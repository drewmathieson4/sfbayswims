#!/usr/bin/env python3
"""Precompute a year of NOAA current predictions.

  python3 tools/precompute_currents.py 2026                      # cove: SFB1204 bin 18, 6-min → data/currents-2026.json
  python3 tools/precompute_currents.py --world bay 2026          # every station in data/worlds/bay/stations.json,
                                                                 #   30-min → data/worlds/bay/currents-2026.json
Harmonic stations: `interval=30&vel_type=speed_dir` in monthly chunks (31-day cap; bin omitted →
surface bin). Subordinate stations only publish max flood / slack / max ebb events; they are
resampled onto the same 30-min grid with a cosine between events, along meanFloodDir/meanEbbDir.
Output per station: {t0, dtMs, kn[], dir[]} (the app's CurrentSeries reads this form directly).
"""
import json, math, datetime, time
from _common import coops, parse_local, TZ
from _world import DATA, world_dir, load_world, world_id, opt, iopt, year_arg

def month_ranges(year):
    """Monthly (begin, end) YYYYMMDD pairs covering Dec 20 of the previous year to Jan 10 of the next (31-day API cap)."""
    start = datetime.date(year - 1, 12, 20); stop = datetime.date(year + 1, 1, 10); out = []
    while start < stop:
        end = min(start + datetime.timedelta(days=30), stop)
        out.append((start.strftime("%Y%m%d"), end.strftime("%Y%m%d"))); start = end + datetime.timedelta(days=1)
    return out

def fetch_continuous(station, year, interval, bin_=None):
    samples = []
    for b, e in month_ranges(year):
        q = {"product": "currents_predictions", "station": station, "interval": str(interval), "vel_type": "speed_dir", "begin_date": b, "end_date": e}
        if bin_: q["bin"] = str(bin_)
        j = coops(**q)
        for c in j["current_predictions"]["cp"]:
            samples.append((parse_local(c["Time"]), float(c["Speed"]), float(c["Direction"])))
        print(f"    {station} {b}..{e}: {len(samples)} rows", end="\r", flush=True)
    samples.sort(); out = []; last = None
    for t, kn, d in samples:
        if t != last: out.append((t, kn, d)); last = t
    return out

def fetch_events(station, year):
    """MAX_SLACK events Dec 20 → Jan 10, in two chunks (the API caps predictions at 366 days)."""
    ev, fd, ed = [], None, None
    for b, e in ((f"{year - 1}1220", f"{year}0630"), (f"{year}0701", f"{year + 1}0110")):
        j = coops(product="currents_predictions", station=station, interval="MAX_SLACK", begin_date=b, end_date=e)
        cp = j["current_predictions"]["cp"]
        ev += [(parse_local(c["Time"]), float(c["Velocity_Major"])) for c in cp]
        if fd is None: fd = cp[0].get("meanFloodDir"); ed = cp[0].get("meanEbbDir")
    return sorted(set(ev)), fd, ed

def cosine_resample(events, fd, ed, t0, dt, n):
    """Signed along-axis velocity between events: max→slack and slack→max follow a quarter cosine."""
    kn, dr = [], []
    j = 0
    for i in range(n):
        t = t0 + i * dt
        while j + 1 < len(events) and events[j + 1][0] <= t: j += 1
        if j + 1 >= len(events) or t < events[0][0]: v = 0.0
        else:
            (ta, va), (tb, vb) = events[j], events[j + 1]
            tau = (t - ta) / (tb - ta) if tb > ta else 0
            if abs(va) < 1e-6 and abs(vb) > 1e-6: v = vb * math.sin(math.pi / 2 * tau)     # slack → max
            elif abs(vb) < 1e-6: v = va * math.cos(math.pi / 2 * tau)                     # max → slack
            else: v = va + (vb - va) * (1 - math.cos(math.pi * tau)) / 2                   # max → max (no slack listed)
        kn.append(round(abs(v), 3)); dr.append(fd if v >= 0 else ed)
    return kn, dr

def main():
    year = year_arg(); wid = world_id()
    if wid == "cove":
        station, bin_, interval = "SFB1204", 18, iopt("--interval", 6)
        samples = fetch_continuous(station, year, interval, bin_)
        out = {"station": station, "bin": bin_, "interval_min": interval, "generated": datetime.datetime.now().isoformat(timespec="seconds"),
               "t0": samples[0][0], "dtMs": interval * 60000, "kn": [s[1] for s in samples], "dir": [s[2] for s in samples]}
        dst = DATA / f"currents-{year}.json"
    else:
        world = load_world(wid); st = json.loads((world_dir(wid) / "stations.json").read_text())["stations"]
        interval = iopt("--interval", 30); dt = interval * 60000
        t0 = int(datetime.datetime(year - 1, 12, 20, tzinfo=TZ).timestamp() * 1000)
        t1 = int(datetime.datetime(year + 1, 1, 10, tzinfo=TZ).timestamp() * 1000)
        n = int((t1 - t0) / dt) + 1
        only = opt("--only"); only = set(only.split(",")) if only else None
        dst = world_dir(wid) / f"currents-{year}.json"
        stations = json.loads(dst.read_text())["stations"] if (only and dst.exists()) else {}   # --only merges into the existing bundle
        for s in st:
            if only and s["id"] not in only: continue
            time.sleep(1.0)                                             # CO-OPS rate-limits bursts (403)
            try:
                if s["type"] == "H" and s.get("continuous", True):
                    samples = fetch_continuous(s["id"], year, interval)
                    # snap onto the common grid (samples are on :00/:30 already at interval=30)
                    idx = {round((t - t0) / dt): (k, d) for t, k, d in samples}
                    kn = [idx.get(i, (0.0, 0))[0] for i in range(n)]; dr = [idx.get(i, (0.0, 0))[1] for i in range(n)]
                    kind = "continuous"
                else:
                    ev, fd, ed = fetch_events(s["id"], year)
                    if fd is None or ed is None: print(f"  {s['id']}: no flood/ebb dirs, skipped"); continue
                    kn, dr = cosine_resample(ev, fd, ed, t0, dt, n); kind = "max_slack_cosine"
                kn = [round(v, 2) for v in kn]; dr = [int(round(v)) for v in dr]
                stations[s["id"]] = {"t0": t0, "dtMs": dt, "kn": kn, "dir": dr, "kind": kind, "lat": s["lat"], "lon": s["lon"], "name": s["name"]}
                print(f"  {s['id']:>8} {kind:<16} max {max(kn):.2f} kn" + " " * 20)
            except Exception as ex:                       # one bad station must not kill the year
                print(f"  {s['id']}: {type(ex).__name__}: {ex}")
        out = {"world": wid, "year": year, "interval_min": interval, "generated": datetime.datetime.now().isoformat(timespec="seconds"), "stations": stations}
        dst = world_dir(wid) / f"currents-{year}.json"
    dst.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {dst} ({dst.stat().st_size // 1024} KB)")

if __name__ == "__main__":
    main()
