// Kiosk only: follow the room light. tools/pi/ambient.py samples a VEML7700 and writes {lux, t} to
// /run/aquatic/ambient.json; tools/serve.py serves it as /ambient.json. We map lux → a brightness level
// (log scale between luxDark and luxBright) and ease a black overlay (+ a faint warm tint) toward it, so
// the frame dims like a print as the room darkens. If the sensor goes quiet we return to full brightness.
import { CONFIG } from '../engine/config.js';

export function startAmbient() {
  const c = CONFIG.ambient; if (!c?.enabled) return;
  const dim = document.getElementById('dim'), warm = document.getElementById('warm'); if (!dim || !warm) return;
  let level = 1, target = 1, lastSeen = 0;
  const luxToLevel = lux => {
    const lo = Math.log(c.luxDark), hi = Math.log(c.luxBright);
    const f = Math.min(1, Math.max(0, (Math.log(Math.max(lux, 0.01)) - lo) / (hi - lo)));
    return c.minBrightness + (1 - c.minBrightness) * f;
  };
  async function poll() {
    try {
      const r = await fetch(c.url, { cache: 'no-store' }); if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      if (!Number.isFinite(j.lux) || j.lux < 0 || !Number.isFinite(j.t) || Date.now() - j.t > 60000 || j.t > Date.now() + 5000) throw new Error('stale sensor reading');
      lastSeen = j.t; target = luxToLevel(j.lux);
    } catch { if (Date.now() - lastSeen > 60000) target = 1; }
  }
  poll(); setInterval(poll, c.pollS * 1000);
  setInterval(() => {                                   // ease so a passing shadow never flickers the picture
    level += (target - level) * 0.12; if (Math.abs(target - level) < 0.002) level = target;
    const dark = (1 - level) / Math.max(0.01, 1 - c.minBrightness);   // 0 in daylight → 1 at the floor
    dim.style.opacity = (1 - level).toFixed(3);
    warm.style.opacity = (c.warmth * dark).toFixed(3);
  }, 250);
  return { get level() { return level; }, set: lux => { target = luxToLevel(lux); lastSeen = Date.now(); } };
}
