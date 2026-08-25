// Tide series from NOAA hi/lo extremes: the rate of rise/fall by cosine interpolation (what the cove's fill/drain needs).
export class TideSeries {
  constructor({ hilo, station = null }) {
    this.hilo = hilo.slice().sort((a, b) => a.t - b.t);
    this.station = station; this._i = 0;
  }
  get t0() { return this.hilo[0]?.t ?? Infinity; }
  get t1() { return this.hilo[this.hilo.length - 1]?.t ?? -Infinity; }
  covers(a, b) { return this.hilo.length > 1 && this.t0 <= a && this.t1 >= b; }
  _bracket(t) {                                         // [i, i+1, outOfRange]
    const h = this.hilo, n = h.length;
    if (n < 2) return null;
    if (t <= h[0].t) return [0, 1, true];
    if (t >= h[n - 1].t) return [n - 2, n - 1, true];
    let i = this._i;
    if (!(h[i].t <= t && t < h[i + 1].t)) {
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (h[m].t <= t) lo = m; else hi = m; }
      i = lo; this._i = i;
    }
    return [i, i + 1, false];
  }
  /** ft per hour, + rising */
  rateAt(t) {
    const b = this._bracket(t); if (!b || b[2]) return 0;
    const a = this.hilo[b[0]], c = this.hilo[b[1]], tau = (t - a.t) / (c.t - a.t);
    return (c.h - a.h) * (Math.PI / 2) * Math.sin(Math.PI * tau) / (c.t - a.t) * 3600e3;
  }
  rateMps(t) { return this.rateAt(t) * 0.3048 / 3600; }
  static merge(a, b) {
    if (!a) return b; if (!b) return a;
    const byT = new Map();
    for (const e of [...a.hilo, ...b.hilo]) byT.set(Math.round(e.t / 60000), e);
    return new TideSeries({ hilo: [...byT.values()], station: b.station || a.station });
  }
}
