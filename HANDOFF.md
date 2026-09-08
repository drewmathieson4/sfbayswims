# Maintenance handoff — September 2026

The Planner and Frame remain separate products on one engine. Current behavior is in README.md and SPEC.md;
implementation map in ARCHITECTURE.md; source/refresh operations in DATA.md. Old proposals are in docs/archive.

This maintenance pass addresses shared-name HTML injection, invalid plan inputs, immediate-sweep playback,
search cancellation and finish coverage, requested-year loading, redundant weather/preview computation,
bundle completeness and atomic publishing, stale ambient data, configurable fades, and the eight-second button reset.
Unused trails/helpers/extra Pico inputs are removed. Both products retain their core functionality.

Run `npm test`, `npm run test:browser`, and `python3 tools/check_bundles.py` before release.
Build with `python3 tools/build_site.py <new-directory>`. Test dependencies and rebuild inputs are not deployed.
The provided deployment workflow needs GitHub Pages Source set to GitHub Actions; no remote setting has been changed
by this local maintenance pass. No commit, merge, or deployment is implied by editing this checkout.

Still requiring physical validation: Pi installation/services, Pico gestures and Wi-Fi reset, comitup setup,
actual light sensor readings, Bay frame rate, cold boots, and a 48-hour soak. Follow README-frame.md.
Defer new spots and features until those checks pass.
