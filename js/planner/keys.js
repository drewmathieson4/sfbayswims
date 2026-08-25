// Keys: ← → start ±5 min (hold accelerates; ⇧ = ±1 h) · ↑ ↓ swim · r the other way · n now · space preview · s streaks ·
// c current arrows · - + pace ±1 s · v next spot · ? the settings sheet · Esc closes it.
import { CONFIG } from '../engine/config.js';
import { state, set, effectiveTime } from '../engine/state.js';
import { per100 } from '../engine/format.js';
import { toggleShow } from '../engine/show.js';
import { startStop } from './panel.js';

export function bindKeys({ b, panel }) {
  const T = CONFIG.scrub;
  const clampT = t => Math.max(state.now - T.maxBackH * 3600e3, Math.min(state.now + T.maxForwardH * 3600e3, t));
  const snap = t => Math.round(t / (T.stepMin * 60000)) * T.stepMin * 60000;
  const setTime = t => set({ selectedTime: Math.abs(t - state.now) < T.snapNowMin * 60000 ? null : clampT(t) });
  let hold = null;
  const endHold = () => { if (!hold) return; clearInterval(hold.timer); if (state.selectedTime != null) setTime(snap(state.selectedTime)); hold = null; };
  const startHold = (dir, stepMin) => {
    if (hold && hold.dir !== dir) endHold();
    if (hold) return;
    let t = snap(effectiveTime() + dir * stepMin * 60000);
    if (Math.abs(t - state.now) < stepMin * 60000) t = snap(state.now) + dir * stepMin * 60000;   // a tap always moves a full step
    setTime(t);
    hold = { dir, start: performance.now(), last: performance.now() };
    hold.timer = setInterval(() => {
      const now = performance.now(), held = (now - hold.start) / 1000, dt = (now - hold.last) / 1000; hold.last = now;
      if (held < T.holdDelayS) return;
      const rate = Math.min(T.maxMinPerS, T.startMinPerS * Math.pow(2, (held - T.holdDelayS) / T.doubleEveryS));
      set({ selectedTime: clampT(effectiveTime() + hold.dir * rate * dt * 60000) });
    }, 40);
  };
  const typing = e => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName);
  window.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e)) return;
    switch (e.key) {
      case 'ArrowRight': if (!e.repeat) startHold(1, e.shiftKey ? 60 : T.stepMin); e.preventDefault(); break;
      case 'ArrowLeft': if (!e.repeat) startHold(-1, e.shiftKey ? 60 : T.stepMin); e.preventDefault(); break;
      case 'ArrowUp': case 'ArrowDown': panel.cycle(e.key === 'ArrowUp' ? -1 : 1); e.preventDefault(); break;
      case 'r': case 'R': panel.reverse(); break;
      case ' ': startStop(); e.preventDefault(); break;
      case 'n': case 'N': endHold(); set({ swimming: false, paused: false, selectedTime: null }); break;
      case 'Escape': panel.closeSheet(); break;
      case 's': case 'S': toggleShow('streaks'); break;
      case 'c': case 'C': panel.toggleArrows(); break;
      case 'v': case 'V': if (!e.repeat) b.nextWorld(); break;
      case '-': case '_': set({ paceMps: per100() / Math.min(300, Math.round(per100() / state.paceMps) + 1) }); break;   // pace: ±1 s per 100
      case '=': case '+': set({ paceMps: per100() / Math.max(40, Math.round(per100() / state.paceMps) - 1) }); break;
      case '?': panel.openSheet(); break;
      default: return;
    }
  });
  window.addEventListener('keyup', e => { if ((e.key === 'ArrowRight' && hold?.dir === 1) || (e.key === 'ArrowLeft' && hold?.dir === -1)) endHold(); });
  window.addEventListener('blur', endHold);
}
