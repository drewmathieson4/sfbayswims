# Current product specification

The Planner and Frame are separate apps sharing geometry, fields, physics, data, and rendering.
The public Planner answers when a swim is feasible, its estimated time, and where currents affect it.
The Frame is a quiet framed aerial made as a gift. Keep its single-button interaction and uncluttered labels.

## Shared behavior

- Native JavaScript modules and static files; test dependencies never enter the browser runtime.
- Cove zone geometry and a sheltered current model; Bay water mask and a 43-station blended field.
- Route integration advances time along the swim, with crabbing, a bounded sprint reserve, and swept playback.
- Bundles load for requested dates. Fallback provenance and coverage remain visible.
- User input is bounded before entering geometry/physics; route names are text.
- Predicted best starts require coverage through the finish. Input changes cancel searches.
- Breadcrumbs remain in the Planner. Comet and ink trail modes have been retired.

## Planner

Spot, route/direction, start, pace, result, preview, legs, best starts, custom routes, saved plans, and sharing.
Desktop uses a left panel; phones use a bottom panel with expanded/collapsed states. Settings and provenance open
as sheets. The timeline spans 48 hours from the selected day's midnight; preview updates its moving markers.
The other spot loads on demand unless `preload=1`. Weather observations do not invalidate physics.

## Frame

Preset defaults: 60-second swim, 1-second hold, 1-second fade, 2-second rest, 6-second swept playback; no breadcrumbs.
Streaks follow the swimmer and continue between swims. The caption clears during rest.
Click toggles swimmer, double-click labels, triple-click streaks, hold 0.6 seconds switches views.
The Pico sends `b` while held and `w` once after eight seconds to reset Wi-Fi; GP2/GP3 are unused.
Optional quiet hours pause cycling; an all-infeasible skipped cycle backs off instead of busy-looping.
Ambient dimming requires fresh sensor timestamps. Missing/stale sensors restore full brightness.

## Maintenance

Regression checks cover physics, validation, sharing, coverage, atomic bundle publishing, and browser behavior.
The Pi and CI share a validated refresh driver. Publishing excludes rebuild inputs but preserves them in the repo.
Hardware validation is required before gifting; see README-frame.md.

Deferred: new spots, comparisons, calendar, print/PWA features, and more cosmetic controls.
Historical proposals and phase logs are in docs/archive; they are not current acceptance requirements.
