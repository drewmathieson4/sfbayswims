// The app's entry: boot the engine, then this app's HUD, rail, keys and kiosk behaviour on top of it.
import { boot } from './engine/boot.js';
import { CONFIG } from './engine/config.js';
import { state } from './engine/state.js';
import { createHud } from './planner/hud.js';
import { bindControls } from './planner/keys.js';
import { kioskMode } from './frame/kiosk.js';

let stored = null; try { stored = localStorage.getItem('ap.world'); } catch {}
const b = await boot({
  firstWorld: () => (state.kiosk ? stored : null),                          // the kiosk remembers its view across the nightly reload
  onActivate: world => {
    const title = world.world.title || 'Aquatic Park';
    document.getElementById('title').textContent = title; document.title = title;   // the HUD title names the view
    if (state.kiosk) { try { localStorage.setItem('ap.world', world.id); } catch {} }
  },
});
const hud = createHud({ live: b.live });
bindControls({ live: b.live, mapEl: b.dom.mapEl, onSwitchWorld: b.nextWorld });
if (state.kiosk) kioskMode();
let k = 0;
b.services.onTick((dt, force) => {                                          // the rail's elapsed and speed, every 8th frame
  if (!force && ++k % 8) return;
  const sw = b.services.swimmer; if (!sw) return;
  hud.setElapsed(sw.elapsed, CONFIG.anim.speedup * (state.tempo || 1)); hud.setSpeed(sw.speedMps);
});
await b.activateFirst();
if (state.kiosk) { try { (await import('./frame/ambient.js')).startAmbient(); } catch (e) { console.warn('ambient', e.message); } }
