#!/usr/bin/env python3
"""A year of tide hi/lo predictions for the cove's station → data/tides-YYYY.json (the offline bundle).

  python3 tools/precompute_tides.py 2027

Pads ±20 days around the year. The app only needs the extremes (it interpolates the rate with a cosine).
"""
import json, datetime
from _common import coops, parse_local, ymd
from _world import DATA, year_arg

STATION = "9414305"                                   # North Point / Pier 41 — the cove's tide timing
year = year_arg()
begin, end = datetime.date(year, 1, 1) - datetime.timedelta(days=20), datetime.date(year, 12, 31) + datetime.timedelta(days=20)
print(f"hi/lo {STATION} {begin}..{end}")
j = coops(product="predictions", datum="MLLW", station=STATION, interval="hilo", begin_date=ymd(begin), end_date=ymd(end))
hilo = [{"t": parse_local(p["t"]), "h": float(p["v"]), "type": p["type"]} for p in j["predictions"]]
out = {"station": STATION, "datum": "MLLW", "units": "ft", "generated": datetime.datetime.now().isoformat(timespec="seconds"), "hilo": hilo}
dst = DATA / f"tides-{year}.json"
dst.write_text(json.dumps(out, separators=(",", ":")))
print(f"wrote {dst} ({len(hilo)} extremes, {dst.stat().st_size // 1024} KB)")
