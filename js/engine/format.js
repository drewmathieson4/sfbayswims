// Number formatting shared by the apps: times as m:ss / h:mm:ss, distances in yards or miles, pace per 100 yd.
export const M2YD = 1.09361, M2MI = 1 / 1609.344, YD100 = 91.44;
export const fmtMMSS = s => {
  if (!isFinite(s)) return '—';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
};
export const fmtDist = m => m * M2YD >= 3000 ? `${(m * M2MI).toFixed(1)} mi` : `${Math.round(m * M2YD).toLocaleString('en-US')} yd`;
/** Ground speed in m/s → "1:43 /100 yd" in whole seconds; "—" when not moving. */
export const fmtPace = mps => mps > 0.01 ? `${fmtMMSS(Math.round(YD100 / mps))} /100 yd` : '—';
