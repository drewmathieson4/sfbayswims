#!/usr/bin/env python3
"""Stage a static site containing runtime assets only. Rebuild inputs remain in the repo."""
import argparse
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent.parent


def runtime_files(root=ROOT):
    root = Path(root)
    files = {Path('index.html'), Path('frame/index.html'), Path('data/worlds/index.json'), Path('data/frame.json'), Path('data/watertemp-climatology.json')}
    for directory, pattern in [('js', '*.js'), ('css', '*.css'), ('data', 'tides-*.json'), ('data', 'currents-*.json')]:
        source = root / directory
        iterator = source.rglob(pattern) if directory in ('js', 'css') else source.glob(pattern)
        files.update(p.relative_to(root) for p in iterator)
    index = json.loads((root / 'data/worlds/index.json').read_text())
    for entry in index['worlds']:
        folder = Path('data/worlds') / entry['id']
        world = json.loads((root / folder / 'world.json').read_text())
        files.update(folder / name for name in ['world.json', world['landmarks'], world['routes']])
        geometry = world['geometry']
        keys = ['shoreline', 'zones'] if geometry['type'] == 'zones' else ['file', 'meta']
        files.update(folder / geometry[key] for key in keys)
        if world['field']['type'] == 'stations': files.add(folder / world['field']['stations'])
        files.update(p.relative_to(root) for p in (root / folder).glob('currents-*.json'))
        photo = folder / world.get('photo', {}).get('dir', 'photo')
        meta = json.loads((root / photo / 'photo.json').read_text())
        files.add(photo / 'photo.json')
        variant = next((v for v in meta['variants'] if v['id'] == meta['default']), meta['variants'][0])
        files.add(photo / variant['file'])
    for extra in ['CNAME', 'SOURCES.md']:
        if (root / extra).exists(): files.add(Path(extra))
    for path in files:
        if not (root / path).resolve().is_relative_to(root.resolve()): raise ValueError(f'Invalid runtime asset: {path}')
        if not (root / path).is_file(): raise ValueError(f'Missing runtime asset: {path}')
    return sorted(files)


def build(output, root=ROOT):
    files = runtime_files(root)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)  # never delete/overwrite an arbitrary directory
    for path in files:
        destination = output / path; destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(Path(root) / path, destination)
    (output / '.nojekyll').touch()
    return files


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('output', type=Path, nargs='?', default=ROOT / 'site')
    args = parser.parse_args(); files = build(args.output)
    print(f'Staged {len(files)} runtime files in {args.output}')
