#!/usr/bin/env python3
"""Report how far the bundled predictions reach — tides, the cove's current, every Bay station — and warn when a bundle
ends within --days (default 60). Run it any time; the yearly chore is to regenerate next year's bundles in December:

    python3 tools/precompute_tides.py --year 2027
    python3 tools/precompute_currents.py --year 2027                 # the cove's station
    python3 tools/precompute_currents.py --world bay --year 2027     # the 43 Bay stations

Exit status 1 when a bundle is missing or ends soon (for cron / CI)."""
import json, sys, time, datetime, glob, argparse, os
TZ = datetime.timezone(datetime.timedelta(hours=-8))
ap = argparse.ArgumentParser(); ap.add_argument('--days', type=int, default=60); a = ap.parse_args()
root = os.path.join(os.path.dirname(__file__), '..', 'data')
now = time.time() * 1000; soon = now + a.days * 86400e3; bad = 0
def ends(name, t_end):
    global bad
    if t_end is None: print(f'  {name:42s} MISSING'); bad += 1; return
    d = datetime.datetime.fromtimestamp(t_end / 1000, TZ).strftime('%Y-%m-%d')
    left = (t_end - now) / 86400e3
    flag = '  ← ends soon' if t_end < soon else ''
    if flag: bad += 1
    print(f'  {name:42s} through {d} ({left:5.0f} days){flag}')
def series_end(b):
    if 'samples' in b: return b['samples'][-1]['t'] if b['samples'] else None
    if 'kn' in b: return b['t0'] + (len(b['kn']) - 1) * b['dtMs']
    return None
print('bundled predictions (all Pacific dates)')
for f in sorted(glob.glob(os.path.join(root, 'tides-*.json'))):
    b = json.load(open(f)); ends(os.path.basename(f) + ' (hi/lo)', b['hilo'][-1]['t'] if b.get('hilo') else None)
for f in sorted(glob.glob(os.path.join(root, 'currents-*.json'))):
    b = json.load(open(f)); ends(os.path.basename(f) + ' (cove ' + b.get('station', '?') + ')', series_end(b))
for f in sorted(glob.glob(os.path.join(root, 'worlds', '*', 'currents-*.json'))):
    b = json.load(open(f)); w = f.split(os.sep)[-2]
    st = b.get('stations') or b
    ends_ = [series_end(s) for s in (st.values() if isinstance(st, dict) else st)]
    ends_ = [e for e in ends_ if e]
    ends(f'{w}/{os.path.basename(f)} ({len(ends_)} stations, earliest end)', min(ends_) if ends_ else None)
c = json.load(open(os.path.join(root, 'watertemp-climatology.json'))); print(f'  {"watertemp-climatology.json":42s} {len(c.get("doyMeanF", []))} days of year')
sys.exit(1 if bad else 0)
