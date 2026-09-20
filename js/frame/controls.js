// Endless encoder: arrow keys over USB; mouse wheel provides the same controls during setup.
import { state, set, effectiveTime } from '../engine/state.js';

export function createControls({ cycle, busy = () => false, dial }) {
  const html = document.documentElement;
  set({ frameTimeBrowsing: false });
  let photograph = false, savedShow = null, lastTurn = -Infinity, lastFast = -Infinity, lastDirection = 0, streak = 0;
  function leavePoster() {
    if (!photograph) return;
    photograph = false; html.classList.remove('photograph');
    set({ show: savedShow }); savedShow = null;
  }
  function now() {
    leavePoster(); cycle.stop();
    set({ frameTimeBrowsing: false, selectedTime: null, show: { swimmer: false, streaks: true, ui: true } });
    cycle.start();
  }
  function swimmer() {
    leavePoster();
    const enabled = !state.show.swimmer, at = effectiveTime();
    cycle.stop();
    set({ selectedTime: enabled ? at : state.selectedTime,
      show: { swimmer: enabled, streaks: true, ui: true } });
    cycle.start();
  }
  function poster() {
    if (photograph) { leavePoster(); cycle.start(); return; }
    savedShow = { ...state.show }; photograph = true;
    cycle.stop(); html.classList.add('photograph');
    set({ show: { swimmer: false, streaks: false, ui: false } });
  }
  function turn(direction) {
    if (busy() || !Number.isFinite(direction) || !direction) return;
    direction = Math.sign(direction);
    if (photograph) return; // the photograph stays still until a button gesture changes mode
    if (state.show.swimmer) { cycle.next(direction); return; }
    // A flick stays in the smallest step; only a sustained spin one way (detents closer than fastMs) earns the larger ones.
    // Letting go to re-grip keeps the spin's streak for graceMs; a longer pause, or reversing, starts over. A slow detent is always the smallest step.
    const t = performance.now(), fast = t - lastTurn < dial.fastMs && direction === lastDirection;
    if (direction !== lastDirection || t - lastFast >= dial.graceMs) streak = 0;
    if (fast) { streak++; lastFast = t; }
    lastTurn = t; lastDirection = direction;
    const minutes = fast ? dial.steps.reduce((m, [after, step]) => streak >= after ? step : m, dial.steps[0][1]) : dial.steps[0][1];
    set({ frameTimeBrowsing: true, selectedTime: effectiveTime() + direction * minutes * 60000 });
  }
  window.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault(); turn(e.key === 'ArrowRight' ? 1 : -1);
    }
  });
  window.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) return;
    e.preventDefault(); turn(Math.sign(e.deltaY || e.deltaX));
  }, { passive: false });
  return { now, swimmer, poster, turn, get photograph() { return photograph; } };
}
