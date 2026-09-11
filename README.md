# SF Bay Swims

Two apps share one engine: the swim **Planner** at `/` and the picture **Frame** at `/frame/`.
The Planner estimates swim times for Aquatic Park and San Francisco Bay. The Frame is a wedding gift:
an aerial photograph with drifting currents, quiet labels, an optional swimmer, a button, and an endless dial.

## Run

```sh
python3 tools/serve.py 8000
```

Open `http://localhost:8000` or `http://localhost:8000/frame/`. Both apps use native JavaScript modules;
there is no frontend build step or runtime package dependency. Python's standard library is sufficient to serve them.

## Planner

Choose a spot, swim, direction, Pacific start time, and pace. The result shows distance, estimated duration,
finish, daylight, and current. Preview follows the swimmer through changing tidal conditions.
Legs, best-start searches, custom route drawing, saved plans, and shared links are available in the panel.
Advanced pace settings control sprint reserve and the minimum ground speed.

Keys: arrows change time/swim, `r` reverses, `n` returns to now, space previews/pauses, `s` toggles streaks,
`c` toggles current arrows, `l` opens legs, `-`/`+` adjust pace, `v` switches spots, `?` opens settings.

Shared/custom plans accept at most 100 waypoints within the chosen spot and at most 100 km between waypoints.
Pace must be 0.1–5 m/s. Names are plain text. Saved plans stay in the browser.

## Frame

Each swim lasts **60 seconds** by default, then holds for one second, fades for one second, and rests for two.
The default is live currents without a swimmer. The dial scrubs time (arrow keys or mouse wheel online).
Single press restores live time; double press toggles swimmer mode, where the dial chooses a repeating swim.
Triple press toggles photograph-only mode; hold 0.6 seconds switches spots.
A small current forecast beneath the conditions shows flood above the baseline and ebb below it. Hardware installation and validation: [README-frame.md](README-frame.md).
Presets: `data/frame.json`, optional gitignored `data/frame.local.json`, and URL flags.

## Data and limitations

Currents are NOAA predictions. The Cove field models shelter, tidal filling, and an eddy; the Bay field blends
43 stations by distance. This is an estimate, not hydrodynamics. Wind is informational; waves, fog, shipping,
and swimmer fatigue beyond the simplified sprint model are not modeled. The app is not a navigation system.

Bundles support offline operation on the locally served Pi. A website visitor still needs the site's assets
available; this is not an installable offline PWA. Missing live water readings fall back to climatology.
Current/tide bundles load for the dates requested, including next year before November. Best-start results must
finish within coverage. The Planner does not preload the other spot; `?preload=1` opts in. The Frame preloads it.
Sources and refresh procedures: [DATA.md](DATA.md), [SOURCES.md](SOURCES.md).

## Development and verification

```sh
npm ci
npm test
# Local browser tests use installed Google Chrome. CI uses Playwright Chromium.
npm run test:browser
python3 tools/check_bundles.py
python3 tools/refresh_bundles.py --dry-run
python3 tools/build_site.py /tmp/sfbayswims-site  # destination must not exist
```

`npm` dependencies are for tests only. The staged site contains runtime assets, including the Cove's
`source.jpg`; it excludes the Bay's source imagery, Overpass caches, scripts, tests, and historical documents.
Those rebuild inputs remain in the repository. For imagery tools, install Pillow and numpy in a virtual environment.

The `test and publish` workflow verifies both apps and deploys the staged artifact on `main`.
**One-time hosting setup:** GitHub repository Settings → Pages → Source must be **GitHub Actions**.
Local changes do not change that setting or publish anything. The bundle workflow dispatches this verified deployment
workflow after a refresh; failed validation prevents publication.

Useful test flags: `?offline=1&seed=1&frames=60&t=2026-09-08T12:00:00-07:00`; frame tests add `persist=0`.
`APP.app.recompute()` and `APP.app.stepFrames(n)` allow deterministic checks in a hidden tab.

Current design: [SPEC.md](SPEC.md). Module map: [ARCHITECTURE.md](ARCHITECTURE.md).
Maintenance status: [HANDOFF.md](HANDOFF.md). Earlier designs: [docs/archive](docs/archive).
