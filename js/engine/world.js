// A world = data/worlds/<id>/: photo, geometry, landmarks, routes, current bundles and a config patch. loadWorld()
// fetches the folder (cached); buildWorld() turns it into projection + geometry + routes + photo + layers + field.
import { CONFIG } from './config.js';
import { createProjection, unionExtent, extentOfPoints } from './projection.js';
import { buildGeometry, isWater } from './geometry.js';
import { loadMask, buildMaskGeometry } from './mask.js';
import { buildRoutes } from './routes.js';
import { createPhoto } from './photo.js';
import { createLayers } from './map.js';
import { createField, CurrentSeries } from './current.js';
import { createStationField } from './stationfield.js';
import { state } from './state.js';
import { tzParts } from './data.js';
import { dataUrl } from './paths.js';

const BASE = structuredClone(CONFIG);      // the defaults = the cove, captured before main.js applies URL flags
const loaded = new Map(), built = new Map();
const optionalJSON = url => loadJSON(url).catch(() => null);

export async function loadJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
export function loadIndex() { return loadJSON(dataUrl('worlds/index.json')); }

export async function loadWorld(id, year = tzParts(Date.now()).y) {
  if (!loaded.has(id)) {
    const promise = (async () => {
      const dir = dataUrl(`worlds/${id}/`), world = await loadJSON(dir + 'world.json'), pdir = dir + (world.photo?.dir || 'photo') + '/';
      const jobs = { landmarks: loadJSON(dir + world.landmarks), routes: loadJSON(dir + world.routes), photoMeta: optionalJSON(pdir + 'photo.json') };
      if (world.geometry.type === 'zones') { jobs.shoreline = loadJSON(dir + world.geometry.shoreline); jobs.zones = loadJSON(dir + world.geometry.zones); }
      else { jobs.maskMeta = loadJSON(dir + world.geometry.meta); jobs.mask = loadMask(dir + world.geometry.file); }
      if (world.field.type === 'stations') jobs.stations = loadJSON(dir + world.field.stations);
      const keys = Object.keys(jobs), values = await Promise.all(Object.values(jobs));
      const data = { id, world, dir, pdir, bundles: new Map(), pending: new Map() };
      keys.forEach((k, i) => { data[k] = values[i]; });
      return data;
    })();
    loaded.set(id, promise);
    promise.catch(() => loaded.delete(id));
  }
  const data = await loaded.get(id);
  await loadCurrentYear(data, year);
  return data;
}

function validSeries(s) {
  return s && Number.isFinite(s.t0) && Number.isFinite(s.dtMs) && s.dtMs > 0 && s.dtMs <= 3600000 &&
    Array.isArray(s.kn) && s.kn.length > 1 && Array.isArray(s.dir) && s.kn.length === s.dir.length &&
    s.kn.every(v => Number.isFinite(v) && v >= 0 && v <= 30) && s.dir.every(v => Number.isFinite(v) && v >= 0 && v <= 360);
}
async function loadCurrentYear(data, year) {
  if (!data.pending.has(year)) data.pending.set(year, (async () => {
    const bundle = await optionalJSON(dataUrl(data.world.bundles.currents.replace('{year}', year)));
    const series = data.world.field.type === 'stations' ? data.stations.stations.map(s => bundle?.stations?.[s.id]) : [bundle];
    if (!series.length || !series.every(validSeries)) return false;
    data.bundles.set(year, bundle); return true;
  })());
  return data.pending.get(year);
}

// Only requested calendar years are fetched; nearby year boundaries are covered by bundle padding.
export async function loadCurrentRange(data, start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 370 * 86400e3) throw new Error('Invalid prediction range');
  const before = data.bundles.size;
  for (let y = tzParts(start).y; y <= tzParts(end).y; y++) await loadCurrentYear(data, y);
  return before !== data.bundles.size;
}

function deepAssign(dst, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object') deepAssign(dst[k], v);
    else dst[k] = v;
  }
}
/** CONFIG ← defaults, then the world's patch, then the URL flags — in place, so every module's reference stays valid. */
export function applyWorldConfig(world, urlOverrides) {
  for (const k of Object.keys(CONFIG)) if (!(k in BASE)) delete CONFIG[k];
  deepAssign(CONFIG, structuredClone(BASE));
  deepAssign(CONFIG, world.config || {});
  urlOverrides?.(CONFIG);
}

