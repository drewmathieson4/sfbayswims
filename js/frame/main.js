// The Frame: boot the engine with the presets, then the overlay, the cycle, button and dial. See SPEC.md, Product A.
import { paceFrom } from '../engine/validate.js';
import { boot } from '../engine/boot.js';
import { state, set, on, effectiveTime } from '../engine/state.js';
import { applyShow } from '../engine/show.js';
import { loadPresets, loadSwitches, saveSwitches } from './presets.js';
import { createOverlay } from './overlay.js';
import { createCycle } from './cycle.js';
import { createButton } from './button.js';
import { createControls } from './controls.js';
import { kioskMode } from './kiosk.js';

const params = new URLSearchParams(location.search), html = document.documentElement;
const wait = ms => new Promise(r => setTimeout(r, ms));
const presets = await loadPresets(params);
const sw = loadSwitches(presets);                                           // { swimmer, overlay, streaks, world }
html.style.setProperty('--current', `rgba(255, 255, 255, ${presets.streakAlpha})`);   // the streak ink; particles read it at creation
html.style.setProperty('--hold-seconds', `${presets.holdSeconds}s`);
html.style.setProperty('--fade-seconds', `${presets.fadeSeconds}s`);
html.style.setProperty('--scrim', presets.labelScrim);                               // the vignette behind the top labels (0 = none)

/** The presets as a CONFIG patch — re-applied after every world's config, so it must be idempotent. */
const overrides = [C => {
  C.show = { swimmer: sw.swimmer, streaks: sw.streaks, ui: sw.overlay };
  C.anim.maxFps = presets.maxFps; C.anim.pauseS = presets.holdSeconds + presets.fadeSeconds;   // the finish: hold, then fade (css/frame.css)
  C.swimmer.icon = presets.icon; C.trace.crumbs = true;
  C.kiosk.returnToNowS = 0; C.kiosk.reloadAt = presets.reloadAt; Object.assign(C.ambient, presets.ambient || {});
  C.paceMps = paceFrom(presets.pace) ?? C.paceMps;
}];
/** Every swim lasts swimSeconds; a swept swim runs at the speed a full swim would and drifts for sweptSeconds. */
const playOptions = (res, route) => {
  const swept = res.profile.sweptAt, full = route.meters / state.paceMps;
  const realSeconds = swept == null ? presets.swimSeconds : Math.max(2, Math.min(presets.swimSeconds, presets.swimSeconds * swept / full));
  return { realSeconds, sweptRealSeconds: presets.sweptSeconds, crumbsPerSwim: presets.crumbsPerSwim?.[state.world] ?? 0 };
};

let busy = false, overlay = null;
const b = await boot({
  params, overrides, preload: true,
  firstWorld: ids => sw.world && ids.includes(sw.world) ? sw.world : presets.view === 'alternate' ? ids[0] : presets.view,
  onActivate: world => { html.dataset.frameWorld = world.id; const t = world.world.title || 'Aquatic Park'; overlay?.setTitle(t); overlay?.renderClock(); document.title = t; },
  runtime: { playOptions, windowScan: 'infeasible', followSwimmer: presets.streaksFollowSwimmer },
});
overlay = createOverlay({ live: b.live, services: b.services });
let tick = 0;
b.services.onTick((dt, force) => { if (force || ++tick % 4 === 0) overlay.renderClock(); });   // the clock follows the swimmer during a swim
let lastSwitch = performance.now();
/** Hold: the next view through black — fade out, switch, wait for the photo, fade up. */
async function switchView() {
  if (busy) return; busy = true;
  html.classList.add('fade-out'); await wait(500);
  await b.nextWorld(); try { await b.live.photo?.ready; } catch { /* the photo layer reports its own errors */ }
  html.classList.remove('fade-out'); await wait(900);
  lastSwitch = performance.now(); busy = false;
}
const cycle = createCycle({ b, presets, overlay, busy: () => busy,
  onLap: () => { if (presets.view === 'alternate' && presets.alternateEveryMin > 0 && performance.now() - lastSwitch > presets.alternateEveryMin * 60000) switchView(); } });
const controls = createControls({ cycle, busy: () => busy });
const button = createButton({ busy: () => busy, onClick: controls.now, onDouble: controls.swimmer, onTriple: controls.poster, onHold: switchView });
on('show', () => applyShow());
on('world', w => saveSwitches(presets, { world: w }));
if (state.kiosk) kioskMode();
else { let t = null; const wake = () => { html.classList.remove('idle'); clearTimeout(t); t = setTimeout(() => html.classList.add('idle'), 3000); }; window.addEventListener('pointermove', wake); wake(); }
await b.activateFirst();
if (state.show.swimmer && state.selectedTime == null) set({ selectedTime: effectiveTime() });
cycle.start();
{ const { fmtDateYear: fmtDate } = await import('../engine/data.js');            // a notice when the bundled predictions are about to run out
  const check = () => { const h = b.services.horizon(); b.services.setHint('horizon', !isFinite(h) ? 'predictions unavailable · update the frame' : (h - Date.now()) / 86400e3 < (APP.CONFIG.horizonWarnDays ?? 21) ? `predictions end ${fmtDate(h)} · update the frame` : ''); };
  check(); setInterval(check, 3600e3); }
window.APP.frame = { presets, cycle, button, controls, switchView };
// Optional on-device diagnostics: counts app updates, not frames delivered by VNC.
if (params.get('perf') === '1') {
  const meter = document.createElement('div');
  meter.id = 'frame-performance';
  meter.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:60;background:#000;color:#fff;padding:8px 12px;font:14px monospace;pointer-events:none';
  meter.textContent = 'Measuring animation updates…';
  document.body.append(meter);
  let updates = 0, started = performance.now();
  let previous = { ...b.services.metrics };
  b.services.onTick((_dt, forced) => { if (!forced) updates++; });
  setInterval(() => {
    const now = performance.now(), rate = updates * 1000 / (now - started);
    const m = b.services.metrics, frames = m.frames - previous.frames;
    const callbacks = (m.callbacks - previous.callbacks) * 1000 / (now - started);
    const work = frames ? (m.workMs - previous.workMs) / frames : 0;
    meter.textContent = `${state.world} · ${rate.toFixed(1)} updates/s · target ${APP.CONFIG.anim.maxFps || 'uncapped'} · ${callbacks.toFixed(1)} callbacks/s · JS ${work.toFixed(1)} ms/update · ${innerWidth}×${innerHeight}`;
    previous = { ...m };
    updates = 0; started = now;
  }, 3000);
}
if (state.kiosk) { try { (await import('./ambient.js')).startAmbient(); } catch (e) { console.warn('ambient', e.message); } }
