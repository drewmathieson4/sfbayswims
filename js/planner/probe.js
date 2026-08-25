// The probe: the current at the point under the pointer (hover on a laptop, tap on a phone), at the moment the picture
// shows — "1.2 kn → 275° · ebb · 3:10pm". Hidden over land.
import { CONFIG } from '../engine/config.js';
import { state, displayTime } from '../engine/state.js';
import { fmtTime } from '../engine/data.js';
import { KN } from '../engine/current.js';

export function createProbe({ b }) {
  const map = b.dom.mapEl, tag = document.getElementById('probe'), live = b.live, vec = { x: 0, y: 0 };
  let pinned = false;
  function show(clientX, clientY) {
    const v = state.view, field = live.field; if (!v || !field) return hide();
    const r = map.getBoundingClientRect(), px = clientX - r.left, py = clientY - r.top;
    const x = v.x0 + px / v.s, y = v.y1 - py / v.s;
    if (!field.isWater(x, y)) return hide();
    const t = displayTime(), c = field.prepare(t); field.sampleInto(x, y, c, vec);
    const kn = Math.hypot(vec.x, vec.y) / KN, dir = (Math.atan2(vec.x, vec.y) * 180 / Math.PI + 360) % 360;
    const f = CONFIG.current.floodDirDeg * Math.PI / 180, flood = vec.x * Math.sin(f) + vec.y * Math.cos(f) > 0;
    tag.textContent = kn < CONFIG.current.slackKn ? `slack · ${fmtTime(t)}` : `${kn.toFixed(1)} kn → ${Math.round(dir)}° · ${flood ? 'flood' : 'ebb'} · ${fmtTime(t)}`;
    tag.style.left = `${px}px`; tag.style.top = `${py}px`; tag.classList.add('on');
  }
  const hide = () => { tag.classList.remove('on'); };
  const drawing = () => document.documentElement.classList.contains('drawing');
  map.addEventListener('pointermove', e => { if (drawing()) return hide(); if (e.pointerType === 'mouse' && !pinned) show(e.clientX, e.clientY); });
  map.addEventListener('pointerleave', () => { if (!pinned) hide(); });
  map.addEventListener('pointerdown', e => { if (drawing()) return; if (e.pointerType !== 'mouse') { pinned = !pinned || true; show(e.clientX, e.clientY); setTimeout(() => { pinned = false; hide(); }, 4000); } });
  return { show, hide };
}
