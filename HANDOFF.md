# Handoff — where things stand (2026-08-25)

For whoever picks this up next (a person or an agent). The long-form docs are `README.md` (the Planner), `README-frame.md`
(the Frame and the Pi), `ARCHITECTURE.md` (every file), `SPEC.md` (the two products and the phase log), `DATA.md` (data
dependencies, failure modes, the bundle chore and its automation).

## State

- **Live:** https://drewmathieson4.github.io/sfbayswims/ (the Planner) and `…/frame/` (the Frame). `main` is the only
  branch; everything through the data audit is merged. Pages deploys `main` about a minute after a push.
- **Routine:** one branch per change, verified, Drew spot-checks at `localhost:8000` (`python3 tools/serve.py 8000`),
  then `git checkout main && git merge --no-ff <branch> && git branch -d <branch> && git push`.
- **Bundles:** 2026 and 2027 committed (predictions through Jan 2028). `.github/workflows/bundles.yml` refreshes them
  quarterly; `python3 tools/check_bundles.py` shows coverage any time.
- **Untested on hardware:** the Pi kit (`tools/pi/`, `README-frame.md`) — flash, `install.sh`, the Pico with the new
  `code.py` (it just holds `b`), the Bay frame-rate test.

## Open list (from SPEC.md "later")

Compare two starts or swims side by side · a 7-day calendar of best starts · lighter Bay bundles for phones (the 7 MB
first load; per-station files or a coarser sample) · new spots (Crissy Field, China Beach — data afternoons, see SPEC.md
"Spots") · a real domain (`sfbayswims.com` → a `CNAME` file), a web manifest / icons / Open Graph image for links and
home-screen installs · an email in `CONFIG.feedback.email` if bug reports should offer it.

## Testing without a visible tab

The engine renders on `requestAnimationFrame`, which stops in a hidden tab. Use `?frames=N&seed=1&offline=1` (renders N
frames and freezes; `html.snapshot-ready`), `APP.app.stepFrames(n)` to advance, `APP.app.recompute()` for a synchronous
physics run, and `await import('/js/engine/state.js')` for the app's own `set()`. Hooks: `APP.state`, `APP.live`,
`APP.app` (the runtime), `APP.planner.{panel,timeline,legs,draw}`, `APP.frame.{cycle,button,presets,switchView}`. A tab
hidden more than five minutes has its timers throttled to once a minute — reload before probing. `?persist=0` keeps
frame probes from writing the shared `localStorage`.

## Things that bit us (so they don't again)

- `smoothPath` must not re-label the route's end points (a zero-length first leg appears).
- The NOAA sunrise formula needs the Pacific day's noon as input, or dawn lands on the next day for morning times.
- `reference()` returns `label`, not a `flood` boolean.
- `applyWorldConfig` resets CONFIG on every spot switch: app patches go through the `overrides` list, never direct edits.
- CO-OPS: 366-day cap per request, 403 on bursts (the tools sleep 1 s), occasional 504 (the refresh driver retries).
