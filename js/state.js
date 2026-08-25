// The app's observable state: plain object + set()/on(). No framework.
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
  kiosk: false,
  still: false,            // ?still=1 → zero current (physics sanity)
  view: null,              // the fitted view (metres ↔ pixels), set by main.js on resize
  data: { waterTemp: null, wind: null, version: 0, sources: {} },   // version bumps on every live-data change → fields drop their cache
  physics: null,           // { at, byRoute: Map, ms }
};

export function set(patch) {
  const changed = [];
  for (const k of Object.keys(patch)) if (state[k] !== patch[k]) { state[k] = patch[k]; changed.push(k); }
  for (const k of changed) for (const fn of listeners.get(k) || []) fn(state[k], state);
  return changed.length > 0;
}
export function on(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  return () => listeners.get(key).delete(fn);
}
export function effectiveTime() { return state.selectedTime ?? state.now; }
export function physicsTime() { return Math.floor(effectiveTime() / 60000) * 60000; }   // physics is recomputed per minute
export function bumpData(patch) { set({ data: { ...state.data, ...patch, version: state.data.version + 1 } }); }
