// Best starts, on request: this swim over the next n tide cycles, every swim over n cycles, or a chosen date — starts
// every 15 min, then one per tide cycle: the local optimum (the fastest start within half a cycle either side), listed
// in time order with the finish, daylight and the slack relation; a start within half an hour of one is nearly as good.
// Filters: daylight (the whole swim between sunrise and sunset), duration and weekends. Computed in chunks so the page stays alive; memoised per swim / pace / data.
import { span } from './dom.js';
import { CONFIG } from '../engine/config.js';
import { state, set, on, physicsTime } from '../engine/state.js';
import { tzParts, localToEpoch, fmtTime, fmtDate, fmtDateYear } from '../engine/data.js';
import { fmtMMSS } from '../engine/format.js';
import { scanStarts, slackNear } from '../engine/swim.js';
import { sunTimes } from '../engine/sun.js';

const CYCLE = 745 * 60000, STEP = 15 * 60000, $ = id => document.getElementById(id);
const fmtWhen = t => `${fmtDate(t).replace(/,.*$/, '')} ${fmtTime(t)}`;

export function createStarts({ b }) {
  const live = b.live, scope = $('bs-scope'), cycles = $('bs-cycles'), date = $('bs-date'), daylight = $('bs-daylight'), maxDur = $('bs-max'), weekends = $('bs-weekends');
  const btn = $('bs-find'), prog = $('bs-progress'), out = $('bs-results');
  const memo = new Map(); let run = 0, preparing = null;
  const yieldNow = () => new Promise(r => setTimeout(r, 0));
  const listed = () => (live.routes || []).filter(r => !r.reversed);          // every swim from routes.json, both Bridge-to-Bridge directions
  const current = () => (live.routes || []).find(r => r.id === state.routeId);
  /** Light for the whole swim: from sunrise to sunset of the start's day (a swim can't span a night and pass). */
  const isDay = (t0, t1) => { const s = sunTimes(t0, CONFIG.origin.lat, CONFIG.origin.lon); return s.sunrise != null && t0 >= s.sunrise && t1 <= s.sunset; };
  const isWeekend = t => { const p = tzParts(t); return [0, 6].includes(new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay()); };
  function times() {
    if (date.value) { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(date.value); if (m) { const t0 = localToEpoch(+m[1], +m[2], +m[3], 0, 0); return [t0, t0 + 30 * 3600e3]; } }
    const t0 = Math.ceil(physicsTime() / STEP) * STEP; return [t0, t0 + Math.max(1, Math.min(8, +cycles.value || 4)) * CYCLE];
  }
  const range = (a, c) => { const hz = b.services.horizon(a), end = Math.min(c, hz); clipped = c > hz; const r = []; for (let t = a; t <= end; t += STEP) r.push(t); return r; };
  let clipped = false;
  async function scanRoute(r, ts, token, context) {
    const key = `${state.world}:${r.id}:${state.paceMps.toFixed(4)}:${state.data.version}:${CONFIG.swim.burstReserveS}:${CONFIG.swim.minGroundMps}:${ts[0]}:${ts.length}`;
    if (memo.has(key)) return memo.get(key);
    const res = [];
    for (let i = 0; i < ts.length; i += 12) { if (token !== run) return null; res.push(...scanStarts(r, ts.slice(i, i + 12), context.pace, context.field, { covers: context.covers })); await yieldNow(); }
    if (token !== run) return null;
    memo.set(key, res); if (memo.size > 40) memo.delete(memo.keys().next().value);
    return res;
  }
  const filters = e => (!daylight.checked || e.day) && (!(+maxDur.value) || e.s <= (+maxDur.value) * 60) && (!weekends.checked || isWeekend(e.t));
  async function find() {
    const token = ++run, [start, end] = times();
    preparing = token; btn.disabled = true; out.innerHTML = ''; prog.hidden = false;
    try {
      await b.services.ensurePredictions(start, end + 7 * 86400e3);
      if (token !== run) return;
      preparing = null;
      const ts = range(start, end), swims = scope.value === 'all' ? listed() : [current()].filter(Boolean);
      if (!swims.length || !live.field) return;
      const context = { pace: state.paceMps, field: live.field, covers: b.services.covers };
      prog.max = swims.length * ts.length; prog.value = 0;
      const rows = [];
      for (const r of swims) {
        const res = await scanRoute(r, ts, token, context);
        if (!res || token !== run) return;
        prog.value += ts.length;
        const good = res.filter(e => e.feasible).map(e => ({ ...e, r, finish: e.t + e.s * 1000, day: isDay(e.t, e.t + e.s * 1000) })).filter(filters);
        const HALF = CYCLE / 2;
        const peaks = good.filter(e => !good.some(o => o !== e && Math.abs(o.t - e.t) < HALF && (o.s < e.s || (o.s === e.s && o.t < e.t)))).sort((a, c) => a.t - c.t);
        if (scope.value === 'all') { const best = peaks.slice().sort((a, c) => a.s - c.s)[0]; if (best) rows.push(best); }
        else rows.push(...peaks);
      }
      if (token !== run) return;
      if (scope.value === 'all') rows.sort((a, c) => a.s - c.s);
      render(rows, ts.length * swims.length);
    } catch (e) {
      if (token === run) out.textContent = `Search failed: ${e.message}`;
    } finally {
      if (token === run) { preparing = null; prog.hidden = true; btn.disabled = false; }
    }
  }
  function render(rows, tried) {
    out.innerHTML = '';
    if (clipped) { const n = document.createElement('div'); n.className = 'hint'; n.textContent = Number.isFinite(b.services.horizon()) ? `searched only as far as the bundled predictions reach (${fmtDateYear(b.services.horizon())})` : 'No bundled predictions are available for this search'; out.appendChild(n); }
    if (!rows.length) { const n = document.createElement('div'); n.className = 'hint'; n.textContent = `no start fits (${tried} tried)`; out.appendChild(n); return; }
    const fastest = rows.reduce((a, c) => (c.s < a.s ? c : a));
    for (const e of rows) {
      const slack = live.field ? slackNear(live.field, e.t) : null;
      const rel = slack ? `${Math.abs(slack.minutes)} min ${slack.minutes >= 0 ? 'after' : 'before'} slack` : '';
      const row = document.createElement('button'); row.type = 'button'; row.className = 'bs' + (e === fastest && rows.length > 1 ? ' best' : '');
      span(row, 'w', `${fmtWhen(e.t)}${scope.value === 'all' ? ` · ${e.r.name}` : ''}`);
      span(row, 's', `${fmtMMSS(e.s)} · ${fmtTime(e.finish)}${e.day ? '' : ' · dark'}`);
      span(row, 'rel', rel);
      row.onclick = () => { if (state.routeId !== e.r.id) set({ routeId: e.r.id }); set({ selectedTime: e.t }); };
      out.appendChild(row);
    }
  }
  function cancel() { run++; preparing = null; out.innerHTML = ''; memo.clear(); btn.disabled = false; prog.hidden = true; }
  btn.onclick = find; $('bs-clear').onclick = () => { date.value = ''; cancel(); };
  for (const input of [scope, cycles, date, daylight, maxDur, weekends]) input.addEventListener('input', cancel);
  for (const key of ['world', 'routeId', 'paceMps', 'selectedTime']) on(key, cancel);
  let version = state.data.version;
  on('data', d => { if (version !== d.version) { version = d.version; if (preparing !== run) cancel(); } });
  return { find, cancel };
}
