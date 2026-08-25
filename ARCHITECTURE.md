# Architecture — a walk through every file

Two products share one **engine** (`js/engine/`): the Planner (`index.html` → `js/planner/main.js`) and the Frame
(`frame/index.html` → `js/frame/main.js`). No build step, no dependencies. See `SPEC.md` for the products. Data lives under `data/`, prepared by the Python scripts under `tools/`. Everything is metres: each world
has a local origin, positions are metres east/north of it, and the SVG's user units are metres too (so a 30 m
swimmer glyph in the Bay is literally `dotR: 30`).

```
index.html ─ js/planner/main.js
frame/index.html ─ js/frame/main.js
                         ├─ js/engine/boot.js ─┬─ world.js ───┬─ geometry.js / mask.js      grid + zones (cove) | water-mask PNG (bay)
                         │                     │              ├─ routes.js                  waypoints → metre polylines, pier-following
                         │                     │              ├─ photo.js · map.js          the aerial <image>; SVG layers
                         │                     │              └─ current.js / stationfield.js   the two current fields
                         │                     └─ runtime.js ─┬─ data.js · tide.js          live NOAA/USGS/NWS + bundles; tide extremes
                         │                                    ├─ swim.js                    the physics: crab, sprint, sweep, 48-h scan
                         │                                    ├─ animate.js · particles.js  the swimmer; the streaks
                         │                                    └─ debug.js                   current arrows, station dots (key d)
                         ├─ js/planner/ panel · hud · timeline · probe · keys · share   the Planner's UI
                         └─ js/frame/ presets · cycle · button · overlay · kiosk · ambient   the Frame's
   js/engine/ config.js · state.js · projection.js · paths.js · format.js · show.js · input.js are leaves everyone imports.
```

## 1. Boot and state

**`index.html`** — the Planner's skeleton: a `#map` with three stacked layers (the photo SVG, the streak canvas, the
drawing SVG) and the HUD corners inside it, the panel, the timeline strip, the footer line and the settings sheet.
Everything is filled by JS. `frame/index.html` is the Frame's: the map, three labels, a scrim and the fade layers.

**`css/engine.css`** — one dark palette in `:root` (white ink on black; the photos are dark-toned and a dark ground
avoids a white flash on the nightly reload), the map layers, the swimmer's classes, the `no-swimmer / no-streaks`
switches and the kiosk cursor rule. Four custom properties are set from config at boot (`--photo-filter`,
`--route-done-w`, `--swimmer-r`, `--ui-scale`). **`css/planner.css`** — the Planner's panel, HUD corners, timeline and
sheet (a bottom sheet on phones); **`css/frame.css`** the Frame's labels and fades.

**`js/planner/main.js`** — the Planner's entry: settings from `localStorage` (`plan.settings`: units, layers, the
advanced physics knobs) as a CONFIG override, `boot()`, direction twins for every one-way or loop swim
(`reverseRoute`, unless `routes.json` names one with `reverseOf`), then the HUD, panel, timeline, probe and keys.

**`js/engine/boot.js`** — boots the engine for a page. Parses the URL flags; composes `CONFIG` (defaults ← the
world's patch ← the app's `overrides` ← URL flags, re-applied after every world switch); sizes the view (`applyView`:
one viewBox in metres shared by both SVGs, the canvas at device resolution — re-run by a ResizeObserver); loads
`data/worlds/index.json`; starts `runtime.js`; returns `{ services, live, activateFirst, switchWorld, nextWorld }`.
`activate()` builds and mounts a world and calls the app's `onActivate(world)` (titles, memory); `switchWorld()` /
`nextWorld()` (the `v` key) save the current route, load the other world's folder (cached), unmount, rebuild, mount.
The other world is preloaded 5 s after boot so the switch is instant. `window.APP` exposes state and the services for
the console and the test hooks. **`js/engine/paths.js`** resolves `data/` against the engine's own URL so a page in a
subfolder (`frame/`) loads the same data.

**`js/engine/config.js`** — every tunable, with a comment each. The cove *is* the defaults; `data/worlds/bay/world.json →
config` patches this object in place (origin, view, 150× tempo, particles, `dotR`). Sections: pace, origin/view/grid,
stations, `current` (the cove model + the flood/ebb axis the Bay uses), `swim` (floor, sprint), particles, `anim`
(tempo, the swept-away timings, the thrash), `scrub` (time travel), refresh, kiosk, ambient, offlineHint, photo,
route, swimmer, trace, show, hud, `debugCurrentKn` (`?kn=`).

