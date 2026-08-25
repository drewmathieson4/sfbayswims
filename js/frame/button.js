// The one button, decoded here rather than on the Pico: click · double-click · triple-click · hold. Sources: the Pico
// (key `b` held while the button is pressed), the space bar, and pointer down/up on the picture (mouse or touch online).
// A tap is a press shorter than tapMs; taps within gapMs of each other count together (clamped at 3); a hold fires at
// holdMs while still pressed and swallows the release. Presses during a transition (busy) are ignored.
export function createButton({ onClick, onDouble, onTriple, onHold, busy = () => false, tapMs = 400, gapMs = 300, holdMs = 600 }) {
  let down = false, pressAt = 0, count = 0, gap = null, holdT = null, held = false;
  const reset = () => { count = 0; held = false; clearTimeout(gap); gap = null; };
  const decide = () => { const n = count; reset(); (n === 1 ? onClick : n === 2 ? onDouble : onTriple)?.(); };
  function press() {
    if (down) return;
    down = true;
    if (busy()) { reset(); pressAt = -1e9; return; }
    pressAt = performance.now(); clearTimeout(gap); gap = null;
    count = Math.min(3, count + 1);
    clearTimeout(holdT); holdT = setTimeout(() => { held = true; count = 0; onHold?.(); }, holdMs);
  }
  function release() {
    if (!down) return;
    down = false; clearTimeout(holdT);
    if (held) { held = false; return; }                                   // the hold already fired
    if (performance.now() - pressAt >= tapMs) { reset(); return; }        // a long press that stopped short of a hold: nothing
    gap = setTimeout(decide, gapMs);
  }
  const isButton = e => e.key === 'b' || e.key === 'B' || e.key === ' ';
  window.addEventListener('keydown', e => { if (isButton(e) && !e.metaKey && !e.ctrlKey && !e.altKey) { if (!e.repeat) press(); e.preventDefault(); } });
  window.addEventListener('keyup', e => { if (isButton(e)) release(); });
  window.addEventListener('blur', release);
  document.addEventListener('pointerdown', e => { if (e.button === 0) press(); });
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);
  return { press, release };
}
