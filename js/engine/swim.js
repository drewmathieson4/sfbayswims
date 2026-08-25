// Swim physics. A route is integrated leg by leg in small steps; at each step the swimmer crabs to hold the leg's
// line against the current: ground speed g = sqrt(v² − c⊥²) + c∥ (v = swimming speed, c⊥/c∥ = current across/along
// the line). When the normal pace makes poor headway they sprint (1:00/100 m) from a reserve that refills while
// swimming easy. If even a sprint can't hold the line the route is impossible: the profile ends there and a drift is
// appended — a fight into the current while the reserve lasts, then tiring, then simply carried (the "swept away"
// animation). The profile (t, x, y, heading, effort per sample) is what js/animate.js plays back.
import { CONFIG } from './config.js';

/** One leg from A to B starting at t0Ms. `st.burst` is the route's sprint reserve (seconds), threaded through the legs. */
export function integrateLeg(A, B, t0Ms, vs, field, opts = CONFIG.swim, st = { burst: opts.burstReserveS || 0 }) {
  const L = Math.hypot(B.x - A.x, B.y - A.y), hdg0 = (Math.atan2(B.x - A.x, B.y - A.y) * 180 / Math.PI + 360) % 360;
  if (L < 0.01) return { meters: 0, seconds: 0, feasible: true, swept: false, samples: [{ s: 0, t: t0Ms, x: A.x, y: A.y, ok: true, hdg: hdg0, effort: 0 }] };
  const ux = (B.x - A.x) / L, uy = (B.y - A.y) / L, nx = -uy, ny = ux;
  const stepM = Math.max(1, opts.stepM), floor = Math.max(1e-3, opts.minGroundMps);
  const nSteps = Math.max(1, Math.ceil(L / stepM)), h = L / nSteps;
  const vb = Math.max(vs, opts.burstPaceMps || vs), reserve = opts.burstReserveS || 0, recharge = opts.burstRechargePerS || 0;
  let t = t0Ms, s = 0, swept = false, g = vs, hdg = hdg0;
  const samples = [];
  for (let k = 0; k < nSteps; k++) {
    const c = field.sample(A.x + ux * (s + h / 2), A.y + uy * (s + h / 2), t);
    const cPar = c.x * ux + c.y * uy, cPerp = c.x * nx + c.y * ny;
    const disc = vs * vs - cPerp * cPerp;
    let gN = disc > 0 ? Math.sqrt(disc) + cPar : -Infinity, ok = gN >= floor, effort = 0;
    g = gN;
    if (!ok && st.burst > 0 && vb > vs) {                              // can't hold it at the normal pace: sprint while the reserve lasts
      const d2 = vb * vb - cPerp * cPerp;
      if (d2 > 0) { const gB = Math.sqrt(d2) + cPar; if (gB >= floor && st.burst >= h / gB) { g = gB; ok = true; effort = 0.5; } }
    }
    if (!ok) {                                                        // even a sprint can't hold the line: swept from here
      swept = true;
      samples.push({ s, t, x: A.x + ux * s, y: A.y + uy * s, ok: false, hdg: hdg0, effort: 1 });
      break;
    }
    const dtS = h / g;
    st.burst = effort ? Math.max(0, st.burst - dtS) : Math.min(reserve, st.burst + dtS * recharge);
    const wx = g * ux - c.x, wy = g * uy - c.y;                         // water-relative velocity → the heading (the crab angle)
    hdg = (Math.atan2(wx, wy) * 180 / Math.PI + 360) % 360;
    samples.push({ s, t, x: A.x + ux * s, y: A.y + uy * s, ok: true, hdg, effort });
    t += 1000 * dtS; s += h;
  }
  if (!swept) samples.push({ s: L, t, x: B.x, y: B.y, ok: true, hdg, effort: 0 });
  return { meters: L, seconds: (t - t0Ms) / 1000, feasible: !swept, swept, samples };
}

/** The drift after being swept at P: sprint into the current while the reserve lasts (losing ground slowly), effort
 *  fading over anim.sweptFightS, then carried. `seconds` of swim time in stepS steps; stops when washed ashore. */
function sweepFrom(P, target, tMs, vs, field, seconds, st, stepS = 5) {
  const vb = Math.max(vs, CONFIG.swim.burstPaceMps || vs), fightS = CONFIG.anim.sweptFightS || 0;
  let reserve = st?.burst || 0, tired = 0, x = P.x, y = P.y, t = tMs, wasWater = field.isWater(x, y);
  const out = [];
  for (let el = stepS; el <= seconds; el += stepS) {
    let e, effort;
    if (reserve > 0) { e = vb; effort = 1; reserve -= stepS; }
    else { tired += stepS; const f = fightS > 0 ? Math.max(0, 1 - tired / fightS) : 0; e = vs * f; effort = 0.3 + 0.7 * f; }
    const c = field.sample(x, y, t), dx = target.x - x, dy = target.y - y, d = Math.hypot(dx, dy) || 1;
    x += (c.x + e * dx / d) * stepS; y += (c.y + e * dy / d) * stepS; t += stepS * 1000;
    const water = field.isWater(x, y);
    if (wasWater && !water) break;
    wasWater = water;
    out.push({ t, x, y, hdg: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360, effort });
  }
  return out;
}

