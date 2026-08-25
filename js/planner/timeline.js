// The timeline strip: 48 hours from the selected day's midnight — the reference current as a filled curve (flood above the
// axis, ebb below), slack ticks, night shading, the swim as a bar from start to finish (red where swept), a "now" mark and
// the draggable playhead that sets the start. SVG, redrawn on every change that matters.
import { CONFIG } from '../engine/config.js';
import { state, set, on, effectiveTime, displayTime } from '../engine/state.js';
import { tzParts, localToEpoch, fmtTime } from '../engine/data.js';
import { sunTimes } from '../engine/sun.js';

const H = 3600e3, SPAN = 48 * H, NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); parent.appendChild(e); return e; };

export function createTimeline({ b, settings }) {
  const svg = document.getElementById('tl'), box = document.getElementById('timeline'), live = b.live;
  let W = 600, Hh = 76, t0 = 0, dragging = false;
  const midnight = t => { const p = tzParts(t); return localToEpoch(p.y, p.mo, p.d, 0, 0); };
  const x = t => ((t - t0) / SPAN) * W, tAt = px => t0 + (px / W) * SPAN;
  const snap = t => Math.round(t / (CONFIG.scrub.stepMin * 60000)) * CONFIG.scrub.stepMin * 60000;
  function window_() {                                                          // the 48 h that hold the selected start, from a midnight
    const sel = effectiveTime(), m = midnight(sel);
    t0 = sel - m > 36 * H ? m + 24 * H : m;
  }
  function render() {
    if (!live.field) return;
    window_();
    const r = box.getBoundingClientRect(); W = Math.max(200, r.width); Hh = Math.max(40, r.height);
    svg.setAttribute('viewBox', `0 0 ${W} ${Hh}`); svg.innerHTML = '';
    const top = 14, bottom = Hh - 12, mid = (top + bottom) / 2, amp = (bottom - top) / 2;
    // night: civil dusk → dawn, for the three days the window can touch
    const o = CONFIG.origin;
    for (let d = -1; d <= 2; d++) {
      const noon = t0 + d * 24 * H + 12 * H, s = sunTimes(noon, o.lat, o.lon), s2 = sunTimes(noon + 24 * H, o.lat, o.lon);
      if (s.dusk && s2.dawn) { const a = Math.max(t0, s.dusk), bnd = Math.min(t0 + SPAN, s2.dawn); if (bnd > a) el('rect', { class: 'night', x: x(a), y: 0, width: x(bnd) - x(a), height: Hh }, svg); }
    }
    // the reference current every 6 min: + flood, − ebb; scaled to the window's max
    const N = SPAN / (6 * 60000), kn = new Float32Array(N + 1); let max = 0.5;
    for (let i = 0; i <= N; i++) { const c = live.field.reference(t0 + i * 6 * 60000); kn[i] = c.label === 'EBB' ? -c.kn : c.kn; if (Math.abs(kn[i]) > max) max = Math.abs(kn[i]); }
    let dF = '', dE = '';
    for (let i = 0; i <= N; i++) { const px = (i / N) * W, v = kn[i] / max * amp; dF += `${i ? 'L' : 'M'}${px.toFixed(1)} ${(mid - Math.max(0, v)).toFixed(1)}`; dE += `${i ? 'L' : 'M'}${px.toFixed(1)} ${(mid - Math.min(0, v)).toFixed(1)}`; }
    el('path', { class: 'flood', d: `${dF}L${W} ${mid}L0 ${mid}Z` }, svg); el('path', { class: 'ebb', d: `${dE}L${W} ${mid}L0 ${mid}Z` }, svg);
    el('line', { class: 'zero', x1: 0, x2: W, y1: mid, y2: mid }, svg);
    // slack ticks (sign changes)
    for (let i = 1; i <= N; i++) if (kn[i - 1] * kn[i] < 0 || (kn[i - 1] === 0 && kn[i] !== 0)) { const t = t0 + (i - 0.5) * 6 * 60000, px = x(t); el('line', { class: 'slack', x1: px, x2: px, y1: mid - 6, y2: mid + 6 }, svg); if (px > 24 && px < W - 24) el('text', { x: px, y: bottom + 10, 'text-anchor': 'middle' }, svg).textContent = fmtTime(t); }
    // hour labels every 6 h
    for (let t = t0; t <= t0 + SPAN; t += 6 * H) { const p = tzParts(t), px = x(t); el('line', { class: 'zero', x1: px, x2: px, y1: top - 4, y2: top }, svg); el('text', { x: px + 3, y: top - 5 }, svg).textContent = p.hh === 0 ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' }).format(new Date(t)) : fmtTime(t).replace(':00', ''); }
    // the swim: start → finish, red from the swept point
    const res = state.physics?.byRoute?.get(state.routeId);
    if (res) {
      const at = state.physics.at, end = at + res.totalSeconds * 1000, sw = res.profile.sweptAt != null ? at + res.profile.sweptAt * 1000 : null;
      const y = top + 2, h = 5;
      if (res.feasible) el('rect', { class: 'swim', x: x(at), y, width: Math.max(2, x(end) - x(at)), height: h }, svg);
      else { if (sw && sw > at) el('rect', { class: 'swim', x: x(at), y, width: Math.max(1, x(sw) - x(at)), height: h }, svg); el('rect', { class: 'swim swept', x: x(sw ?? at), y, width: Math.max(2, x(end) - x(sw ?? at)), height: h }, svg); }
    }
    // the tide height (dashed), scaled to the window's range
    const ts = b.services.refs.tideRef?.();
    if (settings?.tideLine && ts) {
      const M = 96, hs = new Float32Array(M + 1); let lo = Infinity, hi = -Infinity;
      for (let i = 0; i <= M; i++) { const h = ts.heightAt(t0 + (i / M) * SPAN); hs[i] = h ?? 0; if (h != null) { lo = Math.min(lo, h); hi = Math.max(hi, h); } }
      if (hi > lo) { let d = ''; for (let i = 0; i <= M; i++) d += `${i ? 'L' : 'M'}${((i / M) * W).toFixed(1)} ${(bottom - ((hs[i] - lo) / (hi - lo)) * (bottom - top)).toFixed(1)}`; el('path', { class: 'height', d }, svg); }
    }
    // now, and the playhead (the selected start; the swimmer's moment during a preview)
    const nowX = x(state.now); if (nowX >= 0 && nowX <= W) el('line', { class: 'now', x1: nowX, x2: nowX, y1: top, y2: bottom }, svg);
    const hx = x(state.swimming ? displayTime() : effectiveTime());
    el('line', { class: 'head', x1: hx, x2: hx, y1: top - 2, y2: bottom + 2 }, svg);
    el('polygon', { class: 'head-t', points: `${hx - 5},${top - 8} ${hx + 5},${top - 8} ${hx},${top - 2}` }, svg);
  }
  // drag / tap sets the start (snapped to 5 min)
  box.addEventListener('pointerdown', e => { dragging = true; box.setPointerCapture(e.pointerId); move(e); });
  box.addEventListener('pointermove', e => { if (dragging) move(e); });
  const up = () => { dragging = false; if (state.selectedTime != null) set({ selectedTime: snap(state.selectedTime) }); };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  function move(e) { const r = box.getBoundingClientRect(), t = tAt(Math.max(0, Math.min(r.width, e.clientX - r.left))); set({ selectedTime: Math.abs(t - state.now) < CONFIG.scrub.snapNowMin * 60000 ? null : t }); }
  new ResizeObserver(render).observe(box);
  on('selectedTime', render); on('physics', render); on('routeId', render); on('world', render); on('data', render);
  on('now', () => { if (Math.floor(state.now / 60000) !== Math.floor((state.now - 1000) / 60000)) render(); });
  on('swimming', render);
  return { render };
}
