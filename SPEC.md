# SF Bay Swims — the spec: two products on one engine

## Context

The app has become two things at once: a wall-hung **art piece** (the wedding gift — a framed aerial that is
quietly alive, one hidden button) and a **swim-planning tool** (time scrubbing, predicted swim times, routes,
best windows). Every control added for planning makes the frame busier, and every simplification for the frame
weakens the planner. Drew's decision (2026-08-25): split them into two apps that share one engine, in one repo,
renamed because the scope is now the whole Bay. The planner is public (club swimmers, phones + laptops); the frame
runs on the Pi and is also viewable online.

## Names

- **Repo: `sfbayswims`** (Drew's pick — clear, searchable; `gh repo rename sfbayswims`, old URL redirects; Pages
  becomes `drewmathieson4.github.io/sfbayswims/`). Alternatives considered: `baytide`, `swimsf` — weaker.
- **The Planner: "SF Bay Swims"** — the site at `/`. Wordmark lowercase `sfbayswims`. Tagline: *swim times under
  the tide*.
- **The Frame** — internal name; on screen it shows only the view's title (`AQUATIC PARK`, `SAN FRANCISCO BAY`).
  Lives at `/frame/`.
- Vocabulary: a *spot* is what the code calls a world (Aquatic Park, San Francisco Bay, later China Beach…); a
  *swim* is a route; a *start* is the selected time.

## Repo layout (no build step, every commit green)

```
index.html                  SF Bay Swims — the Planner (public root)
frame/index.html            the Frame (Pi kiosk URL; also viewable online)
js/engine/                  shared: config (defaults) state projection geometry mask routes tide current
                            stationfield swim animate particles photo map data world
                            + new: boot.js runtime.js paths.js format.js show.js sun.js debug.js
js/frame/                   main button cycle overlay presets kiosk ambient
js/planner/                 main panel timeline windows legs probe share settings keys hud
css/engine.css              photo/streaks/swimmer/route rules       css/frame.css   css/planner.css
data/                       as now (+ data/frame.json presets; data/frame.local.json per-Pi, gitignored)
tools/                      as now; tools/pi updated (kiosk URL, Pico firmware, rsync excludes)
```

- `engine/paths.js`: data URLs resolved with `new URL('../../data/', import.meta.url)` so `frame/` works (today
  `world.js`/`data.js` fetch `'data/…'` relative to the document).
- Config composition: `config.js` defaults ← `world.json.config` ← **app overrides** ← URL flags.
  `applyWorldConfig` already re-applies an override function after every switch; generalise to a list
  `[appOverrides, urlOverrides]` so the frame's presets and the planner's saved settings compose for free.
- `state.js` stays shared (plain object). Engine-owned keys documented; each app adds its own (`frame.*`, `plan.*`
  in localStorage; `ap.tides` / `ap.currents` caches stay shared — same origin, good).
- `engine/runtime.js` = today's `app.js` minus the HUD/legend: data loops, physics recompute, rAF loop,
  mount/unmount, `?frames` hook; apps hook in with `runtime.onTick(fn)` and `on()`. `engine/debug.js` = the arrows.
- `engine/format.js` = `fmtMMSS`, `fmtDist`, `fmtPace` with a units setting (yd/m, °F/°C; knots stay knots).
- `animate.js`: `setRoute(profile, { realSeconds, sweptRealSeconds })` — a per-swim pace for the playback instead
  of `state.tempo`; the frame needs it, the planner's tempo slider uses it too.
- `swim.js`: keep `cPar/cPerp` per sample (legs table, route colouring); `scanWindows` → `scanStarts(route, t0,
  t1, stepMin, pace, field)` returning every sample, chunkable; `reverseRoute(built)` (reverse built legs — the
  JSON's `follow`/`keepRight` depend on order); `checkLand` exported (custom routes).
- New `engine/sun.js` (NOAA solar position: sunrise, sunset, civil twilight) and `TideSeries.heightAt`.

---

# Product A — the Frame

**What it is.** From across the room: a framed aerial photograph. Up close: the water drifts with the tide as it
is *right now*; every half minute a swimmer sets off along one of the swims at an honest pace under today's
current, finishes, and fades; a small label names the swim and its time; the water temperature and the tide's
state are printed like a museum caption. At night it dims with the room. Nothing on it asks to be touched.

## The cycle

- Per view, the swims in `frame.json` order (default: all of `routes.json`). Each slot: integrate the route at the
  current minute (`physicsTime()`), play it scaled so **every swim lasts `swimSeconds` (20 s)** — Flag ≈ 40×, Bridge
  to Bridge ≈ 500× — with the physics' speed variation preserved (the swimmer visibly labours where the current
  bites). Finish → hold 1 s → trace, glyph and caption fade 1 s → 2 s of bare water → next swim fades in 0.6 s.
  ≈ 26 s per swim: the cove laps in ~2 min, the Bay in ~3.5 min.
