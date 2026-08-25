// The legs table (waypoint to waypoint: distance, time, pace, the current along and across) and the route coloured by
// ground speed on the map (red where the swimmer crawls, green where the current helps); a row's hover highlights its leg.
import { state, on } from '../engine/state.js';
import { fmtMMSS, fmtDist, fmtPaceOnly } from '../engine/format.js';
import { KN } from '../engine/current.js';
import { el } from '../engine/map.js';

export function createLegs({ b, settings }) {
  const table = document.getElementById('legs'), live = b.live, vec = { x: 0, y: 0 };
  let group = null, groupLayer = null, segs = [];
  const current = () => (live.routes || []).find(r => r.id === state.routeId);
  /** Segments between named waypoints: [{ from, to, meters, seconds, feasible, i0, i1 (profile sample range), along, across }] */
  function segments(r, res) {
    const out = []; let seg = null, name0 = r.waypoints[0]?.name || 'start';
    for (let i = 0; i < res.legs.length; i++) {
      const L = res.legs[i];
      if (!seg) seg = { from: name0, to: '', meters: 0, seconds: 0, feasible: true, legs: [] };
      seg.meters += L.meters; seg.seconds += L.seconds; seg.feasible = seg.feasible && L.feasible; seg.legs.push(i);
      const last = i === res.legs.length - 1;
      if (L.to.id || last || !L.feasible) { seg.to = L.to.name || (last ? (r.waypoints[r.waypoints.length - 1]?.name || 'finish') : '…'); out.push(seg); name0 = seg.to; seg = null; if (!L.feasible) break; }
    }
    // the current along / across each segment, averaged over its samples
    const p = res.profile, field = live.field;
    if (field && p.n > 1) {
      for (const s of out) {
        const set = new Set(s.legs); let n = 0, along = 0, across = 0, i0 = -1, i1 = -1;
        for (let i = 0; i < p.n - 1; i++) {
          if (!set.has(p.leg[i])) continue;
          if (i0 < 0) i0 = i; i1 = i;
          const ux = p.x[i + 1] - p.x[i], uy = p.y[i + 1] - p.y[i], L = Math.hypot(ux, uy); if (L < 0.1) continue;
          const c = field.prepare(res.at + p.t[i] * 1000); field.sampleInto(p.x[i], p.y[i], c, vec);
          along += (vec.x * ux + vec.y * uy) / L; across += Math.abs(vec.x * uy - vec.y * ux) / L; n++;
        }
        s.along = n ? along / n / KN : 0; s.across = n ? across / n / KN : 0; s.i0 = i0; s.i1 = i1;
      }
    }
    return out;
  }
  function render() {
    const r = current(), res = r && state.physics?.byRoute?.get(r.id);
    table.innerHTML = '';
    if (!r || !res) { drawRoute(null, null); return; }
    segs = segments(r, { ...res, at: state.physics.at });
    const head = table.insertRow(); for (const h of ['leg', 'distance', 'time', 'pace', 'current']) { const c = document.createElement('th'); c.textContent = h; head.appendChild(c); }
    let slowest = null; for (const s of segs) if (s.feasible && (!slowest || s.meters / s.seconds < slowest.meters / slowest.seconds)) slowest = s;
    segs.forEach((s, k) => {
      const row = table.insertRow(); row.dataset.seg = k; if (s === slowest) row.classList.add('slow'); if (!s.feasible) row.classList.add('swept');
      const cells = [`${s.from} → ${s.to}`, fmtDist(s.meters), s.feasible ? fmtMMSS(s.seconds) : 'swept', s.feasible ? fmtPaceOnly(s.meters / s.seconds) : '—', s.along == null ? '' : `${s.along >= 0 ? '+' : '−'}${Math.abs(s.along).toFixed(1)} · ${s.across.toFixed(1)}`];
      for (const c of cells) { const td = row.insertCell(); td.textContent = c; }
      row.onmouseenter = () => highlight(k); row.onmouseleave = () => highlight(-1);
    });
    drawRoute(r, res);
  }
  /**
   * The route on the map: the whole path always (a thin base line — this is for planning, not just now), coloured by
   * ground speed relative to the still-water pace (0.5× red → 1× grey-white → 1.5× green) as far as the swim gets, and
   * red dashed from the point the current can't be held.
   */
  function drawRoute(r, res) {
    const layer = live.world?.layers?.route; if (!layer) return;
    if (groupLayer !== layer) { group = el('g', { id: 'speed' }, layer); groupLayer = layer; }
    group.innerHTML = '';
    if (!r) return;
    const path = pts => pts.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${(-q.y).toFixed(1)}`).join('');
    el('path', { class: 'base', d: path(r.points) }, group);
    if (res && res.profile.sweptAt != null) {                                  // the rest of the swim, beyond the swept point
      const p = res.profile; let k = 0; while (k < p.n && p.t[k] < p.sweptAt) k++; k = Math.max(0, k - 1);
      let bi = 0, bd = Infinity; r.points.forEach((q, i) => { const d = Math.hypot(q.x - p.x[k], q.y - p.y[k]); if (d < bd) { bd = d; bi = i; } });
      el('path', { class: 'swept', d: path(r.points.slice(bi)) }, group);
    }
    if (!res || !settings.colour) return;
    const p = res.profile, vs = state.paceMps, end = p.sweptAt != null ? p.sweptAt : Infinity;
    for (let i = 0; i + 1 < p.n; i += 2) {
      if (p.t[i] > end) break;
      const j = Math.min(p.n - 1, i + 2), dt = p.t[j] - p.t[i]; if (dt <= 0) continue;
      const g = (p.s[j] - p.s[i]) / dt, ratio = Math.max(0.4, Math.min(1.6, g / vs)), hue = Math.round(120 * (ratio - 0.5));
      const seg = segs.findIndex(s => i >= s.i0 && i <= s.i1);
      el('line', { x1: p.x[i].toFixed(1), y1: (-p.y[i]).toFixed(1), x2: p.x[j].toFixed(1), y2: (-p.y[j]).toFixed(1), stroke: `hsl(${hue} 80% ${ratio < 1 ? 60 : 55}%)`, 'data-seg': seg }, group);
    }
  }
  function highlight(k) { if (!group) return; for (const l of group.children) l.classList.toggle('hi', +l.dataset.seg === k); group.classList.toggle('dim', k >= 0); }
  on('physics', render); on('routeId', render); on('world', () => { groupLayer = null; render(); });
  return { render, highlight };
}
