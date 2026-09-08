# The frame — building and running the Frame on a Raspberry Pi

> **For the agent that does the Pi work — read this box first.** The frame is the wedding gift; the Planner is a
> separate product that happens to share the engine. Your scope is the frame and the Pi only:
>
> - **Yours:** `frame/index.html`, `css/frame.css`, `js/frame/` (main, presets, cycle, button, overlay, kiosk, ambient),
>   `data/frame.json` (presets; `data/frame.local.json` is per-Pi and gitignored), `tools/pi/` (install.sh, the systemd
>   units, ambient.py, wifi_reset.py, comitup.conf, refresh-bundles.sh + cron, `pico/code.py` + `boot.py`),
>   `tools/serve.py`, and this file.
> - **Shared — change only with care, and check the Planner at `/` afterwards:** `js/engine/` (the physics, fields,
>   worlds, streaks, swimmer), `css/engine.css`, `data/worlds/`, `data/*.json` bundles. Tunables for the frame belong in
>   `data/frame.json`, not in the engine.
> - **Not yours:** `index.html`, `css/planner.css`, `js/planner/` — the website.
> - **What has never run on hardware:** all of `tools/pi/`. Order of work: §1 flash and install → check the four
>   services → §2 flash the Pico (it now only holds `b` while the button is pressed; the browser decodes gestures) →
>   §5 the frame-rate test in the Bay view (`?fps=30`) → §4 comitup on the Trixie image → §6 the soak test.
> - **Test the frame without hardware** at `http://localhost:8000/frame/` (`python3 tools/serve.py 8000`): click, double-
>   click, triple-click, hold on the picture or the space bar; `?seed=1&offline=1&persist=0` for a deterministic,
>   network-free, non-persisting run; `APP.frame.{cycle,button,presets,switchView}` in the console.
> - Drew's routine: a branch per change, he spot-checks, then `git checkout main && git merge --no-ff <branch> &&
>   git branch -d <branch> && git push`. Never merge unasked.

A wall-hung picture frame: a matte 15.6" laptop panel behind a mat, a Raspberry Pi hidden on the
back, one cord to the wall, one hidden button under the bottom rail, a light sensor so the
picture dims with the room. From across the room it should pass for a framed aerial photo.

The frame runs the **Frame app** (`frame/index.html`, `js/frame/`, see SPEC.md Product A): the view's swims
play in turn, each starting from *now* and scaled to one minute; while a swim plays the time, the streaks and
the current reading follow the swimmer; between swims the water is simply now. Museum labels only — top-left the
view title and the time, top-right `63°F · flood 1.2 kn · wind W 12 kn` with `Alcatraz · 1:12` beneath it while a
swim plays — and nothing else.
Online you can try it at `/frame/` (click, double-click, triple-click and hold on the picture, or the space bar).

Prototype on the Pi 4 you own; the final board is decided by the frame-rate test (§5). The old external Claude plan is historical design context, not a current parts list.

## 1. Flash the Pi

1. Raspberry Pi Imager → **Raspberry Pi OS (64-bit) with desktop** (Bookworm or Trixie).
   In the Imager settings set hostname `aquatic`, user `pi` (any password), **your Wi-Fi** (so the
   first boot is online), locale `America/Los_Angeles`, and enable SSH.
2. Boot, then copy the repo over and run the installer (it is idempotent — re-run it after any
   app change):

   ```
   rsync -a --exclude venv --exclude .git ./ pi@aquatic.local:~/aquatic-park/
   ssh pi@aquatic.local 'sudo bash ~/aquatic-park/tools/pi/install.sh && sudo reboot'
   ```

   `install.sh` installs Chromium, copies the app to `/opt/aquatic-park`, sets the timezone,
   desktop autologin, disables screen blanking (both `raspi-config` and the labwc `swayidle`
   line), enables I²C, and installs four services:

   | Unit | What |
   |---|---|
   | `aquatic-serve` (system) | `tools/serve.py` — threaded static server on `127.0.0.1:8000` (assets revalidate, the sensor file never caches), serves the light-sensor file as `/ambient.json` |
   | `aquatic-kiosk` (user) | Chromium `--kiosk --app=http://127.0.0.1:8000/frame/index.html?kiosk=1`, `Restart=always`; started by the compositor's autostart once Wayland is up |
   | `aquatic-ambient` (system) | `tools/pi/ambient.py` — VEML7700/BH1750 on I²C → `/run/aquatic/ambient.json` every 2 s; exits quietly if there is no sensor |
   | `aquatic-wifi-reset` (system) | `tools/pi/wifi_reset.py` — `w` key-down after the Pico’s eight-second hold from the "Aquatic Buttons" board (● held 8 s) forgets saved Wi-Fi so the setup hotspot returns; it ignores every other keyboard |

   The installer never overwrites `data/frame.local.json` — this frame's own presets (§3).

   Plus `/etc/cron.d/aquatic-bundles` (daily at 03:00, validating and refreshing missing, invalid, or due tide/current
   bundles; re-running the installer never overwrites bundles the frame generated) and, with
   `comitup` available, the captive-portal hotspot (§4). The installer sources the system labwc
   autostart from the user's, so the desktop session stays intact; only its screen blanker is stopped.
   Option: `--no-comitup`. (SSH is enabled by the Imager settings; that's the remote-fix path.)

3. After the reboot the frame should be full-screen within ~30 s. Check:

   ```
   systemctl status aquatic-serve aquatic-ambient aquatic-wifi-reset
   systemctl --user status aquatic-kiosk          # as pi, in a desktop session or with XDG_RUNTIME_DIR=/run/user/1000
   journalctl -u aquatic-ambient -n 20            # "sensor: VEML7700" and no errors
   curl -s http://127.0.0.1:8000/ambient.json     # {"lux": …}
   vcgencmd measure_temp
   ```

   `chrome://gpu` (plug in a keyboard and press `Esc` to leave kiosk briefly) should show
   *Canvas: Hardware accelerated*.

## 2. The button (Pico as a USB keyboard)

Flash CircuitPython on a Pico / Pico 2, copy the `adafruit_hid` library folder into `/lib`, then
copy `tools/pi/pico/code.py` and `boot.py` to the drive. Wire the button (● GP4) to GND; GP2 and GP3 are unused and no longer read by the firmware. The Pico only reports the button: `b` is held while ● is pressed (plus `w`
after 8 s). The gestures are decoded in the browser (`js/frame/button.js`), so timings change with an app
update, not a reflash:

| Gesture | Timing | Does |
|---|---|---|
| click | press < 0.4 s | swimmer on / off (off = the water shows now) |
| double-click | taps within 0.3 s | overlay (the three labels) on / off |
| triple-click | | tidal movement (the streaks) on / off |
| hold | 0.6 s — fires while still pressed | switch view (cove ↔ Bay) through black |
| hold 8 s | | forget Wi-Fi (`w` → `wifi_reset.py`; the hotspot returns) |

The switches and the view survive the nightly reload (`localStorage`; `persistSwitches` in the presets).

`boot.py` names the board "Aquatic Buttons" and hides the CIRCUITPY drive so the Pi only ever sees
a keyboard; hold ● while plugging the Pico in to get the drive back for editing (the serial console
stays on for debugging). `lsusb` on the Pi lists it as a keyboard.

## 3. What the frame does on its own

- The swims cycle by themselves, in the view's order from a random first swim (again after every view change):
  each starts from the current minute, lasts `swimSeconds` (60 s), holds a
  second, fades, rests two seconds, then the next; a swim the current makes impossible plays its
  fight and drift (`sweptSeconds`) with the caption *too much current · next 4:10pm*. Display never blanks
  (wake lock + OS settings).
- **Hidden presets** — `data/frame.json` in the repo, overridden by `data/frame.local.json` on this frame (not
  in git; survives `install.sh`), then URL flags (`?view=bay&swimmer=0&swimSeconds=30&pace=1:40`). Keys: `view`
  (`cove` | `bay` | `alternate` + `alternateEveryMin`), the three switches, `pace`, `swimSeconds`, `holdSeconds`,
  `fadeSeconds`, `restSeconds`, `sweptSeconds`, `skipInfeasible`, `streaksFollowSwimmer`, `routes` (per view, an
  id list or `null` = all), `crumbsPerSwim` (per view; 0 = none, the default), `icon` (`glyph` | `beacon`), `streakAlpha`, `labelScrim` (the vignette behind the top labels, 0–1), `maxFps`,
  `quietHours` (`{ "from": "23:00", "to": "06:00", "mode": "still" | "dark" }`), `persistSwitches`,
  `resetDaily`, `ambient`, `reloadAt`.
- Live data refreshes on the app's own schedule; with no network it keeps animating from the
  bundled year (tides, currents for both views, water-temperature climatology shown with `≈`).
- The nightly reload (`reloadAt`, 04:00) picks up any app update copied to `/opt/aquatic-park`. The chosen
  view and switches survive it (`localStorage`).
- If every live fetch has failed for 3 minutes (`offlineHint`), the top-left corner shows
  *no wi-fi · join "aquatic-park" to set up*.

## 4. Wi-Fi for someone else's house

With **comitup** installed, a Pi that can't reach a known network raises a hotspot named
**aquatic-park** (password `swimswim`, set in `tools/pi/comitup.conf`). Joining it from a phone opens a
captive page listing nearby networks; pick the
home Wi-Fi, type the password, and within a minute the frame is online (and the hotspot is
gone). Holding ● for 8 s forgets all saved networks and brings the hotspot back — for a move or
a new router. Verify on the Trixie image that `apt install comitup` succeeds (it did on
Bookworm); if the package is missing, the fallback is `sudo nmcli device wifi connect "<ssid>"
password "<pw>"` over SSH.

## 5. Looking like a print — brightness that follows the room

`js/frame/ambient.js` (kiosk only) polls `/ambient.json` and eases a black overlay (plus a faint warm
tint) from full brightness at ≥ 300 lx down to 30 % at ≤ 3 lx (`config.ambient`: `luxDark`,
`luxBright`, `minBrightness`, `warmth`). This removes the "glowing screen" look at night. Without a
sensor the frame simply stays at full brightness.

One thing to try on the prototype, which decides the final board: **frame rate.** In the Bay view with
the default 1600 streaks, `?fps=30` should hold 30 fps (no stutter in the swimmer). If not, either
`&fps=24` / lower `particles.max` in `data/worlds/bay/world.json`, or ship a Pi 5. (Backlight control
over DDC/CI was dropped: the overlay alone gives the print look, and DDC is broken on Pi 5.)

Set the driver board's own OSD brightness low once (~40 %) so even "full" brightness is
print-like; the app's dimming works below that ceiling.

## 6. Assembly notes

- Panel on the mat (active area 344 × 194 mm for a 15.6" 1080p panel), driver board and Pi on
  the back panel, cooler intake at the bottom slot and exhaust at the top; one 12 V cord (the
  Pi's 5 V from a buck or a second adapter behind the frame); buttons on a short ribbon through
  the bottom rail; the light sensor peeks through a 3 mm hole in the bottom rail or a vent slot.
- No glass in front of the matte panel. Matte IPS, not OLED (the HUD is static).
- Soak test: 48 h closed, `vcgencmd measure_temp` under 70 °C; pull the plug ten times — it must
  always come back to the app with no "restore pages" bar (`--disable-session-crashed-bubble`).

## 7. Updating the app later

```
rsync -a --exclude venv --exclude .git ./ pi@aquatic.local:~/aquatic-park/
ssh pi@aquatic.local 'sudo bash ~/aquatic-park/tools/pi/install.sh'    # re-syncs /opt and restarts services
```

The daily `tools/pi/refresh-bundles.sh` runs the same validated driver as CI. It fetches only missing/invalid or due bundles. For manual regeneration see DATA.md.

## Maintenance validation

Run `npm test` and `npm run test:browser` on the development machine. Node packages are test-only and excluded from the Pi installer. The sensor timestamp must be fresh (within 60 seconds); stale files restore full brightness. `holdSeconds` and `fadeSeconds` control both playback and CSS. The Pico owns the eight-second Wi-Fi hold; the Pi resets on key-down with no additional delay.

Physical checks remain required: service startup, sensor readings against room light, single/double/triple/hold gestures, eight-second Wi-Fi reset and reconnection, 30 fps Bay view, ten cold boots, and the 48-hour closed-frame soak. These cannot be certified by desktop browser tests.