- **Infeasible swim:** play it — the most honest thing the frame can say. The swim runs on the 20-s scale to the
  point the line can't be held, the fight+drift takes a fixed `sweptSeconds` (6 s) and fades; caption
  `ALCATRAZ · TOO MUCH CURRENT · NEXT 4:10 PM` (the 48-h scan, enabled for both views in the frame; memoised
  per half hour). Preset `skipInfeasible` to hide them instead.
- **The water follows the swimmer** (Drew's call): while a swim plays, `displayTime()` is the swimmer's moment,
  so the streaks and the top-right current reading cycle through the whole swim — a compressed Bay crossing shows
  the flood slacken, turn and ebb in 20 s. Between swims and whenever the swimmer is off, the water is simply
  *now*. The rewind at each new swim is hidden: the streak canvas fades out with the finished swim (1 s), is
  re-seeded at the new start time during the 2 s of bare water, and fades in with the next swimmer. Water
  temperature and wind stay live. Preset `streaksFollowSwimmer: true` (false = the frame is a window on now).
- Physics per slot costs 1–6 ms; the scan runs once per half hour per infeasible route.

## The button (one physical button; mouse/touch/space bar do the same online)

Decoder in the browser (`js/frame/button.js`), not the Pico — it needs press/release timing and the frame's state
(is a transition running?), and it updates over rsync + nightly reload instead of a reflash. The Pico becomes
dumb: **GP4 press → key `b` down, release → `b` up; held ≥ 8 s → `w` down** (unchanged; `wifi_reset.py` lives
outside the browser). ◀ ▶ stay wired, unmapped.

| Gesture | Timing | Does | Feedback (never a message) |
|---|---|---|---|
| click | press < 400 ms; decided 300 ms after release | swimmer on/off | swimmer fades in at the start of the current swim within 1 s / fades out 0.6 s (caption with it); off = the water returns to *now* |
| double-click | second press within 300 ms of release | overlay on/off | the three text pieces fade 0.4 s |
| triple-click | third press within the window; count clamps at 3 | tidal movement on/off | streaks stop stepping and `#particles` fades 1.5 s; back the same way |
| hold | ≥ 600 ms, fires **at** the threshold, swallows the release and the tap count | switch view (cove ↔ Bay, or the next spot) | fade to black 0.5 s → switch → wait `photo.ready` → fade up 0.9 s (`#fade` layer; `#dim` stays the ambient's) |
| hold ≥ 8 s | Pico sends `w` | forget Wi-Fi (hotspot returns) | the 0.6-s view flip happens first — harmless, and proves the button works |

Input is dropped during a transition (≈1.5 s). Switches persist in `localStorage` (`frame.world`,
`frame.swimmer`, `frame.overlay`, `frame.streaks`) so the nightly reload restores them; presets
`persistSwitches: false` (always boot to the preset) and `resetDaily: true`.

## Graphics

- **Overlay — museum labels, nothing else.** Top-left: the view title, the time beneath. Top-right, one line:
  `58°F · EBB 1.4 KN · WIND W 12 KN` (`≈` kept — honest and tiny) and, beneath it, only while a swim plays, fading
  with it: `ALCATRAZ · 1:12`. A clock under the title shows the moment the picture shows (the swimmer's during a
  swim). No rail, no elapsed/speed, no legend. No panels:
  white ink at 85 %, weight 400, ~0.8× today's size, tracking 0.2 em, `text-shadow: 0 1px 2px rgba(0,0,0,.6), 0 0
  14px rgba(0,0,0,.4)`, inset 3 % (inside the mat's shadow) — a museum label, not a HUD. The offline hint
  (`no wi-fi · join "aquatic-park"…`) stays visible even with the overlay off — it is a service message.
- **Swimmer:** the tapered ink glyph as today (beacon selectable by preset); no comet tail anywhere (both
  products); in the frame **no breadcrumbs either** (`crumbsPerSwim` 0 — Drew, 2026-08-25): the swimmer alone,
  the planner keeps its crumbs. Swims last one minute (`swimSeconds: 60`); the streaks keep drifting
  between swims (Drew, 2026-08-25).
- **Streaks:** today's density; alpha ~0.18; `fps 30` on the Pi.
- **Transitions:** route change as in the cycle; view change through black (a true photo crossfade needs two
  `<image>` elements because the viewBoxes differ — later). Quiet hours (`quietHours: {from:'23:00', to:'06:00',
  mode:'still'}` — no swimmer; or `dark`) and auto-alternation (`view: 'alternate', alternateEveryMin: 10`, switch
  after a completed lap) as presets.
- Removed from the frame: time travel, pace/tempo/icon keys, legend, rail, start button, clock, debug (kept behind
  `?debug=1`).

## Hidden presets — `data/frame.json` (overridden by `data/frame.local.json` on the Pi, then URL flags)

```json
{ "view": "cove", "alternateEveryMin": 0, "swimmer": true, "overlay": true, "streaks": true,
  "pace": "1:45", "swimSeconds": 20, "restSeconds": 2, "sweptSeconds": 6, "skipInfeasible": false,
  "streaksFollowSwimmer": true, "routes": { "cove": null, "bay": ["alcatraz", "gg", "b2b", "angel"] },
  "crumbsPerSwim": { "cove": 0, "bay": 12 }, "icon": "glyph", "streakAlpha": 0.18, "maxFps": 30,
  "quietHours": null, "persistSwitches": true, "resetDaily": false,
  "ambient": { "luxDark": 3, "luxBright": 300, "minBrightness": 0.3, "warmth": 0.25 }, "reloadAt": "04:00" }
```

Kiosk behaviours kept: wake lock, nightly reload, ambient dimming, offline hint, cursor always hidden.
Pi kit: `aquatic-kiosk.service` → `/frame/index.html?kiosk=1` (and the `ExecStartPre` curl), Pico `code.py` →
raw `b`, `install.sh` excludes `data/frame.local.json` from `rsync --delete`, README-frame follows.

---

# Product B — the Planner ("SF Bay Swims")

**What it is.** *When should I swim X, how long will it take, and where will the current hit me?* — answered for
Aquatic Park and the Bay swims, on a phone at the beach or a laptop the night before, with the honesty the
README already has (predictions, not measurements) printed on the page.

**The user is in full control of the inputs:** any pace (free-form mm:ss, not just presets), any start (any date
and time the bundled predictions cover — this year and, once fetched, next; the current ±7 d / +30 d scrub
clamp goes), any swim in either direction, the physics' realism knobs under *Advanced*. The app never overrides a
choice; it only shows the consequences and, on request, the better alternatives.

## Screen

- **Desktop:** the map fills the viewport. A **left panel** (340 px, collapsible to a 48-px rail) holds the plan in
  reading order (below). Top-right **conditions**: water °F, current with `≈`/station, wind, tide height + next
  hi/lo. Along the bottom the **timeline strip** (72 px). `?` opens the key cheatsheet. A footer line:
  *predictions, not measurements · about the numbers* (opens provenance).
- **Phone:** map ~55 vh, timeline pinned under it, a **bottom sheet** with three detents — peek (swim · ETA · ▶),
  half (spot / swim / start / pace), full (result, legs, windows, settings). Tap on the water = **probe**, not "next
  route" (cycling on tap is a frame gesture and surprises planners). Landscape = desktop layout.
- Settings open as a sheet from a gear in the panel header — never a separate page (the Bay mask decode and the
  7 MB bundle must not reload).

## The panel, in order

1. **Spot** — Aquatic Park · San Francisco Bay · (future spots); each remembers its swim.
2. **Swim** — list with distances, grouped by spot; **direction** toggle (loops ↺/↻, point-to-point reversed —
   the two Bridge-to-Bridge routes collapse into one); per-swim notes from `routes.json` (`pilot: true`, shipping
   lanes crossed, permits) shown as a line under the name. **Custom swim** (later phase): tap waypoints on the
   water, snap to landmarks within 30 m, land check, drag to move, undo; saved to favourites; encoded in the URL.
3. **Start** — date + time (Pacific, via `localToEpoch`), `now`, `−1 h · −5 · +5 · +1 h`, the timeline playhead,
   quick-sets `next slack` and `best in 48 h`.
4. **Pace** — mm:ss per 100 yd or 100 m (units toggle beside it), presets 1:30 / 1:45 / 2:00, and **Advanced**
   (collapsed): sprint on/off (1:00), reserve 60 s, minimum ground speed — the physics' realism knobs, nothing
   cosmetic.
5. **Result card** — total (or *too much current at leg 3, 41 min in*), **ETA in clock time**, daylight tags
   (*finish 6:52 pm · sunset 7:41 pm*; warning when any part is after civil dusk), distance, max current met (kn +
   where), *best in 48 h* / *next feasible* (always for infeasible; also when the chosen start is > 15 % slower than
   the best), water/wind (live only; `· now` when scrubbed, wind explicitly *not in the physics*), and **▶ preview**
   — the built playback: the clock, streaks and current follow the swimmer; a small tempo slider.
6. **Legs** — from → to, distance, time, pace, current along / across (kn); the slowest leg flagged; hover/tap a
   row → the leg highlights on the map; the route drawn **coloured by ground speed** (toggle).
7. **Best starts** — on request (a *find best starts* button; never computed unasked), three questions:
   - *This swim, the next **n** tide cycles* — n = 1–8 (a cycle ≈ 12 h 25 min; default 4 ≈ 2 days): starts every
     15 min from now, ranked fastest first, listed with total, ETA, daylight, and the slack relation (*40 min
     before slack at Alcatraz*); the top three marked on the timeline.
   - *Every swim, the next n cycles* — one row per swim: its best start, total and daylight, sortable; a row
     expands to that swim's full ranked list; click any start → it becomes the selected start.
   - *A specific date* — date picker: that day (plus spill into the next morning), ranked; the same filters.
   Filters: *daylight only*, *max duration*, *time of day*, *weekends*. "Optimal" = fastest total; ties by
   daylight, then by the smallest max current met. Built on the generalised `scanStarts`; chunked (`setTimeout`
   slices, cancelled on input, progress bar — the Bay's 8 swims × 4 cycles ≈ 800 integrations ≈ 1–2 s on a
   laptop, ~8 s on a phone), memoised per swim / pace / data version.
8. **Settings** (gear) — units (yd/m, °F/°C); streaks on/off + density (3 steps); swimmer on/off; current arrows;
   station dots; route colouring; keys cheatsheet; **data & provenance** (sources table, fetched-at, live vs
   bundle, the cove field is a model, the Bay field is a blend); **disclaimer**; reset.
9. **Share** — *copy link*: spot, swim (or waypoints), direction, start, pace, units in the URL; opening a link
   restores the plan. *Print* (later): map snapshot, numbers, legs, timeline on one page.

## Timeline strip

48 h from the selected day's midnight, scrollable ±7 days: the reference current as a filled curve (flood above
the axis, ebb below) sampled every 6 min from `field.reference(t)`; slack ticks with times; night shading from
`sun.js`; tide height as a thin line (toggle); the selected swim as a bar from start to ETA, red where
infeasible; a *now* marker; the draggable playhead (drag = scrub, tap = set). Labels every 6 h. SVG, ~150 lines.

## Probe

Hover (desktop) / tap (phone) on water: a small tag `1.2 KN → 275° · EBB · 3:10 PM` with an arrow, at the
selected time (or the swimmer's time during preview). `field.sample(x, y, t)` + `proj.unproject`.

## Keys

`← →` 5 min (hold accelerates) · `⇧← ⇧→` 1 h · `↑ ↓` swim · `r` reverse · `n` now · `space` preview · `s`
streaks · `c` current arrows · `- +` pace · `v` spot · `?` help. Dropped: `i [ ] d h p` (iteration tools; `d`
behind `?debug`).

## Graphics

Same photo, streaks and swimmer as today; the map keeps the uppercase, letter-spaced label language; the panel is
a readable UI (mixed case, 14–15 px, dark theme matched to the photos, system font). Additions: route colouring by
speed, the ETA/finish marker, leg highlight, the timeline, the probe tag. No icon pickers, no size sliders.

## Data, provenance, safety

Footer line + settings sheet: sources (README table), what is live vs bundled, `≈` explained, "the cove field is
a model, the Bay field is an interpolation between stations, wind is informational", swim with a pilot where the
club requires one, times are estimates. Per-swim notes in `routes.json`.

## Performance

Phones: the Bay's 7 MB currents bundle is the first-load cost (Pages gzips) — later: per-station files or a
coarser sample; the cove loads first. `scanStarts` chunked; physics unchanged (6 ms).

---

# Spots (more views)

The world system already supports them; a spot = `world.json` (bbox, origin, config) + photo (`fetch_aerial`,
optional `fetch_sentinel`, `build_mask`, `stylize`) + stations (`fetch_stations --world`, `precompute_currents`)
+ `landmarks.json` / `routes.json`. Local spots use the station field (like the Bay). `index.json` gains `kind:
regional | spot` and `label`. Candidates, in rough order of demand: **Crissy Field / St Francis YC** (the classic
Bay-swim start), **China Beach / Lands End** (outside the Gate; strong current, fog — advanced), **Horseshoe Cove
(Sausalito / Cavallo Point)**, **Alameda Crown Beach**, **Berkeley Marina**, **Clipper Cove (Treasure Island)**,
**Ayala Cove (Angel Island)**, **Keil Cove (Tiburon)**. Each is a data afternoon, no code. Not in this build.

---

# Phases (each on a branch Drew spot-checks in both apps before merging)

0. **Rename** — `gh repo rename sfbayswims`, remote URL, README/ARCHITECTURE/memory, Pages URL check.
1. **Engine split, no behaviour change** — move the 16 modules to `js/engine/` + `paths.js`; extract
   `format/show/kiosk/hud/keys` from `ui.js`, `runtime.js` + `debug.js` from `app.js`, `boot.js` from `main.js`
   (`js/main.js` becomes a thin caller). Verify: `?frames` snapshots and rail times identical in both views.
2. **Frame v1** at `frame/` — cycle (20 s, rest, swept 6 s), button decoder, overlay, presets, transitions,
   persistence; Pi kit (kiosk URL, Pico `b`, rsync excludes, README-frame). Verify online with space/mouse; then
   on the Pi.
3. **Planner v1** at `/` — panel (spot / swim + direction / start / pace / result / preview), timeline, units,
   share links, probe, provenance + disclaimer, keys, phone bottom sheet; legacy HUD/rail/legend removed.
4. **Planner v2** — legs + route colouring, windows search with filters, daylight (`sun.js`), tide height, per-swim
   notes, favourites.
5. **Later** — custom swims, compare two starts/swims, 7-day calendar, print, lighter Bay bundles, PWA shell;
   first new spots (Crissy Field, China Beach).

## Verification (per phase)

- Phase 1: both views load from `/` with no console errors; `?frames=60&seed=1&offline=1` renders the same frame
  as before the move (compare rail numbers: cove Clockwise 21:44, Bay Alcatraz 45:25 at a fixed `?t`); `v`, `←`,
  `space` unchanged; `python3 tools/serve.py` and Pages both serve `data/` from the new paths.
- Phase 2: `/frame/?seed=1`: swims cycle at 26 s each; during a Bay swim the current reading and streaks turn
  with the tide and the rewind is invisible (canvas faded during the gap); swimmer off → the water shows now; an
  infeasible Bay swim shows the fight, drift and caption; click/double/triple/hold behave with the mouse and with
  a `b`-held keyboard; switches survive a reload; `frame.local.json` overrides; `?kiosk=1` on the Pi with the
  reflashed Pico.
- Phase 3+: on a phone (Chrome + Safari) — sheet detents, timeline drag, probe tap, share link round-trip; on
  desktop — panel inputs drive the physics (ETA matches `integrateRoute`), a free-form pace and a start next
  month both compute, *best starts* for one swim / every swim / a chosen date return ranked lists whose top entry
  matches a manual scrub, preview follows the swimmer, provenance visible; no console errors.

## Status

- 2026-08-25 — Phase 0 (rename) and Phase 1 (engine split, `js/engine/`) merged; the combined app at `/` still
  serves as it did.
- 2026-08-25 — Phase 2, the Frame at `frame/` (branch `frame`): cycle, button decoder, overlay, presets,
  transitions, Pi kit (kiosk URL, Pico `b`). Next: Phase 3, the Planner at `/`.
