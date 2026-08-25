# Aquatic Park — swim conditions

An aerial view of Aquatic Park Cove (San Francisco) showing the tidal current as drifting streaks, the water
temperature, and five swim routes. For each route a swimmer loops the course at time-compressed speed while the
rail shows the distance and the estimated time *under the conditions at the selected moment*. Hold an arrow key to
travel through the coming days and watch the estimates and the streaks change.

A second view (`v`), **San Francisco Bay**, zooms out to the Golden Gate → Bay Bridge with the long swims — Alcatraz,
Escape from Alcatraz, the Golden Gate, Golden Gate → Aquatic Park, Bridge to Bridge both ways, Round Angel Island,
Angel Island → Aquatic Park — over a current field blended from 43 NOAA stations. When a swim can't be held against
the current the rail says so, names the next and best start in the coming 48 h, and the swimmer is swept away.

Made as a wedding gift for Jean Marc. `ARCHITECTURE.md` walks through every file.

## Run it

No build step, no server code — any static file server:

```
python3 tools/serve.py 8000          # or: python3 -m http.server 8000
open http://localhost:8000
```

**Controls:** tap / click the map (or `↓` `↑`) — next / previous route · `←` `→` — travel in time: a tap moves
5 minutes, holding accelerates to a day every few seconds; the top-left corner reads *current* on the live clock,
otherwise the date and time · `n` / `Esc` — back to current · **`v`** — switch view (each view remembers its
route) · `space` — pause the swimmer · `i` — swimmer glyph ↔ white dot with a beacon · `[` `]` — animation slower /
faster (the multiplier shows next to *elapsed*) · `-` `+` — pace ±1 s per 100 yd · `a` `s` `u` — swimmer / streaks /
UI overlay on or off · `p` — photo mode (swimmer and overlay off together) · `d` — debug overlay (current arrows,
stations; add `?mask=1` for the water mask). The rail's **speed** row is the swimmer's ground speed right now as time
per 100 yd, whole seconds — it changes with the current along the route. While time-travelling the water temperature is tagged *now* and the wind is
hidden (`hud` in config).

**URL flags:** `?world=bay` · `?route=cw` · `?t=2026-09-01T14:00-07:00` (freeze the time) · `?kiosk=1` (no cursor,
wake lock, nightly reload, remembers the view, drifts back to *current* after 10 idle minutes) · `?fps=30` ·
`?pace=1:45` · `?static=1` (still photo) · `?swimmer=0` `?streaks=0` `?ui=0` · `?still=1` (zero current) ·
`?kn=2.5` (force a uniform current: + flood, − ebb) · `?offline=1` (bundles only) · `?debug=1` ·
`?frames=90&seed=1` (test hook: render 90 frames and freeze — the way to check the app in an occluded tab).

## Layout

```
index.html  css/style.css  js/            the app (20 ES modules, no dependencies)
data/tides-2026.json                      the year's tide extremes (shared)
data/currents-2026.json                   the cove's outside current, SFB1204, 6-min
data/watertemp-climatology.json           day-of-year water temperature (fallback)
data/worlds/index.json                    { default, worlds } — `v` cycles this list
data/worlds/cove/   world.json shoreline.geojson zones.json landmarks.json routes.json photo/{source.jpg, source.json, photo.json}
data/worlds/bay/    world.json mask.png mask.json structures.png stations.json currents-2026.json landmarks.json routes.json
                    photo/{source.jpg, water-2025-05-10.jpg, color-muted.jpg, *.json}   coastline.json piers.json bridges.json (Overpass caches)
tools/              the data-prep scripts (Python 3, stdlib + Pillow + numpy) and tools/pi/ for the picture frame
```

Hand-authored, not generated: `index.json`, each `world.json`, `landmarks.json`, `routes.json`, and the cove's
`photo.json` (the cove ships its aerial untouched, so it points at `source.jpg`). Every constant lives in
`js/config.js`; a world's `world.json` → `config` patches it (the Bay's tempo, particles, swimmer size…).

## Editing routes

