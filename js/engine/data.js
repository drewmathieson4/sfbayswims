// Live data: NOAA CO-OPS (tides, currents), USGS (water temperature), NWS / Open-Meteo (wind) — all browser-side,
// key-less and CORS-enabled — plus Pacific-time helpers, the localStorage cache and the offline bundles.
import { CONFIG } from './config.js';
import { dataUrl } from './paths.js';

export const TZ = 'America/Los_Angeles';
const COOPS = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';

// ---- time: station times are Pacific local; the app renders Pacific regardless of the device ----
const dtfCache = new Map();
function dtf(tz) {
  if (!dtfCache.has(tz)) dtfCache.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  return dtfCache.get(tz);
}
export function tzParts(t, tz = TZ) {
  const p = Object.fromEntries(dtf(tz).formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, hh: (+p.hour) % 24, mi: +p.minute, ss: +p.second };
}
export function tzOffsetMin(t, tz = TZ) { const p = tzParts(t, tz); return (Date.UTC(p.y, p.mo - 1, p.d, p.hh, p.mi, p.ss) - Math.floor(t / 1000) * 1000) / 60000; }
export function localToEpoch(y, mo, d, hh, mi, tz = TZ) {
  const naive = Date.UTC(y, mo - 1, d, hh, mi);
  let t = naive - tzOffsetMin(naive, tz) * 60000;
  const off2 = tzOffsetMin(t, tz);
  if (off2 !== tzOffsetMin(naive, tz)) t = naive - off2 * 60000;
  return t;
}
export function fmtYMD(t, tz = TZ) { const p = tzParts(t, tz); return `${p.y}${String(p.mo).padStart(2, '0')}${String(p.d).padStart(2, '0')}`; }
export function parseCoops(s) { const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d)/.exec(s); return localToEpoch(+m[1], +m[2], +m[3], +m[4], +m[5]); }
export function fmtTime(t) { return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(t)).replace(' ', '').toLowerCase(); }
export function fmtDateYear(t) { return new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(t)); }
export function fmtDate(t) { return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(t)); }

