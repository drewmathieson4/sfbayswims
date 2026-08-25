// Equirectangular local tangent plane about a world's origin. x east, y north, metres.
export const KY = 111195.08;

/** Per-world projection object; pass it to whatever converts lat/lon. */
export function createProjection({ lat, lon }) {
  const KX = KY * Math.cos(lat * Math.PI / 180);
  return {
    origin: { lat, lon }, KX, KY,
    project: (la, lo) => ({ x: (lo - lon) * KX, y: (la - lat) * KY }),
    unproject: (x, y) => ({ lat: lat + y / KY, lon: lon + x / KX }),
  };
}

// SVG uses y-down; we flip once at write time.
export function toSvg(p) { return [p.x, -p.y]; }

/** Expand an extent {x0,x1,y0,y1} to a pixel aspect without cropping. */
export function fitView(extent, pxW, pxH, dpr = 1) {
  const ew = extent.x1 - extent.x0, eh = extent.y1 - extent.y0;
  const cx = (extent.x0 + extent.x1) / 2, cy = (extent.y0 + extent.y1) / 2;
  const aspect = pxW / Math.max(1, pxH);
  let w, h;
  if (aspect >= ew / eh) { h = eh; w = eh * aspect; } else { w = ew; h = ew / aspect; }
  return { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2, w, h,
           s: pxW / w, pxW, pxH, dpr };
}
export function toPx(view, x, y) {
  return [(x - view.x0) * view.s, (view.y1 - y) * view.s];
}
export function viewBoxOf(view) {
  return `${view.x0} ${-view.y1} ${view.w} ${view.h}`;
}
export function unionExtent(a, b, pad = 0) {
  return { x0: Math.min(a.x0, b.x0) - pad, x1: Math.max(a.x1, b.x1) + pad,
           y0: Math.min(a.y0, b.y0) - pad, y1: Math.max(a.y1, b.y1) + pad };
}
export function extentOfPoints(pts) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  return { x0, x1, y0, y1 };
}
