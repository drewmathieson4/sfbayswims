# Data and maintenance

Both apps use committed tide/current predictions and imagery. See [SOURCES.md](SOURCES.md) for provenance.
`python3 tools/check_bundles.py` reports actual coverage; dates in documentation are not the source of truth.

## Runtime

- Current bundles load for the requested Pacific calendar years. Current-year data is cached per world; additional
  years update those series. Missing/invalid station bundles do not count toward coverage.
- Cove uses a live prediction window when available, then bundled predictions, then a tide-derived model.
- Bay blends 43 station series and may patch the reference station with its live prediction window.
- `≈` marks bundled/derived current values, approximate temperatures, or stale readings as applicable.
- Tide/current live windows refresh every 30 minutes with a six-hour cache policy. Water refreshes every ten minutes,
  wind every fifteen, with 12-second request timeouts and fallback sources.
- Water fallback: USGS Alcatraz → USGS IV → USGS Pier 17 → NOAA → CeNCOOS Tiburon → bundled climatology.
- Wind: NWS Fort Point → Open-Meteo. Wind/temperature updates do not trigger physics recomputation.
- Best-start searches require prediction coverage through each finish and cancel when relevant inputs change.
- The locally served Pi works without upstream connectivity. The website has no service worker/PWA asset cache.

## Validate and refresh

```sh
python3 tools/check_bundles.py
python3 tools/refresh_bundles.py --dry-run
python3 tools/refresh_bundles.py
```

Validation requires the current year's files, every expected Bay station, matching finite arrays, and full-year
coverage. Upcoming data extends the horizon only when it overlaps current coverage. Old expired files do not
trigger alarms. Invalid next-year files are repaired even when the current year still has enough runway.

The driver refreshes when current data is missing/invalid or upcoming coverage is needed within 120 days. A failure
or coverage below 45 days exits nonzero. Individual generators validate before an atomic replacement, so failed
station fetches cannot replace a working bundle with a partial year. Continuous NOAA generation uses UTC timestamps
to avoid daylight-saving ambiguity and rejects gaps rather than substituting zero current.

CI runs quarterly; the Pi runs the same driver daily at 03:00 (network fetches occur only when due).
The installer preserves existing generated bundles and local presets. Run the driver to repair invalid preserved data.

Manual generation:

```sh
python3 tools/precompute_tides.py 2027
python3 tools/precompute_currents.py 2027
python3 tools/precompute_currents.py --world bay 2027
```

`--only ID,ID` repairs selected Bay stations, but publication still requires a complete valid roster.
Tide requests are split to respect the request-span cap.

## Rebuild assets

Pillow and numpy are only needed for imagery/mask tools. Commands and source recipes are retained in the scripts'
docstrings and the archived README. Rebuild order: shoreline → zones; Bay mask; aerial → optional Sentinel → stylize;
station metadata → current bundles; tides and climatology independently.

The Bay source aerial, Sentinel image, structure mask and Overpass caches are reproducibility inputs. They stay
in the repository but are excluded from `build_site.py` output. The Cove's `photo/source.jpg` is a runtime asset.
