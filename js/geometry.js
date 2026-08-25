// Zone worlds (the cove): OSM polygons in local metres, the water zones and openings, and the physics grid.
// Grid contract (shared with js/mask.js): grid.type[k] is one of the codes below per cell; zone worlds add
// shelter / fill fields for the cove current model.
export const LAND = 0, COVE = 1, BAY = 2, HARBOR = 3;

export function pointInRing(ring, x, y) {                // ray casting; ring = [[x, y], …]
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function ringBBox(ring) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, x1, y0, y1 };
}
export function polygonArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
}
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const LAND_ROLES = new Set(['pier', 'breakwater', 'building', 'ship', 'beach']);
const toMetresRing = (coords, proj) => coords.map(([lon, lat]) => { const p = proj.project(lat, lon); return [p.x, p.y]; });

export function buildGeometry(shoreline, zones, config, proj) {
  // shoreline features keep their OSM role/name: routes.js follows the piers by name
  const feats = shoreline.features.map(f => {
    const g = f.geometry;
    const rings = g.type === 'Polygon' ? g.coordinates.map(r => toMetresRing(r, proj)) : [toMetresRing(g.coordinates, proj)];
    return { role: f.properties.role, name: f.properties.name, type: g.type, rings };
  });
  const zoneRing = name => { const f = zones.features.find(z => z.properties.zone === name); return f ? toMetresRing(f.geometry.coordinates[0], proj) : null; };
  const cove = zoneRing('cove'), harbor = zoneRing('harbor'), land = zoneRing('land');
  const structures = feats.filter(f => f.type === 'Polygon' && LAND_ROLES.has(f.role)).map(f => f.rings[0]);
  const polys = [...structures.map(r => ({ ring: r, bbox: ringBBox(r), t: LAND })),
    { ring: cove, bbox: ringBBox(cove), t: COVE }, { ring: harbor, bbox: ringBBox(harbor), t: HARBOR }, { ring: land, bbox: ringBBox(land), t: LAND }];
  const classify = (x, y) => {
    for (const p of polys) { const b = p.bbox; if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue; if (pointInRing(p.ring, x, y)) return p.t; }
    return BAY;
  };

  // openings: chords across the gaps, with the normal pointing into their zone
  const centroid = ring => { let sx = 0, sy = 0; for (const [x, y] of ring) { sx += x; sy += y; } return { x: sx / ring.length, y: sy / ring.length }; };
  const zoneCentroid = { cove: centroid(cove), harbor: centroid(harbor) };
  const openings = zones.openings.map(o => {
    const a = proj.project(o.a[1], o.a[0]), b = proj.project(o.b[1], o.b[0]);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, w = Math.hypot(b.x - a.x, b.y - a.y);
    let nx = -(b.y - a.y) / w, ny = (b.x - a.x) / w;
    const c = zoneCentroid[o.zone];
    if ((c.x - mid.x) * nx + (c.y - mid.y) * ny < 0) { nx = -nx; ny = -ny; }
    return { id: o.id, name: o.name, a, b, mid, w, nIn: { x: nx, y: ny }, exposed: !!o.exposed, zone: o.zone };
  });

  // the grid: cell type + the cove model's shelter and fill fields
  let ext = ringBBox(land);
  for (const f of feats) for (const r of f.rings) { const b = ringBBox(r); ext = { x0: Math.min(ext.x0, b.x0), x1: Math.max(ext.x1, b.x1), y0: Math.min(ext.y0, b.y0), y1: Math.max(ext.y1, b.y1) }; }
  const cell = config.grid.cell, pad = config.grid.padM;
  const x0 = Math.floor((ext.x0 - pad) / cell) * cell, y0 = Math.floor((ext.y0 - pad) / cell) * cell;
  const nx = Math.ceil((ext.x1 + pad - x0) / cell), ny = Math.ceil((ext.y1 + pad - y0) / cell), n = nx * ny;
  const type = new Uint8Array(n), shelter = new Float32Array(n), fillShape = new Float32Array(n), fillDirX = new Float32Array(n), fillDirY = new Float32Array(n);
  const cv = config.current;
  const coveOpenings = openings.filter(o => o.zone === 'cove');
  const virtualSrc = coveOpenings.map(o => ({ x: o.mid.x - o.nIn.x * cv.fillLengthM, y: o.mid.y - o.nIn.y * cv.fillLengthM }));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, cx = x0 + (i + 0.5) * cell, cy = y0 + (j + 0.5) * cell;
    const t = classify(cx, cy); type[k] = t;
    if (t === LAND) continue;
    let dAny = Infinity, iAny = -1, dExp = Infinity;                 // nearest cove opening (any) and nearest exposed one
    coveOpenings.forEach((o, oi) => { const d = distToSegment(cx, cy, o.a.x, o.a.y, o.b.x, o.b.y); if (d < dAny) { dAny = d; iAny = oi; } if (o.exposed && d < dExp) dExp = d; });
    shelter[k] = t === COVE ? cv.shelterMin + (1 - cv.shelterMin) * Math.exp(-dExp / cv.shelterLengthM) : t === HARBOR ? cv.harborShelter : 1;
    const fs = t === COVE ? cv.fillLengthM / (cv.fillLengthM + dAny) : dAny < 150 ? Math.exp(-dAny / cv.fillLengthM) : 0;
    if (fs > 0 && iAny >= 0) { const s = virtualSrc[iAny], dx = cx - s.x, dy = cy - s.y, l = Math.hypot(dx, dy) || 1; fillShape[k] = fs; fillDirX[k] = dx / l; fillDirY[k] = dy / l; }
  }
  return { feats, openings, coveAreaM2: cv.areaM2 ?? polygonArea(cove), openingWidthM: coveOpenings.reduce((s, o) => s + o.w, 0),
           grid: { x0, y0, nx, ny, cell, type, shelter, fillShape, fillDirX, fillDirY }, extent: ext };
}

export function cellIndex(grid, x, y) {
  const i = Math.floor((x - grid.x0) / grid.cell), j = Math.floor((y - grid.y0) / grid.cell);
  return (i < 0 || j < 0 || i >= grid.nx || j >= grid.ny) ? -1 : j * grid.nx + i;
}
export function isWater(geom, x, y) { const k = cellIndex(geom.grid, x, y); return k >= 0 && geom.grid.type[k] !== LAND; }
