// SVG helpers: el() creates namespaced elements; createLayers() gives the route and swimmer groups.
const NS = 'http://www.w3.org/2000/svg';
export function el(tag, attrs = {}, parent = null) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
export function createLayers(svg) {
  svg.innerHTML = '';
  return { route: el('g', { id: 'route' }, svg), swimmer: el('g', { id: 'swimmer' }, svg) };
}
