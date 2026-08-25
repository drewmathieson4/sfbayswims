#!/usr/bin/env python3
"""The aerial photo for a world → data/worlds/<id>/photo/source.jpg + source.json.

  python3 tools/fetch_aerial.py                 # cove: NOAA NGS 2025 orthoimagery (0.25 m COGs, read by HTTP range) at 0.44 m
  python3 tools/fetch_aerial.py --world bay     # bay:  USGS NAIP 2022 (tiled 4326 exports, ≤ 4000 px each) at 3 m

Both are resampled onto the world's equirectangular lattice (square-metre pixels over the bbox). The cove ships
source.jpg as is; the Bay's goes through tools/stylize.py with Sentinel-2 water. The COG reader and the UTM→lattice
resample are shared with tools/fetch_sentinel.py.
"""
import math, json, struct, zlib, datetime, io, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
from _common import UA, http_range
from _world import world_dir, load_world, bbox_of, lattice, kx, KY, fopt

Image.MAX_IMAGE_PIXELS = None
NAIP = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage"

# Transverse Mercator forward (Snyder 1987), GRS80, UTM 10N
A_ = 6378137.0; F_ = 1 / 298.257222101; E2 = 2 * F_ - F_ * F_; EP2 = E2 / (1 - E2); K0 = 0.9996; LON0 = -123.0
def ll2utm(lon, lat):
    p, l = math.radians(lat), math.radians(lon - LON0)
    N = A_ / math.sqrt(1 - E2 * math.sin(p) ** 2); T = math.tan(p) ** 2; C = EP2 * math.cos(p) ** 2; Aa = l * math.cos(p)
    M = A_ * ((1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256) * p - (3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024) * math.sin(2 * p)
              + (15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024) * math.sin(4 * p) - (35 * E2 ** 3 / 3072) * math.sin(6 * p))
    x = 500000 + K0 * N * (Aa + (1 - T + C) * Aa ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * Aa ** 5 / 120)
    y = K0 * (M + N * math.tan(p) * (Aa ** 2 / 2 + (5 - T + 9 * C + 4 * C * C) * Aa ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * Aa ** 6 / 720))
    return x, y

# ---- minimal (Big)TIFF IFD reader over HTTP ranges ----
class CogTiff:
    def __init__(self, url):
        self.url = url
        head = http_range(url, 0, 4 * 1024 * 1024 - 1)     # IFDs + offset arrays live at the front (COG)
        self.buf = bytearray(head)
        bo = {b"II": "<", b"MM": ">"}[bytes(head[:2])]
        magic = struct.unpack(bo + "H", head[2:4])[0]
        self.bo = bo; self.big = magic == 43
        first = struct.unpack(bo + "Q", head[8:16])[0] if self.big else struct.unpack(bo + "I", head[4:8])[0]
        self.ifds = []
        off = first
        while off:
            ifd, off = self._read_ifd(off)
            self.ifds.append(ifd)
    def _need(self, a, b):
        if b >= len(self.buf):
            self.buf += http_range(self.url, len(self.buf), max(b, len(self.buf) + (1 << 20)))
    def _read_ifd(self, off):
        bo = self.bo
        if self.big:
            self._need(off, off + 8); n = struct.unpack(bo + "Q", self.buf[off:off + 8])[0]; off += 8; esz = 20
        else:
            self._need(off, off + 2); n = struct.unpack(bo + "H", self.buf[off:off + 2])[0]; off += 2; esz = 12
        self._need(off, off + n * esz + 8)
        tags = {}
        TSZ = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 12: 8, 16: 8}
        TFM = {1: "B", 3: "H", 4: "I", 16: "Q", 12: "d"}
        for i in range(n):
            e = self.buf[off + i * esz: off + (i + 1) * esz]
            if self.big:
                tag, typ, cnt = struct.unpack(bo + "HHQ", e[:12]); val = e[12:20]
            else:
                tag, typ, cnt = struct.unpack(bo + "HHI", e[:8]); val = e[8:12]
            size = TSZ.get(typ, 1) * cnt
            if size <= len(val):
                data = val[:size]
            else:
                p = struct.unpack(bo + ("Q" if self.big else "I"), val)[0]
                self._need(p, p + size); data = bytes(self.buf[p:p + size])
            if typ in TFM:
                tags[tag] = struct.unpack(bo + TFM[typ] * cnt, data)
            else:
                tags[tag] = data
        nxt_off = off + n * esz
        nxt = struct.unpack(bo + ("Q" if self.big else "I"), self.buf[nxt_off:nxt_off + (8 if self.big else 4)])[0]
        return tags, nxt

