#!/usr/bin/env python3
"""The cove's shoreline, piers, breakwater, beach, ships and clubhouses from OpenStreetMap (Overpass)
→ data/worlds/cove/shoreline.geojson. Run once; the geometry never changes.

    python3 tools/fetch_shoreline.py            # writes the file
    python3 tools/fetch_shoreline.py --dry-run  # prints a summary only
"""
import json
from _common import overpass
from _world import world_dir, flag

BBOX = "37.8040,-122.4340,37.8145,-122.4140"   # S,W,N,E — Fort Mason to Pier 45
QUERY = f"""[out:json][timeout:60];
(
  way["natural"="coastline"]({BBOX});
  way["man_made"="pier"]["name"]({BBOX});
  way["man_made"="breakwater"]({BBOX});
  way["natural"="beach"]({BBOX});
  way["historic"="ship"]({BBOX});
  way["building"="yes"]["name"~"Dolphin|South End"]({BBOX});
  way["tourism"="museum"]({BBOX});
);
out tags geom;"""
OUT = world_dir("cove") / "shoreline.geojson"

def role_of(tags):
    if tags.get("natural") == "coastline": return "coast"
    if tags.get("man_made") == "pier": return "pier"
    if tags.get("man_made") == "breakwater": return "breakwater"
    if tags.get("natural") == "beach": return "beach"
    if tags.get("historic") == "ship": return "ship"
    if tags.get("building") or tags.get("tourism") == "museum": return "building"
    return "other"

def main():
    dry = flag("--dry-run")
    osm = overpass(QUERY)
    feats = []
    for el in osm.get("elements", []):
        if el.get("type") != "way" or "geometry" not in el: continue
        coords = [[p["lon"], p["lat"]] for p in el["geometry"]]
        closed = len(coords) > 3 and coords[0] == coords[-1]
        tags = el.get("tags", {})
        role = role_of(tags)
        geom = {"type": "Polygon", "coordinates": [coords]} if closed else {"type": "LineString", "coordinates": coords}
        feats.append({"type": "Feature", "geometry": geom,
                      "properties": {"role": role, "name": tags.get("name"), "osm_id": el["id"], "nodes": len(coords)}})
    feats.sort(key=lambda f: (f["properties"]["role"], -f["properties"]["nodes"]))
    fc = {"type": "FeatureCollection",
          "properties": {"source": "OpenStreetMap contributors, ODbL; via Overpass", "bbox": BBOX},
          "features": feats}
    for f in feats:
        p = f["properties"]; g = f["geometry"]
        cs = g["coordinates"][0] if g["type"] == "Polygon" else g["coordinates"]
        lons = [c[0] for c in cs]; lats = [c[1] for c in cs]
        print(f"{p['role']:>10} {g['type']:>10} {p['nodes']:>4} nodes  {str(p['name']):<34} "
              f"lat {min(lats):.5f}..{max(lats):.5f} lon {min(lons):.5f}..{max(lons):.5f}  id {p['osm_id']}")
    if not dry:
        OUT.write_text(json.dumps(fc, separators=(",", ":")))
        print(f"wrote {OUT} ({OUT.stat().st_size} bytes, {len(feats)} features)")

if __name__ == "__main__":
    main()
