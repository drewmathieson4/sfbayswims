// routes.json + landmarks.json → routes in metres. Waypoints are landmark ids, inline {lat, lon} points, or
// {follow: <structure>} steps that trace an offset curve along a pier/breakwater between their neighbours
// (swimmers hug structures). Loops close; out-and-backs are expanded and shifted right so the lanes don't overlap; every
// path is smoothed at the swimmer's turning scale (route.turnRadiusM) so the position and heading stay continuous.
import { distToSegment, isWater } from './geometry.js';

const ALIASES = { muni: 'Municipal Pier', breakwater: "Fisherman's Wharf Breakwater", hyde: 'Hyde Street Pier', pier45: 'Pier 45' };

function signedArea(pts) { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]); return a / 2; }
function distToRing(ring, x, y) {
  let d = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const v = distToSegment(x, y, ring[j][0], ring[j][1], ring[i][0], ring[i][1]); if (v < d) d = v; }
  return d;
}
/** Closed curve at distance d outside a polygon: per-edge offsets, round joins at convex corners, cleaned. */
export function offsetRing(ring, d, stepM = 5) {
  let pts = ring.slice(); if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
  if (signedArea(pts) < 0) pts.reverse();          // CCW: outward normal of edge (dx,dy) is (dy,-dx)
  const dense = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const n = Math.max(1, Math.ceil(L / stepM));
    for (let k = 0; k < n; k++) dense.push([p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n]);
  }
  const m = dense.length, out = [];
  for (let i = 0; i < m; i++) {
    const p = dense[i], q = dense[(i + 1) % m], r = dense[(i + 2) % m];
    const e1x = q[0] - p[0], e1y = q[1] - p[1], L1 = Math.hypot(e1x, e1y) || 1;
    const n1x = e1y / L1, n1y = -e1x / L1;
    out.push([p[0] + n1x * d, p[1] + n1y * d]);
    out.push([q[0] + n1x * d, q[1] + n1y * d]);
    // round join at a convex (left-turn) vertex q
    const e2x = r[0] - q[0], e2y = r[1] - q[1], L2 = Math.hypot(e2x, e2y) || 1;
    const cross = e1x * e2y - e1y * e2x;
    if (cross > 1e-9) {
      const a1 = Math.atan2(n1y, n1x), n2x = e2y / L2, n2y = -e2x / L2; let a2 = Math.atan2(n2y, n2x);
      while (a2 < a1) a2 += 2 * Math.PI;
      const steps = Math.ceil((a2 - a1) / (Math.PI / 12));
      for (let k = 1; k < steps; k++) { const a = a1 + (a2 - a1) * k / steps; out.push([q[0] + Math.cos(a) * d, q[1] + Math.sin(a) * d]); }
    }
  }
  const clean = out.filter(o => distToRing(pts, o[0], o[1]) >= d * 0.97);
  // drop near-duplicates
  let res = [];
  for (const o of clean) { const l = res[res.length - 1]; if (!l || Math.hypot(o[0] - l[0], o[1] - l[1]) > 1.5) res.push(o); }
  // round remaining corners (Chaikin corner cutting, closed ring) — swimmers don't make sharp turns
  for (let it = 0; it < 2; it++) {
    const sm = [];
    for (let i = 0; i < res.length; i++) { const a = res[i], b = res[(i + 1) % res.length]; sm.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); }
    res = sm;
  }
  return res;
}
/** Nearest point ON the ring (projected onto a segment): { seg, pt } where seg is the segment's start index. */
function nearestOnRing(ring, x, y) {
  let best = { seg: 0, pt: ring[0], d: Infinity };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    let t = l2 ? ((x - a[0]) * dx + (y - a[1]) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
    const px = a[0] + t * dx, py = a[1] + t * dy, d = Math.hypot(x - px, y - py);
    if (d < best.d) best = { seg: i, pt: [px, py], d };
  }
  return best;
}
/** Arc from projection p0 (on segment s0) to projection p1 (on segment s1), walking dir=+1 (ring order) or −1. */
function arc(ring, p0, p1, dir) {
  const n = ring.length, out = [p0.pt];
  if (dir > 0) { let i = (p0.seg + 1) % n; for (let k = 0; k < n; k++) { if (i === (p1.seg + 1) % n) break; out.push(ring[i]); i = (i + 1) % n; } }
  else { let i = p0.seg; for (let k = 0; k < n; k++) { if (i === p1.seg) break; out.push(ring[i]); i = (i - 1 + n) % n; } }
  out.push(p1.pt);
  return out;
}
function fullRing(ring, p0, dir) {
  const n = ring.length, out = [p0.pt];
  if (dir > 0) for (let k = 1; k <= n; k++) out.push(ring[(p0.seg + k) % n]);
  else for (let k = 0; k < n; k++) out.push(ring[(p0.seg - k + n) % n]);
  out.push(p0.pt);
  return out;
}
function arcLength(a) { let L = 0; for (let i = 1; i < a.length; i++) L += Math.hypot(a[i][0] - a[i - 1][0], a[i][1] - a[i - 1][1]); return L; }

