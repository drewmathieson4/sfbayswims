// The panel: spot · swim (+ direction) · start · pace (+ advanced physics) · the result card (+ preview) · tools; the
// settings / about sheet; the phone handle. Everything reads state and writes it with set(); the runtime does the rest.
import { CONFIG } from '../engine/config.js';
import { state, set, on, effectiveTime } from '../engine/state.js';
import { tzParts, localToEpoch, fmtTime, fmtDate } from '../engine/data.js';
import { units, setUnits, fmtMMSS, fmtDist, fmtPace, fmtPaceOnly, parsePace, paceUnit, per100 } from '../engine/format.js';
import { toggleShow } from '../engine/show.js';
import { KN } from '../engine/current.js';
import { planUrl } from './share.js';
import { sunTimes } from '../engine/sun.js';

const $ = id => document.getElementById(id);
const fmtWhen = t => `${fmtDate(t).replace(/,.*$/, '')} ${fmtTime(t)}`;
const pad = n => String(n).padStart(2, '0');

/** ▶ preview / space: start the swim, then pause and resume it (a hidden swimmer is shown first). */
export function startStop() {
  if (state.swimming) { set({ paused: !state.paused }); return; }
  if (!state.show.swimmer) toggleShow('swimmer');
  set({ swimming: true, paused: false });
}

