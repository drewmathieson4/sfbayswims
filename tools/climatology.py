#!/usr/bin/env python3
"""Day-of-year water-temperature climatology from the USGS Alcatraz station (2003–present)
→ data/watertemp-climatology.json. Used by the app only when no live source answers.

  python3 tools/climatology.py [--start 2004] [--end 2025]
Tries the USGS Water Data OGC 'daily' collection first, then falls back to 'continuous'.
"""
import json, datetime, collections, urllib.parse
from _common import get_json
from _world import DATA, iopt

SITE = "USGS-374938122251801"
start = iopt("--start", 2004)
end = iopt("--end", datetime.date.today().year - 1)
BASE = "https://api.waterdata.usgs.gov/ogcapi/v0/collections"

def fetch_all(collection, params):
    items, url = [], f"{BASE}/{collection}/items?{urllib.parse.urlencode(params)}"
    while url:
        j = get_json(url)
        feats = j.get("features", [])
        items += [f["properties"] for f in feats]
        nxt = next((l["href"] for l in j.get("links", []) if l.get("rel") == "next"), None)
        print(f"  {collection}: {len(items)} rows", end="\r")
        url = nxt
    print()
    return items

bydoy = collections.defaultdict(list)
for y in range(start, end + 1):
    rows = []
    try:
        rows = fetch_all("daily", {"monitoring_location_id": SITE, "parameter_code": "00010", "statistic_id": "00003",
                                   "datetime": f"{y}-01-01/{y}-12-31", "limit": 10000, "f": "json"})
    except Exception as e:
        print(f"{y}: daily failed ({e})")
    if not rows:
        try:
            rows = fetch_all("continuous", {"monitoring_location_id": SITE, "parameter_code": "00010",
                                            "datetime": f"{y}-01-01T00:00:00Z/{y}-12-31T23:59:59Z", "limit": 50000, "f": "json"})
        except Exception as e:
            print(f"{y}: continuous failed ({e})"); continue
    n = 0
    for r in rows:
        v = r.get("value"); t = r.get("time")
        if v is None or t is None: continue
        try: v = float(v)
        except ValueError: continue
        if not (0 < v < 40): continue
        day = datetime.date.fromisoformat(t[:10]).timetuple().tm_yday - 1
        bydoy[day].append(v * 9 / 5 + 32); n += 1
    print(f"{y}: {n} values")

doy = []
for d in range(366):
    vals = bydoy.get(d) or bydoy.get(d - 1) or bydoy.get(d + 1) or []
    doy.append(round(sum(vals) / len(vals), 1) if vals else None)
# light smoothing (±3 days)
sm = []
for d in range(366):
    w = [doy[(d + k) % 366] for k in range(-3, 4) if doy[(d + k) % 366] is not None]
    sm.append(round(sum(w) / len(w), 1) if w else None)
out = {"station": SITE, "years": [start, end], "units": "F", "doyMeanF": sm, "generated": datetime.datetime.now().isoformat(timespec="seconds")}
dst = DATA / "watertemp-climatology.json"
dst.write_text(json.dumps(out, separators=(",", ":")))
print(f"wrote {dst}; Jan 1 {sm[0]}°F, Jul 1 {sm[181]}°F, Sep 15 {sm[257]}°F")
