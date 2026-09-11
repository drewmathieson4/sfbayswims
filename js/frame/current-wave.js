// A small signed-current forecast, not tide height or a decorative sine wave.
import { state } from '../engine/state.js';
import { fmtTime } from '../engine/data.js';
const NS = 'http://www.w3.org/2000/svg', HALF = 6 * 3600e3;
export function createCurrentWave(parent, live, covers) {
  const svg = document.createElementNS(NS, 'svg');
  svg.id = 'current-wave'; svg.setAttribute('viewBox', '0 0 240 64');
  svg.setAttribute('role', 'img'); parent.append(svg);
  const add = (tag, attrs) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el); return el;
  };
  add('path', { d: 'M0 25H240', class: 'wave-axis' });
  const curve = add('path', { class: 'wave-curve' });
  add('path', { d: 'M120 2V48', class: 'wave-marker' });
  const dot = add('circle', { cx: 120, r: 2 });
  const conditions = parent.querySelector('#conditions');
  new ResizeObserver(() => { svg.style.width = `${conditions.getBoundingClientRect().width}px`; }).observe(conditions);
  let key = '';
  return function render(at, version) {
    const next = `${Math.floor(at / 60000)}:${version}:${state.world}`;
    if (key === next) return;
    if (!live.field) { svg.style.display = 'none'; return; }
    key = next; svg.style.display = ''; 
    const values = Array.from({ length: 121 }, (_, i) => {
      const t = at - HALF + i * HALF / 60;
      if (!covers(t, t)) return null;
      const o = live.field.reference(t);
      // Project on the flood axis continuously, including below the HUD's slack threshold.
      return o.signedKn;
    });
    const max = Math.max(0.5, ...values.filter(v => v != null).map(Math.abs));
    // Monotone cubic interpolation: smooth joins without adding overshoot at extrema.
    let d = '', run = [];
    function flush() {
      if (!run.length) return;
      const slopes = run.slice(1).map((p, i) => p.y - run[i].y);
      const tangent = i => {
        if (!i) return slopes[0] || 0;
        if (i === run.length - 1) return slopes[i - 1] || 0;
        const a = slopes[i - 1], b = slopes[i];
        return a * b > 0 ? 2 * a * b / (a + b) : 0;
      };
      d += `M${run[0].x},${run[0].y} `;
      for (let i = 1; i < run.length; i++) {
        const a = run[i - 1], b = run[i];
        d += `C${a.x + 2 / 3},${a.y + tangent(i - 1) / 3} ${b.x - 2 / 3},${b.y - tangent(i) / 3} ${b.x},${b.y} `;
      }
      run = [];
    }
    values.forEach((v, i) => {
      if (v == null) { flush(); return; }
      run.push({ x: i * 2, y: 25 - v / max * 21 });
    });
    flush();
    curve.setAttribute('d', d);
    dot.style.display = values[60] == null ? 'none' : '';
    dot.setAttribute('cy', 25 - (values[60] || 0) / max * 21);
    svg.setAttribute('aria-label', `Predicted current: flood above the line, ebb below. Selected time ${fmtTime(at)}. Six hours either side.`);
    live.field.reference(at); // restore the field's cached context after sampling
  };
}
