// A water-mask PNG (255 = water, one pixel per resM metres) → the same grid contract geometry.js builds.
import { LAND, BAY } from './geometry.js';

export async function loadMask(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return createImageBitmap(await r.blob());
}
export function buildMaskGeometry(bitmap, meta, proj) {
  const b = meta.bbox, a = proj.project(b.n, b.w), c = proj.project(b.s, b.e);   // top-left, bottom-right (metres)
  const nx = bitmap.width, ny = bitmap.height, cell = (c.x - a.x) / nx;          // ≈ meta.resM (square-metre pixels)
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(nx, ny) : Object.assign(document.createElement('canvas'), { width: nx, height: ny });
  const c2 = cv.getContext('2d', { willReadFrequently: true });
  c2.drawImage(bitmap, 0, 0);
  const px = c2.getImageData(0, 0, nx, ny).data;
  const type = new Uint8Array(nx * ny);
  for (let row = 0; row < ny; row++) {
    const j = ny - 1 - row;                                                       // PNG rows are y-down; grid rows are y-up
    for (let i = 0; i < nx; i++) type[j * nx + i] = px[(row * nx + i) * 4] > 127 ? BAY : LAND;
  }
  return { feats: [], openings: [], coveAreaM2: 0, openingWidthM: 0, grid: { x0: a.x, y0: c.y, nx, ny, cell, type }, extent: { x0: a.x, x1: c.x, y0: c.y, y1: a.y } };
}
