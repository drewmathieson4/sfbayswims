// Boot the engine for a page: URL flags → CONFIG overrides → view sizing → the world index → the runtime → worlds.
// An app calls boot(), builds its UI on `live` and state, then activateFirst(); switchWorld()/nextWorld() switch views.
import { CONFIG } from './config.js';
import { state, set } from './state.js';
import { fitView, viewBoxOf } from './projection.js';
import { loadIndex, loadWorld, buildWorld } from './world.js';
import { applyShow } from './show.js';
import { start } from './runtime.js';

const $ = id => document.getElementById(id);

/**
 * @param params      URLSearchParams (default: the page's)
 * @param overrides   [fn(CONFIG)] — the app's config patches, re-applied after every world's config; URL flags come last
 * @param firstWorld  ids => id | null — the app's preferred first world when the URL names none
 * @param onActivate  world => void — after each world is mounted (titles, memory)
 * @param dom         { mapEl, svg, photoSvg, photoImg, canvas, hintEl } (default: the standard ids)
 */
export async function boot({ params = new URLSearchParams(location.search), overrides = [], firstWorld = null, onActivate = null, dom = null } = {}) {

  const html = document.documentElement;
  const flag = k => params.has(k) && params.get(k) !== '0';
  if (flag('kiosk')) { html.classList.add('kiosk'); state.kiosk = true; }
  if (flag('still')) state.still = true;
  if (flag('debug')) { html.classList.add('debug'); state.debug = true; }

  // CONFIG composition: defaults ← world.json config ← app overrides ← URL flags — re-applied after every world switch
  const urlOverrides = C => {
    if (params.has('fps')) C.anim.maxFps = +params.get('fps');
    if (params.has('kn')) C.debugCurrentKn = +params.get('kn');
    for (const k of ['swimmer', 'streaks', 'ui']) if (params.get(k) === '0' || flag('static')) C.show[k] = false;
  };
  const applyOverrides = C => { for (const f of [...overrides, urlOverrides]) f(C); };
  const applyCssVars = () => {
    const vars = { '--photo-filter': CONFIG.photo.filter, '--route-done-w': CONFIG.route.doneWidth + 'px', '--swimmer-r': CONFIG.route.dotR, '--ui-scale': CONFIG.uiScale };
    for (const [k, v] of Object.entries(vars)) html.style.setProperty(k, v);
  };
  applyOverrides(CONFIG);
  state.show = { ...CONFIG.show }; applyShow();
  {
    const p = params.get('pace');                        // "1:45" per 100 m, or m/s like "0.9"
    const m = p && /^(\d+):(\d\d)$/.exec(p);
    state.paceMps = m ? 100 / (+m[1] * 60 + +m[2]) : (+p || CONFIG.paceMps);
  }

  // ---- DOM + view: one viewBox in metres shared by the photo SVG and the drawing SVG; canvases at device resolution ----
  const d = dom || { mapEl: $('map'), svg: $('svg'), photoSvg: $('photo'), photoImg: $('photo-img'), canvas: $('particles'), hintEl: $('hint') };
  const { mapEl, svg, photoSvg, canvas } = d;
  const env = { svg, photoSvg, photoImg: d.photoImg, urlOverrides: applyOverrides, applyCssVars };
  const live = { extent: null };                         // what the running app reads at call time: extent, routes, field, photo, geom, particles, swimmer
  const resizeHandlers = [];
  function onResize(fn) { resizeHandlers.push(fn); if (state.view) fn(state.view); }
  function applyView() {
    if (!live.extent) return;
    const rect = mapEl.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const view = fitView(live.extent, rect.width, rect.height, dpr);
    for (const el of [svg, photoSvg]) { el.setAttribute('viewBox', viewBoxOf(view)); el.setAttribute('preserveAspectRatio', 'none'); }
    const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    canvas.style.width = rect.width + 'px'; canvas.style.height = rect.height + 'px';
    canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    set({ view });
    for (const fn of resizeHandlers) fn(view);
  }
  new ResizeObserver(applyView).observe(mapEl);
  window.addEventListener('resize', applyView);

  // ---- worlds ----
  let index;
  try { index = await loadIndex(); } catch (e) { console.error('data/worlds/index.json is missing or invalid — is the app being served from its own folder?', e.message); throw e; }
  const ids = index.worlds.map(w => w.id);
  const wanted = params.get('world'), preferred = firstWorld?.(ids);
  if (wanted && !ids.includes(wanted)) console.warn(`unknown world '${wanted}', using default`);
  const firstId = ids.includes(wanted) ? wanted : ids.includes(preferred) ? preferred : index.default;

  setInterval(() => set({ now: Date.now() }), 1000);
  if (params.has('t')) { const t = Date.parse(params.get('t')); if (!isNaN(t)) set({ selectedTime: t }); }

  window.APP = { state, CONFIG, index, live };           // for the console and the test hooks
  const services = await start({ canvas, mapEl, params, onResize, live, hintEl: d.hintEl });

  function activate(data) {
    const world = buildWorld(data, env, services.refs);
    Object.assign(live, { world, extent: world.extent, routes: world.routes, field: world.field, photo: world.photo, geom: world.geom });
    applyView();
    const remembered = state.routeByWorld[world.id], wantedRoute = params.get('route');
    const routeId = world.routes.some(r => r.id === wantedRoute) ? wantedRoute : world.routes.some(r => r.id === remembered) ? remembered : world.routes[0].id;
    services.mount(world);
    set({ world: world.id, routeId });
    Object.assign(window.APP, { geom: world.geom, routes: world.routes, layers: world.layers, photo: world.photo, app: services });
    onActivate?.(world);
  }
  let switching = false;
  async function switchWorld(id) {
    if (switching || !ids.includes(id) || id === state.world) return;
    switching = true;
    try { state.routeByWorld[state.world] = state.routeId; const data = await loadWorld(id); services.unmount(); activate(data); }
    catch (e) { console.error('world switch failed:', e.message, e.stack); }
    finally { switching = false; }
  }
  function nextWorld() { const i = ids.indexOf(state.world); return switchWorld(ids[(i + 1) % ids.length]); }
  /** Mounts the first world (then the ?frames hook) and preloads the others so a switch is instant. */
  async function activateFirst() {
    try { activate(await loadWorld(firstId)); services.afterMount(); }
    catch (e) { console.error('app start failed:', e.message, e.stack); window.APP.startError = e; }
    setTimeout(() => { for (const id of ids) if (id !== state.world) loadWorld(id).catch(e => console.warn('preload', id, e.message)); }, 5000);
  }
  return { services, live, ids, dom: d, params, activateFirst, switchWorld, nextWorld };
}
