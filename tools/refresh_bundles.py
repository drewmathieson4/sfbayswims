#!/usr/bin/env python3
"""Keep the bundled predictions ahead of the calendar: for this year and next, regenerate any bundle that is missing or
ends within --days (default 120) — tides (`precompute_tides.py`), the cove's current and the Bay's stations
(`precompute_currents.py`). Idempotent; does nothing when everything reaches far enough. Meant for the quarterly GitHub
Action (.github/workflows/bundles.yml) and for a laptop:

    python3 tools/refresh_bundles.py            # do what's needed
    python3 tools/refresh_bundles.py --dry-run  # say what would be done
    python3 tools/refresh_bundles.py --days 200 # be early (fetch next year's now)

Exit 1 when a fetch failed or a bundle still ends within --alarm days (default 45) — the loud signal."""
import os, sys, json, time, datetime, subprocess, glob
sys.path.insert(0, os.path.dirname(__file__))
from _world import opt, flag, iopt
ROOT = os.path.join(os.path.dirname(__file__), '..'); DATA = os.path.join(ROOT, 'data')
DAYS, ALARM, DRY = iopt('--days', 120), iopt('--alarm', 45), flag('--dry-run')
now = time.time() * 1000
def end_of(path):
    if not os.path.exists(path): return None
    b = json.load(open(path))
    if 'hilo' in b: return b['hilo'][-1]['t'] if b['hilo'] else None
    if 'kn' in b: return b['t0'] + (len(b['kn']) - 1) * b['dtMs']
    st = b.get('stations'); ends = []
    for s in (st.values() if isinstance(st, dict) else []):
        if 'samples' in s and s['samples']: ends.append(s['samples'][-1]['t'])
        elif 'kn' in s: ends.append(s['t0'] + (len(s['kn']) - 1) * s['dtMs'])
    return min(ends) if ends else None
def fmt(t): return datetime.datetime.fromtimestamp(t / 1000).strftime('%Y-%m-%d') if t else 'missing'
year = datetime.date.today().year
# one job per bundle per year, grouped by kind; a kind is due when its furthest bundle doesn't reach DAYS ahead
KINDS = {'tides': lambda y: (os.path.join(DATA, f'tides-{y}.json'), ['python3', 'tools/precompute_tides.py', str(y)]),
         'cove':  lambda y: (os.path.join(DATA, f'currents-{y}.json'), ['python3', 'tools/precompute_currents.py', str(y)]),
         'bay':   lambda y: (os.path.join(DATA, 'worlds', 'bay', f'currents-{y}.json'), ['python3', 'tools/precompute_currents.py', '--world', 'bay', str(y)])}
years = (year, year + 1)
jobs = [(kind, y) + KINDS[kind](y) for kind in KINDS for y in years]           # (kind, year, path, cmd)
def needed():
    out = []
    for kind in KINDS:
        mine = [j for j in jobs if j[0] == kind]
        if max(end_of(j[2]) or 0 for j in mine) >= now + DAYS * 86400e3: continue
        missing = [j for j in mine if not os.path.exists(j[2])]
        out += missing or [mine[-1]]                                            # fetch the missing year(s), else refresh the latest
    return out
todo = needed(); failed = 0
print('bundles reach: ' + ', '.join(f'{os.path.relpath(j[2], ROOT)} → {fmt(end_of(j[2]))}' for j in jobs if os.path.exists(j[2])))
if not todo: print(f'nothing to do: everything reaches more than {DAYS} days ahead')
for kind, y, path, cmd in todo:
    print(('would run: ' if DRY else 'running: ') + ' '.join(cmd))
    if DRY: continue
    for attempt in range(3):
        r = subprocess.run(cmd, cwd=ROOT)
        if r.returncode == 0 and os.path.exists(path): break
        time.sleep(30 * (attempt + 1))
    else:
        print(f'FAILED: {" ".join(cmd)}'); failed += 1
latest = {kind: max(end_of(j[2]) or 0 for j in jobs if j[0] == kind) for kind in KINDS}
late = {k: v for k, v in latest.items() if v < now + ALARM * 86400e3}
if late: print('ALARM: ' + ', '.join(f'{k} ends {fmt(v)}' for k, v in late.items()))
sys.exit(1 if (failed or late) and not DRY else 0)
