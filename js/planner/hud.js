// The HUD (top corners: clock, water, current, wind) and the rail (route · distance · total · elapsed · speed · note · best/next ·
// ▶ start). Renders from state; the runtime's tick feeds elapsed and speed through setElapsed/setSpeed.
import { CONFIG } from '../engine/config.js';
import { state, set, on, effectiveTime, displayTime } from '../engine/state.js';
import { fmtTime, fmtDate } from '../engine/data.js';
import { fmtMMSS, fmtDist, fmtPace } from '../engine/format.js';
import { toggleShow } from '../engine/show.js';
import { noteInput } from '../engine/input.js';

const $ = id => document.getElementById(id);
const compass = d => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((d % 360) + 360) % 360 / 45) % 8];
const fmtWhen = t => `${fmtDate(t).replace(/,.*$/, '')} ${fmtTime(t)}`;

export function createHud({ live }) {
  const clock = $('clock'), water = $('water'), current = $('current'), wind = $('wind');
  const rName = $('route-name'), rTotal = $('route-total'), rDist = $('route-dist'), elapsed = $('elapsed'), elapsedK = $('elapsed-k'), speed = $('speed'), note = $('route-note'), best = $('route-best'), next = $('route-next'), startBtn = $('start');
  const scrubbed = () => state.selectedTime != null;
  const swimT = () => state.swimming ? state.swimAt ?? state.physics?.at ?? null : null;   // the swimmer's moment while a swim plays
  const renderClock = () => {
    const t = swimT();
    if (t != null) { const day = scrubbed() || fmtDate(t) !== fmtDate(state.now) ? `${fmtDate(t)} · ` : ''; clock.textContent = `swimming · ${day}${fmtTime(t)}`; }
    else clock.textContent = scrubbed() ? `${fmtDate(effectiveTime())} · ${fmtTime(effectiveTime())}` : 'current';
  };
  const renderStart = () => { startBtn.textContent = !state.swimming ? '▶ start' : state.paused ? '▶ resume' : '❚❚ pause'; };
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
    const o = live.field.reference(displayTime()), where = o.where ? ` <span class="approx">· ${o.where}</span>` : '';
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
  on('now', () => { if (!scrubbed() || state.swimming) { renderClock(); renderCurrent(); } });
  on('swimming', () => { renderClock(); renderCurrent(); renderStart(); }); on('paused', renderStart);
  startBtn.addEventListener('click', () => { noteInput(); startStop(); startBtn.blur(); });
  on('selectedTime', () => { renderClock(); renderCurrent(); renderWater(); renderWind(); });
  on('data', () => { renderWater(); renderWind(); renderCurrent(); });
  on('routeId', renderRoute); on('physics', renderRoute); on('paceMps', renderRoute); on('windows', renderWindows);
  on('world', () => { renderRoute(); renderCurrent(); });
  renderClock(); renderWater(); renderWind(); renderCurrent(); renderRoute(); renderStart();
  return {
    setElapsed: (s, tempo) => { elapsed.textContent = fmtMMSS(s); elapsedK.textContent = tempo && Math.abs(tempo - CONFIG.anim.speedup) > 1e-9 ? `elapsed · ${+tempo.toFixed(1)}×` : 'elapsed'; },
    setSpeed: mps => { speed.textContent = fmtPace(mps); },
  };
}

/** ▶ start / space: start the swim, then pause and resume it (a hidden swimmer is shown first). */
export function startStop() {
  if (state.swimming) { set({ paused: !state.paused }); return; }
  if (!state.show.swimmer) toggleShow('swimmer');
  set({ swimming: true, paused: false });
}