/** Whole route at t0Ms → { feasible, totalMeters, totalSeconds, legs, profile }. sweep:false skips the drift (the 48-h scan). */
export function integrateRoute(route, t0Ms, vs, field, { sweep = true } = {}) {
  const legs = [], st = { burst: CONFIG.swim.burstReserveS || 0 };
  let t = t0Ms, feasible = true, sweptAt = null, sOff = 0;
  const T = [], S = [], X = [], Y = [], LEG = [], HDG = [], EFF = [];
  for (let i = 0; i < route.legs.length; i++) {
    const leg = route.legs[i], r = integrateLeg(leg.from, leg.to, t, vs, field, CONFIG.swim, st);
    legs.push({ from: leg.from, to: leg.to, meters: r.meters, seconds: r.seconds, feasible: r.feasible });
    r.samples.forEach((p, j) => {
      if (!r.swept && j === r.samples.length - 1 && i < route.legs.length - 1) return;   // the next leg starts here
      T.push((p.t - t0Ms) / 1000); S.push(sOff + p.s); X.push(p.x); Y.push(p.y); LEG.push(i); HDG.push(p.hdg); EFF.push(p.effort);
    });
    t += r.seconds * 1000;
    if (r.swept) {
      feasible = false;
      if (sweep) {   // the drift's length is deliberately in screen time: sweptRealS real seconds at the sped-up tempo
        const P = r.samples[r.samples.length - 1], secs = (CONFIG.anim.sweptRealS || 0) * CONFIG.anim.speedup * (CONFIG.anim.sweptTempo || 1);
        sweptAt = (P.t - t0Ms) / 1000;
        for (const q of sweepFrom(P, leg.to, P.t, vs, field, secs, st)) { T.push((q.t - t0Ms) / 1000); S.push(sOff + P.s); X.push(q.x); Y.push(q.y); LEG.push(i); HDG.push(q.hdg); EFF.push(q.effort); }
      }
      break;
    }
    sOff += r.meters;
  }
  const totalMeters = route.meters;
  const animSeconds = T.length > 1 ? T[T.length - 1] : CONFIG.anim.pauseS;   // a degenerate profile still cycles
  return { routeId: route.id, totalMeters, totalSeconds: (t - t0Ms) / 1000, feasible, legs,
           profile: { n: T.length, t: Float64Array.from(T), s: Float32Array.from(S), x: Float32Array.from(X), y: Float32Array.from(Y),
                      leg: Uint16Array.from(LEG), hdg: Float32Array.from(HDG), eff: Float32Array.from(EFF),
                      totalMeters, totalSeconds: sweptAt == null ? (t - t0Ms) / 1000 : animSeconds, sweptAt } };
}

/** Position (and heading, effort) along a profile at swim-time tau. */
export function positionAt(profile, tau) {
  const { n, t, s, x, y, leg, hdg, eff } = profile;
  const g0 = n > 1 ? (s[1] - s[0]) / (t[1] - t[0] || 1) : 0;
  if (n === 0) return { x: 0, y: 0, legIndex: 0, hdg: 0, effort: 0, g: 0, i: 0 };
  if (n === 1 || tau <= t[0]) return { x: x[0], y: y[0], legIndex: leg[0], hdg: hdg[0], effort: eff[0], g: g0, i: 0 };
  if (tau >= t[n - 1]) return { x: x[n - 1], y: y[n - 1], legIndex: leg[n - 1], hdg: hdg[n - 1], effort: eff[n - 1], g: 0, i: n - 1 };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= tau) lo = m; else hi = m; }
  const f = (tau - t[lo]) / (t[hi] - t[lo] || 1), g = (s[hi] - s[lo]) / (t[hi] - t[lo] || 1);   // g: ground speed on this sample, m/s
  const dh = ((hdg[hi] - hdg[lo] + 540) % 360) - 180;                                       // heading: shortest-arc interpolation, no snaps
  return { x: x[lo] + (x[hi] - x[lo]) * f, y: y[lo] + (y[hi] - y[lo]) * f, legIndex: leg[lo], hdg: (hdg[lo] + dh * f + 360) % 360, effort: eff[lo], g, i: lo };
}

/** The coming hours in stepMin steps: the earliest feasible start and the fastest one. */
export function scanWindows(route, t0Ms, vs, field, { hours = 48, stepMin = 30 } = {}) {
  let next = null, best = null;
  for (let off = 0; off <= hours * 60; off += stepMin) {
    const t = t0Ms + off * 60000, r = integrateRoute(route, t, vs, field, { sweep: false });
    if (!r.feasible) continue;
    if (!next) next = { t, s: r.totalSeconds };
    if (!best || r.totalSeconds < best.s) best = { t, s: r.totalSeconds };
  }
  return { next, best };
}
