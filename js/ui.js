// HUD (top corners), rail (route · distance · total · elapsed · note · best/next), keys, gestures and kiosk behaviour.
import { CONFIG } from './config.js';
import { state, set, on, effectiveTime } from './state.js';
import { fmtTime, fmtDate } from './data.js';

const $ = id => document.getElementById(id);
export const fmtMMSS = s => {
  if (!isFinite(s)) return '—';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
};
const M2YD = 1.09361, M2MI = 1 / 1609.344, YD100 = 91.44;
export const fmtDist = m => m * M2YD >= 3000 ? `${(m * M2MI).toFixed(1)} mi` : `${Math.round(m * M2YD).toLocaleString('en-US')} yd`;
const compass = d => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((d % 360) + 360) % 360 / 45) % 8];
const fmtWhen = t => `${fmtDate(t).replace(/,.*$/, '')} ${fmtTime(t)}`;

export function createHud({ live }) {
  const clock = $('clock'), water = $('water'), current = $('current'), wind = $('wind');
  const rName = $('route-name'), rTotal = $('route-total'), rDist = $('route-dist'), elapsed = $('elapsed'), elapsedK = $('elapsed-k'), speed = $('speed'), note = $('route-note'), best = $('route-best'), next = $('route-next');
  const scrubbed = () => state.selectedTime != null;
  const renderClock = () => { clock.textContent = scrubbed() ? `${fmtDate(effectiveTime())} · ${fmtTime(effectiveTime())}` : 'current'; };
  function renderWater() {
    const w = state.data.waterTemp;
    if (!w || (scrubbed() && CONFIG.hud.scrubbedWater === 'hide')) { water.textContent = w ? '' : 'water …'; return; }
    water.innerHTML = `water ${w.approx ? '<span class="approx">≈</span>' : ''}${Math.round(w.degF)}°F${scrubbed() ? ' <span class="approx">· now</span>' : ''}`;
  }
  function renderWind() {
    const w = state.data.wind;
    if (!w || (scrubbed() && CONFIG.hud.scrubbedWind === 'hide')) { wind.textContent = ''; return; }
    wind.textContent = `wind ${w.dirDeg != null ? compass(w.dirDeg) + ' ' : ''}${Math.round(w.kn)} kn${scrubbed() ? ' · now' : ''}`;
  }
  function renderCurrent() {
    if (!live.field) { current.textContent = ''; return; }
    const o = live.field.reference(effectiveTime()), where = o.where ? ` <span class="approx">· ${o.where}</span>` : '';
    current.innerHTML = o.label === 'SLACK' ? `slack${where}` : `${o.label.toLowerCase()} ${o.approx ? '≈' : ''}${o.kn.toFixed(1)} kn${where}`;
  }
  function renderRoute() {
    const r = live.routes?.find(x => x.id === state.routeId); if (!r) return;
    rName.textContent = r.name; rDist.textContent = fmtDist(r.meters);
    const ph = state.physics?.byRoute?.get(r.id);
    rTotal.textContent = ph ? fmtMMSS(ph.feasible ? ph.totalSeconds : NaN) : '…';
    note.textContent = ph && !ph.feasible ? 'too much current' : '';
    renderWindows();
  }
  function renderWindows() {
    const w = state.windows, ph = state.physics?.byRoute?.get(state.routeId);
    if (!w || w.routeId !== state.routeId || !ph || ph.feasible) { best.textContent = ''; next.textContent = ''; return; }
    best.innerHTML = w.best ? `<span class="k">best 48 h</span><span class="v">${fmtWhen(w.best.t)} · ${fmtMMSS(w.best.s)}</span>` : '';
    next.innerHTML = w.next ? `<span class="k">next</span><span class="v">${fmtWhen(w.next.t)}</span>` : '';
  }
  on('now', () => { if (!scrubbed()) { renderClock(); renderCurrent(); } });
  on('selectedTime', () => { renderClock(); renderCurrent(); renderWater(); renderWind(); });
  on('data', () => { renderWater(); renderWind(); renderCurrent(); });
  on('routeId', renderRoute); on('physics', renderRoute); on('paceMps', renderRoute); on('windows', renderWindows);
  on('world', () => { renderRoute(); renderCurrent(); });
  renderClock(); renderWater(); renderWind(); renderCurrent(); renderRoute();
  return {
    setElapsed: (s, tempo) => { elapsed.textContent = fmtMMSS(s); elapsedK.textContent = tempo && Math.abs(tempo - CONFIG.anim.speedup) > 1e-9 ? `elapsed · ${+tempo.toFixed(1)}×` : 'elapsed'; },
    setSpeed: mps => { speed.textContent = mps > 0.01 ? `${fmtMMSS(Math.round(YD100 / mps))} /100 yd` : '—'; },   // whole seconds only
  };
}

/** The a / s / u switches and ?static: state.show → html classes. */
export function applyShow() {
  const html = document.documentElement, s = state.show;
  html.classList.toggle('no-ui', !s.ui); html.classList.toggle('no-swimmer', !s.swimmer); html.classList.toggle('no-streaks', !s.streaks);
}
export function toggleShow(k) { set({ show: { ...state.show, [k]: !state.show[k] } }); applyShow(); }

// last input from a person (keys or pointer) — the kiosk's idle drift and cursor hiding both read it
let lastInputAt = performance.now();
const noteInput = () => { lastInputAt = performance.now(); };

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
      case ' ': set({ paused: !state.paused }); e.preventDefault(); break;
      case 'n': case 'N': case 'Escape': case 'Enter': endHold(); set({ selectedTime: null }); break;
      case 'a': case 'A': toggleShow('swimmer'); break;
      case 's': case 'S': toggleShow('streaks'); break;
      case 'u': case 'U': toggleShow('ui'); break;
      case 'p': case 'P': { const on_ = !(state.show.swimmer || state.show.ui); set({ show: { ...state.show, swimmer: on_, ui: on_ } }); applyShow(); break; }   // photo mode
      case 'v': case 'V': if (!e.repeat) onSwitchWorld(); break;
      case 'd': case 'D': set({ debug: !state.debug }); document.documentElement.classList.toggle('debug', state.debug); break;
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
    if (back > 0 && state.selectedTime != null && (performance.now() - lastInputAt) / 1000 > back) set({ selectedTime: null });
  }, 5000);
  let reloadedDay = null;                               // nightly reload picks up an updated app; robust to a slipped minute
  setInterval(() => {
    const d = new Date(), hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (hhmm >= CONFIG.kiosk.reloadAt && reloadedDay !== d.getDate()) { reloadedDay = d.getDate(); if (performance.now() > 120000) location.reload(); }
  }, 60000);
}
