// Errors in one place: the last few (window errors, unhandled promise rejections, ones the code reports) for the bug
// report and the planner's error banner. Browser-extension noise is ignored.
const errors = [], fns = new Set();
const noise = /message channel closed|Extension context|ResizeObserver loop/i;
export function reportError(msg, where = '') {
  const text = String(msg ?? 'error').slice(0, 300);
  if (noise.test(text)) return;
  const e = { t: Date.now(), msg: text, where };
  errors.push(e); if (errors.length > 10) errors.shift();
  for (const f of fns) { try { f(e); } catch { /* a listener must not take the others down */ } }
}
export function onError(fn) { fns.add(fn); return () => fns.delete(fn); }
export function lastErrors() { return errors.slice(); }
window.addEventListener('error', e => reportError(e.message, e.filename ? `${e.filename.split('/').pop()}:${e.lineno}` : ''));
window.addEventListener('unhandledrejection', e => reportError(e.reason?.message || e.reason, 'promise'));
