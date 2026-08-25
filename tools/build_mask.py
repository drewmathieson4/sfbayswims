#!/usr/bin/env python3
"""The Bay's water mask from OpenStreetMap → data/worlds/<id>/mask.png (255 = water, 10 m cells), mask.json, and
structures.png (bridge decks, for the photo composite).

  python3 tools/build_mask.py --world bay

Coastline ways are chained, clipped to the bbox and closed along its edge (land on the left); islands are rings;
piers and breakwaters are painted as land. Overpass replies are cached next to the mask (coastline.json, piers.json,
bridges.json) so a rebuild needs no network — delete them if the bbox changes.
"""
import json, datetime
import numpy as np
from PIL import Image, ImageDraw
from _common import overpass
from _world import world_dir, load_world, bbox_of, lattice

def chain_ways(ways):
    """Join coastline ways end-to-end by shared endpoint into polylines (lists of (lon,lat)); merges until stable."""
    chains = [[tuple((p["lon"], p["lat"])) for p in w["geometry"]] for w in ways if w.get("geometry")]
    merged = True
    while merged:
        merged = False
        by_start = {}
        for i, c in enumerate(chains): by_start.setdefault(c[0], []).append(i)
        for i, c in enumerate(chains):
            if c[0] == c[-1]: continue
            cands = [j for j in by_start.get(c[-1], []) if j != i]
            if cands:
                j = cands[0]; chains[i] = c + chains[j][1:]; del chains[j]; merged = True; break
    return chains

def clip_polyline(pts, bbox):
    """Clip a polyline to the bbox; returns pieces whose ends lie exactly on the boundary (or inside)."""
    s, w, n, e = bbox
    inside = lambda p: w <= p[0] <= e and s <= p[1] <= n
    def cross(a, b):   # intersection of segment a-b with the bbox boundary, nearest to a
        best = None
        for t in _edge_hits(a, b, bbox):
            if best is None or t < best: best = t
        return best
    pieces, cur = [], []
    for i in range(len(pts)):
        p = pts[i]
        if i == 0:
            if inside(p): cur = [p]
            continue
        a, b = pts[i - 1], p
        hits = sorted(_edge_hits(a, b, bbox))
        if inside(a) and inside(b): cur.append(b)
        elif inside(a) and not inside(b):
            t = hits[0] if hits else 1.0; cur.append(_lerp(a, b, t)); pieces.append(cur); cur = []
        elif not inside(a) and inside(b):
            t = hits[-1] if hits else 0.0; cur = [_lerp(a, b, t), b]
        else:
            if len(hits) >= 2: pieces.append([_lerp(a, b, hits[0]), _lerp(a, b, hits[-1])])
    if len(cur) > 1: pieces.append(cur)
    return pieces

def _lerp(a, b, t): return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
def _edge_hits(a, b, bbox):
    s, w, n, e = bbox; out = []
    for axis, val in ((0, w), (0, e), (1, s), (1, n)):
        da = b[axis] - a[axis]
        if abs(da) < 1e-12: continue
        t = (val - a[axis]) / da
        if 0 <= t <= 1:
            q = _lerp(a, b, t); o = 1 - axis; lo, hi = (s, n) if axis == 0 else (w, e)
            if lo - 1e-9 <= q[o] <= hi + 1e-9: out.append(t)
    return out

def perim(p, bbox):
    """Counter-clockwise perimeter coordinate from the NW corner: W edge south, S edge east, E edge north, N edge west."""
    s, w, n, e = bbox; W, H = e - w, n - s; x, y = p
    if abs(x - w) < 1e-9: return n - y
    if abs(y - s) < 1e-9: return H + (x - w)
    if abs(x - e) < 1e-9: return H + W + (y - s)
    return 2 * H + W + (e - x)
def corners_between(p0, p1, bbox):
    s, w, n, e = bbox; W, H = e - w, n - s; P = 2 * (W + H)
    cs = [(H, (w, s)), (H + W, (e, s)), (2 * H + W, (e, n)), (P, (w, n))]   # perimeter coordinate of each corner (CCW)
    out = []; a, b = p0, p1
    if b <= a: b += P
    for c, pt in cs:
        for k in (0, 1):
            cc = c + k * P
            if a < cc < b: out.append((cc, pt))
    return [pt for _, pt in sorted(out)]