def utm_window(bbox, margin=20):
    """UTM (zone 10) window covering the lat/lon bbox, with a margin in metres → (E0, E1, N0, N1)."""
    s, w, n, e = bbox
    corners = [ll2utm(lo, la) for lo in (w, e) for la in (s, n)]
    return (min(c[0] for c in corners) - margin, max(c[0] for c in corners) + margin,
            min(c[1] for c in corners) - margin, max(c[1] for c in corners) + margin)

def read_cog_window(url, E0, E1, N0, N1, mosaic, px, level=0, origin=None, workers=12, label=None):
    """Paste the tiles of a UTM-aligned, DEFLATE-compressed COG that cover [E0,E1]×[N0,N1] into `mosaic`
    (pixel (0,0) = (E0, N1) at `px` m/px — the COG level's own resolution). origin = (X0, Y0) of the file's
    top-left corner; default: its GeoTIFF tiepoint. Returns (tiles pasted, bytes fetched)."""
    import numpy as np
    t = CogTiff(url); ifd = t.ifds[level]
    tw, th = ifd[322][0], ifd[323][0]; iw, ih = ifd[256][0], ifd[257][0]
    spp = ifd[277][0]; comp = ifd[259][0]; pred = ifd.get(317, (1,))[0]
    offs, cnts = ifd[324], ifd[325]; tpr = math.ceil(iw / tw)
    assert comp == 8 and spp >= 3, f"unexpected tiff layout comp={comp} spp={spp}"
    if origin is None: tie = t.ifds[0][33922]; X0, Y0 = tie[3], tie[4]
    else: X0, Y0 = origin
    c0 = max(0, int((E0 - X0) / px)); c1 = min(iw, int((E1 - X0) / px) + 1)
    r0 = max(0, int((Y0 - N1) / px)); r1 = min(ih, int((Y0 - N0) / px) + 1)
    if c1 <= c0 or r1 <= r0: return 0, 0
    jobs = [(ty, tx) for ty in range(r0 // th, (r1 - 1) // th + 1) for tx in range(c0 // tw, (c1 - 1) // tw + 1)]
    print(f"  {label or url.rsplit('/', 2)[-2]}: level {level} {iw}×{ih}, tiles {tw}×{th}, need {len(jobs)} tiles", flush=True)
    mode = {3: "RGB", 4: "RGBX", 5: "RGBXX"}[spp]
    def get(job):
        ty, tx = job; k = ty * tpr + tx
        if cnts[k] == 0: return job, None, 0                       # empty (nodata) tile
        raw = http_range(url, offs[k], offs[k] + cnts[k] - 1)
        a = np.frombuffer(zlib.decompress(raw), np.uint8)
        if a.size != th * tw * spp: return job, None, len(raw)
        a = a.reshape(th, tw, spp)
        if pred == 2: a = (np.cumsum(a, axis=1, dtype=np.uint32) & 255).astype(np.uint8)
        im = Image.frombytes("RGB", (tw, th), a.tobytes(), "raw", mode, tw * spp, 1)
        vw, vh = min(tw, iw - tx * tw), min(th, ih - ty * th)          # edge tiles are padded past the image: clip the padding
        if vw < tw or vh < th: im = im.crop((0, 0, vw, vh))
        return job, im, len(raw)
    total = [0, 0]
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for job, im, nbytes in ex.map(get, jobs):
            if im is None: continue
            ty, tx = job; Et = X0 + tx * tw * px; Nt = Y0 - ty * th * px
            mosaic.paste(im, (round((Et - E0) / px), round((N1 - Nt) / px)))
            total[0] += 1; total[1] += nbytes
            if total[0] % 25 == 0: print(f"    {total[0]} tiles, {total[1] / 1e6:.0f} MB", flush=True)
    return total[0], total[1]

def utm_to_lattice(mosaic, bbox, res, E0, N1, px):
    """Resample a UTM-aligned mosaic (pixel (0,0) = (E0, N1), px m/px) onto the equirectangular square-metre
    lattice of bbox at `res` m/px. An affine fit is exact to a fraction of a pixel at this size."""
    import numpy as np
    s, w, n, e = bbox
    outW, outH = lattice(bbox, res)
    shrink = max(1.0, res / px * 0.9)                       # pre-shrink so the transform is ~1:1 (no aliasing)
    if shrink > 1.05: mosaic = mosaic.resize((round(mosaic.width / shrink), round(mosaic.height / shrink)), Image.LANCZOS)
    def src_px(u, v):
        lon = w + (u + 0.5) / outW * (e - w); lat = n - (v + 0.5) / outH * (n - s); E, N = ll2utm(lon, lat)
        return ((E - E0) / px) / shrink - 0.5, ((N1 - N) / px) / shrink - 0.5
    pts = [(u, v) for u in [outW * k / 5 for k in range(6)] for v in [outH * k / 5 for k in range(6)]]
    Amat = np.array([[u, v, 1] for u, v in pts]); B = np.array([src_px(u, v) for u, v in pts])
    coef = np.linalg.lstsq(Amat, B, rcond=None)[0]; err = np.abs(Amat @ coef - B).max()
    a, d = coef[0]; b, ee = coef[1]; c, f = coef[2]
    print(f"  affine fit max residual {err:.3f} px; output {outW}×{outH} @ {res} m")
    return mosaic.transform((outW, outH), Image.AFFINE, (a, b, c, d, ee, f), resample=Image.BICUBIC)

def fetch_noaa(bbox, res, level):
    BASE = "https://coastalimagery.blob.core.windows.net/digitalcoast/SanFranciscoCA_RGBN_2025_10318/"
    TILES = [("549000e4188000n.tif", 4188005.0), ("549000e4185000n.tif", 4185005.0)]
    X0 = 548995.0
    E0, E1, N0, N1 = utm_window(bbox)
    scale = 2 ** level; px = 0.25 * scale
    W = int((E1 - E0) / px) + 1; H = int((N1 - N0) / px) + 1
    print(f"NOAA window E {E0:.0f}..{E1:.0f} N {N0:.0f}..{N1:.0f} → {W}×{H} px @ {px} m (level {level})")
    mosaic = Image.new("RGB", (W, H)); total = [0, 0]
    for name, originN in TILES:
        nt, nb = read_cog_window(BASE + name, E0, E1, N0, N1, mosaic, px, level, origin=(X0, originN), label=name)
        total[0] += nt; total[1] += nb
    print(f"  fetched {total[0]} tiles, {total[1] / 1e6:.0f} MB")
    out = utm_to_lattice(mosaic, bbox, res, E0, N1, px)
    return out, {"source": "NOAA NGS 2025 orthoimagery, San Francisco (Digital Coast 10318), public domain",
                 "tiles": [t[0] for t in TILES], "level": level, "nativeResM": px}

def naip_export(bbox, W, H):
    """One NAIPPlus exportImage in EPSG:4326 (the server expands a bbox to the requested aspect: keep W:H degree-proportional)."""
    s, w, n, e = bbox
    q = {"bbox": f"{w},{s},{e},{n}", "bboxSR": "4326", "imageSR": "4326", "size": f"{W},{H}", "format": "jpg", "f": "image"}
    req = urllib.request.Request(NAIP + "?" + urllib.parse.urlencode(q), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=300) as r: return Image.open(io.BytesIO(r.read())).convert("RGB")

def fetch_naip(bbox, res):
    """Tiled 4326 export (each tile ≤ 4000 px, degree-proportional → exact bbox), stitched, then resampled to square-metre pixels."""
    s, w, n, e = bbox
    W, H = lattice(bbox, res)
    tx = max(1, math.ceil(W / 4000)); ty = 1
    while round(4000 * ((n - s) / ty) / ((e - w) / tx)) > 4000: ty += 1
    dlon, dlat = (e - w) / tx, (n - s) / ty
    TW = 4000; TH = round(TW * dlat / dlon)
    print(f"NAIP {tx}×{ty} tiles of {TW}×{TH} px → {W}×{H} @ {res} m")
    mosaic = Image.new("RGB", (TW * tx, TH * ty))
    for j in range(ty):
        for i in range(tx):
            mosaic.paste(naip_export((n - dlat * (j + 1), w + dlon * i, n - dlat * j, w + dlon * (i + 1)), TW, TH), (i * TW, j * TH)); print(f"  tile {i},{j} ok", flush=True)
    return mosaic.resize((W, H), Image.LANCZOS), {"source": "USGS NAIPPlus (USDA NAIP 2022, 0.6 m, flown 2022-05-18), public domain", "nativeResM": 0.6, "tiles": f"{tx}×{ty}"}

def main():
    world = load_world(); bbox = bbox_of(world)
    source = "noaa" if world["id"] == "cove" else "naip"
    res = fopt("--res", 0.44 if source == "noaa" else 3)
    out_dir = world_dir() / world.get("photo", {}).get("dir", "photo"); out_dir.mkdir(parents=True, exist_ok=True)
    img, meta = fetch_noaa(bbox, res, 0) if source == "noaa" else fetch_naip(bbox, res)
    dst = out_dir / "source.jpg"; img.save(dst, quality=92, optimize=True)
    s, w, n, e = bbox
    (out_dir / "source.json").write_text(json.dumps({"world": world["id"], "bbox": {"s": s, "w": w, "n": n, "e": e}, "width": img.width, "height": img.height, "resM": res,
        "fetchedAt": datetime.datetime.now().isoformat(timespec="seconds"), **meta}, indent=1))
    print(f"wrote {dst} ({dst.stat().st_size // 1024} KB, {img.width}×{img.height})")

if __name__ == "__main__":
    main()
