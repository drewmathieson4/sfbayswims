// A plan in the URL: spot, swim (a twin's id carries the direction), start, pace (m/s, unit-free) and the units.
import { state, effectiveTime } from '../engine/state.js';
import { units } from '../engine/format.js';
import { tzParts } from '../engine/data.js';

const pad = n => String(n).padStart(2, '0');
export function planUrl(custom = null) {
  const q = new URLSearchParams();
  q.set('world', state.world); q.set('route', state.routeId);
  if (custom && state.routeId === 'custom') { q.set('wp', custom.points.map(p => `${(+p.lat).toFixed(5)},${(+p.lon).toFixed(5)}`).join(';')); q.set('mode', custom.mode); q.set('name', custom.name); }
  if (state.selectedTime != null) { const p = tzParts(effectiveTime()); q.set('t', `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mi)}-0${8 - (isDst(effectiveTime()) ? 1 : 0)}:00`); }
  q.set('pace', state.paceMps.toFixed(4));
  q.set('units', units.dist); q.set('temp', units.temp);
  return `${location.origin}${location.pathname}?${q}`;
}
const isDst = t => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'short' }).format(new Date(t)).includes('PDT');
/** A custom swim from a shared link: { name, mode, points } or null. */
export function customFromParams(params) {
  if (!params.has('wp')) return null;
  const points = params.get('wp').split(';').map(s => s.split(',').map(Number)).filter(a => a.length === 2 && a.every(Number.isFinite)).map(([lat, lon]) => ({ lat, lon }));
  return points.length >= 2 ? { name: params.get('name') || 'Shared swim', mode: params.get('mode') || 'oneway', points } : null;
}
/** Units from a shared link override the saved ones (boot already reads world / route / t / pace). */
export function readPlan(params, settings) {
  if (params.has('units')) settings.units = { ...settings.units, dist: params.get('units') === 'm' ? 'm' : 'yd' };
  if (params.has('temp')) settings.units = { ...settings.units, temp: params.get('temp') === 'C' ? 'C' : 'F' };
}
