// The aerial photo: an <image> in its own SVG that shares the map viewBox, georeferenced from photo.json's bbox.
export function createPhoto({ svg, img, meta, proj, dir }) {
  let resolveReady;
  const ready = new Promise(r => { resolveReady = r; });
  if (!meta?.variants?.length) {
    console.warn(`no ${dir}photo.json — run tools/fetch_aerial.py (and tools/stylize.py for the Bay)`);
    svg.style.display = 'none'; resolveReady(false);
    return { ready, dispose() {} };
  }
  svg.style.display = '';
  const b = meta.bbox, a = proj.project(b.n, b.w), c = proj.project(b.s, b.e);   // top-left, bottom-right in metres
  img.setAttribute('x', a.x.toFixed(1)); img.setAttribute('y', (-a.y).toFixed(1));
  img.setAttribute('width', (c.x - a.x).toFixed(1)); img.setAttribute('height', (a.y - c.y).toFixed(1));
  const v = meta.variants.find(x => x.id === meta.default) || meta.variants[0];
  const onLoad = () => resolveReady(true), onErr = () => { console.warn('photo failed to load', v.file); resolveReady(false); };
  img.addEventListener('load', onLoad); img.addEventListener('error', onErr);
  img.setAttribute('href', dir + v.file);
  return { ready, dispose() { img.removeEventListener('load', onLoad); img.removeEventListener('error', onErr); } };
}
