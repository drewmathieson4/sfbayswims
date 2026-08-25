// The map's HUD corners. Top-left: the wordmark, the spot, the clock line ("current", the selected time, or
// "swimming · time" during a preview), the offline hint. Top-right: water, the current with its ≈ and station, wind, the tide.
import { CONFIG } from '../engine/config.js';
import { state, on, effectiveTime, displayTime } from '../engine/state.js';
import { fmtTime, fmtDate } from '../engine/data.js';
import { fmtTemp } from '../engine/format.js';

const $ = id => document.getElementById(id);
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const compass = d => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((d % 360) + 360) % 360 / 45) % 8];

export function createHud({ live, refs }) {
  const title = $('title'), clock = $('clock'), water = $('water'), current = $('current'), wind = $('wind'), tide = $('tide');
  const scrubbed = () => state.selectedTime != null;
  const swimT = () => (state.swimming ? state.swimAt ?? state.physics?.at ?? null : null);
  const renderClock = () => {
    const t = swimT();
    if (t != null) { const day = scrubbed() || fmtDate(t) !== fmtDate(state.now) ? `${fmtDate(t)} · ` : ''; clock.textContent = `swimming · ${day}${fmtTime(t)}`; }
    else clock.textContent = scrubbed() ? `${fmtDate(effectiveTime())} · ${fmtTime(effectiveTime())}` : 'current';
  };
  function renderWater() {
    const w = state.data.waterTemp;
    if (!w) { water.textContent = 'water …'; return; }
    const old = !w.approx && Date.now() - w.t > CONFIG.stale.waterH * 3600e3;                  // a live reading gone stale shows its age
    water.innerHTML = `water ${w.approx || old ? '<span class="approx">≈</span>' : ''}${fmtTemp(w.degF)}${old ? ` <span class="approx">· ${ago(w.t)}</span>` : scrubbed() ? ' <span class="approx">· now</span>' : ''}`;
  }
  function renderWind() {
    const w = state.data.wind;
    if (!w || (scrubbed() && CONFIG.hud.scrubbedWind === 'hide')) { wind.textContent = ''; return; }
    const old = Date.now() - w.t > CONFIG.stale.windH * 3600e3;
    wind.textContent = `wind ${w.dirDeg != null ? compass(w.dirDeg) + ' ' : ''}${Math.round(w.kn)} kn${old ? ` · ${ago(w.t)}` : scrubbed() ? ' · now' : ''}`;
  }
  function renderCurrent() {
    if (!live.field) { current.textContent = ''; return; }
    const o = live.field.reference(displayTime()), where = o.where ? ` <span class="approx">· ${o.where}</span>` : '';
    current.innerHTML = o.label === 'SLACK' ? `slack${where}` : `${o.label.toLowerCase()} ${o.approx ? '≈' : ''}${o.kn.toFixed(1)} kn${where}`;
  }
  function renderTide() {
    const ts = refs?.tideRef?.() ?? null;
    if (!ts) { tide.textContent = ''; return; }
    const t = displayTime(), h = ts.heightAt(t), nx = ts.next(t);
    tide.textContent = h == null ? '' : `tide ${h.toFixed(1)} ft${nx ? ` · ${nx.type === 'H' ? 'high' : 'low'} ${fmtTime(nx.t)}` : ''}`;
  }
  const all = () => { renderClock(); renderCurrent(); renderTide(); };
  on('now', () => { if (!scrubbed() || state.swimming) all(); if (state.now % 60000 < 1000) { renderWater(); renderWind(); } });   // ages tick once a minute
  on('swimming', all); on('selectedTime', () => { all(); renderWater(); renderWind(); });
  on('data', () => { renderWater(); renderWind(); renderCurrent(); renderTide(); });
  on('world', all);
  renderClock(); renderWater(); renderWind(); renderCurrent(); renderTide();
  return { setSpot: t => { title.textContent = t; }, rerender: () => { renderWater(); renderWind(); all(); } };
}
