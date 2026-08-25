#!/usr/bin/env python3
"""Seamless water for a world from ONE Sentinel-2 L2A pass (ESA/Copernicus, 10 m, free and open).

  python3 tools/fetch_sentinel.py --world bay --list              # cloud-free dates that cover the whole bbox
  python3 tools/fetch_sentinel.py --world bay --date 2025-05-10   # → photo/water-2025-05-10.jpg + water-2025-05-10.json

Aerial mosaics (NAIP, NOAA) are flown in strips, so their water changes tone and texture at every seam;
a satellite scene is one exposure. Earth Search STAC (no key) finds the scenes, the true-colour COGs on
AWS are read by HTTP range requests with the reader in fetch_aerial.py, and the UTM window is resampled
onto the world's bbox lattice. tools/stylize.py --water-from blends the result under the aerial's land.
"""
import json, datetime
from PIL import Image
from _common import get_json
from _world import world_dir, load_world, bbox_of, opt, flag, fopt
from fetch_aerial import utm_window, read_cog_window, utm_to_lattice

STAC = "https://earth-search.aws.element84.com/v1/search"

def stac_search(bbox, max_cloud=3.0, since="2022-01-01"):
    s, w, n, e = bbox
    body = {"collections": ["sentinel-2-l2a"], "bbox": [w, s, e, n], "datetime": f"{since}T00:00:00Z/{datetime.date.today().isoformat()}T23:59:59Z",
            "query": {"eo:cloud_cover": {"lt": max_cloud}}, "limit": 400,
            "fields": {"include": ["id", "properties.datetime", "properties.eo:cloud_cover", "properties.grid:code", "properties.s2:nodata_pixel_percentage", "assets.visual.href"]}}
    return get_json(STAC, data=json.dumps(body).encode(), json_body=True)["features"]

def dates_covering(items, bbox_tiles):
    """date → {tile: item} for dates where every tile the bbox needs exists with (almost) no nodata."""
    by = {}
    for f in items:
        p = f["properties"]
        if p.get("s2:nodata_pixel_percentage", 0) > 1: continue
        d = p["datetime"][:10]; by.setdefault(d, {})
        t = p.get("grid:code")
        if t not in by[d] or p["eo:cloud_cover"] < by[d][t]["properties"]["eo:cloud_cover"]: by[d][t] = f
    return {d: ts for d, ts in by.items() if bbox_tiles <= set(ts)}

def score(d, ts):   # lower is better: cloud, and a preference for the calm, high-sun months
    cloud = max(t["properties"]["eo:cloud_cover"] for t in ts.values()); month = int(d[5:7])
    return cloud + (0 if 5 <= month <= 10 else 1.5)

def fetch_date(d, ts, bbox, res=10.0):
    E0, E1, N0, N1 = utm_window(bbox); px = 10.0
    mosaic = Image.new("RGB", (int((E1 - E0) / px) + 1, int((N1 - N0) / px) + 1)); tiles = 0
    for code, f in sorted(ts.items()):
        nt, _ = read_cog_window(f["assets"]["visual"]["href"], E0, E1, N0, N1, mosaic, px, 0, label=f["id"]); tiles += nt
    return utm_to_lattice(mosaic, bbox, res, E0, N1, px), tiles

def main():
    world = load_world(); bbox = bbox_of(world); s, w, n, e = bbox
    out_dir = world_dir() / world.get("photo", {}).get("dir", "photo"); out_dir.mkdir(parents=True, exist_ok=True)
    res = fopt("--res", 10)
    items = stac_search(bbox, fopt("--max-cloud", 3), opt("--since", "2022-01-01"))
    # which MGRS tiles does the bbox need? every tile that appears on the most-covered dates
    tiles = {f["properties"].get("grid:code") for f in items}
    cover = dates_covering(items, tiles)
    if not cover:   # bbox may touch a tile only marginally; accept dates that have the tiles present most often
        from collections import Counter
        c = Counter(f["properties"].get("grid:code") for f in items); tiles = {t for t, k in c.items() if k >= max(c.values()) * 0.5}; cover = dates_covering(items, tiles)
    ranked = sorted(cover.items(), key=lambda kv: score(*kv))
    print(f"{len(items)} scenes < {opt('--max-cloud', '3')} % cloud; tiles {sorted(tiles)}; {len(cover)} dates cover the bbox")
    if flag("--list") or not opt("--date"):
        for d, ts in ranked[:40]: print(f"  {d}  cloud {max(t['properties']['eo:cloud_cover'] for t in ts.values()):.1f}%  " + " ".join(sorted(ts)))
        return
    d = opt("--date")
    if d not in cover: raise SystemExit(f"{d}: not a cloud-free date covering the bbox — try --list")
    im, nt = fetch_date(d, cover[d], bbox, res)
    dst = out_dir / f"water-{d}.jpg"; im.save(dst, quality=92, optimize=True)
    meta = json.dumps({"world": world["id"], "date": d, "items": sorted(f["id"] for f in cover[d].values()),
        "bbox": {"s": s, "w": w, "n": n, "e": e}, "width": im.width, "height": im.height, "resM": res, "file": dst.name,
        "source": f"Copernicus Sentinel-2 L2A (ESA), {d}", "fetchedAt": datetime.datetime.now().isoformat(timespec="seconds")}, indent=1)
    (out_dir / f"water-{d}.json").write_text(meta)
    print(f"wrote {dst} ({dst.stat().st_size // 1024} KB, {im.width}×{im.height} @ {res} m, {nt} tiles)")

if __name__ == "__main__":
    main()