def osm_land_polygons(bbox, cache=None):
    s, w, n, e = bbox
    ways = overpass(f'[out:json][timeout:120];way["natural"="coastline"]({s},{w},{n},{e});out geom;', cache)["elements"]
    chains = chain_ways(ways)
    polys, opens = [], []
    for ch in chains:
        if ch[0] == ch[-1]: polys.append(ch)                       # island / lake ring
        else: opens += clip_polyline(ch, bbox)
    # close open chains along the bbox boundary, walking CCW (keeps land on the left)
    opens = [o for o in opens if len(o) > 1]
    starts = sorted(range(len(opens)), key=lambda i: perim(opens[i][0], bbox))
    used = [False] * len(opens)
    for i0 in range(len(opens)):
        if used[i0]: continue
        ring = []; i = i0
        for _ in range(len(opens) + 1):
            used[i] = True; ring += opens[i]
            pe = perim(opens[i][-1], bbox)
            cand = sorted([(perim(opens[j][0], bbox) - pe) % (2 * ((e - w) + (n - s))), j] for j in range(len(opens)) if j != i or True)
            _, j = cand[0]
            ring += corners_between(pe, perim(opens[j][0], bbox), bbox)
            if j == i0 or used[j]: break
            i = j
        ring.append(ring[0]); polys.append(ring)
    return polys

def signed_area(ring):
    return sum(ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1] for i in range(len(ring) - 1)) / 2

def main():
    world = load_world(); d = world_dir(); bbox = bbox_of(world); s, w, n, e = bbox; res = 10.0
    W, H = lattice(bbox, res)
    px = lambda p: ((p[0] - w) / (e - w) * W, (n - p[1]) / (n - s) * H)
    polys = osm_land_polygons(bbox, cache=d / "coastline.json")
    mask = Image.new("L", (W, H), 255); draw = ImageDraw.Draw(mask)          # start all water
    for ring in polys:
        if len(ring) < 4: continue
        land = signed_area(ring) > 0                                         # CCW ring = land on the left = island / mainland
        draw.polygon([px(p) for p in ring], fill=0 if land else 255)
    piers = overpass(f'[out:json][timeout:120];(way["man_made"="pier"]({s},{w},{n},{e});way["man_made"="breakwater"]({s},{w},{n},{e}););out geom;', d / "piers.json")["elements"]
    for wy in piers:
        g = [(p["lon"], p["lat"]) for p in wy.get("geometry", [])]
        if len(g) > 3 and g[0] == g[-1]: draw.polygon([px(p) for p in g], fill=0)
        elif len(g) > 1: draw.line([px(p) for p in g], fill=0, width=1)
    mask.save(d / "mask.png", optimize=True)
    frac = float(np.mean(np.asarray(mask) > 127))
    (d / "mask.json").write_text(json.dumps({"bbox": {"s": s, "w": w, "n": n, "e": e}, "width": W, "height": H, "resM": res,
        "source": f"OSM coastline ({len(polys)} polygons) + piers", "waterFraction": round(frac, 3),
        "generated": datetime.datetime.now().isoformat(timespec="seconds")}, indent=1))
    print(f"wrote {d / 'mask.png'} {W}×{H} @ {res} m, water fraction {frac:.2f}")
    # structures.png: bridge decks + cables. Not land for the physics (swimmers pass under them) — tools/stylize.py
    # keeps these pixels from the aerial instead of the satellite water.
    bridges = overpass(f'[out:json][timeout:120];way["bridge"="yes"]["highway"~"^(motorway|trunk|primary|secondary)$"]({s},{w},{n},{e});out geom;', d / "bridges.json")["elements"]
    st = Image.new("L", (W, H), 0); dr = ImageDraw.Draw(st)
    for wy in bridges:
        g = [(p["lon"], p["lat"]) for p in wy.get("geometry", [])]
        if len(g) > 1: dr.line([px(p) for p in g], fill=255, width=4)
    st.save(d / "structures.png", optimize=True); print(f"wrote {d / 'structures.png'} ({len(bridges)} bridge ways)")

if __name__ == "__main__":
    main()