`landmarks.json` holds routing points (never drawn); `routes.json` lists waypoints as landmark ids, inline
`{lat, lon}` points, or — in the cove — **follow steps** `{ "follow": "muni" | "breakwater" | "hyde", "via": "<landmark>" }`
that hug a structure 15 m off its OSM outline (`route.followOffsetM`). `loop: true` closes the route;
`oneWay: true` is point-to-point; anything else is an out-and-back, shifted right (`route.keepRightM`) so the
lanes don't overlap. Bay routes are straight legs; Aquatic Park finishes go `off_opening → opening → cove_mid →
gate → start`, and the Round Angel Island ring is the island's outline pushed 150 m offshore. Add `?debug=1` while
editing: the boot check warns about any leg that crosses land.

## The physics (honest version)

**Currents.** Cove: NOAA's prediction for the station 1 km outside the Opening, leaking in with a shelter factor
that decays with distance from the Opening, plus the tidal fill/drain through the gaps and an intrusion eddy — a
model, not a measurement (`config.current`). Bay: each station's prediction blended by inverse distance (5 nearest,
power 2) on a 40 m lattice, masked to water; between stations it's a smooth blend, not hydrodynamics. The HUD reads
one honest number — the Opening (cove) or the Alcatraz station (Bay).

**Swim times.** The swimmer crabs to hold each leg's line: ground speed `g = √(v² − c⊥²) + c∥`. Where the normal
pace (1:45/100 m) can't hold the line they sprint at 1:00/100 m from a 60 s reserve that refills while swimming
easy — a short strong stretch is swum through and the route is simply feasible. A route shows `—` only when even
sprinting can't complete it; then the swimmer fights the current while the reserve lasts, tires, is carried off and
fades, and starts again. In the Bay an infeasible route also gets a 48-hour scan for the next and best start.

## Data sources (free, key-less, called from the browser)

| What | Source |
|---|---|
| Tide extremes | NOAA CO-OPS 9414305 North Point / Pier 41 |
| Cove current (live) | NOAA CO-OPS SFB1204 "Alcatraz Island, SW of", bin 18, 6-min speed/direction |
| Bay currents | NOAA CO-OPS predictions for 14 harmonic stations (30-min) + 29 subordinate `PCT…` stations (max/slack events resampled on a cosine) |
| Water temperature | USGS 374938122251801 "SF Bay at NE shore Alcatraz Island" (fallbacks: USGS IV, USGS Pier 17, NOAA 9414290, CeNCOOS Tiburon, then the climatology, shown with ≈) |
| Wind | NWS FTPC1 (Fort Point); fallback Open-Meteo |
| Cove photo | NOAA NGS 2025 orthoimagery of San Francisco, 0.25 m, public domain — shipped untouched at 0.44 m |
| Bay photo | land: USGS NAIPPlus (NAIP 2022, 0.6 m, public domain) · water: Copernicus Sentinel-2 L2A, 2025-05-10 pass, 10 m (contains modified Copernicus Sentinel data 2025) |
| Water mask, Bay | OpenStreetMap coastline + islands + piers + bridges via Overpass (© OpenStreetMap contributors, ODbL) |

Nothing is attributed on screen by design; it lives here and in the tools.

## Rebuilding the data

In this order (network-heavy steps marked); every step is idempotent and the caches make the mask rebuild offline.

```
python3 tools/fetch_shoreline.py                                  # cove/shoreline.geojson            (Overpass)
python3 tools/build_zones.py                                      # cove/zones.json
python3 tools/fetch_aerial.py                                     # cove/photo/source.jpg  NOAA 2025   (~150 MB of tiles)
python3 tools/build_mask.py --world bay                           # bay/mask.png mask.json structures.png (Overpass, cached)
python3 tools/fetch_aerial.py --world bay                         # bay/photo/source.jpg   NAIP 2022
python3 tools/fetch_sentinel.py --world bay --list                # cloud-free Sentinel-2 dates covering the Bay
python3 tools/fetch_sentinel.py --world bay --date 2025-05-10     # bay/photo/water-2025-05-10.jpg
python3 tools/stylize.py --world bay --water-from water-2025-05-10.jpg --contrast 1.3 --saturation 0.8   # bay/photo/color-muted.jpg
python3 tools/fetch_stations.py --world bay                       # bay/stations.json                (NOAA)
python3 tools/precompute_currents.py --world bay 2026             # bay/currents-2026.json           (NOAA, ~4 min; --only A,B re-fetches stations)
python3 tools/precompute_tides.py 2026                            # data/tides-2026.json             (NOAA)
python3 tools/precompute_currents.py 2026                         # data/currents-2026.json          (NOAA)
python3 tools/climatology.py                                      # data/watertemp-climatology.json  (USGS, ~20 years)
```

The picture frame's yearly cron runs the three bundle steps for the coming year every December.

## The picture frame

`README-frame.md`: flashing the Pi, `tools/pi/install.sh`, the Pico button board, Wi-Fi setup, the light sensor.
