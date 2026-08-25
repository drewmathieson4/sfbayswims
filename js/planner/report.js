// Report a bug: a diagnostic text (the plan, the data and its age, the predictions' reach, the browser, the last errors)
// that the user can copy, open as a GitHub issue, or email — no backend involved.
import { CONFIG } from '../engine/config.js';
import { state } from '../engine/state.js';
import { fmtTime, fmtDate } from '../engine/data.js';
import { units } from '../engine/format.js';
import { lastErrors } from '../engine/health.js';
import { planUrl } from './share.js';

const $ = id => document.getElementById(id);
const age = t => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const when = t => `${fmtDate(t)} ${fmtTime(t)}`;

export function buildReport({ b, notes = '', custom = null }) {
  const d = state.data, h = d.health || {}, hz = b.services.horizon();
  const line = (k, label) => { const v = h[k]; return `${label}: ${v ? (v.ok ? `ok (${v.source || 'live'}, ${age(v.t)})` : `failed ${age(v.t)} — ${v.err}`) : 'not fetched yet'}`; };
  const res = state.physics?.byRoute?.get(state.routeId);
  return [
    `SF Bay Swims bug report · app ${CONFIG.version} · ${new Date().toISOString()}`,
    `What happened: ${notes.trim() || '(please describe)'}`,
    '', `Plan: ${planUrl(custom)}`,
    `Spot ${state.world} · swim ${state.routeId} · start ${state.selectedTime != null ? when(state.selectedTime) : 'now'} · pace ${state.paceMps.toFixed(3)} m/s · units ${units.dist}/${units.temp}`,
    res ? `Physics: ${res.feasible ? `${Math.round(res.totalSeconds)} s` : 'swept'} · ${state.physics.ms.toFixed(1)} ms · at ${when(state.physics.at)}` : 'Physics: none yet',
    '', 'Data:',
    `  water: ${d.waterTemp ? `${d.waterTemp.degF.toFixed(1)}°F ${d.waterTemp.approx ? '(climatology)' : ''} from ${d.waterTemp.source || '?'} at ${when(d.waterTemp.t)}` : 'none'} · ${line('waterTemp', 'fetch')}`,
    `  wind: ${d.wind ? `${d.wind.kn.toFixed(1)} kn from ${d.wind.source || '?'} at ${when(d.wind.t)}` : 'none'} · ${line('wind', 'fetch')}`,
    `  ${line('tides', 'tides live')} · ${line('currents', 'cove current live')}`,
    `  bundled predictions through ${isFinite(hz) ? when(hz) : 'unknown'}`,
    '', `Browser: ${navigator.userAgent} · ${innerWidth}×${innerHeight} @${devicePixelRatio} · ${navigator.onLine ? 'online' : 'offline'}`,
    `Errors: ${lastErrors().length ? lastErrors().map(e => `[${fmtTime(e.t)}] ${e.where ? e.where + ': ' : ''}${e.msg}`).join(' | ') : 'none'}`,
  ].join('\n');
}

export function bindReport({ b, getCustom = () => null }) {
  const notes = $('report-notes'), copy = $('report-copy'), issue = $('report-issue'), mail = $('report-email');
  const text = () => buildReport({ b, notes: notes.value, custom: getCustom() });
  copy.onclick = async () => { try { await navigator.clipboard.writeText(text()); copy.textContent = 'copied'; } catch { prompt('copy this report', text()); } setTimeout(() => { copy.textContent = 'copy report'; }, 1500); };
  issue.onclick = () => { const t = text(); window.open(`${CONFIG.feedback.issues}?title=${encodeURIComponent('Bug: ' + (notes.value.trim().slice(0, 60) || state.routeId))}&body=${encodeURIComponent(t.slice(0, 6000))}`, '_blank'); };
  if (CONFIG.feedback.email) { mail.hidden = false; mail.onclick = () => { location.href = `mailto:${CONFIG.feedback.email}?subject=${encodeURIComponent('SF Bay Swims bug')}&body=${encodeURIComponent(text().slice(0, 6000))}`; }; }
  else mail.hidden = true;
}
