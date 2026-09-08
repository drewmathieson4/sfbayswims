#!/usr/bin/env python3
"""Validate this year's predictions and coverage ahead; old files never trigger expiry alarms."""
import argparse
import datetime
from pathlib import Path
import time
from _bundles import jobs, inspect, TZ


def check(root, days=60, now=None):
    now = time.time() * 1000 if now is None else now
    year = datetime.datetime.fromtimestamp(now / 1000, TZ).year
    required = list(jobs(root, [year]))
    upcoming = list(jobs(root, [year + 1]))
    bad = 0
    for current, future in zip(required, upcoming):
        bounds, error = inspect(current)
        if error:
            print(f'{current[2]}: INVALID — {error}'); bad += 1
        end = bounds[1] if bounds else 0
        if future[2].exists():
            extra, err = inspect(future)
            if err:
                print(f'{future[2]}: INVALID — {err}'); bad += 1
            elif bounds and extra[0] <= end:
                end = max(end, extra[1])
        if end < now + days * 86400000:
            print(f'{current[0]}: missing continuous coverage {days} days ahead'); bad += 1
        else:
            print(f'{current[0]}: valid through {datetime.datetime.fromtimestamp(end / 1000, TZ).date()}')
    try:
        import json
        from _bundles import finite
        values = json.loads((Path(root) / 'watertemp-climatology.json').read_text())['doyMeanF']
        if len(values) != 366 or not all(finite(v) for v in values): raise ValueError('expected 366 finite temperatures')
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f'climatology: INVALID — {exc}'); bad += 1
    return 1 if bad else 0


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--days', type=int, default=60)
    ap.add_argument('--data', type=Path, default=Path(__file__).resolve().parent.parent / 'data')
    args = ap.parse_args()
    try: return check(args.data, args.days)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f'Cannot validate bundle inventory: {exc}'); return 1


if __name__ == '__main__': raise SystemExit(main())
