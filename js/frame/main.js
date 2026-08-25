// The Frame: boot the engine with the presets, then the overlay, the cycle and the one button. See SPEC.md, Product A.
import { boot } from '../engine/boot.js';
import { state, on } from '../engine/state.js';
import { toggleShow } from '../engine/show.js';
import { loadPresets, loadSwitches, saveSwitches } from './presets.js';
import { createOverlay } from './overlay.js';
import { createCycle } from './cycle.js';
import { createButton } from './button.js';
import { kioskMode } from './kiosk.js';

const params = new URLSearchParams(location.search), html = document.documentElement;
const wait = ms => new Promise(r => setTimeout(r, ms));
const presets = await loadPresets(params);
const sw = loadSwitches(presets);                                           // { swimmer, overlay, streaks, world }
html.style.setProperty('--current', `rgba(255, 255, 255, ${presets.streakAlpha})`);   // the streak ink; particles read it at creation

/** The presets as a CONFIG patch — re-applied after every world's config, so it must be idempotent. */
const overrides = [C => {
  C.show = { swimmer: sw.swimmer, streaks: sw.streaks, ui: sw.overlay };
  C.anim.maxFps = presets.maxFps; C.anim.pauseS = presets.holdSeconds + presets.fadeSeconds;   // the finish: hold, then fade (css/frame.css)
  C.swimmer.icon = presets.icon; C.trace.crumbs = true;
  C.kiosk.reloadAt = presets.reloadAt; Object.assign(C.ambient, presets.ambient || {});
  const m = /^(\d+):(\d\d)$/.exec(presets.pace || ''); if (m) C.paceMps = 100 / (+m[1] * 60 + +m[2]);
}];
/** Every swim lasts swimSeconds; a swept swim runs at the speed a full swim would and drifts for sweptSeconds. */
const playOptions = (res, route) => {
  const T = res.profile.totalSeconds, swept = res.profile.sweptAt, full = route.meters / state.paceMps;
  const realSeconds = swept == null ? presets.swimSeconds : Math.max(2, Math.min(presets.swimSeconds, presets.swimSeconds * swept / full));
  return { realSeconds, sweptRealSeconds: presets.sweptSeconds, crumbsPerSwim: presets.crumbsPerSwim?.[state.world] ?? 0, tailFrac: presets.tailFrac };
};

let busy = false, overlay = null;
const b = await boot({
  params, overrides,
  firstWorld: ids => sw.world && ids.includes(sw.world) ? sw.world : presets.view === 'alternate' ? ids[0] : presets.view,
  onActivate: world => { const t = world.world.title || 'Aquatic Park'; overlay?.setTitle(t); document.title = t; },
  runtime: { playOptions, windowScan: 'infeasible', followSwimmer: presets.streaksFollowSwimmer },
});
overlay = createOverlay({ live: b.live });
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
const button = createButton({ busy: () => busy, onClick: () => toggleShow('swimmer'), onDouble: () => toggleShow('ui'), onTriple: () => toggleShow('streaks'), onHold: switchView });
on('show', s => saveSwitches(presets, { swimmer: s.swimmer, overlay: s.ui, streaks: s.streaks }));
on('world', w => saveSwitches(presets, { world: w }));
if (state.kiosk) kioskMode();
else { let t = null; const wake = () => { html.classList.remove('idle'); clearTimeout(t); t = setTimeout(() => html.classList.add('idle'), 3000); }; window.addEventListener('pointermove', wake); wake(); }
await b.activateFirst();
cycle.start();
window.APP.frame = { presets, cycle, button, switchView };
if (state.kiosk) { try { (await import('./ambient.js')).startAmbient(); } catch (e) { console.warn('ambient', e.message); } }
