import contextlib
import datetime
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from _bundles import atomic_write, jobs, validate_bundle, TZ
from check_bundles import check
from refresh_bundles import needed
from build_site import build, runtime_files
import precompute_currents
import runpy

YEAR = 2026
NOW = datetime.datetime(YEAR, 9, 8, tzinfo=TZ).timestamp() * 1000


def series(year=YEAR):
    start = datetime.datetime(year - 1, 12, 20, tzinfo=TZ).timestamp() * 1000
    end = datetime.datetime(year + 1, 1, 10, tzinfo=TZ).timestamp() * 1000
    n = int((end - start) / 3600000) + 1
    return {'station': 'SFB1204', 't0': start, 'dtMs': 3600000, 'kn': [1] * n, 'dir': [90] * n}


class Bundles(unittest.TestCase):
    def test_invalid_arrays_and_roster(self):
        for bad in ({**series(), 'kn': [1]}, {**series(), 'dtMs': 0}, {**series(), 'dir': [None] * len(series()['kn'])}):
            with self.assertRaises(ValueError): validate_bundle(bad, 'cove', YEAR)
        with self.assertRaises(ValueError): validate_bundle({'stations': {'a': series()}}, 'bay', YEAR, ['a', 'b'])

    def test_atomic_publish_preserves_good_file(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'currents.json'; original = series()
            atomic_write(path, original, 'cove', YEAR)
            before = path.read_bytes()
            with self.assertRaises(ValueError): atomic_write(path, {'kn': []}, 'cove', YEAR)
            self.assertEqual(path.read_bytes(), before)
            self.assertEqual(list(Path(d).glob('*.tmp')), [])

    def test_generator_failure_preserves_existing_year(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); path = root / 'currents-2026.json'; path.write_text('original')
            (root / 'stations.json').write_text(json.dumps({'stations': [{'id': 'a', 'type': 'H', 'lat': 0, 'lon': 0, 'name': 'A'}]}))
            with patch.object(precompute_currents, 'world_id', return_value='bay'), patch.object(precompute_currents, 'world_dir', return_value=root), patch.object(precompute_currents, 'year_arg', return_value=YEAR), patch.object(precompute_currents, 'fetch_continuous', side_effect=RuntimeError('offline')), patch.object(precompute_currents.time, 'sleep'):
                with self.assertRaises(RuntimeError): precompute_currents.main()
            self.assertEqual(path.read_text(), 'original')

    def test_missing_files_fail_and_old_files_do_not_raise_false_alarm(self):
        root = Path(__file__).resolve().parents[1] / 'data'
        with tempfile.TemporaryDirectory() as d:
            target = Path(d); (target / 'worlds/bay').mkdir(parents=True); (target / 'worlds/cove').mkdir()
            for p in ['worlds/index.json', 'worlds/bay/world.json', 'worlds/bay/stations.json', 'worlds/cove/world.json', 'watertemp-climatology.json']:
                (target / p).write_bytes((root / p).read_bytes())
            with contextlib.redirect_stdout(io.StringIO()): self.assertEqual(check(target, now=NOW), 1)
            self.assertTrue(needed(target, NOW, 120))
            for job in jobs(target, [2026, 2027]): job[2].write_bytes((root / job[2].relative_to(target)).read_bytes())
            (target / 'currents-2025.json').write_text('{}')
            with contextlib.redirect_stdout(io.StringIO()): self.assertEqual(check(target, now=NOW), 0)
            self.assertEqual(needed(target, NOW, 120), [])
            (target / 'currents-2026.json').unlink()
            self.assertIn('cove', [j[0] for j in needed(target, NOW, 120)])

    def test_site_keeps_runtime_images_and_excludes_rebuild_inputs(self):
        files = set(runtime_files())
        self.assertIn(Path('data/worlds/cove/photo/source.jpg'), files)
        self.assertIn(Path('data/worlds/bay/photo/color-muted.jpg'), files)
        for name in ['photo/source.jpg', 'photo/water-2025-05-10.jpg', 'coastline.json', 'piers.json', 'bridges.json', 'structures.png']:
            self.assertNotIn(Path('data/worlds/bay') / name, files)
        with tempfile.TemporaryDirectory() as d:
            output = Path(d) / 'site'; build(output)
            self.assertTrue((output / 'frame/index.html').exists())
            with self.assertRaises(FileExistsError): build(output)

    def test_tide_generator_splits_long_requests_and_publishes_after_validation(self):
        calls = []
        def coops(**kwargs):
            calls.append(kwargs)
            return {'predictions': [{'t': '2026-01-01 00:00', 'v': '1', 'type': 'H'}]}
        with patch('_common.coops', side_effect=coops), patch('_world.year_arg', return_value=2026), patch('_bundles.atomic_write') as publish:
            with tempfile.TemporaryDirectory() as d, patch('_world.DATA', Path(d)):
                (Path(d) / 'tides-2026.json').touch()
                with contextlib.redirect_stdout(io.StringIO()): runpy.run_path(str(Path(__file__).resolve().parents[1] / 'tools/precompute_tides.py'))
        self.assertEqual(len(calls), 2)
        for call in calls:
            begin = datetime.datetime.strptime(call['begin_date'], '%Y%m%d')
            end = datetime.datetime.strptime(call['end_date'], '%Y%m%d')
            self.assertLessEqual((end - begin).days + 1, 366)
        publish.assert_called_once()

    def test_continuous_fetch_uses_utc_across_fall_back(self):
        response = {'current_predictions': {'cp': [{'Time': '2026-11-01 08:30', 'Speed': '1', 'Direction': '90'}, {'Time': '2026-11-01 09:30', 'Speed': '1', 'Direction': '90'}]}}
        with patch.object(precompute_currents, 'coops', return_value=response) as coops, patch.object(precompute_currents, 'month_ranges', return_value=[('20261101', '20261101')]):
            samples = precompute_currents.fetch_continuous('a', 2026, 60)
        self.assertEqual(coops.call_args.kwargs['time_zone'], 'gmt')
        self.assertEqual(samples[1][0] - samples[0][0], 3600000)

    def test_nonuniform_samples_cannot_be_silently_zero_filled(self):
        with self.assertRaises(ValueError): precompute_currents.cosine_resample([(0, 1), (10, 0)], 90, 270, 0, 10, 3)


if __name__ == '__main__': unittest.main()
