"""Smoke tests serve the deployment artifact, including from a Pages-style subdirectory."""
from pathlib import Path
import sys
import tempfile
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools'))
from build_site import build
import serve

with tempfile.TemporaryDirectory(prefix='sfbayswims-browser-') as directory:
    root = Path(directory)
    build(root / 'sfbayswims')
    # Serve identical assets at both URL shapes without copying the large bundles twice.
    for path in (root / 'sfbayswims').iterdir(): (root / path.name).symlink_to(path)
    serve.ROOT = root
    with serve.Server(('127.0.0.1', 8765), serve.Handler) as server:
        server.serve_forever()
