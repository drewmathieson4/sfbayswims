// The app's observable state: plain object + set()/on(). No framework. A listener that throws is reported and skipped —
// one broken render never takes the rest of the page down.
import { reportError } from './health.js';
const listeners = new Map();

export const state = {
  now: Date.now(),
  selectedTime: null,      // ms while time-travelling; null = follow the clock
  routeId: null,
  paceMps: 1.0,
  paused: false,
  debug: false,
  world: null,
  routeByWorld: {},        // each view remembers its route across `v`
  windows: null,           // { next, best } from the 48-h feasibility scan (infeasible routes only)
  show: { swimmer: true, streaks: true, ui: true },
  icon: null,              // runtime override of swimmer.icon (key i): 'glyph' | 'beacon'
  tempo: 1,                // runtime multiplier on anim.speedup (keys [ ])
  swimming: false,         // a swim is playing (▶ start / space): the clock and the streaks follow the swimmer
  swimAt: null,            // ms — the swimmer's moment while a swim plays (its start + elapsed swim seconds); null at rest
  kiosk: false,
  still: false,            // ?still=1 → zero current (physics sanity)
  view: null,              // the fitted view (metres ↔ pixels), set by main.js on resize
  data: { waterTemp: null, wind: null, version: 0, sources: {}, health: {} },   // version bumps on every live-data change → fields drop their cache; health: per source { ok, t, source | err }
  physics: null,           // { at, byRoute: Map, ms }
};

export function set(patch) {
  const changed = [];
  for (const k of Object.keys(patch)) if (state[k] !== patch[k]) { state[k] = patch[k]; changed.push(k); }
  for (const k of changed) for (const fn of listeners.get(k) || []) { try { fn(state[k], state); } catch (e) { console.error(`listener for '${k}':`, e); reportError(e.message, `on('${k}')`); } }
  return changed.length > 0;
}
export function on(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  return () => listeners.get(key).delete(fn);
}
export function effectiveTime() { return state.selectedTime ?? state.now; }
export function physicsTime() { return Math.floor(effectiveTime() / 60000) * 60000; }   // physics is recomputed per minute
export function displayTime() { return state.swimAt ?? effectiveTime(); }              // what the picture shows: the swimmer's moment while swimming, else the selected one
export function bumpData(patch) { set({ data: { ...state.data, ...patch, version: state.data.version + 1 } }); }
