#!/usr/bin/env python3
"""The shipped photo for a world with satellite water → data/worlds/<id>/photo/color-muted.jpg + photo.json.

  python3 tools/stylize.py --world bay --water-from water-2025-05-10.jpg --contrast 1.3 --saturation 0.8

Land, piers and bridges come from the aerial (photo/source.jpg); the water comes from ONE Sentinel-2 pass
(photo/water-<date>.jpg from tools/fetch_sentinel.py) blended in through mask.png — a satellite scene is a single
exposure, so its water has none of the flight-line seams an aerial mosaic has. Steps: tone-match the satellite water to
the aerial's water median · level km-scale brightness fronts (--water-level, 0 = off) · feather the shoreline ·
keep bridge pixels (structures.png) from the aerial · then the colour recipe (contrast, saturation).
(The cove ships its aerial untouched: photo.json points at source.jpg, no stylize step.)
"""
import json, datetime
import numpy as np
from PIL import Image, ImageFilter, ImageEnhance, ImageOps
from _world import world_dir, load_world, opt, fopt

MAXW = 5000                                            # working width; the Bay's 6733-px aerial becomes ~4 m/px
CON, SAT = fopt("--contrast", 1.3), fopt("--saturation", 0.8)
WATER_FROM, LEVEL, LEVEL_KM = opt("--water-from"), fopt("--water-level", 0.6), fopt("--water-level-km", 1.0)
BLUR = 1.0                                             # a light Gaussian on the whole image before the recipe

world = load_world(); D = world_dir() / world.get("photo", {}).get("dir", "photo")
info = json.loads((D / "source.json").read_text())
rgb = Image.open(D / "source.jpg").convert("RGB")
if rgb.width > MAXW: rgb = rgb.resize((MAXW, round(rgb.height * MAXW / rgb.width)), Image.LANCZOS)
source = info["source"]

if WATER_FROM:
    wmeta = json.loads((D / WATER_FROM.replace(".jpg", ".json")).read_text())
    assert all(abs(wmeta["bbox"][k] - info["bbox"][k]) < 1e-6 for k in "swne"), "water image bbox != photo bbox — re-run fetch_sentinel.py"
    A = np.asarray(rgb).astype(np.float32)
    Wm = np.asarray(Image.open(D / WATER_FROM).convert("RGB").resize(rgb.size, Image.BICUBIC)).astype(np.float32)
    m = Image.open(D.parent / "mask.png").convert("L").resize(rgb.size, Image.NEAREST); M = np.asarray(m) > 127
    # tone: the satellite water is much darker; scale it (per channel) to the aerial's water median
    gain = np.median(A[M], axis=0) / np.maximum(np.median(Wm[M], axis=0), 1); Wm = Wm * gain
    # level: block medians (~LEVEL_KM) → smooth gain toward the global median, so a sediment front doesn't become a dark pool
    if LEVEL > 0:
        B = max(16, round(LEVEL_KM * 1000 / (0.23 * 87900 / rgb.width))); Hh, Ww = M.shape; bh, bw = -(-Hh // B), -(-Ww // B)
        gmed = np.median(Wm[M], axis=0); med = np.full((bh, bw, 3), np.nan, np.float32)
        for j in range(bh):
            for i in range(bw):
                blk = M[j*B:(j+1)*B, i*B:(i+1)*B]
                if blk.mean() > 0.15: med[j, i] = np.median(Wm[j*B:(j+1)*B, i*B:(i+1)*B][blk], axis=0)
        hole = np.isnan(med[..., 0])
        while hole.any():                                                  # fill land blocks from their water neighbours
            pad = np.pad(med, ((1, 1), (1, 1), (0, 0)), constant_values=np.nan)
            nb = np.stack([pad[1+dy:bh+1+dy, 1+dx:bw+1+dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx])
            with np.errstate(all="ignore"): fill = np.nanmean(nb, axis=0)
            med[hole] = fill[hole]; hole = np.isnan(med[..., 0])
        local = np.asarray(Image.fromarray(np.clip(med, 0, 255).astype(np.uint8)).resize((Ww, Hh), Image.BICUBIC)).astype(np.float32)
        Wm = Wm * (1 + (np.clip(gmed / np.maximum(local, 1), 0.5, 2.0) - 1) * LEVEL)
    F = np.asarray(m.filter(ImageFilter.GaussianBlur(3)), np.float32)[..., None] / 255   # feathered shoreline
    sp = D.parent / "structures.png"
    if sp.exists(): F = F * (1 - np.asarray(Image.open(sp).convert("L").resize(rgb.size, Image.BILINEAR).filter(ImageFilter.GaussianBlur(1)), np.float32)[..., None] / 255)
    rgb = Image.fromarray(np.clip(A * (1 - F) + Wm * F + 0.5, 0, 255).astype(np.uint8))
    source = f"{info['source']} (land) · {wmeta['source']} (water)"
    print(f"water: {WATER_FROM}, tone gain {np.round(gain, 2).tolist()}, level {LEVEL} @ {LEVEL_KM} km, bridges {'kept' if sp.exists() else 'none'}")

base = ImageOps.autocontrast(rgb, cutoff=0.5).filter(ImageFilter.GaussianBlur(BLUR))
out = ImageEnhance.Contrast(ImageEnhance.Color(base).enhance(SAT)).enhance(CON)
out.save(D / "color-muted.jpg", quality=85, optimize=True, progressive=True)
recipe = f"saturation {SAT} · contrast {CON}" + (f" · water {WATER_FROM} level {LEVEL}" if WATER_FROM else "")
(D / "photo.json").write_text(json.dumps({"bbox": info["bbox"], "width": out.width, "height": out.height, "resM": round(info["resM"] * Image.open(D / "source.jpg").width / out.width, 2),
    "source": source, "generated": datetime.datetime.now().isoformat(timespec="seconds"), "default": "color-muted",
    "variants": [{"id": "color-muted", "file": "color-muted.jpg", "tone": "dark", "recipe": recipe, "color": True}]}, indent=1))
print(f"wrote {D / 'color-muted.jpg'} ({(D / 'color-muted.jpg').stat().st_size // 1024} KB) · {recipe}")
