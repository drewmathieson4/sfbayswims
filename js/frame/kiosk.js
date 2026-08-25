// Kiosk behaviour (the frame): hide the cursor when idle, drift back to "current" after returnToNowS, keep the screen
// awake, reload nightly to pick up updates.
import { CONFIG } from '../engine/config.js';
import { state, set } from '../engine/state.js';
import { noteInput, idleSeconds } from '../engine/input.js';

/** Kiosk: hide the cursor when idle, drift back to "current" after returnToNowS, keep the screen awake, reload nightly. */
export function kioskMode() {
  const html = document.documentElement;
  let idleTimer = null;
  const wake = () => { noteInput(); html.classList.remove('idle'); clearTimeout(idleTimer); idleTimer = setTimeout(() => html.classList.add('idle'), CONFIG.kiosk.idleCursorS * 1000); };
  for (const ev of ['pointermove', 'pointerdown', 'keydown']) window.addEventListener(ev, wake);
  wake();
  navigator.wakeLock?.request('screen').catch(() => {});
  setInterval(() => {
    const back = CONFIG.kiosk.returnToNowS;
    if (back > 0 && state.selectedTime != null && idleSeconds() > back) set({ selectedTime: null });
  }, 5000);
  let reloadedDay = null;                               // nightly reload picks up an updated app; robust to a slipped minute
  setInterval(() => {
    const d = new Date(), hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (hhmm >= CONFIG.kiosk.reloadAt && reloadedDay !== d.getDate()) { reloadedDay = d.getDate(); if (performance.now() > 120000) location.reload(); }
  }, 60000);
}
