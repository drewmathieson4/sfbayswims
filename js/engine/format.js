// Number formatting shared by the apps, in the chosen units: times as m:ss / h:mm:ss, distances in yards + miles or
// metres + kilometres, pace per 100 yd or 100 m, temperature in °F or °C. The frame uses yards and °F; the planner lets
// the user choose (setUnits).
export const M2YD = 1.09361, M2MI = 1 / 1609.344, YD100 = 91.44;
export const units = { dist: 'yd', temp: 'F' };                    // 'yd' | 'm' · 'F' | 'C'
export function setUnits(patch) { Object.assign(units, patch); }
export const fmtMMSS = s => {
  if (!isFinite(s)) return '—';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
};
export const fmtDist = m => units.dist === 'm'
  ? (m >= 3000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m).toLocaleString('en-US')} m`)
  : (m * M2YD >= 3000 ? `${(m * M2MI).toFixed(1)} mi` : `${Math.round(m * M2YD).toLocaleString('en-US')} yd`);
export const per100 = () => (units.dist === 'm' ? 100 : YD100);    // metres in "100"
export const paceUnit = () => (units.dist === 'm' ? '/100 m' : '/100 yd');
/** Ground speed in m/s → "1:43 /100 yd" in whole seconds; "—" when not moving. */
export const fmtPace = mps => (mps > 0.01 ? `${fmtMMSS(Math.round(per100() / mps))} ${paceUnit()}` : '—');
export const fmtPaceOnly = mps => (mps > 0.01 ? fmtMMSS(Math.round(per100() / mps)) : '—');
/** "1:45" in the current units → m/s, or null. */
export const parsePace = s => { const m = /^(\d+):(\d\d)$/.exec(String(s).trim()); if (!m) return null; const sec = +m[1] * 60 + +m[2]; return sec > 0 ? per100() / sec : null; };
export const fmtTemp = degF => (units.temp === 'C' ? `${Math.round((degF - 32) * 5 / 9)}°C` : `${Math.round(degF)}°F`);
