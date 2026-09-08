#!/usr/bin/env python3
"""A year of tide hi/lo predictions for the cove's station → data/tides-YYYY.json (the offline bundle).

  python3 tools/precompute_tides.py 2027

Pads ±20 days around the year. The app only needs the extremes (it interpolates the rate with a cosine).
"""
import datetime
from _common import coops, parse_local, ymd
from _world import DATA, year_arg
from _bundles import atomic_write

STATION = "9414305"                                   # North Point / Pier 41 — the cove's tide timing
year = year_arg()
begin, end = datetime.date(year, 1, 1) - datetime.timedelta(days=20), datetime.date(year, 12, 31) + datetime.timedelta(days=20)
print(f"hi/lo {STATION} {begin}..{end}")
predictions = []
while begin <= end:
    stop = min(begin + datetime.timedelta(days=365), end)
    predictions.extend(coops(product="predictions", datum="MLLW", station=STATION, interval="hilo", begin_date=ymd(begin), end_date=ymd(stop))["predictions"])
    begin = stop + datetime.timedelta(days=1)
hilo = [{"t": parse_local(p["t"]), "h": float(p["v"]), "type": p["type"]} for p in predictions]
out = {"station": STATION, "datum": "MLLW", "units": "ft", "generated": datetime.datetime.now().isoformat(timespec="seconds"), "hilo": hilo}
dst = DATA / f"tides-{year}.json"
atomic_write(dst, out, "tides", year)
print(f"wrote {dst} ({len(hilo)} extremes, {dst.stat().st_size // 1024} KB)")