/** Everything the app needs for a world. The expensive parts (grid, routes, field) are built once per world id. */
export function buildWorld(data, env, refs) {
  const { world } = data;
  applyWorldConfig(world, env.urlOverrides); env.applyCssVars();
  let b = built.get(data.id);
  if (!b) {
    const t0 = performance.now(), proj = createProjection(CONFIG.origin);
    if (world.geometry.type === 'mask' && world.field.type === 'cove') throw new Error(`world ${data.id}: the cove field needs zone geometry`);
    const geom = world.geometry.type === 'zones' ? buildGeometry(data.shoreline, data.zones, CONFIG, proj) : buildMaskGeometry(data.mask, data.maskMeta, proj);
    const { routes, landmarks } = buildRoutes(data.routes, data.landmarks, geom, { proj, followOffsetM: CONFIG.route.followOffsetM, keepRightM: CONFIG.route.keepRightM, turnRadiusM: CONFIG.route.turnRadiusM });
    if (state.debug) checkLand(routes, geom);
    let extent = CONFIG.view.extent;
    if (!extent) {                                       // fit: the core box ∪ the routes, padded
      const pts = routes.flatMap(r => r.points);
      extent = CONFIG.view.core ? { ...CONFIG.view.core } : null;
      if (pts.length) extent = extent ? unionExtent(extent, extentOfPoints(pts)) : extentOfPoints(pts);
      const pad = CONFIG.view.routePadM;
      extent = { x0: extent.x0 - pad, x1: extent.x1 + pad, y0: extent.y0 - pad, y1: extent.y1 + pad };
    }
    let field, stations = null, bundle = null;
    const seriesById = new Map();
    if (world.field.type === 'stations') {
      stations = (data.stations?.stations || []).map(s => ({ ...s, ...proj.project(s.lat, s.lon) }));
      for (const s of stations) seriesById.set(s.id, new CurrentSeries({ samples: [] }));
      field = createStationField({ geometry: geom, stations, seriesById, tideRef: refs.tideRef, liveRef: refs.liveCurrentsRef, config: CONFIG, fieldCfg: world.field });
    } else {
      const currentsRef = () => { const live = refs.liveCurrentsRef(); if (live && bundle) return { covers: t => live.covers(t) || bundle.covers(t), at: t => live.covers(t) ? live.at(t) : bundle.at(t) }; return live || bundle; };
      field = createField({ geometry: geom, tideRef: refs.tideRef, currentsRef, config: CONFIG });
    }
    let intervals = [], revision = -1;
    function updateCurrents() {
      if (revision === data.bundles.size) return;
      revision = data.bundles.size;
      const bundles = [...data.bundles.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
      if (stations) for (const s of stations) seriesById.set(s.id, CurrentSeries.concat(bundles.map(b => b.stations[s.id]), s.id));
      else bundle = bundles.length ? CurrentSeries.concat(bundles, CONFIG.stations.currents) : null;
      const ranges = bundles.map(b => {
        const ss = stations ? stations.map(s => b.stations[s.id]) : [b];
        return { start: Math.max(...ss.map(s => s.t0)), end: Math.min(...ss.map(s => s.t0 + (s.kn.length - 1) * s.dtMs)) };
      }).sort((a, b) => a.start - b.start);
      intervals = [];
      for (const range of ranges) {
        const last = intervals.at(-1);
        if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
        else intervals.push({ ...range });
      }
      field.ctx.t = NaN;
    }
    const covers = (start, end) => intervals.some(r => r.start <= start && r.end >= end);
    const horizon = t => (intervals.find(r => r.start <= t && r.end >= t) || intervals.at(-1))?.end ?? -Infinity;
    const ensureCurrents = async (start, end) => { const changed = await loadCurrentRange(data, start, end); updateCurrents(); return changed; };
    b = { proj, geom, routes, landmarks, landmarksJson: data.landmarks, extent, field, stations, horizon, covers, ensureCurrents, updateCurrents };
    built.set(data.id, b);
    console.log(`world ${data.id}: grid ${geom.grid.nx}×${geom.grid.ny} @ ${geom.grid.cell.toFixed(1)} m, ${routes.length} routes, ${stations ? stations.length + ' stations' : 'cove field'}, ${Math.round(performance.now() - t0)} ms`);
  }
  b.updateCurrents();
  const photo = createPhoto({ svg: env.photoSvg, img: env.photoImg, meta: data.photoMeta, proj: b.proj, dir: data.pdir });
  const layers = createLayers(env.svg);
  return { id: data.id, world, ...b, photo, layers };
}

/** Route authoring aid (?debug=1): warn when a leg crosses land — beach ends excused, nicks under 30 m ignored. */
/** Does any leg of the route run over land (three consecutive 10-m samples off the water)? Returns the first such leg or null. */
export function routeCrossesLand(r, geom) {
  for (const leg of r.legs) {
    const n = Math.max(1, Math.ceil(leg.meters / 10)), skip = Math.min(4, Math.floor(n / 3)); let run = 0;
    for (let s = skip; s <= n - skip; s++) {
      const x = leg.from.x + (leg.to.x - leg.from.x) * s / n, y = leg.from.y + (leg.to.y - leg.from.y) * s / n;
      if (isWater(geom, x, y)) { run = 0; continue; }
      if (++run >= 3) return { leg, x, y };
    }
  }
  return null;
}
function checkLand(routes, geom) {
  for (const r of routes) { const c = routeCrossesLand(r, geom); if (c) console.warn(`route ${r.id}: leg ${c.leg.from.id || '·'}→${c.leg.to.id || '·'} crosses land near x=${Math.round(c.x)} y=${Math.round(c.y)} m`); }
}
