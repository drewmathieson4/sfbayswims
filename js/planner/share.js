// A plan in the URL: spot, swim (a twin's id carries the direction), start, pace (m/s, unit-free) and the units.
import { state, effectiveTime } from '../engine/state.js';
import { units } from '../engine/format.js';
import { customSwim, MAX_WAYPOINTS } from '../engine/validate.js';

export function planUrl(custom = null) {
  const q = new URLSearchParams();
  q.set('world', state.world); q.set('route', state.routeId);
  if (custom && state.routeId === 'custom') { q.set('wp', custom.points.map(p => `${(+p.lat).toFixed(5)},${(+p.lon).toFixed(5)}`).join(';')); q.set('mode', custom.mode); q.set('name', custom.name); }
  if (state.selectedTime != null) q.set('t', new Date(effectiveTime()).toISOString());
  q.set('pace', state.paceMps.toFixed(4));
  q.set('units', units.dist); q.set('temp', units.temp);
  return `${location.origin}${location.pathname}?${q}`;
}
/** A custom swim from a shared link: { name, mode, points } or null. */
export function customFromParams(params) {
  if (!params.has('wp')) return null;
  const rows = params.get('wp').split(';');
  if (rows.length > MAX_WAYPOINTS || rows.some(s => !/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(s))) return null;
  const points = rows.map(s => { const [lat, lon] = s.split(',').map(Number); return { lat, lon }; });
  return customSwim({ name: params.get('name') || 'Shared swim', mode: params.get('mode') || 'oneway', points });
}
/** Units from a shared link override the saved ones (boot already reads world / route / t / pace). */
export function readPlan(params, settings) {
  if (params.has('units')) settings.units = { ...settings.units, dist: params.get('units') === 'm' ? 'm' : 'yd' };
  if (params.has('temp')) settings.units = { ...settings.units, temp: params.get('temp') === 'C' ? 'C' : 'F' };
}
