// Hidden presets: data/frame.json, then data/frame.local.json (one frame's overrides, not in git), then URL flags.
// The three switches (swimmer, overlay, streaks) and the view persist in localStorage across reloads when persistSwitches.
import { paceFrom } from '../engine/validate.js';
import { dataUrl } from '../engine/paths.js';

const DEFAULTS = {
  view: 'cove', alternateEveryMin: 0, swimmer: true, overlay: true, streaks: true, pace: '1:45',
  swimSeconds: 60, holdSeconds: 1, fadeSeconds: 1, restSeconds: 2, sweptSeconds: 6, skipInfeasible: false, streaksFollowSwimmer: true,
  routes: {}, crumbsPerSwim: {}, icon: 'glyph', streakAlpha: 0.18, labelScrim: 0.45, maxFps: 30,
  quietHours: null, persistSwitches: true, resetDaily: false, ambient: {}, reloadAt: '04:00',
};
const merge = (a, b) => { for (const [k, v] of Object.entries(b || {})) if (!['__proto__', 'constructor', 'prototype'].includes(k)) a[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v; return a; };
const getJSON = async f => { try { const r = await fetch(dataUrl(f), { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch { return null; } };

export async function loadPresets(params) {
  const p = merge(merge(structuredClone(DEFAULTS), await getJSON('frame.json')), await getJSON('frame.local.json'));
  if (params.has('view')) p.view = params.get('view');
  for (const k of ['swimmer', 'overlay', 'streaks']) if (params.has(k)) p[k] = params.get(k) !== '0';
  for (const k of ['swimSeconds', 'holdSeconds', 'fadeSeconds', 'restSeconds', 'sweptSeconds', 'alternateEveryMin', 'maxFps', 'streakAlpha', 'labelScrim']) if (params.has(k)) p[k] = +params.get(k);
  if (params.has('pace')) p.pace = params.get('pace');
  if (params.has('persist')) p.persistSwitches = params.get('persist') !== '0';
  for (const [key, min, max] of [['swimSeconds', 1, 3600], ['holdSeconds', 0, 60], ['fadeSeconds', 0, 60], ['restSeconds', 0, 3600], ['sweptSeconds', 1, 60], ['alternateEveryMin', 0, 1440], ['maxFps', 0, 120], ['streakAlpha', 0, 1], ['labelScrim', 0, 1]]) {
    p[key] = Number.isFinite(p[key]) ? Math.max(min, Math.min(max, p[key])) : DEFAULTS[key];
  }
  if (!paceFrom(p.pace)) p.pace = DEFAULTS.pace;
  for (const key of ['swimmer', 'overlay', 'streaks', 'skipInfeasible', 'streaksFollowSwimmer', 'persistSwitches', 'resetDaily']) if (typeof p[key] !== 'boolean') p[key] = DEFAULTS[key];
  if (!['glyph', 'beacon'].includes(p.icon)) p.icon = DEFAULTS.icon;
  for (const key of ['routes', 'crumbsPerSwim', 'ambient']) if (!p[key] || typeof p[key] !== 'object' || Array.isArray(p[key])) p[key] = {};
  for (const [key, value] of Object.entries(p.routes)) if (value !== null && (!Array.isArray(value) || !value.every(id => typeof id === 'string'))) delete p.routes[key];
  for (const [key, value] of Object.entries(p.crumbsPerSwim)) if (!Number.isInteger(value) || value < 0 || value > 1000) delete p.crumbsPerSwim[key];
  return p;
}

const KEY = 'frame.switches';
const today = () => new Date().toDateString();
/** The switches to boot with: what was stored (unless resetDaily and the day has turned), else the presets. */
export function loadSwitches(p) {
  const fromPresets = { swimmer: p.swimmer, overlay: p.overlay, streaks: p.streaks, world: null };
  if (!p.persistSwitches) return fromPresets;
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!s || (p.resetDaily && s.day !== today())) return fromPresets;
    for (const key of ['swimmer', 'overlay', 'streaks']) if (typeof s[key] === 'boolean') fromPresets[key] = s[key];
    if (typeof s.world === 'string') fromPresets.world = s.world;
    return fromPresets;
  } catch { return fromPresets; }
}
export function saveSwitches(p, patch) {
  if (!p.persistSwitches) return;
  try { const s = JSON.parse(localStorage.getItem(KEY) || '{}'); localStorage.setItem(KEY, JSON.stringify({ ...s, ...patch, day: today() })); } catch { /* private mode */ }
}
