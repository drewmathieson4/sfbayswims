// Drifting current streaks on a transparent canvas: each particle steps with the field, trails fade, dead ones respawn
// in a random water cell of the view. Seeded (?seed=) for reproducible test frames.
import { CONFIG } from './config.js';
import { toPx } from './projection.js';
import { isWater, LAND } from './geometry.js';

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export function createParticles({ canvas, geometry, field, config = CONFIG, seed = null }) {
  const rand = seed != null ? mulberry32(seed) : Math.random;
  const ctx2d = canvas.getContext('2d');
  const g = geometry.grid, P = config.particles;
  let view = null, N = 0, X, Y, AGE, MAXAGE, spawn = new Int32Array(0), color = 'rgba(255,255,255,0.2)';
  const v = { x: 0, y: 0 };

  function respawn(i) {
    const k = spawn[(rand() * spawn.length) | 0];
    X[i] = g.x0 + ((k % g.nx) + rand()) * g.cell; Y[i] = g.y0 + (((k / g.nx) | 0) + rand()) * g.cell;
    AGE[i] = 0; MAXAGE[i] = P.maxAgeS[0] + rand() * (P.maxAgeS[1] - P.maxAgeS[0]);
  }
  /** New view: list the water cells in it (spawn sites) and size the swarm to the water area. */
  function resize(vw) {
    const same = view && vw.x0 === view.x0 && vw.x1 === view.x1 && vw.y0 === view.y0 && vw.y1 === view.y1 && vw.pxW === view.pxW && vw.pxH === view.pxH;
    view = vw;
    if (same) return;
    const i0 = Math.max(0, Math.floor((vw.x0 - g.x0) / g.cell)), i1 = Math.min(g.nx - 1, Math.ceil((vw.x1 - g.x0) / g.cell));
    const j0 = Math.max(0, Math.floor((vw.y0 - g.y0) / g.cell)), j1 = Math.min(g.ny - 1, Math.ceil((vw.y1 - g.y0) / g.cell));
    let count = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (g.type[j * g.nx + i] !== LAND) count++;
    spawn = new Int32Array(count); let n = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * g.nx + i; if (g.type[k] !== LAND) spawn[n++] = k; }
    N = Math.max(P.min, Math.min(P.max, Math.round(count / P.perCells)));
    X = new Float32Array(N); Y = new Float32Array(N); AGE = new Float32Array(N); MAXAGE = new Float32Array(N);
    for (let i = 0; i < N; i++) { respawn(i); AGE[i] = rand() * MAXAGE[i]; }
    setColor();
  }
  function setColor() { const c = getComputedStyle(document.documentElement).getPropertyValue('--current').trim(); if (c) color = c; }
  function step(dt, t) {
    if (!view || !spawn.length) return;
    const c = field.prepare(t);
    ctx2d.globalCompositeOperation = 'destination-out';           // fade the trails
    ctx2d.fillStyle = `rgba(0,0,0,${P.fade})`; ctx2d.fillRect(0, 0, view.pxW, view.pxH);
    ctx2d.globalCompositeOperation = 'source-over';
    ctx2d.strokeStyle = color; ctx2d.lineWidth = P.lineWidth; ctx2d.lineCap = 'round';
    ctx2d.beginPath();
    const sp = P.speedup * dt;
    for (let i = 0; i < N; i++) {
      field.sampleInto(X[i], Y[i], c, v);
      const nx = X[i] + v.x * sp, ny = Y[i] + v.y * sp;
      AGE[i] += dt;
      if (AGE[i] > MAXAGE[i] || nx < view.x0 || nx > view.x1 || ny < view.y0 || ny > view.y1 || !isWater(geometry, nx, ny)) { respawn(i); continue; }
      const p0 = toPx(view, X[i], Y[i]), p1 = toPx(view, nx, ny);
      ctx2d.moveTo(p0[0], p0[1]); ctx2d.lineTo(p1[0], p1[1]);
      X[i] = nx; Y[i] = ny;
    }
    ctx2d.stroke();
  }
  return { resize, step, setColor, clear: () => view && ctx2d.clearRect(0, 0, view.pxW, view.pxH), get count() { return N; } };
}
