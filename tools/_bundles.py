"""Shared prediction validation and atomic publishing; no network or CLI side effects."""
import datetime
import json
import math
import os
from pathlib import Path
import tempfile
from zoneinfo import ZoneInfo

TZ = ZoneInfo('America/Los_Angeles')


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def series_bounds(series):
    if not isinstance(series, dict):
        raise ValueError('invalid current series')
    kn, direction = series.get('kn'), series.get('dir')
    if not isinstance(kn, list) or len(kn) < 2 or not isinstance(direction, list) or len(kn) != len(direction):
        raise ValueError('current arrays must have matching lengths of at least two')
    if not finite(series.get('t0')) or not finite(series.get('dtMs')) or not 0 < series['dtMs'] <= 3600000:
        raise ValueError('invalid series clock')
    if not all(finite(v) and 0 <= v <= 30 for v in kn) or not all(finite(v) and 0 <= v <= 360 for v in direction):
        raise ValueError('invalid current speed/direction')
    return series['t0'], series['t0'] + (len(kn) - 1) * series['dtMs']


def validate_bundle(bundle, kind, year, expected=()):
    if not isinstance(bundle, dict):
        raise ValueError('invalid bundle')
    if kind == 'tides':
        rows = bundle.get('hilo')
        if not isinstance(rows, list) or len(rows) < 2:
            raise ValueError('missing tide extremes')
        if not all(isinstance(r, dict) and finite(r.get('t')) and finite(r.get('h')) and r.get('type') in ('H', 'L') for r in rows):
            raise ValueError('invalid tide extreme')
        if any(b['t'] <= a['t'] or b['t'] - a['t'] > 18 * 3600000 for a, b in zip(rows, rows[1:])):
            raise ValueError('unordered or missing tide extremes')
        bounds = [(rows[0]['t'], rows[-1]['t'])]
    elif kind == 'cove':
        if bundle.get('station') != 'SFB1204':
            raise ValueError('wrong cove station')
        bounds = [series_bounds(bundle)]
    else:
        stations = bundle.get('stations')
        if not expected or not isinstance(stations, dict) or set(stations) != set(expected):
            raise ValueError('station roster does not match stations.json')
        bounds = [series_bounds(stations[s]) for s in expected]
    start, end = max(a for a, _ in bounds), min(b for _, b in bounds)
    required = [datetime.datetime(y, 1, 1, tzinfo=TZ).timestamp() * 1000 for y in (year, year + 1)]
    if start > required[0] or end < required[1]:
        raise ValueError(f'incomplete coverage for {year}')
    return start, end


def jobs(root, years):
    root = Path(root)
    for year in years:
        yield 'tides', year, root / f'tides-{year}.json', (), ['tools/precompute_tides.py', str(year)]
        yield 'cove', year, root / f'currents-{year}.json', (), ['tools/precompute_currents.py', str(year)]
        index = json.loads((root / 'worlds/index.json').read_text())
        for entry in index['worlds']:
            wid = entry['id']; folder = root / 'worlds' / wid
            world = json.loads((folder / 'world.json').read_text())
            if world['field']['type'] != 'stations':
                continue
            roster = json.loads((folder / world['field']['stations']).read_text())['stations']
            expected = tuple(s['id'] for s in roster)
            yield wid, year, folder / f'currents-{year}.json', expected, ['tools/precompute_currents.py', '--world', wid, str(year)]


def inspect(job):
    kind, year, path, expected, _ = job
    try:
        return validate_bundle(json.loads(path.read_text()), kind, year, expected), None
    except (OSError, ValueError, KeyError, TypeError) as exc:
        return None, str(exc)


def atomic_write(path, bundle, kind, year, expected=()):
    validate_bundle(bundle, kind, year, expected)
    path = Path(path)
    encoded = json.dumps(bundle, separators=(',', ':'), allow_nan=False)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, prefix=path.name + '.', suffix='.tmp', delete=False) as out:
            temporary = out.name
            out.write(encoded); out.flush(); os.fsync(out.fileno())
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)
