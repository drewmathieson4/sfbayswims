# Current product specification

The Planner and Frame are separate apps sharing geometry, fields, physics, data, and rendering.
The public Planner answers when a swim is feasible, its estimated time, and where currents affect it.
The Frame is a quiet framed aerial made as a gift. Keep its button-and-dial interaction and uncluttered labels.

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
Default: live time, streaks and labels, no swimmer. Dial backward/forward freezes the selected time;
slow turns advance 5 minutes per detent, faster turns 15 or 60 minutes. There is no idle timeout.
Single press exits swimmer/photo modes and restores live time. Double press toggles swimmer mode:
each selected preset repeats at the same frozen departure time; the dial selects the next/previous preset.
Triple press hides all text, graph, particles and SVG annotations, leaving only the aerial photo;
the dial is inactive until photo mode is exited. Another triple restores the prior mode and route.
Hold 0.6 seconds switches views, preserving time and mode. Reload starts in the configured default mode.
The current graph samples the same field as the conditions over ±6 hours, with flood above zero,
ebb below, and a selected-time marker. Missing prediction coverage leaves gaps rather than invented data.
The selected hardware is one detented endless encoder with a built-in push button, wired directly to Pi 4 GPIO.
A Pi input service will bridge rotation and press/release events to the existing frame controls; implementation
and physical validation are pending. A Pico is optional; its existing firmware sends `b` while held, arrow keys
from encoder GP2/GP3, and `w` after eight seconds. Direct-GPIO Wi-Fi reset still needs adaptation.
Optional quiet hours pause cycling; an all-infeasible skipped cycle backs off instead of busy-looping.
Ambient dimming requires fresh sensor timestamps. Missing/stale sensors restore full brightness.

## Maintenance

Regression checks cover physics, validation, sharing, coverage, atomic bundle publishing, and browser behavior.
The Pi and CI share a validated refresh driver. Publishing excludes rebuild inputs but preserves them in the repo.
Hardware validation is required before gifting; see README-frame.md.

Deferred: new spots, comparisons, calendar, print/PWA features, and more cosmetic controls.
Historical proposals and phase logs are in docs/archive; they are not current acceptance requirements.
