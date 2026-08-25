// Sunrise, sunset and civil twilight for a place and a day (NOAA's solar-position algorithm, ±2 min). Times are epoch ms.
import { tzParts, localToEpoch } from './data.js';
const D2R = Math.PI / 180;
const jd = t => t / 86400e3 + 2440587.5, ms = j => (j - 2440587.5) * 86400e3;
function crossings(dayNoonMs, lat, lon, altitudeDeg) {
  const n = Math.round(jd(dayNoonMs) - 2451545 + 0.0008), Js = n - lon / 360;
  const M = ((357.5291 + 0.98560028 * Js) % 360 + 360) % 360, Mr = M * D2R;
  const C = 1.9148 * Math.sin(Mr) + 0.02 * Math.sin(2 * Mr) + 0.0003 * Math.sin(3 * Mr);
  const lam = ((M + C + 180 + 102.9372) % 360) * D2R;
  const Jt = 2451545 + Js + 0.0053 * Math.sin(Mr) - 0.0069 * Math.sin(2 * lam);
  const dec = Math.asin(Math.sin(lam) * Math.sin(23.4397 * D2R)), phi = lat * D2R;
  const cosW = (Math.sin(altitudeDeg * D2R) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosW <= -1 || cosW >= 1) return null;                        // no crossing that day (polar); never in San Francisco
  const w = Math.acos(cosW) / (2 * Math.PI);
  return [ms(Jt - w), ms(Jt + w)];
}
/** { dawn, sunrise, sunset, dusk } for the Pacific day containing `t`. */
export function sunTimes(t, lat, lon) {
  const p = tzParts(t), noon = localToEpoch(p.y, p.mo, p.d, 12, 0);
  const day = crossings(noon, lat, lon, -0.833), civil = crossings(noon, lat, lon, -6);
  return { sunrise: day?.[0] ?? null, sunset: day?.[1] ?? null, dawn: civil?.[0] ?? null, dusk: civil?.[1] ?? null };
}
