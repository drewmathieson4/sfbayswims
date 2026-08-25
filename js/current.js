// Station current series, and the cove current field c(x, y, t): the outside current leaks in with a shelter
// factor, the cove fills/drains through its openings with the tide, and an eddy curls just inside the Opening.
// Field interface (shared with js/stationfield.js): prepare(t) → ctx · sampleInto(x, y, ctx, out) · sample(x, y, t) ·
// reference(t) for the HUD · isWater(x, y).
import { CONFIG } from './config.js';
import { state } from './state.js';
import { cellIndex, isWater, LAND, COVE } from './geometry.js';

export const KN = 0.514444;   // m/s per knot
const D2R = Math.PI / 180;

/** A time series of current vectors; from NOAA samples or a compact bundle {t0, dtMs, kn[], dir[]}. */
export class CurrentSeries {
  constructor({ samples, t0, dtMs, kn, dir, station = null }) {
    if (!samples && kn) samples = kn.map((k, i) => ({ t: t0 + i * dtMs, kn: k, dir: dir[i] }));
    const s = samples.slice().sort((a, b) => a.t - b.t);
    this.t = Float64Array.from(s, e => e.t);
    this.u = Float32Array.from(s, e => e.kn * KN * Math.sin(e.dir * D2R));
    this.v = Float32Array.from(s, e => e.kn * KN * Math.cos(e.dir * D2R));
    this.station = station; this._i = 0;
  }
  get t0() { return this.t[0]; } get t1() { return this.t[this.t.length - 1]; }
  covers(t) { return this.t.length > 1 && t >= this.t0 && t <= this.t1; }
  /** Interpolated vector at t; outside the range the nearest end, flagged approx. */
  at(t) {
    const n = this.t.length;
    if (n === 0) return { u: 0, v: 0, kn: 0, dir: 0, approx: true };
    if (t <= this.t[0]) return this._pack(this.u[0], this.v[0], true);
    if (t >= this.t[n - 1]) return this._pack(this.u[n - 1], this.v[n - 1], true);
    let i = this._i;
    if (!(this.t[i] <= t && t < this.t[i + 1])) {
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.t[m] <= t) lo = m; else hi = m; }
      i = lo; this._i = i;
    }
    const f = (t - this.t[i]) / (this.t[i + 1] - this.t[i]);
    return this._pack(this.u[i] + (this.u[i + 1] - this.u[i]) * f, this.v[i] + (this.v[i + 1] - this.v[i]) * f, false);
  }
  _pack(u, v, approx) { return { u, v, kn: Math.hypot(u, v) / KN, dir: (Math.atan2(u, v) / D2R + 360) % 360, approx }; }
  /** Join bundles (this year's and next year's) or sample lists. */
  static concat(bundles, station = null) {
    const samples = [];
    for (const b of bundles) { if (!b) continue; if (b.samples) samples.push(...b.samples); else if (b.kn) b.kn.forEach((k, i) => samples.push({ t: b.t0 + i * b.dtMs, kn: k, dir: b.dir[i] })); }
    const byT = new Map(); for (const s of samples) byT.set(s.t, s);
    return new CurrentSeries({ samples: [...byT.values()], station });
  }
}

/** Fallback when no station data: current ∝ tide rate, along the flood/ebb axis. */
export function derivedCurrent(tide, t, cv) {
  let kn = cv.fallbackKnPerFtH * tide.rateAt(t - cv.fallbackLagMin * 60000);
  kn = Math.max(-1.2, Math.min(1.2, kn));
  const dir = kn >= 0 ? cv.floodDirDeg : cv.ebbDirDeg, m = Math.abs(kn) * KN;
  return { u: m * Math.sin(dir * D2R), v: m * Math.cos(dir * D2R), kn: Math.abs(kn), dir, approx: true };
}

/** Forced uniform current for testing (?kn=): + flood, − ebb along the given axis. */
export function overrideCurrent(kn, floodDirDeg, ebbDirDeg) {
  const deg = (kn >= 0 ? floodDirDeg : ebbDirDeg) * D2R;
  return { u: Math.abs(kn) * KN * Math.sin(deg), v: Math.abs(kn) * KN * Math.cos(deg), kn: Math.abs(kn), dir: deg / D2R, approx: true };
}

