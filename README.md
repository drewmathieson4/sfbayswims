# SF Bay Swims — swim conditions for Aquatic Park and the Bay

An aerial view of Aquatic Park Cove (San Francisco) showing the tidal current as drifting streaks, the water
temperature, and five swim routes. For each route it shows the distance and the estimated time *under the
conditions at the selected moment*; **▶ preview** sends a swimmer round the course at time-compressed speed, and
while they swim the clock, the streaks and the current reading follow *them* — a long swim shows the tide turning under
the swimmer. Drag the timeline or hold an arrow key to travel through the coming days and watch the estimates and the
streaks change.

A second view (`v`), **San Francisco Bay**, zooms out to the Golden Gate → Bay Bridge with the long swims — Alcatraz,
Escape from Alcatraz, the Golden Gate, Golden Gate → Aquatic Park, Bridge to Bridge both ways, Round Angel Island,
Angel Island → Aquatic Park — over a current field blended from 43 NOAA stations. When a swim can't be held against
the current it says so, names the next and best start in the coming 48 h, and the swimmer is swept away.

This is two products on one engine — the **Planner** (this page) and the wall-hung **Frame**
(`frame/` — the view's swims play in turn, 20 seconds each from now, with the water following the swimmer; one
button: click swimmer, double-click overlay, triple-click streaks, hold to switch view) — see [SPEC.md](SPEC.md)
and [README-frame.md](README-frame.md).

Made as a wedding gift for Jean Marc. `ARCHITECTURE.md` walks through every file.

## Run it

No build step, no server code — any static file server:

```
python3 tools/serve.py 8000          # or: python3 -m http.server 8000
open http://localhost:8000           # the Planner · http://localhost:8000/frame/ is the Frame
```

**The Planner** (`/`): pick a **spot** (Aquatic Park, San Francisco Bay), a **swim** and its direction (one-way and loop
swims can be swum the other way), a **start** (the date-time field, `now`, ±5 min / ±1 h, or drag the playhead on the
timeline strip along the bottom), and your **pace** (mm:ss per 100 yd or 100 m; *Advanced* exposes the sprint reserve
and the ground speed below which the swimmer is swept). The result card shows the distance, the estimated time, the
**finish in clock time**, the strongest current met and where, *too much current* with the next and best start in
48 h when a swim can't be made, and **▶ preview** — the swimmer plays the swim with the clock, streaks and current
following them (the slider sets the speed). The top-right corner reads the water temperature, the current at the
Opening (cove) or the Alcatraz station (Bay) with `≈` when a station runs on its bundled prediction, the wind, and the
tide with the next high or low. A **daylight** row shows sunrise–sunset and flags a swim that starts before dawn or
finishes after dusk. **Legs** (key `l`) breaks the swim down waypoint to waypoint — distance, time, pace, the current
along (+ helps) and across — and the route on the map is coloured by ground speed (red where the swimmer crawls, green
where the current helps; hover a row to highlight its leg). **Best starts** searches, on request, this swim or every
swim over the next *n* tide cycles, or a chosen date: the best start in each tide cycle (a start within half an hour
of it is nearly as good), in time order with the finish time, the slack relation and a daylight flag, the fastest in
bold; filters for daylight, maximum duration and weekends; click one to plan it.
**Draw a swim** (or *edit this swim* to start from an existing one): tap the water to add waypoints — a tap near a
landmark snaps to it — drag a marker to move one, choose one way / out and back / loop, name it; the swim is analysed as
you draw (time, finish, legs, best starts) and warns if a leg crosses land. It travels in the share link and in **Saved
plans**, which keep favourites in the browser. The **timeline** shows the reference current for 48 hours (flood above
the axis, ebb below), the tide height (dashed), slack times, night, the swim as a bar (red where swept) and *now*. Hover (or tap on a phone) anywhere on the
water for the current at that point and moment. *copy link* puts the whole plan in the URL; *settings · about* has
units, the map layers, the keys, the data sources and what the numbers do and don't mean.

**Keys:** `← →` start ±5 min (hold to accelerate; `⇧` for ±1 h) · `↑ ↓` swim · `r` the other way · `n` now · `space`
preview / pause · `s` streaks · `c` current arrows · `l` legs · `- +` pace ±1 s · `v` next spot · `?` the settings sheet.

**URL flags:** `?world=bay` · `?route=b2b_west` (a twin's id, e.g. `alcatraz~`, carries the direction) · `?wp=lat,lon;lat,lon…&mode=oneway|outback|loop&name=…` (a drawn swim) ·
`?t=2026-09-01T14:00-07:00` · `?pace=0.87` (m/s) or `?pace=1:45` (per 100 m) · `?units=m&temp=C` · `?offline=1`
(bundles only) · `?debug=1` · `?frames=90&seed=1` (test hook: render 90 frames and freeze).

## Layout

```
index.html  js/planner/  css/planner.css   the Planner: main, panel, hud, timeline, probe, keys, share
frame/index.html  js/frame/  css/frame.css  data/frame.json   the Frame: presets, cycle, button, overlay (+ kiosk, ambient)
js/engine/  css/engine.css                the shared engine: boot, runtime, worlds, fields, physics, swimmer, streaks, data (23 modules)
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
`js/engine/config.js`; a world's `world.json` → `config` patches it (the Bay's tempo, particles, swimmer size…).

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
fades, and returns to the start. In the Bay an infeasible route also gets a 48-hour scan for the next and best start.
Time advances along the swim: a Bay crossing started at 8:31 pm reaches the Gate hours later, in whatever the tide
is doing then — which is why, while a swim plays, the picture follows the swimmer rather than the clock.

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