/** Join/leave the structure tangentially: drop arc points at each end until the straight leg meets the ring within maxDeg. */
function tangentTrim(arc, from, to, maxDeg, look = 30) {
  const ang = (ax, ay, bx, by) => { const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by); if (la < 0.5 || lb < 0.5) return 0; let d = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)))); return d * 180 / Math.PI; };
  let a = arc;
  // entry: first index where direction (from→a[j]) vs (a[j]→a[j+1]) is within maxDeg
  let j0 = 0;
  for (let j = 0; j < Math.min(look, a.length - 2); j++) { const d = ang(a[j][0] - from[0], a[j][1] - from[1], a[j + 1][0] - a[j][0], a[j + 1][1] - a[j][1]); if (d <= maxDeg) { j0 = j; break; } if (j === Math.min(look, a.length - 2) - 1) j0 = 0; }
  // exit: last index where direction (a[j-1]→a[j]) vs (a[j]→to) is within maxDeg
  let j1 = a.length - 1;
  for (let j = a.length - 1; j >= Math.max(j0 + 1, a.length - 1 - look); j--) { const d = ang(a[j][0] - a[j - 1][0], a[j][1] - a[j - 1][1], to[0] - a[j][0], to[1] - a[j][1]); if (d <= maxDeg) { j1 = j; break; } if (j === Math.max(j0 + 1, a.length - 1 - look)) j1 = a.length - 1; }
  return a.slice(j0, j1 + 1);
}

/**
 * Smooth the whole path at the scale of R metres: resample every R/5 m, then move each point to the mean of the points
 * within ±R/2 m along the path (the two ends stay put). Micro-kinks — pier-ring joins, keep-right mitres — vanish and
 * corners become curves of radius ≈ R/2, so the swimmer's position and heading are continuous. A point the smoothing
 * would put on land keeps its resampled place. Named waypoints survive on their nearest sample.
 */
export function smoothPath(seq, R, { inWater = null } = {}) {
  if (!(R > 0) || seq.length < 3) return seq;
  const step = Math.max(0.5, R / 5);
  const pts = [{ ...seq[0] }];
  let carry = 0;                                            // distance already covered since the last sample
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1], b = seq[i], L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 1e-6) continue;
    let d = step - carry;
    for (; d <= L; d += step) pts.push({ id: null, name: '', follow: b.follow, x: a.x + (b.x - a.x) * d / L, y: a.y + (b.y - a.y) * d / L });
    carry = L - (d - step);
  }
  pts.push({ ...seq[seq.length - 1] });
  for (const w of seq.slice(1, -1)) {                       // named waypoints: the nearest sample takes the name (the ends keep theirs)
    if (!w.id) continue;
    let best = -1, bd = Infinity;
    for (let k = 1; k < pts.length - 1; k++) { const dd = Math.hypot(pts[k].x - w.x, pts[k].y - w.y); if (dd < bd) { bd = dd; best = k; } }
    if (best > 0 && bd <= step) { pts[best].id = w.id; pts[best].name = w.name; }
  }
  const half = Math.max(1, Math.round(R / 2 / step)), n = pts.length, out = pts.map(q => ({ ...q }));
  for (let i = 1; i < n - 1; i++) {
    const k = Math.min(half, i, n - 1 - i);
    let sx = 0, sy = 0;
    for (let j = i - k; j <= i + k; j++) { sx += pts[j].x; sy += pts[j].y; }
    const x = sx / (2 * k + 1), y = sy / (2 * k + 1);
    if (!inWater || inWater(x, y)) { out[i].x = x; out[i].y = y; }
  }
  return out;
}

