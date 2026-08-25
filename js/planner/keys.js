// Keys and gestures: ← → time travel (hold accelerates), ↑ ↓ / tap / swipe routes, space start·pause, n current, v view,
// a s u p switches, d debug, h legend, - + pace, i icon, [ ] tempo.
import { CONFIG } from '../engine/config.js';
import { state, set, effectiveTime } from '../engine/state.js';
import { YD100 } from '../engine/format.js';
import { applyShow, toggleShow } from '../engine/show.js';
import { noteInput } from '../engine/input.js';
import { startStop } from './hud.js';

export function bindControls({ live, mapEl, onSwitchWorld }) {
  const routes = () => live.routes || [];
  const cycle = dir => { const rs = routes(); if (!rs.length) return; const i = rs.findIndex(r => r.id === state.routeId); set({ routeId: rs[(i + dir + rs.length) % rs.length].id }); };
  // ---- time travel: tap = ±stepMin, hold = accelerating scrub ----
  const T = CONFIG.scrub;
  const clampT = t => Math.max(state.now - T.maxBackH * 3600e3, Math.min(state.now + T.maxForwardH * 3600e3, t));
  const snap = t => Math.round(t / (T.stepMin * 60000)) * T.stepMin * 60000;
  const setTime = t => set({ selectedTime: Math.abs(t - state.now) < T.snapNowMin * 60000 ? null : clampT(t) });
  let hold = null;
  const endHold = () => { if (!hold) return; clearInterval(hold.timer); if (state.selectedTime != null) setTime(snap(state.selectedTime)); hold = null; };
  const startHold = dir => {
    if (hold && hold.dir !== dir) endHold();
    if (hold) return;
    let t = snap(effectiveTime() + dir * T.stepMin * 60000);
    if (Math.abs(t - state.now) < T.stepMin * 60000) t = snap(state.now) + dir * T.stepMin * 60000;   // a tap always moves a full step
    setTime(t);
    hold = { dir, start: performance.now(), last: performance.now() };
    hold.timer = setInterval(() => {
      const now = performance.now(), held = (now - hold.start) / 1000, dt = (now - hold.last) / 1000; hold.last = now;
      if (held < T.holdDelayS) return;
      const rate = Math.min(T.maxMinPerS, T.startMinPerS * Math.pow(2, (held - T.holdDelayS) / T.doubleEveryS));
      set({ selectedTime: clampT(effectiveTime() + hold.dir * rate * dt * 60000) });
    }, 40);
  };
  window.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    noteInput();
    switch (e.key) {
      case 'ArrowRight': if (!e.repeat) startHold(1); e.preventDefault(); break;
      case 'ArrowLeft': if (!e.repeat) startHold(-1); e.preventDefault(); break;
      case 'ArrowUp': case 'ArrowDown': cycle(e.key === 'ArrowUp' ? -1 : 1); e.preventDefault(); break;
      case ' ': startStop(); e.preventDefault(); break;
      case 'n': case 'N': case 'Escape': case 'Enter': endHold(); set({ swimming: false, paused: false, selectedTime: null }); break;   // stops the swim, back to current
      case 'a': case 'A': toggleShow('swimmer'); break;
      case 's': case 'S': toggleShow('streaks'); break;
      case 'u': case 'U': toggleShow('ui'); break;
      case 'p': case 'P': { const on_ = !(state.show.swimmer || state.show.ui); set({ show: { ...state.show, swimmer: on_, ui: on_ } }); applyShow(); break; }   // photo mode
      case 'v': case 'V': if (!e.repeat) onSwitchWorld(); break;
      case 'd': case 'D': set({ debug: !state.debug }); document.documentElement.classList.toggle('debug', state.debug); break;
      case 'h': case 'H': document.documentElement.classList.toggle('no-keys'); break;                                      // the controls legend
      case '-': case '_': set({ paceMps: YD100 / Math.min(300, Math.round(YD100 / state.paceMps) + 1) }); break;   // pace: ±1 s per 100 yd
      case '=': case '+': set({ paceMps: YD100 / Math.max(40, Math.round(YD100 / state.paceMps) - 1) }); break;
      case 'i': case 'I': set({ icon: (state.icon || CONFIG.swimmer.icon) === 'glyph' ? 'beacon' : 'glyph' }); break;   // swimmer glyph ↔ beacon
      case '[': case ']': { let t = state.tempo * (e.key === ']' ? 1.5 : 1 / 1.5); if (Math.abs(t - 1) < 0.02) t = 1; set({ tempo: Math.min(64, Math.max(0.1, t)) }); break; }   // animation faster / slower
      default: return;
    }
  });
  window.addEventListener('keyup', e => { if ((e.key === 'ArrowRight' && hold?.dir === 1) || (e.key === 'ArrowLeft' && hold?.dir === -1)) endHold(); });
  window.addEventListener('blur', endHold);
  // ---- pointer: tap = next route, horizontal swipe = previous/next ----
  let down = null;
  mapEl.addEventListener('pointerdown', e => { noteInput(); down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  mapEl.addEventListener('pointerup', e => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y, dt = performance.now() - down.t; down = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) cycle(dx < 0 ? 1 : -1);
    else if (Math.hypot(dx, dy) < 8 && dt < 400) cycle(1);
  });
}
