"""Worlds and argv for the data-prep tools.

A world is data/worlds/<id>/: world.json (bbox, geometry, field, config patch) plus that world's photo, mask,
landmarks, routes and current bundles. Tools take --world <id> (default cove).
"""
import json, math, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
WORLDS = DATA / "worlds"

# equirectangular metres per degree (must match js/projection.js)
KY = 111195.08
def kx(lat): return KY * math.cos(math.radians(lat))

def opt(name, default=None):
    """The value following `name` in argv, or default."""
    a = sys.argv[1:]
    return a[a.index(name) + 1] if name in a and a.index(name) + 1 < len(a) else default
def flag(name): return name in sys.argv[1:]
def fopt(name, default): return float(opt(name, default))
def iopt(name, default): return int(opt(name, default))
def year_arg(default=None):
    """A bare 4-digit year anywhere in argv."""
    import datetime
    for a in sys.argv[1:]:
        if a.isdigit() and len(a) == 4: return int(a)
    return default or datetime.date.today().year

def world_id(): return opt("--world", "cove")
def world_dir(wid=None): return WORLDS / (wid or world_id())
def load_world(wid=None): return json.loads((world_dir(wid) / "world.json").read_text())
def bbox_of(world):
    b = world["bbox"]
    return (float(b["s"]), float(b["w"]), float(b["n"]), float(b["e"]))
def lattice(bbox, res_m):
    """Pixel size of an equirectangular image with square-metre pixels covering bbox at res_m."""
    s, w, n, e = bbox
    return round((e - w) * kx((s + n) / 2) / res_m), round((n - s) * KY / res_m)