/** Keep right: shift each leg d metres to the right of its direction of travel, so out and back
 *  never overlap. Gentle corners are mitred (averaged); sharp turns / turnarounds pass through the
 *  original vertex, giving a small U. */
export function keepRight(points, d) {
  if (!(d > 0) || points.length < 2) return points;
  const segs = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    if (L < 0.01) continue;
    const nx = dy / L * d, ny = -dx / L * d;   // right-hand normal (x east, y north)
    segs.push({ a: { ...a, x: a.x + nx, y: a.y + ny }, b: { ...b, x: b.x + nx, y: b.y + ny }, ux: dx / L, uy: dy / L, v: b });
  }
  if (!segs.length) return points;
  const out = [segs[0].a];
  for (let i = 1; i < segs.length; i++) {
    const p = segs[i - 1], q = segs[i];
    const cos = p.ux * q.ux + p.uy * q.uy;
    if (cos > -0.17) out.push({ ...q.a, x: (p.b.x + q.a.x) / 2, y: (p.b.y + q.a.y) / 2 });   // turn < ~100°: mitre
    else { out.push(p.b); out.push({ ...p.v }); out.push(q.a); }                               // sharp turn: small U through the vertex
  }
  out.push(segs[segs.length - 1].b);
  // start and finish exactly where the route says; the lane peels off / merges back over a run of ~3 d so there is
  // no sideways jog at either end
  const f = segs[0], l = segs[segs.length - 1], ramp = seg => Math.min(3 * d, 0.5 * Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y));
  out[0] = { ...f.a, x: f.a.x + f.ux * ramp(f), y: f.a.y + f.uy * ramp(f) };
  out[out.length - 1] = { ...l.b, x: l.b.x - l.ux * ramp(l), y: l.b.y - l.uy * ramp(l) };
  out.unshift({ ...points[0] }); out.push({ ...points[points.length - 1] });
  return out;
}

