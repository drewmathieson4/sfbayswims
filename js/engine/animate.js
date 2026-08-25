// The swimmer: the icon (a tapered glyph with stroking arms, or a dot), the swum path (comet tail or ink line),
// breadcrumbs every crumbEveryS of swim time, and the swept-away fade. Plays one swim of a profile from js/swim.js per ▶ start.
import { CONFIG } from './config.js';
import { state } from './state.js';
import { el } from './map.js';
import { positionAt } from './swim.js';

export function createSwimmer({ routeLayer, swimmerLayer, config = CONFIG }) {
  const done = el('path', { class: 'route-done' }, routeLayer);
  const crumbsG = el('g', { class: 'crumbs' }, routeLayer);
  const tailG = el('g', { class: 'tail' }, routeLayer);
  const icon = el('g', { class: 'icon' }, swimmerLayer);
  let profile = null, tau = 0, hold = 0, armPhase = 0, crumbCount = 0, parts = {}, iconKey = '';
  let panic = 0;                                         // effort from the physics: 0 cruising · 0.5 sprint · 1 fighting · 0.3 carried
  let play = {};                                         // per-swim playback from setRoute(prof, opts): rate, sweptRate, crumbEveryS (null = config)
  const R = () => config.route.dotR, S = () => config.swimmer.size;

  // ---- icon ----
  const mode = () => state.icon || config.swimmer.icon;   // 'glyph' | 'beacon' (key i overrides the config)
  function buildIcon() {
    const key = mode() + JSON.stringify(config.swimmer.glyph) + R();
    if (key === iconKey) return;
    iconKey = key; icon.innerHTML = ''; parts = {};
    const r = R();
    if (mode() === 'glyph') {                             // top-down swimmer drawn pointing north; rotated to the heading
      const G = config.swimmer.glyph;
      parts.armL = el('path', { class: 'arm' }, icon); parts.armR = el('path', { class: 'arm' }, icon);
      const sw = r * G.shoulder, hw = r * G.hip, L = r * G.length, top = -r * G.shoulderY;
      parts.body = el('path', { class: 'body', d: `M0 ${top}C${sw} ${top} ${sw} ${top + L * 0.35} ${hw} ${top + L * 0.75}C${hw * 0.8} ${top + L} ${-hw * 0.8} ${top + L} ${-hw} ${top + L * 0.75}C${-sw} ${top + L * 0.35} ${-sw} ${top} 0 ${top}Z` }, icon);
      parts.head = el('circle', { class: 'head', cx: 0, cy: -r * G.headY, r: r * G.head }, icon);
      icon.style.setProperty('--arm-w', G.armW + 'px');
    } else {                                              // beacon: a white dot with a pulsing ring (CSS animates the ring)
      el('circle', { class: 'beacon', cx: 0, cy: 0, r: r * 0.9 }, icon);
      parts.dot = el('circle', { class: 'dot', cx: 0, cy: 0, r: r * 0.55 }, icon);
    }
  }
  function updateIcon(p, dt) {
    const r = R(), A = config.anim, glyph = mode() === 'glyph';
    const jitter = panic ? panic * (A.panicJitterDeg || 0) * Math.sin(armPhase * 1.7) : 0;   // a desperate wobble when fighting
    const rot = glyph ? p.hdg + jitter : 0;
    icon.setAttribute('transform', `translate(${p.x.toFixed(2)} ${(-p.y).toFixed(2)}) rotate(${rot.toFixed(1)}) scale(${S()})`);
    if (!glyph) return;
    const G = config.swimmer.glyph;
    armPhase += dt * 2 * Math.PI * config.swimmer.strokeHz * (1 + panic * ((A.panicStrokeX || 1) - 1));   // faster stroke under effort
    const sy = -r * G.shoulderY + r * 0.1, sx = r * G.shoulder * 0.9, reach = r * config.swimmer.armReach * (1 + panic * ((A.panicReachX || 1) - 1)), ax = r * G.armX;
    const yl = sy - reach * (0.5 + 0.5 * Math.cos(armPhase)), yr = sy - reach * (0.5 + 0.5 * Math.cos(armPhase + Math.PI));
    parts.armL.setAttribute('d', `M${-sx} ${sy}Q${-ax * 1.1} ${(sy + yl) / 2 - r * 0.15} ${-ax} ${yl}`);
    parts.armR.setAttribute('d', `M${sx} ${sy}Q${ax * 1.1} ${(sy + yr) / 2 - r * 0.15} ${ax} ${yr}`);
  }

  // ---- trace ----
  function pathBetween(t0, t1) {
    const { n, t, x, y } = profile, a = positionAt(profile, t0), b = positionAt(profile, t1);
    let d = `M${a.x.toFixed(1)} ${(-a.y).toFixed(1)}`;
    for (let i = a.i + 1; i < n && t[i] < t1; i++) if (t[i] > t0) d += `L${x[i].toFixed(1)} ${(-y[i]).toFixed(1)}`;
    return d + `L${b.x.toFixed(1)} ${(-b.y).toFixed(1)}`;
  }
  function updateTrace() {
    const tr = config.trace;
    if (tr.mode === 'none') { tailG.style.display = 'none'; done.style.display = 'none'; }
    else if (tr.mode === 'ink') { tailG.style.display = 'none'; done.style.display = ''; done.setAttribute('d', pathBetween(0, tau)); }
    else {                                              // comet: N segments fading behind the swimmer
      done.style.display = 'none'; tailG.style.display = '';
      const N = tr.tailSegments, span = Math.min(tau, tr.tailS);
      while (tailG.children.length < N) el('path', {}, tailG);
      for (let k = 0; k < N; k++) {
        const seg = tailG.children[k], t1 = tau - span * k / N, t0 = tau - span * (k + 1) / N;
        if (span <= 0 || t1 <= 0) { seg.setAttribute('d', ''); continue; }
        seg.setAttribute('d', pathBetween(Math.max(0, t0), t1));
        const f = 1 - k / N;
        seg.style.opacity = (0.15 + 0.85 * f).toFixed(3); seg.style.strokeWidth = (config.route.doneWidth * (0.4 + 0.6 * f)).toFixed(2) + 'px';
      }
    }
    const every = play.crumbEveryS ?? tr.crumbEveryS;
    if (!tr.crumbs || !isFinite(every)) { crumbsG.style.display = 'none'; return; }
    crumbsG.style.display = '';
    const n = Math.floor(tau / every);                   // one crumb per `every` swim seconds: append the new ones, clear on restart
    if (n < crumbCount) { crumbsG.innerHTML = ''; crumbCount = 0; }
    for (; crumbCount < n; crumbCount++) { const c = positionAt(profile, (crumbCount + 1) * every); el('circle', { cx: c.x.toFixed(1), cy: (-c.y).toFixed(1), r: (R() * 0.32).toFixed(2) }, crumbsG); }
  }

  /**
   * Plays this profile. opts (the frame): realSeconds — the swim (up to the swept point) lasts this many real seconds;
   * sweptRealSeconds — the fight + drift last this long; crumbsPerSwim — N crumbs over the swim (0 = none). Without opts
   * the config's tempo and crumbEveryS apply.
   */
  function setRoute(prof, opts = null) {
    profile = prof.profile; tau = Math.min(tau, profile.totalSeconds); crumbsG.innerHTML = ''; crumbCount = 0;
    const T = profile.totalSeconds, sw = profile.sweptAt, swim = sw ?? T;
    play = {
      rate: opts?.realSeconds ? swim / opts.realSeconds : null,
      sweptRate: opts?.sweptRealSeconds && sw != null ? (T - sw) / opts.sweptRealSeconds : null,
      crumbEveryS: opts?.crumbsPerSwim != null ? (opts.crumbsPerSwim > 0 ? swim / opts.crumbsPerSwim : Infinity) : null,
    };
    buildIcon(); place(0);
  }
  const inSweep = () => profile.sweptAt != null && tau > profile.sweptAt;
  let speedMps = 0;                                      // ground speed at the swimmer's position (the rail's "speed")
  function place(dt) {
    const p = positionAt(profile, tau);
    speedMps = inSweep() ? 0 : p.g;
    panic += (p.effort - panic) * Math.min(1, dt * 3);
    let fade = 1;
    if (inSweep()) {                                    // full opacity while fighting, then fade out
      const sw = profile.sweptAt, f = (tau - sw) / Math.max(1, profile.totalSeconds - sw), from = config.anim.sweptFadeFrom ?? 0.5;
      fade = f <= from ? 1 : Math.pow(Math.max(0, 1 - (f - from) / (1 - from)), 1.3);
    }
    updateIcon(p, dt); updateTrace();
    icon.style.opacity = fade.toFixed(3); tailG.style.opacity = fade.toFixed(3);
  }
  function reset() { tau = 0; hold = 0; crumbsG.innerHTML = ''; crumbCount = 0; if (profile) place(0); }   // back to the start, waiting
  /** Advances the swim by dt real seconds; true once the lap is over (the end pause has run and the swimmer is back at the start). */
  function step(dt) {
    if (!profile) return false;
    if (hold > 0) { hold -= dt; if (hold <= 0) { reset(); return true; } }
    else {
      const base = play.rate ?? config.anim.speedup * (state.tempo || 1);
      tau += dt * (inSweep() ? (play.sweptRate ?? base * (config.anim.sweptTempo || 1)) : base);
      if (tau >= profile.totalSeconds) { tau = profile.totalSeconds; hold = config.anim.pauseS; }
    }
    place(dt);
    return false;
  }
  return { setRoute, step, reset, rebuild: () => { if (profile) { buildIcon(); place(0); } }, get tau() { return tau; }, get speedMps() { return speedMps; },
           get elapsed() { return profile?.sweptAt != null ? Math.min(tau, profile.sweptAt) : tau; }, get pos() { return positionAt(profile, tau); } };
}
