// Repeat the dial-selected preset at the frozen departure time; hold, fade, rest, replay.
import { state, set, on } from '../engine/state.js';

export function createCycle({ b, presets, overlay, busy = () => false, onLap = null }) {
  const html = document.documentElement, services = b.services;
  let running = false, list = [], idx = 0, timer = null, finishing = false, current = null, skipped = 0;
  const routesFor = w => { const all = b.live.routes || [], want = presets.routes?.[w]; return want ? want.map(id => all.find(r => r.id === id)).filter(Boolean) : all; };
  const clear = () => { clearTimeout(timer); timer = null; };
  const schedule = ms => { clear(); timer = setTimeout(slot, ms); };
  const hhmm = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  /** Quiet hours (presets.quietHours {from, to, mode}): true while the frame should rest. */
  function quiet() {
    const q = presets.quietHours; if (!q?.from || !q?.to) { html.classList.remove('quiet'); return false; }
    const t = hhmm(), inside = q.from <= q.to ? (t >= q.from && t < q.to) : (t >= q.from || t < q.to);
    html.classList.toggle('quiet', inside && q.mode === 'dark');
    return inside;
  }
  function idle() { clear(); finishing = false; html.classList.remove('fading'); overlay.setCaption(null); current = null; }
  /** Starts the next swim now, or idles when the swimmer is off, the frame is busy, or it is quiet. */
  function slot() {
    clear();
    if (!running || !state.show.swimmer || quiet() || busy()) { idle(); return; }
    if (!list.length) { list = routesFor(state.world); idx = 0; }   // a fresh view starts on a random swim
    if (!list.length) return;
    if (idx >= list.length) { idx = 0; onLap?.(); if (busy()) return; }
    const r = list[idx];
    if (state.routeId !== r.id) set({ routeId: r.id });                  // stops any swim, marks the physics dirty
    services.recompute();                                                // the route at the current minute, with the frame's play options
    const prof = state.physics?.byRoute.get(r.id);
    if (!prof || (!prof.feasible && presets.skipInfeasible)) { idx++; skipped++; const delay = skipped >= list.length ? 60000 : 0; if (delay) skipped = 0; schedule(delay); return; }
    skipped = 0;
    current = r; finishing = false; html.classList.remove('fading');
    overlay.setCaption(r, prof, state.windows?.routeId === r.id ? state.windows : null);
    set({ swimming: true, paused: false });
  }
  // the finish: when the swimmer reaches the end, hold + fade (CSS, html.fading); the runtime stops the swim after
  // anim.pauseS (= hold + fade) and resets the swimmer while everything is invisible; then the rest, then the next swim
  services.onTick(() => {
    if (!running || !state.swimming || finishing) return;
    const total = state.physics?.byRoute.get(state.routeId)?.profile.totalSeconds;
    if (total != null && services.swimmer && services.swimmer.tau >= total - 1e-6) { finishing = true; html.classList.add('fading'); }
  });
  on('swimming', v => { if (!v && running && current) { finishing = false; current = null; schedule(presets.restSeconds * 1000); } });
  on('windows', w => { if (current && w?.routeId === current.id) overlay.setCaption(current, state.physics?.byRoute.get(current.id), w); });
  on('world', () => { list = []; idx = 0; idle(); });
  on('show', s => { if (!s.swimmer) idle(); });
  // the watchdog: whenever the cycle is allowed and nothing is playing or scheduled, start within a second
  on('now', () => {
    const resting = quiet();
    if (running && resting) { idle(); set({ swimming: false, paused: false }); return; }
    if (running && !state.swimming && !finishing && timer == null && state.show.swimmer && !busy()) schedule(0);
  });
  return {
    start() { running = true; schedule(0); },
    stop() { running = false; idle(); set({ swimming: false, paused: false }); },
    next(direction = 1) { current = null; set({ swimming: false, paused: false }); idx = (idx + direction + list.length) % (list.length || 1); finishing = false; html.classList.remove('fading'); slot(); },   // test hook: skip to the next swim now
    get current() { return current; }, get index() { return idx; }, get finishing() { return finishing; },
  };
}
