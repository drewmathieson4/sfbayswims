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
import { dataUrl } from './paths.js';

const BASE = structuredClone(CONFIG);      // the defaults = the cove, captured before main.js applies URL flags
const loaded = new Map(), built = new Map();

export async function loadJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
export function loadIndex() { return loadJSON(dataUrl('worlds/index.json')); }

export async function loadWorld(id, year = new Date().getFullYear()) {
  if (loaded.has(id)) return loaded.get(id);
  const dir = dataUrl(`worlds/${id}/`), world = await loadJSON(dir + 'world.json'), pdir = dir + (world.photo?.dir || 'photo') + '/';
  const opt = url => fetch(url, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);   // optional files → null
  const jobs = {
    landmarks: loadJSON(dir + world.landmarks), routes: loadJSON(dir + world.routes), photoMeta: opt(pdir + 'photo.json'),
    currentsThis: opt(dataUrl(world.bundles.currents.replace('{year}', year))), currentsNext: opt(dataUrl(world.bundles.currents.replace('{year}', year + 1))),
  };
  if (world.geometry.type === 'zones') { jobs.shoreline = loadJSON(dir + world.geometry.shoreline); jobs.zones = loadJSON(dir + world.geometry.zones); }
  else { jobs.maskMeta = loadJSON(dir + world.geometry.meta); jobs.mask = loadMask(dir + world.geometry.file); }
  if (world.field.type === 'stations') jobs.stations = loadJSON(dir + world.field.stations);
  const keys = Object.keys(jobs), values = await Promise.all(keys.map(k => jobs[k]));
  const data = { id, world, dir, pdir };
  keys.forEach((k, i) => { data[k] = values[i]; });
  loaded.set(id, data);
  return data;
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
    let field, stations = null, horizon = Infinity;                 // when the bundled current predictions run out
    if (world.field.type === 'stations') {
      const seriesById = new Map(), a = data.currentsThis?.stations || {}, n = data.currentsNext?.stations || {};
      for (const id of new Set([...Object.keys(a), ...Object.keys(n)])) seriesById.set(id, CurrentSeries.concat([a[id], n[id]], id));
      for (const s of seriesById.values()) if (s.t?.length) horizon = Math.min(horizon, s.t1);
      stations = (data.stations?.stations || []).map(s => ({ ...s, ...proj.project(s.lat, s.lon) }));
      field = createStationField({ geometry: geom, stations, seriesById, tideRef: refs.tideRef, liveRef: refs.liveCurrentsRef, config: CONFIG, fieldCfg: world.field });
    } else {
      // the cove's outside current: the live NOAA window when it covers t, else the year bundle
      const bundle = (data.currentsThis?.kn || data.currentsNext?.kn) ? CurrentSeries.concat([data.currentsThis, data.currentsNext], CONFIG.stations.currents) : null;
      if (bundle?.t?.length) horizon = bundle.t1;
      const currentsRef = () => { const live = refs.liveCurrentsRef(); if (live && bundle) return { covers: t => live.covers(t) || bundle.covers(t), at: t => live.covers(t) ? live.at(t) : bundle.at(t) }; return live || bundle; };
      field = createField({ geometry: geom, tideRef: refs.tideRef, currentsRef, config: CONFIG });
    }
    b = { proj, geom, routes, landmarks, landmarksJson: data.landmarks, extent, field, stations, horizon };
    built.set(data.id, b);
    console.log(`world ${data.id}: grid ${geom.grid.nx}×${geom.grid.ny} @ ${geom.grid.cell.toFixed(1)} m, ${routes.length} routes, ${stations ? stations.length + ' stations' : 'cove field'}, ${Math.round(performance.now() - t0)} ms`);
  }
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