export function createField({ geometry, tideRef, currentsRef, config = CONFIG }) {
  const g = geometry.grid, cv = config.current;
  const fx = Math.sin(cv.floodDirDeg * D2R), fy = Math.cos(cv.floodDirDeg * D2R);
  const ctx = { u: 0, v: 0, kn: 0, dir: 0, flood: false, uFill: 0, rateFtH: 0, t: NaN, approx: false, source: 'none', version: -1, still: false, override: 0 };
  const opening = geometry.openings.find(o => o.id === 'opening') || geometry.openings[0];
  const eddies = geometry.openings.filter(o => o.exposed && o.zone === 'cove').map(o => ({ x: o.mid.x + o.nIn.x * cv.eddyRadiusM, y: o.mid.y + o.nIn.y * cv.eddyRadiusM }));

  // prepare(t): the outside current and tide rate for this moment, cached per 30-s bucket and per data version
  function prepare(t) {
    t = Math.round(t / 30000) * 30000;
    if (t === ctx.t && ctx.version === state.data.version && !state.still === !ctx.still && ctx.override === config.debugCurrentKn) return ctx;
    ctx.version = state.data.version; ctx.still = state.still; ctx.override = config.debugCurrentKn;
    const cur = currentsRef(), tide = tideRef(), tl = t - cv.currentLagMin * 60000;
    let out;
    if (config.debugCurrentKn) { out = overrideCurrent(config.debugCurrentKn, cv.floodDirDeg, cv.ebbDirDeg); ctx.source = 'override'; }
    else if (cur && cur.covers(tl)) { out = cur.at(tl); ctx.source = 'station'; }
    else if (tide) { out = derivedCurrent(tide, t, cv); ctx.source = 'derived'; }
    else { out = { u: 0, v: 0, kn: 0, dir: 0, approx: true }; ctx.source = 'none'; }
    ctx.u = out.u * cv.outsideGain; ctx.v = out.v * cv.outsideGain;
    ctx.kn = Math.hypot(ctx.u, ctx.v) / KN; ctx.dir = out.dir; ctx.approx = !!out.approx;
    ctx.flood = (ctx.u * fx + ctx.v * fy) > 0;
    ctx.rateFtH = tide ? tide.rateAt(t) : 0;
    const rateMps = tide ? tide.rateMps(t) : 0;
    ctx.uFill = geometry.openingWidthM > 0 ? cv.fillGain * geometry.coveAreaM2 * rateMps / (geometry.openingWidthM * cv.openingDepthM) : 0;
    if (state.still) ctx.u = ctx.v = ctx.kn = ctx.uFill = 0;
    ctx.t = t;
    return ctx;
  }
  // sampleInto: the vector at (x, y) for a prepared ctx — shelter × outside + fill/drain + eddy
  function sampleInto(x, y, c, v) {
    const k = cellIndex(g, x, y);
    if (k < 0 || g.type[k] === LAND) { v.x = 0; v.y = 0; return v; }
    const s = g.shelter[k], f = c.uFill * g.fillShape[k];
    v.x = s * c.u + f * g.fillDirX[k]; v.y = s * c.v + f * g.fillDirY[k];
    if (cv.eddyGain > 0 && g.type[k] === COVE) {
      const R = cv.eddyRadiusM, sense = c.flood ? 1 : -1, mag = Math.hypot(c.u, c.v);
      for (const e of eddies) {
        const rx = x - e.x, ry = y - e.y, r = Math.hypot(rx, ry) || 1;
        if (r > 3 * R) continue;
        const vt = cv.eddyGain * mag * (r / R) * Math.exp(1 - r / R);
        v.x += sense * vt * (ry / r); v.y += sense * vt * (-rx / r);
      }
    }
    return v;
  }
  const tmp = { x: 0, y: 0 };
  function sample(x, y, t) { prepare(t); return sampleInto(x, y, ctx, tmp); }   // hot path: returns a shared scratch vector
  /** What the HUD shows: the current at the Opening. */
  function reference(t) {
    prepare(t); sampleInto(opening.mid.x, opening.mid.y, ctx, tmp);
    const kn = Math.hypot(tmp.x, tmp.y) / KN;
    return { kn, label: kn < cv.slackKn ? 'SLACK' : (ctx.flood ? 'FLOOD' : 'EBB'), approx: ctx.approx, source: ctx.source, where: '' };
  }
  return { prepare, sampleInto, sample, reference, ctx, isWater: (x, y) => isWater(geometry, x, y) };
}