**`js/engine/state.js`** — a 30-line observable store: `state` (the clock, `selectedTime` while time-travelling, `swimming` + `swimAt`, route,
pace, show-flags, the fitted view, live data with a `version`, the physics results), `set(patch)` notifying
`on(key)` listeners, `effectiveTime()` (selected or now), `displayTime()` (the swimmer's moment while a swim plays, else that), `physicsTime()` (per minute), `bumpData()` (bumps the
version so the fields drop their cached frame).

**`js/engine/world.js`** — worlds. `loadWorld(id)` fetches the folder in parallel (world.json, landmarks, routes,
photo.json, this and next year's current bundles, shoreline+zones or mask+meta, stations) and caches it.
`applyWorldConfig()` resets `CONFIG` to the defaults, layers the world's patch, then the URL flags — in place, so
every module's reference stays valid. `buildWorld()` builds projection → geometry → routes → extent → field once
per world id (cached: the Bay's 140 k-cell lattice and mask decode happen once), and creates the DOM-bound photo and
SVG layers every time. With `?debug=1` it also checks every leg against the water mask (route authoring).

## 2. Physics and geometry

**`js/engine/projection.js`** — the local tangent plane (`createProjection(origin)`: lat/lon ↔ metres, x east, y north),
`fitView` (expand an extent to the screen's aspect), `toPx`, `viewBoxOf`, extent helpers.

**`js/engine/geometry.js`** — zone worlds (the cove). Turns `shoreline.geojson` (OSM piers, breakwater, beach,
clubhouses, ships) and `zones.json` (cove / harbor / land polygons + the openings) into metres, classifies a
5 m grid (`LAND / COVE / BAY / HARBOR`), and precomputes the cove model's per-cell shelter factor and fill
direction. `cellIndex` / `isWater` are the grid contract everyone uses.

**`js/engine/mask.js`** — mask worlds (the Bay): decodes `mask.png` (255 = water, 10 m cells) into the same grid contract.

**`js/engine/routes.js`** — `routes.json` + `landmarks.json` → routes in metres. Waypoints are landmark ids, inline
points, or **follow steps** that trace an offset curve along a pier (`offsetRing`: per-edge offsets, round joins,
Chaikin smoothing; `arc`/`fullRing`/`tangentTrim` choose and trim the arc). Loops close, out-and-backs expand and
are shifted right (`keepRight`) so the lanes don't overlap. The drawn `points` keep every vertex; the physics
`legs` are a decimated polyline (a vertex every ≥ 8 m, on an 8° bend, or at a named waypoint). The path is smoothed
first (`smoothPath`: resampled every `route.turnRadiusM`/5 and averaged over ±`turnRadiusM`/2 along the path — 10 m in
the cove, 150 m in the Bay — with any point that would land on shore kept in place), and `positionAt` interpolates the
heading, so the swimmer's position and heading are continuous at any tempo.

**`js/engine/tide.js`** — `TideSeries`: NOAA hi/lo extremes → the rate of rise/fall by cosine interpolation (what the
cove's fill/drain needs), `heightAt`, `next` (the next extreme), `covers`, `merge` (bundle + cache + live).

**`js/engine/current.js`** — `CurrentSeries` (station vectors over time, from live samples or a compact year bundle) and
the **cove field**: `prepare(t)` fetches the outside current (live window → bundle → derived from the tide) and the
tide rate for the moment (cached per 30 s and per data version); `sampleInto(x, y)` applies shelter × outside +
fill/drain + the Opening eddy; `reference(t)` is the HUD's number (the current at the Opening).

**`js/engine/stationfield.js`** — the **Bay field**, same interface: per lattice cell the 5 nearest stations and their
inverse-distance weights (computed once); `prepare(t)` evaluates all 43 station series; `sampleInto` blends them;
`reference(t)` reads the Alcatraz station. A station whose bundle ends clamps to its last value (flagged ≈).

**`js/engine/swim.js`** — the physics. `integrateLeg`: 10 m steps; at each, the crab solution `g = √(v² − c⊥²) + c∥`;
if the line can't be held at the normal pace and the sprint reserve allows, sprint (`effort 0.5`); if even that
fails the leg is *swept* and the route ends there. `integrateRoute` threads the reserve through the legs and, for a
swept route, appends `sweepFrom`: a fight (sprinting into the current while the reserve lasts), tiring over
`sweptFightS`, then carried. The result is a profile (`t, x, y, hdg, effort` arrays) that `positionAt` interpolates.
`scanWindows` integrates a route every 30 min over 48 h for the next/best feasible start; `scanStarts` does a batch of
given starts (the planner's search); `slackNear` finds the nearest slack of the reference current.

## 3. Rendering, UI, live data

**`js/engine/runtime.js`** — the running engine. Live data: bundles → localStorage cache → NOAA/USGS/NWS refresh loops (tides,
currents, water temperature with its fallback chain, wind), the kiosk's offline hint. Per world: `mount`/`unmount`
(particles + swimmer). Physics: `markDirty` (120 ms debounce) → `recompute()` re-integrates every route at the
current minute, hands the selected route's profile to the swimmer, and — for an infeasible Bay route — schedules
the memoised 48-h scan. The rAF loop (optionally fps-capped) steps the streaks at `displayTime()` and, while a swim plays
(`state.swimming` — ▶ start / space; any route, view, pace or time change stops it), the swimmer, publishing their
moment as `state.swimAt` so the clock, the current reading and the streaks follow the swim; a swim keeps its start
minute until it ends. Apps hook the loop with `onTick(fn(dt, force))` (the rail's elapsed/speed). `?frames=` / `stepFrames()` are the test hooks for an
occluded tab.

**`js/engine/debug.js`** — the debug overlay (`d` / `?debug=1`): current arrows on a grid, station dots, the water mask with
`?mask=1`, a status line — on a canvas created on demand.

**`js/engine/animate.js`** — the swimmer: the tapered glyph (or a dot) rotated to the crab heading, arms stroking at a
rate that rises with `effort`, breadcrumbs every `crumbEveryS` (appended, not rebuilt) as the trace — `trace.mode` can
add a comet tail or an ink line, off by default — and the swept-away playback: fight at full opacity, then fade, pause; `step()` then reports the lap over and the
swimmer waits at the start.

**`js/engine/particles.js`** — the streaks: N particles (sized to the water area in view) stepping with the field,
trails fading on a transparent canvas, dead ones respawning in water cells; seedable for reproducible frames.

**`js/engine/photo.js`** — the aerial: places the `<image>` from `photo.json`'s bbox in metres and picks the default variant.

**`js/engine/map.js`** — `el()` for namespaced SVG elements and the two layer groups (`#route`, `#swimmer`).

**`js/engine/data.js`** — every network call (NOAA CO-OPS tides/currents, USGS water temperature with fallbacks, NWS /
Open-Meteo wind), the Pacific-time helpers (station times are Pacific local; the app renders Pacific regardless of
the device), the localStorage cache, the bundle loader and the climatology lookup.

**`js/planner/hud.js`** — the map's corners: wordmark, spot, the clock line ("current", the selected time, or
"swimming · time"), water (°F/°C), the current with `≈` and its station, wind, the tide (height now, next high/low).

**`js/planner/panel.js`** — the panel: spot buttons, the swim list (one entry per swim; twins reached by the direction
toggle), start (datetime in Pacific via `localToEpoch`, now, ±), pace (`parsePace` in the chosen units, presets,
*Advanced*: sprint reserve, swept floor → CONFIG.swim + `bumpData`), the result card (distance, time, finish, the
strongest current met — sampled along the profile — swept note, best/next, elapsed/speed, ▶ preview + tempo slider),
copy link, the settings/about sheet (units, layers, keys, sources, disclaimer). `startStop()` for ▶ and the space bar.

**`js/planner/timeline.js`** — the 48-h strip from the selected day's midnight: reference current every 6 min
(flood up / ebb down), slack ticks, night from `sun.js`, the swim bar (red from the swept point), now, the playhead;
drag or tap sets the start. **`probe.js`** — the current under the pointer (hover / tap) at `displayTime()`.
**`keys.js`** — the keys. **`share.js`** — the plan as a URL (`planUrl`) and units from a link (`readPlan`).
**`legs.js`** — the legs table (segments between named waypoints from the physics legs; the current along/across sampled
over each) and the route coloured by ground speed on the map. **`starts.js`** — best starts: `scanStarts` in chunks
over the next n tide cycles (745 min each, every 15 min) or a date, for this swim or every swim from `routes.json`,
ranked, filtered (daylight via `sun.js`, duration, weekends), with `slackNear` for the slack relation; memoised.

**`js/engine/format.js`** · **`show.js`** · **`input.js`** · **`sun.js`** — number formatting in the chosen units
(`setUnits`: yards/miles or metres/km, pace per 100 yd or m, °F/°C); the switches (`state.show` → html classes); when a
person last touched the app; sunrise, sunset and civil twilight (NOAA's algorithm).

**`js/frame/kiosk.js`** — `kioskMode` (idle cursor, drift back to current, wake lock, the nightly reload).

**The Frame** (`frame/index.html`, `css/frame.css`, `js/frame/main.js`) — boots the engine with the presets as a
CONFIG override and `runtime: { playOptions, windowScan: 'infeasible', followSwimmer }`. **`presets.js`** loads
`data/frame.json` ← `frame.local.json` ← URL flags and persists the switches; **`cycle.js`** plays the view's swims
in turn (each re-integrated at the current minute, scaled by `playOptions` to `swimSeconds`; finish → `html.fading`
(hold + fade in CSS) → the runtime's end pause resets the swimmer unseen → rest → next; quiet hours; a once-a-second
watchdog); **`button.js`** decodes click / double / triple / hold from the Pico's held `b`, the space bar or the
pointer; **`overlay.js`** renders the title, the conditions line at `displayTime()` and the caption. `animate.js`
takes per-swim play options (`realSeconds`, `sweptRealSeconds`, `crumbsPerSwim`) from
`setRoute(prof, opts)`.

**`js/frame/ambient.js`** — kiosk only: polls `/ambient.json` (the Pi's light sensor) and eases a black overlay and a
warm tint so the frame dims like a print as the room darkens.

## 4. Data and tools

`data/` — see the README's layout. Hand-authored: `index.json`, `world.json`, `landmarks.json`, `routes.json`,
the cove's `photo.json`. Generated by the tools below (the README lists the order). Overpass replies
(`coastline.json`, `piers.json`, `bridges.json`) and both `source.jpg` are build inputs the app never fetches.

| tool | makes | notes |
|---|---|---|
| `_common.py` | — | shared: retrying `get_json`, `http_range`, `coops()`, `overpass(query, cache)`, Pacific time |
| `_world.py` | — | shared: world folders, `opt/flag`, the metres-per-degree constants, `lattice()` |
| `fetch_shoreline.py` | cove `shoreline.geojson` | the cove's OSM piers, breakwater, beach, clubs, ships |
| `build_zones.py` | cove `zones.json` | hand-picked OSM vertices → cove / harbor / land polygons + the openings |
| `fetch_aerial.py` | `photo/source.jpg` | NOAA 2025 COGs by HTTP range (cove) or tiled NAIP exports (Bay), resampled onto the lattice |
| `build_mask.py` | bay `mask.png`, `mask.json`, `structures.png` | OSM coastline chained and closed, islands, piers; bridges for the compositor |
| `fetch_sentinel.py` | bay `photo/water-<date>.jpg` | Earth Search STAC → the pass's true-colour COGs on AWS, one seamless water image |
| `stylize.py` | bay `photo/color-muted.jpg`, `photo.json` | satellite water tone-matched and levelled under the aerial's land and bridges, then contrast/saturation |
| `fetch_stations.py` | bay `stations.json` | the NOAA current stations in the bbox, their type/bin/axes |
| `precompute_currents.py` | `currents-YYYY.json` | a year of predictions: the cove's station (6-min) or every Bay station (30-min; subordinate stations resampled from max/slack events) |
| `precompute_tides.py` | `tides-YYYY.json` | a year of tide extremes |
| `climatology.py` | `watertemp-climatology.json` | ~20 years of USGS Alcatraz temperatures → a day-of-year mean |
| `serve.py` | — | the production server: threaded, revalidating, `/ambient.json` mapped to the sensor file |
| `pi/` | — | the frame: `install.sh`, four systemd units, comitup config, `ambient.py`, `wifi_reset.py`, the Pico firmware, the December cron |
