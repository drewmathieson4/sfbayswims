# Architecture

`index.html` loads `js/planner/main.js`; `frame/index.html` loads `js/frame/main.js`.
Each calls `engine/boot.js`, which mounts a world and starts the runtime.

## Engine

- `boot`: URL/config composition, view sizing, activation, switching, optional preloading.
- `world`: cached geometry/routes and mutable prediction series; requested-year loading and coverage.
- `runtime`: data refresh, physics recompute, animation, prediction-range loading, deterministic test hooks.
- `state`: observable state; `bumpData` invalidates physics, `updateObservations` only updates weather/UI.
- `data`, `tide`, `current`, `stationfield`: source adapters, Pacific time, prediction series and fields.
- `projection`, `geometry`, `mask`, `routes`: coordinates, land/water classification, route construction and smoothing.
- `swim`: leg/route integration, swept profiles, candidate starts and automatic windows.
- `animate`, `particles`, `photo`, `map`: swimmer/breadcrumbs, streak canvas, georeferenced aerial, SVG helpers.
- `format`, `sun`, `show`, `input`, `health`, `debug`, `paths`, `validate`: shared leaf utilities.

Config composition: defaults ← world config ← app overrides ← URL flags. The CONFIG object remains stable.
World geometry and station weights are cached; loading another year updates series without rebuilding the map.
Coverage is tracked as contiguous bundle intervals, preventing a missing year from being treated as interpolatable.

## Apps

Planner: `panel` handles inputs, results, settings and favourites; `hud` conditions; `timeline` background and
moving markers; `starts` cancellable chunked searches; `draw` custom routes; `legs` breakdown/route colours;
`probe`, `keys`, `share`, `report`, `dom` handle pointer, keyboard, URLs, diagnostics, and safe text nodes.

Frame: `presets`, `cycle`, `button`, `overlay`, `kiosk`, `ambient` handle configuration, sequencing, gestures,
labels, unattended behavior, and timestamped light-sensor readings.

## Data preparation and hardware

`_common` provides HTTP helpers; `_world` world paths/CLI helpers; `_bundles` validates full-year coverage,
station rosters and values, and publishes atomically. `check_bundles` checks current coverage; `refresh_bundles`
regenerates only invalid/missing/due bundles using `precompute_tides` and `precompute_currents`.

Geometry: `fetch_shoreline` → `build_zones` for Cove; `build_mask` and its Overpass caches for Bay.
Imagery: `fetch_aerial`; Bay also uses `fetch_sentinel` → `stylize`. `fetch_stations` discovers station metadata;
`climatology` prepares fallback temperatures. `build_site` stages the runtime deployment allowlist.

`tools/serve.py` serves locally and maps `/ambient.json` to the Pi sensor file. `tools/pi` contains the installer,
four systemd units, daily refresh cron, sensor reader, Wi-Fi reset listener, and one-button Pico firmware.
The Pi installation excludes test dependencies and deployment output.

Tests live in `tests`: Node physics/input checks, Python bundle/publishing checks, Playwright app smoke/regression
checks. Runtime remains dependency-free. The Pages workflow runs verification before deployment.
