// The Bay current field: inverse-distance blend of NOAA station predictions on a coarse lattice, masked to water.
// Same interface as js/current.js createField: prepare / sampleInto / sample / reference / ctx / isWater.
import { CONFIG } from './config.js';
import { state } from './state.js';
import { cellIndex, isWater, LAND } from './geometry.js';
import { KN, overrideCurrent } from './current.js';

const D2R = Math.PI / 180;

export function createStationField({ geometry, stations, seriesById, tideRef, liveRef = null, config = CONFIG, fieldCfg = {} }) {
  const g = geometry.grid, cv = config.current;
  const idw = { k: 5, power: 2, cellM: 40, ...(fieldCfg.idw || {}) };
  const S = stations.filter(s => seriesById.has(s.id));
  if (!S.length) console.warn('station field: no current series loaded — still water');
  const k = Math.min(idw.k, S.length);
  let refIdx = S.findIndex(s => s.id === fieldCfg.reference);
  if (refIdx < 0) { console.warn(`station field: reference '${fieldCfg.reference}' not loaded; using ${S[0]?.id}`); refIdx = 0; }
  const ref = S[refIdx];
  const refFlood = (ref?.floodDir ?? cv.floodDirDeg) * D2R, fx = Math.sin(refFlood), fy = Math.cos(refFlood);

  // Static IDW weights: for every lattice cell, its k nearest stations and their normalised 1/d^p weights.
  const W = { x0: g.x0, y0: g.y0, cell: idw.cellM, nx: Math.ceil(g.nx * g.cell / idw.cellM), ny: Math.ceil(g.ny * g.cell / idw.cellM) };
  const idx = new Uint16Array(W.nx * W.ny * k), wgt = new Float32Array(W.nx * W.ny * k);
  {
    const d = new Float64Array(S.length), near = new Int32Array(k);
    for (let j = 0; j < W.ny; j++) for (let i = 0; i < W.nx; i++) {
      const cx = W.x0 + (i + 0.5) * W.cell, cy = W.y0 + (j + 0.5) * W.cell, base = (j * W.nx + i) * k;
      for (let s = 0; s < S.length; s++) d[s] = Math.hypot(cx - S[s].x, cy - S[s].y);
      let found = 0;                                                     // partial selection of the k nearest (insertion)
      for (let s = 0; s < S.length; s++) {
        let m = found < k ? found++ : (d[s] < d[near[k - 1]] ? k - 1 : -1);
        if (m < 0) continue;
        while (m > 0 && d[s] < d[near[m - 1]]) { near[m] = near[m - 1]; m--; }
        near[m] = s;
      }
      let sum = 0;
      for (let m = 0; m < k; m++) { const s = near[m], w = 1 / Math.pow(Math.max(d[s], W.cell), idw.power); idx[base + m] = s; wgt[base + m] = w; sum += w; }
      for (let m = 0; m < k; m++) wgt[base + m] /= sum || 1;
    }
  }

  const su = new Float32Array(S.length), sv = new Float32Array(S.length);
  const ctx = { u: 0, v: 0, kn: 0, dir: 0, flood: false, uFill: 0, rateFtH: 0, t: NaN, approx: false, source: 'stations', version: -1, still: false, override: 0, su, sv };

  // one station's vector at t: the live NOAA window for the reference station, else its bundle (clamped at the ends)
  function stationUV(i, t) {
    const s = S[i];
    if (liveRef && s.id === config.stations.currents) { const live = liveRef(); if (live?.covers(t)) return live.at(t); }
    return seriesById.get(s.id).at(t);
  }
  // prepare(t): every station's vector for this moment (30-s buckets; the integrator calls this per 10 m step)
  function prepare(t) {
    t = Math.round(t / 30000) * 30000;
    if (t === ctx.t && ctx.version === state.data.version && !state.still === !ctx.still && ctx.override === config.debugCurrentKn) return ctx;
    ctx.version = state.data.version; ctx.still = state.still; ctx.override = config.debugCurrentKn;
    let approx = false, refApprox = false;
    for (let i = 0; i < S.length; i++) { const o = stationUV(i, t); su[i] = o.u * cv.outsideGain; sv[i] = o.v * cv.outsideGain; if (o.approx) { approx = true; if (i === refIdx) refApprox = true; } }
    ctx.source = 'stations';
    if (config.debugCurrentKn) { const o = overrideCurrent(config.debugCurrentKn, ref?.floodDir ?? cv.floodDirDeg, ref?.ebbDir ?? cv.ebbDirDeg); su.fill(o.u); sv.fill(o.v); approx = refApprox = true; ctx.source = 'override'; }
    if (state.still) { su.fill(0); sv.fill(0); }
    ctx.u = su[refIdx] || 0; ctx.v = sv[refIdx] || 0;
    ctx.kn = Math.hypot(ctx.u, ctx.v) / KN; ctx.dir = (Math.atan2(ctx.u, ctx.v) / D2R + 360) % 360;
    ctx.flood = (ctx.u * fx + ctx.v * fy) > 0; ctx.approx = approx || refApprox;
    const tide = tideRef(); ctx.rateFtH = tide ? tide.rateAt(t) : 0; ctx.uFill = 0;
    ctx.t = t;
    return ctx;
  }
  function sampleInto(x, y, c, v) {
    const cell = cellIndex(g, x, y);
    if (cell < 0 || g.type[cell] === LAND) { v.x = 0; v.y = 0; return v; }
    const i = Math.min(W.nx - 1, Math.max(0, ((x - W.x0) / W.cell) | 0)), j = Math.min(W.ny - 1, Math.max(0, ((y - W.y0) / W.cell) | 0)), b = (j * W.nx + i) * k;
    let u = 0, vv = 0;
    for (let m = 0; m < k; m++) { const s = idx[b + m], w = wgt[b + m]; u += w * c.su[s]; vv += w * c.sv[s]; }
    v.x = u; v.y = vv; return v;
  }
  const tmp = { x: 0, y: 0 };
  function sample(x, y, t) { prepare(t); return sampleInto(x, y, ctx, tmp); }   // hot path: returns a shared scratch vector
  /** What the HUD shows: the reference station's own reading. */
  function reference(t) {
    prepare(t);
    return { kn: ctx.kn, label: ctx.kn < cv.slackKn ? 'SLACK' : (ctx.flood ? 'FLOOD' : 'EBB'), approx: ctx.approx, source: ctx.source, where: fieldCfg.referenceLabel || '' };
  }
  return { prepare, sampleInto, sample, reference, ctx, stations: S, isWater: (x, y) => isWater(geometry, x, y) };
}
