// SF Bay Swims — the Planner: boot the engine, then the panel, the HUD, the timeline, the probe and the keys.
// See SPEC.md, Product B. Settings live in localStorage (plan.settings); a plan travels in the URL (share.js).
import { boot } from '../engine/boot.js';
import { CONFIG } from '../engine/config.js';
import { state, set, bumpData } from '../engine/state.js';
import { setUnits } from '../engine/format.js';
import { reverseRoute } from '../engine/routes.js';
import { applyShow } from '../engine/show.js';
import { createHud } from './hud.js';
import { createPanel } from './panel.js';
import { createTimeline } from './timeline.js';
import { createProbe } from './probe.js';
import { createLegs } from './legs.js';
import { createStarts } from './starts.js';
import { bindKeys } from './keys.js';
import { readPlan, customFromParams } from './share.js';
import { createDraw } from './draw.js';

const params = new URLSearchParams(location.search);
const DEFAULTS = { units: { dist: 'yd', temp: 'F' }, streaks: true, swimmer: true, arrows: false, colour: true, tideLine: true, swim: { burst: true, reserveS: 60, floorMps: 0.25 } };
export const settings = (() => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('plan.settings') || '{}') }; } catch { return { ...DEFAULTS }; } })();
export function saveSettings() { try { localStorage.setItem('plan.settings', JSON.stringify(settings)); } catch { /* private mode */ } }
readPlan(params, settings);                                                   // units from a shared link win
setUnits(settings.units);
if (settings.arrows) { document.documentElement.classList.add('debug'); state.debug = true; }

/** The settings as a CONFIG patch — re-applied after every spot's config, so it must be idempotent. */
const overrides = [C => {
  C.show.streaks = settings.streaks; C.show.swimmer = settings.swimmer;
  C.swim.burstReserveS = settings.swim.burst ? settings.swim.reserveS : 0;
  C.swim.minGroundMps = settings.swim.floorMps;
}];

let hud = null;
const b = await boot({
  params, overrides,
  onActivate: world => {
    // every one-way or loop swim can be swum the other way: a twin per route, unless the JSON already has one (reverseOf)
    const twinned = new Set(world.routes.map(r => r.reverseOf).filter(Boolean));
    for (const r of world.routes.slice()) if ((r.oneWay || r.loop) && !r.reverseOf && !twinned.has(r.id)) world.routes.push(reverseRoute(r));
    const wanted = params.get('route');
    if (wanted && wanted !== state.routeId && world.routes.some(r => r.id === wanted)) set({ routeId: wanted });
    hud?.setSpot(world.world.title || 'Aquatic Park'); document.title = `${world.world.title} · SF Bay Swims`;
  },
});
hud = createHud({ live: b.live, refs: b.services.refs });
const draw = createDraw({ b });
const panel = createPanel({ b, settings, saveSettings, recomputePhysics: () => bumpData({}), draw });
const timeline = createTimeline({ b, settings });
createProbe({ b });
const legs = createLegs({ b, settings });
createStarts({ b });
panel.onSetting(k => { if (k === 'colour') legs.render(); if (k === 'tideLine') timeline.render(); });
bindKeys({ b, panel });
panel.onUnits(() => hud.rerender());
applyShow();
let k = 0;
b.services.onTick((dt, force) => {                                            // elapsed, speed and the timeline's playhead during a preview
  if (!force && ++k % 8) return;
  const sw = b.services.swimmer; if (!sw) return;
  panel.setElapsed(sw.elapsed, CONFIG.anim.speedup * (state.tempo || 1), sw.speedMps);
  if (state.swimming) timeline.render();
});
await b.activateFirst();
const shared = customFromParams(params); if (shared) draw.load(shared);
hud.setSpot(b.live.world?.world.title || 'Aquatic Park');
window.APP.planner = { settings, panel, timeline, legs, draw };