/** The physics polyline of a path: legs split every ≥ 8 m, on an 8° bend, or at a named waypoint; and the length. */
export function legsFrom(seq) {
  let meters = 0;
  for (let i = 1; i < seq.length; i++) meters += Math.hypot(seq[i].x - seq[i - 1].x, seq[i].y - seq[i - 1].y);
  const legs = [];
  for (let i = 1, from = seq[0]; i < seq.length; i++) {
    const p = seq[i], d = Math.hypot(p.x - from.x, p.y - from.y);
    if (d < 0.05) continue;
    const last = i === seq.length - 1, nxt = last ? null : seq[i + 1];
    let bend = 0;
    if (nxt) { const a = Math.atan2(p.y - from.y, p.x - from.x), b = Math.atan2(nxt.y - p.y, nxt.x - p.x); bend = Math.abs(((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) * 180 / Math.PI; }
    if (last || d >= 8 || bend > 8 || p.id) { legs.push({ from, to: p, meters: d }); from = p; }
  }
  return { legs, meters };
}
/** The same swim the other way (the planner's direction toggle): id + '~', the path reversed, the legs rebuilt. */
export function reverseRoute(route) {
  const points = route.points.slice().reverse(), { legs, meters } = legsFrom(points);
  return { ...route, id: route.id + '~', name: route.name + ' · reversed', reversed: true, reverseOf: route.id, points, legs, meters, waypoints: route.waypoints.slice().reverse() };
}

export function buildRoutes(routesJson, landmarksJson, geom, opts = {}) {
  const offsetDefault = opts.followOffsetM ?? 15, proj = opts.proj;
  const landmarks = new Map();
  for (const l of landmarksJson.landmarks) landmarks.set(l.id, { ...l, ...proj.project(l.lat, l.lon) });
  const rings = new Map();
  const ringFor = (name, d) => {
    const key = name + '@' + d;
    if (!rings.has(key)) {
      const feat = geom?.feats.find(f => f.type === 'Polygon' && f.name === (ALIASES[name] || name));
      if (!feat) throw new Error(`follow: unknown structure '${name}'`);
      rings.set(key, offsetRing(feat.rings[0], d));
    }
    return rings.get(key);
  };
  const resolvePoint = (w, rid) => {
    if (typeof w === 'string') { const l = landmarks.get(w); if (!l) throw new Error(`route ${rid}: unknown landmark '${w}'`); return l; }
    return { id: null, name: w.name || '', lat: w.lat, lon: w.lon, ...proj.project(w.lat, w.lon), adhoc: true };
  };
  const routes = [];
  for (const r of routesJson.routes) {
    // 1. resolve fixed points, keep follow markers in place
    const items = r.waypoints.map(w => (w && typeof w === 'object' && w.follow) ? { follow: w } : resolvePoint(w, r.id));
    // 2. expand follow markers between their neighbours
    let pts = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.follow) { pts.push(it); continue; }
      const f = it.follow, prev = pts[pts.length - 1], next = items[(i + 1) % items.length];
      if (!prev || !next || next.follow) throw new Error(`route ${r.id}: follow step needs a point before and after`);
      const ring = ringFor(f.follow, f.offset ?? offsetDefault);
      const p0 = nearestOnRing(ring, prev.x, prev.y), p1 = nearestOnRing(ring, next.x, next.y);
      const same = Math.hypot(p0.pt[0] - p1.pt[0], p0.pt[1] - p1.pt[1]) < 1;
      let a = same ? fullRing(ring, p0, 1) : arc(ring, p0, p1, 1), b = same ? fullRing(ring, p0, -1) : arc(ring, p0, p1, -1), chosen;
      if (f.dir) chosen = f.dir === 'cw' ? b : a;
      else if (f.via) {
        const v = resolvePoint(f.via, r.id);
        const near = seg => Math.min(...seg.map(p => Math.hypot(p[0] - v.x, p[1] - v.y)));
        chosen = near(a) <= near(b) ? a : b;
      } else chosen = arcLength(a) <= arcLength(b) ? a : b;
      chosen = tangentTrim(chosen, [prev.x, prev.y], [next.x, next.y], f.joinDeg ?? 35);
      for (const p of chosen) pts.push({ id: null, name: '', x: p[0], y: p[1], follow: f.follow });
    }
    // 3. loop / out-and-back expansion
    let seq = pts.slice();
    if (!r.oneWay) {
      if (r.loop) { if (seq[0] !== seq[seq.length - 1]) seq.push(seq[0]); }
      else seq = seq.concat(seq.slice(0, -1).reverse());
    }
    // 4. keep right so the way out and the way back don't overlap
    seq = keepRight(seq, r.keepRightM ?? opts.keepRightM ?? 0);
    // 5. smooth the path at the swimmer's turning scale (swimmers turn on a curve; nothing sub-metre survives)
    seq = smoothPath(seq, r.turnRadiusM ?? opts.turnRadiusM ?? 0, { inWater: geom?.grid ? (x, y) => isWater(geom, x, y) : null });
    // 6. the path keeps every point; the physics integrates a polyline that splits every ≥ 8 m, wherever the next
    //    segment bends more than 8° off the chord, and at every named waypoint — the rings are dense (~1 m) and the
    //    integrator steps 10 m anyway
    const { legs, meters } = legsFrom(seq);
    routes.push({ id: r.id, name: r.name, notes: r.notes || '', loop: !!r.loop, oneWay: !!r.oneWay, reverseOf: r.reverseOf || null, points: seq, waypoints: items.filter(x => !x.follow), legs, meters });
  }
  return { landmarks, routes };
}