export function createPanel({ b, settings, saveSettings, recomputePhysics }) {
  const html = document.documentElement, live = b.live;
  const routes = () => live.routes || [];
  const listed = () => routes().filter(r => !r.reversed && !r.reverseOf);   // one entry per swim; twins reach it via the direction toggle
  const twinOf = r => routes().find(q => q.reverseOf === r.id) || (r.reverseOf ? routes().find(q => q.id === r.reverseOf) : null);
  const primaryOf = r => (r.reverseOf ? routes().find(q => q.id === r.reverseOf) || r : r);
  const current = () => routes().find(r => r.id === state.routeId);

  // ---- spot ----
  const spots = $('spots');
  function renderSpots() {
    spots.innerHTML = '';
    for (const w of b.index.worlds) { const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = w.title || w.id; btn.classList.toggle('on', w.id === state.world); btn.onclick = () => b.switchWorld(w.id); spots.appendChild(btn); }
  }
  // ---- swim + direction ----
  const swims = $('swims'), dir = $('dir');
  function renderSwims() {
    const cur = current(), prim = cur ? primaryOf(cur) : null;
    swims.innerHTML = '';
    for (const r of listed()) {
      const btn = document.createElement('button'); btn.type = 'button';
      btn.innerHTML = `<span>${r.name}</span><span class="d">${fmtDist(r.meters)}</span>`;
      btn.classList.toggle('on', prim?.id === r.id); btn.onclick = () => set({ routeId: r.id });
      swims.appendChild(btn);
    }
    dir.innerHTML = '';
    if (!cur) return;
    const tw = twinOf(cur);
    if (!tw) return;
    const a = primaryOf(cur), bb = twinOf(a);
    for (const r of [a, bb]) { const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = r.loop ? (r === a ? '↻ ' : '↺ ') + r.name : r.name; btn.classList.toggle('on', r.id === cur.id); btn.onclick = () => set({ routeId: r.id }); dir.appendChild(btn); }
  }
  function reverse() { const cur = current(), tw = cur && twinOf(cur); if (tw) set({ routeId: tw.id }); }
  function cycle(d) { const rs = listed(); if (!rs.length) return; const cur = current(), i = rs.findIndex(r => r.id === (cur ? primaryOf(cur).id : null)); set({ routeId: rs[(i + d + rs.length) % rs.length].id }); }

  // ---- start ----
  const startIn = $('start');
  const setTime = t => set({ selectedTime: Math.abs(t - state.now) < CONFIG.scrub.snapNowMin * 60000 ? null : t });
  function renderStart() {
    const p = tzParts(effectiveTime());
    const v = `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mi)}`;
    if (document.activeElement !== startIn) startIn.value = v;
  }
  startIn.addEventListener('change', () => { const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(startIn.value); if (m) setTime(localToEpoch(+m[1], +m[2], +m[3], +m[4], +m[5])); });
  $('now').onclick = () => set({ selectedTime: null, swimming: false, paused: false });
  for (const btn of document.querySelectorAll('.steps button')) btn.onclick = () => setTime(effectiveTime() + (+btn.dataset.min) * 60000);

  // ---- pace ----
  const paceIn = $('pace'), paceUnitEl = $('pace-unit');
  function renderPace() { paceUnitEl.textContent = paceUnit(); if (document.activeElement !== paceIn) paceIn.value = fmtPaceOnly(state.paceMps); }
  paceIn.addEventListener('change', () => { const v = parsePace(paceIn.value); if (v) set({ paceMps: v }); else renderPace(); });
  for (const btn of document.querySelectorAll('.presets button')) btn.onclick = () => set({ paceMps: parsePace(btn.textContent) });
  const burst = $('burst'), reserve = $('reserve'), floor = $('floor');
  const readAdvanced = () => { settings.swim = { burst: burst.checked, reserveS: +reserve.value || 0, floorMps: +floor.value || 0.25 }; saveSettings(); CONFIG.swim.burstReserveS = settings.swim.burst ? settings.swim.reserveS : 0; CONFIG.swim.minGroundMps = settings.swim.floorMps; recomputePhysics(); };
  for (const el of [burst, reserve, floor]) el.addEventListener('change', readAdvanced);
  burst.checked = settings.swim.burst; reserve.value = settings.swim.reserveS; floor.value = settings.swim.floorMps;

  // ---- result ----
  const rName = $('route-name'), rNotes = $('route-notes'), rDist = $('route-dist'), rTotal = $('route-total'), rEta = $('route-eta'), rMax = $('route-max'), rSun = $('route-sun'), note = $('route-note'), best = $('route-best'), next = $('route-next');
  const elapsed = $('elapsed'), elapsedK = $('elapsed-k'), speed = $('speed'), startBtn = $('start-swim'), tempo = $('tempo'), tempoV = $('tempo-v');
  /** The strongest current met along the swim and where: samples the field along the profile. */
  function strongest(r, res) {
    const field = live.field, prof = res.profile; if (!field || !prof || prof.n < 2) return null;
    let max = -1, at = 0; const v = { x: 0, y: 0 };
    const end = prof.sweptAt != null ? prof.sweptAt : prof.totalSeconds;
    for (let i = 0; i < prof.n; i += 2) { if (prof.t[i] > end) break; const c = field.prepare(res.at + prof.t[i] * 1000); field.sampleInto(prof.x[i], prof.y[i], c, v); const m = Math.hypot(v.x, v.y); if (m > max) { max = m; at = i; } }
    if (max < 0) return null;
    const leg = r.legs[Math.min(r.legs.length - 1, prof.leg[at])];
    let where = leg?.to?.name || '';
    if (!where) {                                                                 // the nearest named waypoint of the swim
      let bd = Infinity; for (const w of r.waypoints) { const d = Math.hypot(w.x - prof.x[at], w.y - prof.y[at]); if (w.name && d < bd) { bd = d; where = `near ${w.name}`; } }
    }
    return { kn: max / KN, where, t: prof.t[at] };
  }
  function renderRoute() {
    const r = current(); if (!r) return;
    rName.textContent = r.name; rNotes.textContent = r.notes || ''; rDist.textContent = fmtDist(r.meters);
    const res = state.physics?.byRoute?.get(r.id);
    if (!res) { rTotal.textContent = '…'; rEta.textContent = '…'; rMax.textContent = '…'; rSun.textContent = '…'; note.textContent = ''; renderWindows(); return; }
    const at = state.physics.at;
    rTotal.textContent = res.feasible ? fmtMMSS(res.totalSeconds) : '—';
    rEta.textContent = res.feasible ? fmtTime(at + res.totalSeconds * 1000) : '—';
    const s = strongest(r, { ...res, at });
    rMax.textContent = s ? `${s.kn.toFixed(1)} kn${s.where ? ` · ${s.where}` : ''}` : '—';
    { const s = sunTimes(at, CONFIG.origin.lat, CONFIG.origin.lon), fin = at + res.totalSeconds * 1000;   // daylight: the swim against civil twilight
      const dark = s.dawn != null && (at < s.dawn || (res.feasible && fin > s.dusk));
      rSun.innerHTML = s.sunrise ? `${fmtTime(s.sunrise)} – ${fmtTime(s.sunset)}${dark ? ' <em class="warn">· in the dark</em>' : ''}` : '—'; }
    if (!res.feasible) { const sw = res.profile.sweptAt, leg = r.legs[Math.min(r.legs.length - 1, res.profile.leg[Math.max(0, res.profile.n - 1)])]; note.textContent = `too much current · swept ${fmtMMSS(sw ?? 0)} in${leg?.to?.name ? ` near ${leg.to.name}` : ''}`; }
    else note.textContent = '';
    renderWindows();
  }
  function renderWindows() {
    const w = state.windows, res = state.physics?.byRoute?.get(state.routeId);
    if (!w || w.routeId !== state.routeId || !res || res.feasible) { best.textContent = ''; next.textContent = ''; return; }
    best.innerHTML = w.best ? `<span class="k">best in 48 h</span><span class="v">${fmtWhen(w.best.t)} · ${fmtMMSS(w.best.s)}</span>` : '';
    next.innerHTML = w.next ? `<span class="k">next feasible</span><span class="v">${fmtWhen(w.next.t)}</span>` : '';
  }
  const renderStartBtn = () => { startBtn.textContent = !state.swimming ? '▶ preview' : state.paused ? '▶ resume' : '❚❚ pause'; };
  startBtn.onclick = () => { startStop(); startBtn.blur(); };
  const tempoFrom = v => Math.pow(2, +v);                                          // slider −2…3 → ¼×…8× of the spot's tempo
  tempo.addEventListener('input', () => { set({ tempo: tempoFrom(tempo.value) }); renderTempo(); });
  function renderTempo() { tempoV.textContent = `${Math.round(CONFIG.anim.speedup * (state.tempo || 1))}×`; tempo.value = Math.log2(state.tempo || 1); }

  // ---- peek line (phones) + handle ----
  const peek = $('peek');
  function renderPeek() { const r = current(), res = r && state.physics?.byRoute?.get(r.id); peek.textContent = r ? `${r.name} · ${res ? (res.feasible ? fmtMMSS(res.totalSeconds) : 'too much current') : '…'}` : '…'; }
  $('collapse').onclick = () => html.classList.toggle('panel-collapsed');
  $('handle').onclick = e => { if (e.target.tagName !== 'BUTTON') html.classList.toggle('panel-collapsed'); };

  // ---- tools: share + the sheet ----
  const share = $('share');
  share.onclick = async () => { const url = planUrl(); try { await navigator.clipboard.writeText(url); share.textContent = 'link copied'; } catch { prompt('copy this link', url); } setTimeout(() => { share.textContent = 'copy link'; }, 1500); };
  const sheet = $('sheet');
  const openSheet = () => { sheet.hidden = false; renderSheet(); }, closeSheet = () => { sheet.hidden = true; };
  $('settings-btn').onclick = openSheet; $('about').onclick = e => { e.preventDefault(); openSheet(); }; $('sheet-close').onclick = closeSheet;
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
  function renderSheet() {
    for (const btn of $('u-dist').children) btn.classList.toggle('on', btn.dataset.v === units.dist);
    for (const btn of $('u-temp').children) btn.classList.toggle('on', btn.dataset.v === units.temp);
    for (const btn of $('layers').children) { const k = btn.dataset.k; btn.classList.toggle('on', k === 'arrows' ? state.debug : k === 'colour' || k === 'tideLine' ? !!settings[k] : state.show[k]); }
    const src = state.data.sources || {}, w = state.data.waterTemp, wd = state.data.wind;
    $('sources').textContent = `Sources: NOAA CO-OPS tides (North Point) and current predictions; ${w ? `water temperature ${w.source || src.waterTemp || 'USGS Alcatraz'}` : 'water temperature pending'}${wd ? `; wind ${wd.source || 'NWS Fort Point'}` : ''}. Times are Pacific.`;
  }
  for (const btn of $('u-dist').children) btn.onclick = () => { setUnits({ dist: btn.dataset.v }); settings.units = { ...units }; saveSettings(); rerenderUnits(); renderSheet(); };
  for (const btn of $('u-temp').children) btn.onclick = () => { setUnits({ temp: btn.dataset.v }); settings.units = { ...units }; saveSettings(); rerenderUnits(); renderSheet(); };
  for (const btn of $('layers').children) btn.onclick = () => { const k = btn.dataset.k; if (k === 'arrows') toggleArrows(); else if (k === 'colour' || k === 'tideLine') { settings[k] = !settings[k]; saveSettings(); for (const fn of settingListeners) fn(k); } else { toggleShow(k); settings[k] = state.show[k]; saveSettings(); } renderSheet(); };
  const settingListeners = [];
  function toggleArrows() { set({ debug: !state.debug }); html.classList.toggle('debug', state.debug); settings.arrows = state.debug; saveSettings(); }
  $('reset').onclick = () => { try { localStorage.removeItem('plan.settings'); } catch {} location.href = location.pathname; };
  let unitsListeners = [];
  const rerenderUnits = () => { renderSwims(); renderPace(); renderRoute(); renderFavs(); for (const fn of unitsListeners) fn(); };

  // ---- saved plans (localStorage plan.favourites) ----
  const favs = $('favs');
  const loadFavs = () => { try { return JSON.parse(localStorage.getItem('plan.favourites') || '[]'); } catch { return []; } };
  const saveFavs = list => { try { localStorage.setItem('plan.favourites', JSON.stringify(list)); } catch {} };
  function renderFavs() {
    favs.innerHTML = '';
    for (const [i, f] of loadFavs().entries()) {
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'fav';
      btn.innerHTML = `<span>${f.name}</span><span class="x" title="forget">×</span><span class="d">${f.t ? fmtWhen(f.t) : 'now'} · ${fmtPaceOnly(f.pace)} ${paceUnit()}</span>`;
      btn.onclick = async e => {
        if (e.target.classList.contains('x')) { const l = loadFavs(); l.splice(i, 1); saveFavs(l); renderFavs(); return; }
        if (f.world !== state.world) await b.switchWorld(f.world);
        set({ routeId: f.route, selectedTime: f.t, paceMps: f.pace });
      };
      favs.appendChild(btn);
    }
  }
  $('fav-save').onclick = () => { const r = current(); if (!r) return; const l = loadFavs(); l.unshift({ name: `${r.name} · ${state.selectedTime ? fmtWhen(state.selectedTime) : 'now'}`, world: state.world, route: r.id, t: state.selectedTime, pace: state.paceMps }); saveFavs(l.slice(0, 20)); renderFavs(); };
  renderFavs();

  // ---- wiring ----
  on('world', () => { renderSpots(); renderSwims(); renderRoute(); renderPeek(); renderTempo(); });
  on('routeId', () => { renderSwims(); renderRoute(); renderPeek(); });
  on('physics', () => { renderRoute(); renderPeek(); }); on('windows', renderWindows);
  on('selectedTime', () => { renderStart(); }); on('now', () => { if (state.selectedTime == null) renderStart(); });
  on('paceMps', () => { renderPace(); });
  on('swimming', renderStartBtn); on('paused', renderStartBtn); on('tempo', renderTempo);
  renderSpots(); renderSwims(); renderStart(); renderPace(); renderRoute(); renderPeek(); renderStartBtn(); renderTempo();
  return {
    reverse, cycle, toggleArrows, openSheet, closeSheet, setTime,
    onUnits: fn => unitsListeners.push(fn), onSetting: fn => settingListeners.push(fn),
    setElapsed: (s, tempoX, mps) => { elapsed.textContent = fmtMMSS(s); elapsedK.textContent = state.tempo && state.tempo !== 1 ? `elapsed · ${Math.round(tempoX)}×` : 'elapsed'; speed.textContent = fmtPace(mps); },
  };
}
