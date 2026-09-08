// Validate browser-controlled inputs before they reach geometry or physics.
export const MAX_WAYPOINTS = 100;
export function validPace(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0.1 && value <= 5; }
export function paceFrom(value) {
  const m = /^(\d+):(\d{2})$/.exec(String(value ?? '').trim());
  const pace = m ? (+m[2] < 60 ? 100 / (+m[1] * 60 + +m[2]) : NaN) : Number(value);
  return validPace(pace) ? pace : null;
}
export function customSwim(value, bbox = null) {
  if (!value || !['oneway', 'outback', 'loop'].includes(value.mode) || !Array.isArray(value.points) || value.points.length < 2 || value.points.length > MAX_WAYPOINTS) return null;
  const points = value.points;
  if (!points.every(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 &&
    (!bbox || (p.lat >= bbox.s && p.lat <= bbox.n && p.lon >= bbox.w && p.lon <= bbox.e)))) return null;
  // Bound work even before a world is loaded. These are local swims, at most 100 km of waypoint segments.
  let meters = 0;
  for (let i = 1; i < points.length; i++) meters += 111195.08 * Math.hypot(points[i].lat - points[i - 1].lat, (points[i].lon - points[i - 1].lon) * Math.cos(points[i].lat * Math.PI / 180));
  if (meters < 1 || meters > 100000) return null;
  return { name: typeof value.name === 'string' ? value.name.trim().slice(0, 120) || 'Custom swim' : 'Custom swim', mode: value.mode, points: points.map(p => ({ ...p })) };
}
