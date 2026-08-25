// The engine's runtime: live-data refresh loops, the physics recompute, the animation loop, per-world mount/unmount.
// boot.js starts it once and mounts worlds into it; apps read state, subscribe with on(), and hook the loop with onTick().
import { CONFIG } from './config.js';
import { state, set, on, bumpData, displayTime, physicsTime } from './state.js';
import * as data from './data.js';
import { TideSeries } from './tide.js';
import { createDebug } from './debug.js';
import { CurrentSeries } from './current.js';
import { createParticles } from './particles.js';
import { integrateRoute, scanWindows } from './swim.js';
import { createSwimmer } from './animate.js';

/**
 * playOptions(res, route) → opts for swimmer.setRoute (the frame scales every swim); windowScan 'infeasible' | 'off' overrides
 * the world's ui.windowScan; followSwimmer false keeps the picture at now while a swim plays.
 */
export async function start({ canvas, mapEl, params, onResize, live, hintEl = null, playOptions = null, windowScan = null, followSwimmer = true }) {
  const offline = params.has('offline');
  const seed = params.has('seed') ? +params.get('seed') : null;
  const frames = params.has('frames') ? +params.get('frames') : null;   // test hook: render N frames, then freeze
  const H = 3600e3;

  // ---- shared series: the tide (bundle + cache + live) and the cove station's live current window ----
  // refs are functions because both series are replaced as data arrives; the fields read them at call time.
  let tide = null, currents = null;
  const refs = { tideRef: () => tide, liveCurrentsRef: () => currents };
  const debug = createDebug({ mapEl, params });

  const year = new Date().getFullYear();
  for (const y of [year, year + 1]) {                                   // this year's and next year's bundles: no restart at New Year
    const b = await data.loadBundle(`tides-${y}.json`);
    if (b?.hilo?.length) tide = TideSeries.merge(tide, new TideSeries({ hilo: b.hilo, station: b.station }));
  }
  const cachedTide = data.cacheGet('tides');
  if (cachedTide?.hilo) tide = TideSeries.merge(tide, new TideSeries(cachedTide));
  if (tide) bumpData({});

  let failures = 0, lastOk = Date.now();
  const noteOk = () => { failures = 0; lastOk = Date.now(); if (hintEl) hintEl.textContent = ''; };
  const noteFail = () => { failures++; };
  async function refreshTides() {
    const now = Date.now(), c = data.cacheGet('tides');
    if (c && now - (c.fetchedAt || 0) < CONFIG.refresh.tideH * H && tide?.covers(now - 12 * H, now + 30 * H)) return;
    try { const r = await data.fetchTides({ t0: now - 36 * H, t1: now + 36 * H }); data.cachePut('tides', r); tide = TideSeries.merge(tide, new TideSeries(r)); bumpData({}); noteOk(); }
    catch (e) { console.warn('tides', e.message); noteFail(); }
  }
  async function refreshWaterTemp() {
    try { const w = await data.fetchWaterTemp(); bumpData({ waterTemp: w }); state.data.sources.waterTemp = w.source; noteOk(); }
    catch (e) { console.warn(e.message); noteFail(); await climatologyFallback(); }
  }
  async function climatologyFallback() {
    const clim = await data.loadBundle('watertemp-climatology.json'), v = data.climatologyTemp(clim, Date.now());
    if (v != null) bumpData({ waterTemp: { t: Date.now(), degF: v, approx: true, source: 'climatology' } });
  }
  async function refreshWind() { try { const w = await data.fetchWind(); bumpData({ wind: w }); noteOk(); } catch (e) { console.warn('wind', e.message); noteFail(); } }
  async function refreshCurrents() {
    const now = Date.now(), c = data.cacheGet('currents'); let series = c;
    if (!c || now - (c.fetchedAt || 0) > CONFIG.refresh.currentsH * H || !(c.samples?.length) || c.samples[c.samples.length - 1].t < now + 24 * H) {
      try { series = await data.fetchCurrents({ t0: now - 36 * H, t1: now + 36 * H }); data.cachePut('currents', series); noteOk(); } catch (e) { console.warn('currents', e.message); noteFail(); }
    }
    if (series?.samples?.length) { currents = new CurrentSeries(series); bumpData({}); }
  }
  if (!offline) {
    refreshTides(); refreshWaterTemp(); refreshWind(); refreshCurrents();
    setInterval(refreshTides, 30 * 60000); setInterval(refreshCurrents, 30 * 60000);
    setInterval(refreshWaterTemp, CONFIG.refresh.waterTempMin * 60000); setInterval(refreshWind, CONFIG.refresh.windMin * 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshWaterTemp(); refreshWind(); } });
    if (state.kiosk) setInterval(() => { const h = CONFIG.offlineHint; if (hintEl) hintEl.textContent = (failures >= 2 && Date.now() - lastOk > h.afterS * 1000) ? h.text : ''; }, 30000);
  } else await climatologyFallback();

  // ---- per-world: particles + swimmer ----
  let world = null, particles = null, swimmer = null;
  onResize(v => particles?.resize(v));
  function mount(w) {
    world = w;
    particles = createParticles({ canvas, geometry: w.geom, field: w.field, config: CONFIG, seed });
    if (state.view) particles.resize(state.view);
    swimmer = createSwimmer({ routeLayer: w.layers.route, swimmerLayer: w.layers.swimmer, config: CONFIG });
    live.particles = particles; live.swimmer = swimmer;
    bumpData({});                                                       // data.version bump → the field drops its cached frame
  }
  function unmount() {
    clearTimeout(recomputeTimer); recomputeTimer = null; clearTimeout(scanTimer); scanTimer = null;
    particles?.clear(); world?.photo.dispose(); particles = null; swimmer = null; world = null; set({ windows: null, swimming: false, paused: false });
  }

  // ---- physics: every route is re-integrated when the time, pace, route or data change (debounced 120 ms) ----
  let dirty = true, lastMinute = -1, recomputeTimer = null, scanTimer = null, scanMemo = new Map();
  const markDirty = () => { dirty = true; clearTimeout(recomputeTimer); recomputeTimer = setTimeout(() => { recomputeTimer = null; if (dirty) recomputeSafe(); }, 120); };
  const recomputeSafe = () => { try { recompute(); } catch (e) { console.error('recompute:', e.message, e.stack); } };
  on('selectedTime', markDirty); on('paceMps', markDirty); on('data', markDirty); on('routeId', markDirty);
  on('icon', () => swimmer?.rebuild());
  const minuteTick = () => { if (state.selectedTime != null || state.swimming) return; const m = Math.floor(state.now / 60000); if (m !== lastMinute) { lastMinute = m; markDirty(); } };
  on('now', minuteTick);
  // ---- the swim: one lap per ▶ start (state.swimming). While it plays the picture follows the swimmer's moment (state.swimAt):
  // the streaks, the HUD current and the clock read displayTime(); the swim keeps its start minute until it ends.
  on('swimming', v => {
    if (v) { if (dirty) recomputeSafe(); state.swimAt = followSwimmer ? state.physics?.at ?? null : null; }
    else { swimmer?.reset(); state.swimAt = null; minuteTick(); }             // catch up on the minutes that passed meanwhile
  });
  const stopSwim = () => set({ swimming: false, paused: false });
  for (const k of ['routeId', 'selectedTime', 'paceMps', 'world']) on(k, stopSwim);   // whatever changes what is being swum stops the swim
  on('show', s => { if (!s.swimmer) stopSwim(); });
  function recompute() {
    dirty = false;
    if (!world || !swimmer) return;
    const at = state.swimming && state.physics ? state.physics.at : physicsTime(), byRoute = new Map(), t0 = performance.now();
    for (const r of world.routes) byRoute.set(r.id, integrateRoute(r, at, state.paceMps, world.field));
    set({ physics: { at, byRoute, ms: performance.now() - t0 } });
    const r = world.routes.find(x => x.id === state.routeId) || world.routes[0];
    swimmer.setRoute(byRoute.get(r.id), playOptions?.(byRoute.get(r.id), r));
    scheduleScan(r, byRoute.get(r.id));
  }
  // the 48-h feasibility scan: only for infeasible routes, memoised per half hour (it is ~100 route integrations)
  function scheduleScan(r, res) {
    const w = world, mode = windowScan || w.world.ui?.windowScan || 'off';
    if (mode === 'off' || res.feasible) { if (state.windows) set({ windows: null }); return; }
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanTimer = null;
      if (world !== w) return;
      const key = `${w.id}:${r.id}:${Math.floor(physicsTime() / 1800e3)}:${state.paceMps}:${state.data.version}`;
      let win = scanMemo.get(key);
      if (!win) { const t0 = performance.now(); win = { ...scanWindows(r, physicsTime(), state.paceMps, w.field), routeId: r.id, ms: performance.now() - t0 }; scanMemo.set(key, win); if (scanMemo.size > 64) scanMemo.delete(scanMemo.keys().next().value); }
      set({ windows: win });
    }, 300);
  }

  // ---- the loop ----
  let last = performance.now(), forceRender = false, frozen = false, loopErrors = 0, acc = 0, streaksWere = true;
  const tickFns = [];                                    // the apps' per-frame hooks fn(dt, force): the rail's elapsed/speed live there
  function tick(ts) {
    const dt = Math.min(0.05, (ts - last) / 1000); last = ts;
    const maxFps = CONFIG.anim.maxFps || 0;
    if (maxFps > 0) { acc += dt; if (acc < 1 / maxFps) { requestAnimationFrame(tick); return; } }
    const step = maxFps > 0 ? acc : dt; acc = 0;
    try { tickBody(step); } catch (e) { if (loopErrors++ < 3) console.error('loop error:', e.message, e.stack); }
    requestAnimationFrame(tick);
  }
  function tickBody(dt) {
    if ((frozen && !forceRender) || !particles || !swimmer || (document.hidden && !forceRender)) return;
    if (state.show.streaks) particles.step(dt, displayTime()); else if (streaksWere) particles.clear();
    streaksWere = state.show.streaks;
    if (state.swimming && !state.paused) {
      if (swimmer.step(dt)) stopSwim();                                       // lap over: the swimmer is back at the start, the picture returns to now
      else state.swimAt = followSwimmer && state.physics ? state.physics.at + swimmer.elapsed * 1000 : null;
    }
    for (const fn of tickFns) fn(dt, false);
    if (state.debug) debug.draw({ world, particles, t: displayTime() });
  }
  requestAnimationFrame(tick);
  /** Test hooks: ?frames=N starts the swim, renders N frames after the first mount and freezes; stepFrames() advances a frozen page. */
  function stepFrames(n, dt = 1 / 30) { if (dirty) recomputeSafe(); forceRender = true; try { for (let i = 0; i < n; i++) tickBody(dt); } finally { forceRender = false; } }
  async function afterMount() {
    if (!Number.isFinite(frames)) return;
    try { await world?.photo.ready; await new Promise(r => setTimeout(r, 50)); if (state.show.swimmer) set({ swimming: true }); stepFrames(frames); for (const fn of tickFns) fn(0, true); }
    finally { frozen = true; document.documentElement.classList.add('snapshot-ready'); }
  }

  return { refs, mount, unmount, afterMount, recompute: recomputeSafe, stepFrames, onTick: fn => { tickFns.push(fn); }, get particles() { return particles; }, get swimmer() { return swimmer; }, get field() { return world?.field; } };
}
