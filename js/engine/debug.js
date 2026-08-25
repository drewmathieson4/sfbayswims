// The debug overlay (key d / ?debug=1): current arrows on a grid, station dots, the water mask with ?mask=1, a status line.
import { state } from './state.js';
import { toPx } from './projection.js';
import { KN } from './current.js';

export function createDebug({ mapEl, params }) {
  let dbg = null;
  function draw({ world, particles, t }) {
    const v = state.view, field = world.field; if (!v) return;
    if (!dbg) { dbg = document.createElement('canvas'); dbg.id = 'debugcanvas'; mapEl.appendChild(dbg); }
    const dpr = v.dpr || 1;
    if (dbg.width !== Math.round(v.pxW * dpr)) { dbg.width = Math.round(v.pxW * dpr); dbg.height = Math.round(v.pxH * dpr); dbg.style.width = v.pxW + 'px'; dbg.style.height = v.pxH + 'px'; }
    const c2 = dbg.getContext('2d'); c2.setTransform(dpr, 0, 0, dpr, 0, 0); c2.clearRect(0, 0, v.pxW, v.pxH);
    const c = field.prepare(t), vec = { x: 0, y: 0 }, stepM = Math.max(25, Math.round(v.w / 60 / 25) * 25);
    c2.strokeStyle = 'rgba(200,0,0,0.6)'; c2.lineWidth = 1; c2.beginPath();
    for (let y = Math.ceil(v.y0 / stepM) * stepM; y < v.y1; y += stepM) for (let x = Math.ceil(v.x0 / stepM) * stepM; x < v.x1; x += stepM) {
      field.sampleInto(x, y, c, vec);
      if (Math.hypot(vec.x, vec.y) < 0.01) continue;
      const sc = stepM * 0.8 / KN, p0 = toPx(v, x, y), p1 = toPx(v, x + vec.x * sc, y + vec.y * sc), a = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
      c2.moveTo(p0[0], p0[1]); c2.lineTo(p1[0], p1[1]);
      c2.moveTo(p1[0], p1[1]); c2.lineTo(p1[0] - 4 * Math.cos(a - 0.5), p1[1] - 4 * Math.sin(a - 0.5));
      c2.moveTo(p1[0], p1[1]); c2.lineTo(p1[0] - 4 * Math.cos(a + 0.5), p1[1] - 4 * Math.sin(a + 0.5));
    }
    c2.stroke();
    if (field.stations) { c2.fillStyle = 'rgba(0,120,255,0.9)'; for (const s of field.stations) { const p = toPx(v, s.x, s.y); c2.beginPath(); c2.arc(p[0], p[1], 3, 0, 7); c2.fill(); c2.fillText(s.id, p[0] + 5, p[1] - 4); } }
    if (params.has('mask')) { const g = world.geom.grid; c2.fillStyle = 'rgba(0,80,255,0.25)'; const step = Math.max(1, Math.round(2 / v.s / g.cell)); for (let j = 0; j < g.ny; j += step) for (let i = 0; i < g.nx; i += step) { if (g.type[j * g.nx + i] === 0) continue; const p = toPx(v, g.x0 + i * g.cell, g.y0 + (j + step) * g.cell); c2.fillRect(p[0], p[1], g.cell * step * v.s + 0.5, g.cell * step * v.s + 0.5); } }
    c2.fillStyle = 'rgba(200,0,0,0.9)'; c2.font = '11px monospace';
    c2.fillText(`ref ${c.kn.toFixed(2)} kn @${c.dir.toFixed(0)}° ${c.flood ? 'FLOOD' : 'EBB'} src=${c.source} | tide ${c.rateFtH.toFixed(2)} ft/h | particles ${particles?.count} | physics ${state.physics?.ms?.toFixed(1)} ms | world ${state.world}`, 12, v.pxH - 12);
  }
  return { draw };
}
