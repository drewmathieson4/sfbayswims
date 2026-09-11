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
> - **Current build decision (September 8, 2026):** use the existing Pi 4 and one detented endless encoder with
>   a built-in push button, wired directly to Pi GPIO. No Pico or separate button is required. The GPIO input
>   service still needs implementation and hardware testing; the Pico instructions below are an optional alternative.
>   The manually configured frame server and Chromium kiosk have run on the Pi; this does not validate the
>   legacy installer, sensor, or Wi-Fi provisioning. Complete controls, §5 performance, §4 Wi-Fi, then §6 soak testing.
> - **Test the frame without hardware** at `http://localhost:8000/frame/` (`python3 tools/serve.py 8000`): click, double-
>   click, triple-click, hold on the picture or the space bar; `?seed=1&offline=1&persist=0` for a deterministic,
>   network-free, non-persisting run; `APP.frame.{cycle,button,presets,switchView}` in the console.
> - Drew's routine: a branch per change, he spot-checks, then `git checkout main && git merge --no-ff <branch> &&
>   git branch -d <branch> && git push`. Never merge unasked.

A wall-hung picture frame: a matte 15.6" laptop panel behind a mat, a Raspberry Pi hidden on the
back, one cord to the wall, one endless rotary dial with tactile detents and a built-in push button under the bottom rail, a light sensor so the
picture dims with the room. From across the room it should pass for a framed aerial photo.

The frame runs the **Frame app** (`frame/index.html`, `js/frame/`). It starts with live currents and
quiet labels, with no swimmer. The dial moves time backward/forward and leaves it fixed until a
single press restores now. Double press enters/exits swimmer mode; the dial chooses a preloaded
swim, repeated at the selected departure time. Triple press shows only the photograph; another
triple restores the previous mode. Hold switches views while preserving time and mode.
The clock always shows the date. While browsing time with the dial, it adds an offset such as `+3H` or `−15M`; single press clears the offset.
A small forecast beneath the conditions shows the selected point in the ebb/flood cycle (±6 hours).
Online, use left/right arrow keys or the mouse wheel as the dial, and click/space/B as the button.

Prototype on the Pi 4 you own; the final board is decided by the frame-rate test (§5). The old external Claude plan is historical design context, not a current parts list.

The current consolidated purchase checklist is [docs/frame-buy-list.md](docs/frame-buy-list.md).
It supersedes the older bare-panel and 12 V power arrangement: use a complete monitor and separate external USB-C supplies.

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

## 2. The dial and button

### Selected build: direct Pi 4 GPIO connection

Use a panel-mount quadrature encoder with tactile detents, continuous rotation, and a normally open push switch.
The encoder and its built-in switch connect to the Pi 4 GPIO header. Buy a matching knob and mounting/wiring
hardware; omit the Pico, its USB cable, and a separate push button from the recommended parts.

Drew selected black metal for the knob. Recommended control parts (September 8, 2026; not yet ordered):

- [Adafruit Rotary Encoder + Extras, #377](https://www.adafruit.com/product/377): $4.50,
  continuous rotation with tactile detents and a built-in push switch; 6 mm D shaft.
- [Adafruit black anodized aluminum knob, #5527](https://www.adafruit.com/product/5527):
  20 mm diameter, 6 mm bore with set screw, textured sides and a white triangle marking. Listed at $2.95
  and available through [DigiKey](https://www.digikey.com/en/products/detail/adafruit-industries-llc/5527/16653407)
  when checked; out of stock directly at Adafruit. Requires a 2 mm hex key (not included).

To consolidate shipping, buy the encoder through
[DigiKey too](https://www.digikey.com/en/products/detail/adafruit-industries-llc/377/7902287)
(1528-2438-ND, $4.50, listed in stock September 8, 2026). The knob is 1528-5527-ND.
For the planned ambient dimming, the same order can include
[VEML7700 board #4162](https://www.digikey.com/en/products/detail/adafruit-industries-llc/4162/9997696)
(1528-2891-ND, $4.95) and
[QT-to-female GPIO cable #4397](https://www.digikey.com/en/products/detail/adafruit-industries-llc/4397/10824270)
(1528-4397-ND, $0.95, 150 mm). Both were listed in stock; these four items total $13.35 before shipping and tax.
Confirm the combined shipping charge and delivery date at checkout. This covers controls and sensing, not the
display, power, or final frame hardware. Drew already has a breadboard and jumper wires, and can borrow a friend's
soldering iron; confirm access to a 2 mm hex key and heat-shrink tubing for assembly.

The shaft and bore are compatible; final mounting still needs measurement. Leave clearance beneath the knob
for the push switch to travel, and use a recessed mount or thin bracket if the wooden rail is too thick for
the encoder's threaded bushing. Wiring and mounting materials are additional to these two control parts.

A small background service on the Pi will read rotation and switch press/release events and pass them to the
frame's existing controls. This service is planned, not implemented or installed. Choose the exact encoder before
finalizing GPIO assignments and wiring; preserve pins needed by the ambient light sensor. Validate detents,
direction, fast turns, all button gestures, and automatic startup with the physical control. The legacy eight-second
Wi-Fi reset below currently depends on Pico firmware and also needs adaptation for this build.

### Optional alternative: Pico as a USB keyboard

Flash CircuitPython on a Pico / Pico 2, copy the `adafruit_hid` library folder into `/lib`, then
copy `tools/pi/pico/code.py` and `boot.py` to the drive. Wire the button (● GP4) to GND; connect a quadrature encoder A/B to GP2/GP3 and its common to GND. The encoder sends left/right arrows (swap A/B if reversed). The Pico reports the button: `b` is held while ● is pressed (plus `w`
after 8 s). The gestures are decoded in the browser (`js/frame/button.js`), so timings change with an app
update, not a reflash:

| Gesture | Timing | Does |
|---|---|---|
| click | press < 0.4 s | exit swimmer/photo mode and restore live time |
| double-click | taps within 0.3 s | enter/exit swimmer mode at the selected time |
| triple-click | | photograph only / restore previous mode |
| hold | 0.6 s — fires while still pressed | switch view (cove ↔ Bay) through black |
| hold 8 s | | forget Wi-Fi (`w` → `wifi_reset.py`; the hotspot returns) |

Only the view survives the nightly reload (`localStorage`; `persistSwitches` in the presets).
The frame starts in its configured default mode. Slow dial turns step 5 minutes, faster turns 15 or 60 minutes.
In swimmer mode each detent changes one preset; in photograph mode the dial does nothing.

`boot.py` names the board "Aquatic Buttons" and hides the CIRCUITPY drive so the Pi only ever sees
a keyboard; hold ● while plugging the Pico in to get the drive back for editing (the serial console
stays on for debugging). `lsusb` on the Pi lists it as a keyboard.

## 3. What the frame does on its own

- In swimmer mode the chosen swim repeats at the frozen departure time: `swimSeconds` (60 s),
  hold, fade, rest, replay. A swept swim shows its fight and drift (`sweptSeconds`).
- The forecast uses predicted current, not tide height. Flood is above the baseline, ebb below;
  the marker follows the displayed time. Unavailable predictions leave gaps.
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
  view survives it (`localStorage`).
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

- Retain the complete monitor by its housing behind the mat; measure the delivered monitor before fabrication.
  Mount the Pi and sensor on standoffs, provide lower and upper ventilation, and keep the rear panel removable.
  Separate external USB-C supplies power the Pi and monitor; a finished power strip can combine them at the wall.
  Mount the encoder under the bottom rail with clearance for its push switch. Expose the light sensor to room light.
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

## Frame-only transfer to the existing sfbayswims Pi

On the Mac, build into a new directory (the builder refuses to overwrite an existing directory):

```bash
python3 tools/build_site.py site/sfbayswims-controls --frame-only
rsync -av site/sfbayswims-controls/ sfbayswims@sfbayswims.local:~/sfbayswims/
```

This includes only the frame, shared engine, runtime data and Python web server. The separately
configured `sfbayswims.service` serves `/home/sfbayswims/sfbayswims` on port 8000. Refresh the browser
after copying; the existing service does not need restarting for static file updates. The legacy
`tools/pi/install.sh` still targets `/opt/aquatic-park`; do not run it on this installation unchanged.
The encoder firmware uses CircuitPython's `rotaryio.IncrementalEncoder`:
https://docs.circuitpython.org/en/latest/shared-bindings/rotaryio/index.html
Physical encoder direction, detents, rapid turns, gestures, and Pi rendering still require hardware testing.
