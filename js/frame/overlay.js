// The overlay: museum labels — top-left the view title and the time the picture shows (the swimmer's during a swim);
// top-right the conditions line (water · current · wind, the current at that moment) and, beneath it, the caption
// (swim · time) while a swim plays.
import { CONFIG } from '../engine/config.js';
import { state, on, displayTime } from '../engine/state.js';
import { fmtMMSS } from '../engine/format.js';
import { fmtTime } from '../engine/data.js';

const $ = id => document.getElementById(id);
const compass = d => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((d % 360) + 360) % 360 / 45) % 8];

export function createOverlay({ live }) {
  const title = $('title'), clock = $('clock'), cond = $('conditions'), cap = $('caption');
  const renderClock = () => { clock.textContent = fmtTime(displayTime()); };
  function renderConditions() {
    const parts = [], w = state.data.waterTemp, wind = state.data.wind;
    if (w) parts.push(`${w.approx || Date.now() - w.t > CONFIG.stale.waterH * 3600e3 ? '≈' : ''}${Math.round(w.degF)}°F`);
    if (live.field) { const o = live.field.reference(displayTime()); parts.push(o.label === 'SLACK' ? 'slack' : `${o.label.toLowerCase()} ${o.approx ? '≈' : ''}${o.kn.toFixed(1)} kn`); }
    if (wind && Date.now() - wind.t <= CONFIG.stale.windH * 3600e3) parts.push(`wind ${wind.dirDeg != null ? compass(wind.dirDeg) + ' ' : ''}${Math.round(wind.kn)} kn`);
    cond.textContent = parts.join(' · ');
  }
  on('now', () => { renderConditions(); renderClock(); }); on('data', renderConditions); on('world', renderConditions); on('swimming', renderConditions);
  renderClock();
  return {
    setTitle: t => { title.textContent = t; },
    /** "Alcatraz · 1:12", or "Alcatraz · too much current · next 4:10pm"; null clears. */
    setCaption: (route, prof, windows) => {
      if (!route) { cap.textContent = ''; return; }
      let s = route.name;
      if (prof?.feasible) s += ` · ${fmtMMSS(prof.totalSeconds)}`;
      else { s += ' · too much current'; if (windows?.next) s += ` · next ${fmtTime(windows.next.t)}`; }
      cap.textContent = s;
    },
    renderConditions, renderClock,
  };
}
