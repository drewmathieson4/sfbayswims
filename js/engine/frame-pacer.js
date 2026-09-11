// Limit rendering without discarding fractional frame time at uneven display refresh rates.
// Simulation time is measured separately so retained scheduling time is never counted twice.
export function createFramePacer(start = performance.now()) {
  let callbackAt = start, renderedAt = start, accumulated = 0;
  return (at, maxFps = 0) => {
    accumulated += Math.max(0, at - callbackAt);
    callbackAt = at;
    const interval = maxFps > 0 ? 1000 / maxFps : 0;
    if (interval && accumulated + 1e-6 < interval) return null;
    accumulated = interval
      ? Math.max(0, accumulated - Math.floor((accumulated + 1e-6) / interval) * interval)
      : 0;
    const elapsed = Math.min(0.1, Math.max(0, (at - renderedAt) / 1000));
    renderedAt = at;
    return elapsed;
  };
}
