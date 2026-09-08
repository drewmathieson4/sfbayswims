// Draw a swim: tap the water to add waypoints (a tap within draw.snapM of a landmark snaps to it), drag a marker to move
// it, undo, choose the shape (one way · out and back · loop), name it. The route is rebuilt on every change through the
// same builder as routes.json, so the physics, the legs and the best starts work on it at once. A custom swim travels
// in the share URL (wp=) and in saved plans.
import { customSwim, MAX_WAYPOINTS } from '../engine/validate.js';
import { CONFIG } from '../engine/config.js';
import { state, set, bumpData, on } from '../engine/state.js';
import { buildRoutes } from '../engine/routes.js';
import { routeCrossesLand } from '../engine/world.js';
import { el } from '../engine/map.js';

const $ = id => document.getElementById(id);

export function createDraw({ b, onChange = null }) {
  const html = document.documentElement, map = b.dom.mapEl, live = b.live;
  const st = { on: false, name: '', mode: 'oneway', points: [] };            // points: { lat, lon, id?, name? }
  const ui = { bar: $('draw-bar'), name: $('draw-name'), mode: $('draw-mode'), warn: $('draw-warn'), start: $('draw-start'), seed: $('draw-seed'), undo: $('draw-undo'), clear: $('draw-clear'), done: $('draw-done'), cancel: $('draw-cancel'), count: $('draw-count') };
  let group = null, groupLayer = null, drag = null, down = null, previousWorld = null;
  const drafts = new Map();
  const world = () => live.world;
  const xy = p => world().proj.project(p.lat, p.lon);
  const unproject = (clientX, clientY) => { const v = state.view, r = map.getBoundingClientRect(); return { x: v.x0 + (clientX - r.left) / v.s, y: v.y1 - (clientY - r.top) / v.s }; };
  /** A point on the water at (x, y): the nearest landmark within snapM, else the coordinates themselves. */
  function pointAt(x, y) {
    let best = null, bd = CONFIG.draw?.snapM ?? 30;
    for (const l of world().landmarks.values()) { const d = Math.hypot(l.x - x, l.y - y); if (d < bd) { bd = d; best = l; } }
    if (best) return { lat: best.lat, lon: best.lon, id: best.id, name: best.name };
    const ll = world().proj.unproject(x, y); return { lat: +ll.lat.toFixed(5), lon: +ll.lon.toFixed(5) };
  }
  /** Rebuild the custom route from the points (≥ 2) and select it; with fewer points, drop it. */
  function rebuild() {
    const w = world(); if (!w) return;
    const i = w.routes.findIndex(r => r.id === 'custom'); if (i >= 0) w.routes.splice(i, 1);
    ui.warn.textContent = '';
    if (st.points.length >= 2) {
      if (!customSwim(st, w.world.bbox)) { ui.warn.textContent = `Use 2–${MAX_WAYPOINTS} points inside this spot, with a total length below 100 km.`; if (state.routeId === 'custom') set({ routeId: w.routes[0].id }); return; }
      const json = { routes: [{ id: 'custom', name: st.name.trim().slice(0, 120) || 'Custom swim', oneWay: st.mode === 'oneway', loop: st.mode === 'loop',
        waypoints: st.points.map((p, k) => (p.id ? p.id : { lat: p.lat, lon: p.lon, name: String(k + 1) })) }] };
      try {
        const { routes } = buildRoutes(json, w.landmarksJson, w.geom, { proj: w.proj, followOffsetM: CONFIG.route.followOffsetM, keepRightM: CONFIG.route.keepRightM, turnRadiusM: CONFIG.route.turnRadiusM });
        const r = routes[0]; r.custom = true; r.crossesLand = !!routeCrossesLand(r, w.geom); w.routes.push(r);
        if (r.crossesLand) ui.warn.textContent = 'a leg crosses land';
        if (state.routeId !== 'custom') set({ routeId: 'custom' }); else bumpData({});
      } catch (e) { ui.warn.textContent = e.message; }
    } else if (state.routeId === 'custom') set({ routeId: w.routes[0].id });
    markers(); ui.count.textContent = st.points.length ? `${st.points.length} point${st.points.length > 1 ? 's' : ''}` : 'tap the water to add points';
    onChange?.();
  }
  /** The markers: one circle per point, draggable. */
  function markers() {
    const layer = world()?.layers?.route; if (!layer) return;
    if (groupLayer !== layer) { group = el('g', { id: 'draw' }, layer); groupLayer = layer; }
    group.innerHTML = '';
    if (!st.on) return;
    const r = CONFIG.route.dotR * 1.1;
    st.points.forEach((p, k) => {
      const { x, y } = xy(p);
      const c = el('circle', { cx: x.toFixed(1), cy: (-y).toFixed(1), r: r.toFixed(2), 'data-k': k }, group);
      c.addEventListener('pointerdown', e => { e.stopPropagation(); drag = { k, moved: false }; c.setPointerCapture(e.pointerId); });
      c.addEventListener('pointermove', e => { if (!drag || drag.k !== k) return; drag.moved = true; const q = unproject(e.clientX, e.clientY); const ll = world().proj.unproject(q.x, q.y); st.points[k] = { lat: ll.lat, lon: ll.lon }; c.setAttribute('cx', q.x.toFixed(1)); c.setAttribute('cy', (-q.y).toFixed(1)); });
      c.addEventListener('pointerup', e => { if (!drag) return; const moved = drag.moved; drag = null; if (moved) { const q = unproject(e.clientX, e.clientY); if (world().field.isWater(q.x, q.y)) st.points[k] = pointAt(q.x, q.y); rebuild(); } });
      c.addEventListener('pointercancel', () => { drag = null; rebuild(); });
    });
  }
  // a tap on the water adds a point (the probe stands aside while drawing)
  map.addEventListener('pointerdown', e => { if (st.on && !drag) down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  map.addEventListener('pointerup', e => {
    if (!st.on || !down || drag) { down = null; return; }
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6, dt = performance.now() - down.t; down = null;
    if (moved || dt > 600) return;
    const q = unproject(e.clientX, e.clientY);
    if (!world().field.isWater(q.x, q.y)) { ui.warn.textContent = 'that is land'; return; }
    if (st.points.length >= MAX_WAYPOINTS) { ui.warn.textContent = `Maximum ${MAX_WAYPOINTS} points`; return; }
    st.points.push(pointAt(q.x, q.y)); rebuild();
  });
  function begin(seed = null) {
    st.on = true; html.classList.add('drawing'); ui.bar.hidden = false; ui.start.hidden = true;
    if (seed) { st.points = seed.points.map(p => ({ ...p })); st.name = seed.name || ''; st.mode = seed.mode || 'oneway'; }
    ui.name.value = st.name; ui.mode.value = st.mode;
    rebuild();
  }
  function end(keep) {
    st.on = false; html.classList.remove('drawing'); ui.bar.hidden = true; ui.start.hidden = false;
    if (!keep) { st.points = []; }
    rebuild();
  }
  ui.start.onclick = () => begin();
  ui.seed.onclick = () => { const r = (live.routes || []).find(q => q.id === state.routeId); if (!r) return; begin({ name: r.custom ? r.name : `${r.name} (edited)`, mode: r.loop ? 'loop' : r.oneWay ? 'oneway' : 'outback', points: r.waypoints.map(w => (w.id ? { lat: w.lat, lon: w.lon, id: w.id, name: w.name } : { lat: w.lat, lon: w.lon })) }); };
  ui.undo.onclick = () => { st.points.pop(); rebuild(); };
  ui.clear.onclick = () => { st.points = []; rebuild(); };
  ui.done.onclick = () => end(true);
  ui.cancel.onclick = () => end(false);
  ui.name.addEventListener('input', () => { st.name = ui.name.value; rebuild(); });
  ui.mode.addEventListener('change', () => { st.mode = ui.mode.value; rebuild(); });
  on('world', id => {
    if (previousWorld) drafts.set(previousWorld, { name: st.name, mode: st.mode, points: st.points.map(p => ({ ...p })) });
    previousWorld = id; groupLayer = null; drag = down = null; st.on = false;
    html.classList.remove('drawing'); ui.bar.hidden = true; ui.start.hidden = false;
    const saved = drafts.get(id); st.name = saved?.name || ''; st.mode = saved?.mode || 'oneway'; st.points = saved?.points.map(p => ({ ...p })) || [];
  });
  return {
    /** The custom swim as data (for saved plans and the URL), or null. */
    get custom() { return (live.routes || []).some(r => r.id === 'custom') ? { name: st.name.trim().slice(0, 120) || 'Custom swim', mode: st.mode, points: st.points.map(p => ({ lat: p.lat, lon: p.lon })) } : null; },
    /** Build and select a custom swim from data (a shared link or a saved plan). */
    load(c) { c = customSwim(c, world()?.world.bbox); if (!c) { ui.warn.textContent = 'Invalid shared swim for this spot'; return false; } st.points = c.points.map(p => ({ lat: +p.lat, lon: +p.lon })); st.name = c.name || 'Custom swim'; st.mode = c.mode || 'oneway'; if (st.on) { ui.name.value = st.name; ui.mode.value = st.mode; } rebuild(); },
    get drawing() { return st.on; },
  };
}
