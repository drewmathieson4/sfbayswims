// The running app: live-data refresh loops, the physics recompute, the animation loop, per-world mount/unmount,
// and the debug overlay. main.js boots it once; worlds are mounted into it.
import { CONFIG } from './config.js';
import { state, set, on, bumpData, effectiveTime, physicsTime } from './state.js';
import * as data from './data.js';
import { TideSeries } from './tide.js';
import { createHud, bindControls, kioskMode } from './ui.js';
import { CurrentSeries, KN } from './current.js';
import { createParticles } from './particles.js';
import { integrateRoute, scanWindows } from './swim.js';
import { createSwimmer } from './animate.js';
import { toPx } from './projection.js';

export async function start({ canvas, mapEl, params, onResize, live, nextWorld }) {
  const offline = params.has('offline');
  const seed = params.has('seed') ? +params.get('seed') : null;
  const frames = params.has('frames') ? +params.get('frames') : null;   // test hook: render N frames, then freeze
  const H = 3600e3;

  // ---- shared series: the tide (bundle + cache + live) and the cove station's live current window ----
  // refs are functions because both series are replaced as data arrives; the fields read them at call time.
  let tide = null, currents = null;
  const refs = { tideRef: () => tide, liveCurrentsRef: () => currents };
  const hud = createHud({ live });
  bindControls({ live, mapEl, onSwitchWorld: nextWorld });
  if (state.kiosk) kioskMode();

  const year = new Date().getFullYear();
  for (const y of [year, year + 1]) {                                   // this year's and next year's bundles: no restart at New Year
    const b = await data.loadBundle(`tides-${y}.json`);
    if (b?.hilo?.length) tide = TideSeries.merge(tide, new TideSeries({ hilo: b.hilo, station: b.station }));
  }
  const cachedTide = data.cacheGet('tides');
  if (cachedTide?.hilo) tide = TideSeries.merge(tide, new TideSeries(cachedTide));
  if (tide) bumpData({});

  let failures = 0, lastOk = Date.now();
  const hintEl = document.getElementById('hint');
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
    particles?.clear(); world?.photo.dispose(); particles = null; swimmer = null; world = null; set({ windows: null });
  }

  // ---- physics: every route is re-integrated when the time, pace, route or data change (debounced 120 ms) ----
  let dirty = true, lastMinute = -1, recomputeTimer = null, scanTimer = null, scanMemo = new Map();
  const markDirty = () => { dirty = true; clearTimeout(recomputeTimer); recomputeTimer = setTimeout(() => { recomputeTimer = null; if (dirty) recomputeSafe(); }, 120); };
  const recomputeSafe = () => { try { recompute(); } catch (e) { console.error('recompute:', e.message, e.stack); } };
  on('selectedTime', markDirty); on('paceMps', markDirty); on('data', markDirty); on('routeId', markDirty);
  on('now', () => { if (state.selectedTime == null) { const m = Math.floor(state.now / 60000); if (m !== lastMinute) { lastMinute = m; markDirty(); } } });
  function recompute() {
    dirty = false;
    if (!world || !swimmer) return;
    const at = physicsTime(), byRoute = new Map(), t0 = performance.now();
    for (const r of world.routes) byRoute.set(r.id, integrateRoute(r, at, state.paceMps, world.field));
    set({ physics: { at, byRoute, ms: performance.now() - t0 } });
    const r = world.routes.find(x => x.id === state.routeId) || world.routes[0];
    swimmer.setRoute(byRoute.get(r.id));
    scheduleScan(r, byRoute.get(r.id));
  }
  // the 48-h feasibility scan: only for infeasible routes, memoised per half hour (it is ~100 route integrations)
  function scheduleScan(r, res) {
    const w = world, mode = w.world.ui?.windowScan || 'off';
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
  let last = performance.now(), hudTick = 0, forceRender = false, frozen = false, loopErrors = 0, acc = 0, streaksWere = true;
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
    if (state.show.streaks) particles.step(dt, effectiveTime()); else if (streaksWere) particles.clear();
    streaksWere = state.show.streaks;
    if (!state.paused && state.show.swimmer) swimmer.step(dt);
    if ((hudTick = (hudTick + 1) % 8) === 0) hud.setElapsed(swimmer.elapsed);
    if (state.debug) drawDebug(effectiveTime());
  }
  requestAnimationFrame(tick);
  /** Test hooks: ?frames=N renders N frames after the first mount and freezes; stepFrames() advances a frozen page. */
  function stepFrames(n, dt = 1 / 30) { if (dirty) recomputeSafe(); forceRender = true; try { for (let i = 0; i < n; i++) tickBody(dt); } finally { forceRender = false; } }
  async function afterMount() {
    if (!Number.isFinite(frames)) return;
    try { await world?.photo.ready; await new Promise(r => setTimeout(r, 50)); stepFrames(frames); hud.setElapsed(swimmer?.elapsed ?? 0); }
    finally { frozen = true; document.documentElement.classList.add('snapshot-ready'); }
  }

  // ---- debug overlay (key d / ?debug=1): current arrows, station dots, the water mask with ?mask=1 ----
  let dbg = null;
  function drawDebug(t) {
    const v = state.view, field = world.field; if (!v) return;
    if (!dbg) { dbg = document.createElement('canvas'); dbg.id = 'debugcanvas'; mapEl.appendChild(dbg); }
    const dpr = v.dpr || 1;
    if (dbg.width !== Math.round(v.pxW * dpr)) { dbg.width = Math.round(v.pxW * dpr); dbg.height = Math.round(v.pxH * dpr); dbg.style.width = v.pxW + 'px'; dbg.style.height = v.pxH + 'px'; }
    const c2 = dbg.getContext('2d'); c2.setTransform(dpr, 0, 0, dpr, 0, 0); c2.clearRect(0, 0, v.pxW, v.pxH);
    const c = field.prepare(t), vec = { x: 0, y: 0 }, stepM = Math.max(25, Math.round(v.w / 60 / 25) * 25);
    c2.strokeStyle = 'rgba(200,0,0,0.6)'; c2.lineWidth = 1; c2.beginPath();
    for (let y = Math.ceil(v.y0 / stepM) * stepM; y < v.y1; y += stepM) for (let x = Math.ceil(v.x0 / stepM) * stepM; x < v.x1; x += stepM) {
      field.sampleInto(x, y, c, vec);
      if (Math.hypot(vec.x, vec.y) < 0.01) continue;
      const sc = stepM * 0.8 / KN, p0 = toPx(v, x, y), p1 = toPx(v, x + vec.x * sc, y + vec.y * sc), a = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
      c2.moveTo(p0[0], p0[1]); c2.lineTo(p1[0], p1[1]);
      c2.moveTo(p1[0], p1[1]); c2.lineTo(p1[0] - 4 * Math.cos(a - 0.5), p1[1] - 4 * Math.sin(a - 0.5));
      c2.moveTo(p1[0], p1[1]); c2.lineTo(p1[0] - 4 * Math.cos(a + 0.5), p1[1] - 4 * Math.sin(a + 0.5));
    }
    c2.stroke();
    if (field.stations) { c2.fillStyle = 'rgba(0,120,255,0.9)'; for (const s of field.stations) { const p = toPx(v, s.x, s.y); c2.beginPath(); c2.arc(p[0], p[1], 3, 0, 7); c2.fill(); c2.fillText(s.id, p[0] + 5, p[1] - 4); } }
    if (params.has('mask')) { const g = world.geom.grid; c2.fillStyle = 'rgba(0,80,255,0.25)'; const step = Math.max(1, Math.round(2 / v.s / g.cell)); for (let j = 0; j < g.ny; j += step) for (let i = 0; i < g.nx; i += step) { if (g.type[j * g.nx + i] === 0) continue; const p = toPx(v, g.x0 + i * g.cell, g.y0 + (j + step) * g.cell); c2.fillRect(p[0], p[1], g.cell * step * v.s + 0.5, g.cell * step * v.s + 0.5); } }
    c2.fillStyle = 'rgba(200,0,0,0.9)'; c2.font = '11px monospace';
    c2.fillText(`ref ${c.kn.toFixed(2)} kn @${c.dir.toFixed(0)}° ${c.flood ? 'FLOOD' : 'EBB'} src=${c.source} | tide ${c.rateFtH.toFixed(2)} ft/h | particles ${particles?.count} | physics ${state.physics?.ms?.toFixed(1)} ms | world ${state.world}`, 12, v.pxH - 12);
  }

  return { hud, refs, mount, unmount, afterMount, recompute: recomputeSafe, stepFrames, get particles() { return particles; }, get swimmer() { return swimmer; }, get field() { return world?.field; } };
}