// ---- fetch with a timeout ----
export async function getJSON(url, { timeoutMs = CONFIG.refresh.fetchTimeoutMs, headers } = {}) {
  const ctl = new AbortController(), id = setTimeout(() => ctl.abort(), timeoutMs);
  try { const r = await fetch(url, { signal: ctl.signal, headers }); if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`); return await r.json(); }
  finally { clearTimeout(id); }
}
const coopsURL = params => `${COOPS}?${new URLSearchParams({ time_zone: 'lst_ldt', units: 'english', format: 'json', application: 'aquaticpark', ...params })}`;

// ---- localStorage cache (best effort) ----
export function cacheGet(key) { try { const s = localStorage.getItem('ap.' + key); return s ? JSON.parse(s) : null; } catch { return null; } }
export function cachePut(key, obj) { try { localStorage.setItem('ap.' + key, JSON.stringify(obj)); } catch { /* ignore */ } }

// ---- tides: hi/lo extremes at the cove's station ----
export async function fetchTides({ t0, t1 }) {
  const j = await getJSON(coopsURL({ product: 'predictions', datum: 'MLLW', station: CONFIG.stations.tideLocal, interval: 'hilo', begin_date: fmtYMD(t0), end_date: fmtYMD(t1) }));
  if (j.error) throw new Error(j.error.message);
  return { station: CONFIG.stations.tideLocal, hilo: j.predictions.map(p => ({ t: parseCoops(p.t), h: +p.v, type: p.type })), fetchedAt: Date.now() };
}

// ---- currents: the cove's outside station, 6-minute speed/direction ----
export async function fetchCurrents({ t0, t1 }) {
  const s = CONFIG.stations;
  const j = await getJSON(coopsURL({ product: 'currents_predictions', station: s.currents, bin: s.currentsBin, interval: '6', vel_type: 'speed_dir', begin_date: fmtYMD(t0), end_date: fmtYMD(t1) }));
  if (j.error) throw new Error(j.error.message);
  return { station: s.currents, samples: (j.current_predictions?.cp || []).map(c => ({ t: parseCoops(c.Time), kn: +c.Speed, dir: +c.Direction })), fetchedAt: Date.now() };
}

// ---- water temperature: measured sources, nearest first ----
async function usgsOGC(site) {
  const j = await getJSON(`https://api.waterdata.usgs.gov/ogcapi/v0/collections/latest-continuous/items?monitoring_location_id=USGS-${site}&parameter_code=00010&f=json`);
  const f = j.features?.[0]?.properties; if (!f || f.value == null) throw new Error('empty');
  return { t: Date.parse(f.time), degF: (+f.value) * 9 / 5 + 32 };
}
async function usgsIV(site) {
  const j = await getJSON(`https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${site}&parameterCd=00010&period=PT3H`);
  const vals = j.value?.timeSeries?.[0]?.values?.[0]?.value; if (!vals?.length) throw new Error('empty');
  const v = vals[vals.length - 1]; return { t: Date.parse(v.dateTime), degF: (+v.value) * 9 / 5 + 32 };
}
async function cencoosTiburon() {
  const j = await getJSON('https://erddap.cencoos.org/erddap/tabledap/tiburon-water-tibc1.json?time,sea_water_temperature&time>=now-1day&orderByMax(%22time%22)');
  const row = j.table?.rows?.[0]; if (!row || row[1] == null) throw new Error('empty');
  return { t: Date.parse(row[0]), degF: row[1] * 9 / 5 + 32, approx: true };   // Raccoon Strait; runs warm
}
async function coopsTemp(station) {
  const j = await getJSON(coopsURL({ product: 'water_temperature', station, date: 'latest' }));
  if (j.error) throw new Error(j.error.message);                                // HTTP 200 with an error body when the sensor is down
  const d = j.data?.[0]; if (!d) throw new Error('empty');
  return { t: parseCoops(d.t), degF: +d.v };
}
export async function fetchWaterTemp() {
  const s = CONFIG.stations;
  const chain = [['usgs-alcatraz', () => usgsOGC(s.waterTempUSGS)], ['usgs-alcatraz-iv', () => usgsIV(s.waterTempUSGS)], ['usgs-pier17', () => usgsOGC(s.waterTempUSGSAlt)],
                 ['noaa-9414290', () => coopsTemp(s.tideRef)], ['cencoos-tiburon', () => cencoosTiburon()]];
  for (const [source, fn] of chain) {
    try { const r = await fn(); if (isFinite(r.degF) && Date.now() - r.t < 36 * 3600e3) return { ...r, source }; console.warn('water temp', source, 'stale or NaN'); }
    catch (e) { console.warn('water temp', source, e.message); }
  }
  throw new Error('no water temperature source');
}

// ---- wind ----
export async function fetchWind() {
  try {
    const j = await getJSON(`https://api.weather.gov/stations/${CONFIG.stations.windNWS}/observations/latest`, { headers: { Accept: 'application/geo+json' } });
    const p = j.properties; if (p?.windSpeed?.value == null) throw new Error('no wind value');
    return { t: Date.parse(p.timestamp), kn: p.windSpeed.value / 1.852, dirDeg: p.windDirection?.value ?? null, gustKn: p.windGust?.value != null ? p.windGust.value / 1.852 : null, source: 'nws-ftpc1' };
  } catch (e) { console.warn('wind nws', e.message); }
  const o = CONFIG.origin;
  const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${o.lat}&longitude=${o.lon}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn&cell_selection=sea&timezone=${TZ}`);
  const c = j.current; return { t: Date.parse(c.time), kn: c.wind_speed_10m, dirDeg: c.wind_direction_10m, gustKn: c.wind_gusts_10m, source: 'open-meteo' };
}

// ---- offline bundles (data/*.json) ----
export async function loadBundle(name) {
  try { const r = await fetch(dataUrl(name), { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch { return null; }
}
export function climatologyTemp(clim, t) {
  if (!clim?.doyMeanF) return null;
  const p = tzParts(t), day = Math.floor((Date.UTC(p.y, p.mo - 1, p.d) - Date.UTC(p.y, 0, 1)) / 86400e3);
  const v = clim.doyMeanF[Math.min(day, clim.doyMeanF.length - 1)];
  return isFinite(v) ? v : null;
}
