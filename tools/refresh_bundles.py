#!/usr/bin/env python3
"""Refresh invalid/missing current-year bundles and upcoming coverage. Shared by CI and Pi."""
import argparse
import datetime
from pathlib import Path
import subprocess
import sys
import time
from _bundles import jobs, inspect, TZ
from check_bundles import check


def needed(root, now, days):
    year = datetime.datetime.fromtimestamp(now / 1000, TZ).year
    todo = []
    for current, future in zip(jobs(root, [year]), jobs(root, [year + 1])):
        bounds, error = inspect(current)
        if error: todo.append(current)
        extra, future_error = inspect(future)
        # Keep the current year healthy even if the next year's file already exists.
        if future_error and (future[2].exists() or not bounds or bounds[1] < now + days * 86400000): todo.append(future)
    return todo


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--days', type=int, default=120)
    ap.add_argument('--alarm', type=int, default=45); ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args(); root = Path(__file__).resolve().parent.parent
    try: todo = needed(root / 'data', time.time() * 1000, args.days)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f'Cannot read bundle inventory: {exc}'); return 1
    failed = False
    for job in todo:
        cmd = [sys.executable, *job[4]]
        print(('would run: ' if args.dry_run else 'running: ') + ' '.join(cmd), flush=True)
        if args.dry_run: continue
        for attempt in range(3):
            result = subprocess.run(cmd, cwd=root)
            if result.returncode == 0 and inspect(job)[1] is None: break
            if attempt < 2: time.sleep(30)
        else: failed = True
    if args.dry_run:
        if not todo: print('No refresh needed')
        return 0
    healthy = check(root / 'data', args.alarm)
    return 1 if failed or healthy else 0


if __name__ == '__main__': raise SystemExit(main())
