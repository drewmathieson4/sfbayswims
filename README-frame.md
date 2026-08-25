# The frame — building and running Aquatic Park on a Raspberry Pi

A wall-hung picture frame: a matte 15.6" laptop panel behind a mat, a Raspberry Pi hidden on the
back, one cord to the wall, three hidden buttons under the bottom rail, a light sensor so the
picture dims with the room. From across the room it should pass for a framed aerial photo.

Parts, prices and links are in the plan (`~/.claude/plans/ok-perfect-this-is-glimmering-galaxy.md`,
"Parts list"). Prototype on the Pi 4 you own; the final board is decided by the frame-rate test (§5).

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
   | `aquatic-kiosk` (user) | Chromium `--kiosk --app=http://127.0.0.1:8000/index.html?kiosk=1`, `Restart=always`; started by the compositor's autostart once Wayland is up |
   | `aquatic-ambient` (system) | `tools/pi/ambient.py` — VEML7700/BH1750 on I²C → `/run/aquatic/ambient.json` every 2 s; exits quietly if there is no sensor |
   | `aquatic-wifi-reset` (system) | `tools/pi/wifi_reset.py` — `w` held 3 s from the "Aquatic Buttons" board (● held 8 s) forgets saved Wi-Fi so the setup hotspot returns; it ignores every other keyboard |

   Plus `/etc/cron.d/aquatic-bundles` (every December morning until next year's tide/current
   bundles exist; re-running the installer never overwrites bundles the frame generated) and, with
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

## 2. Buttons (Pico as a USB keyboard)

Flash CircuitPython on a Pico / Pico 2, copy the `adafruit_hid` library folder into `/lib`, then
copy `tools/pi/pico/code.py` and `boot.py` to the drive. Wire three momentary buttons to GND:

| Button | Pin | Gesture → key → app |
|---|---|---|
| ◀ | GP2 | press…release → `←` held → tap = 5 min back, hold = accelerating rewind |
| ▶ | GP3 | press…release → `→` held → forward |
| ● | GP4 | tap → `↓` next route · double-tap → `p` photo mode (swimmer + overlay off) · triple-tap → `v` switch view (cove ↔ Bay) · hold 1–8 s then release → `n` back to *current* · hold 8 s → `w` held (forget Wi-Fi) |

`boot.py` names the board "Aquatic Buttons" and hides the CIRCUITPY drive so the Pi only ever sees
a keyboard; hold ● while plugging the Pico in to get the drive back for editing (the serial console
stays on for debugging). `lsusb` on the Pi lists it as a keyboard.

## 3. What the frame does on its own

- Route **stays put**; after 10 min without a button press while time-travelling it drifts back
  to *current* (`kiosk.returnToNowS`). Display never blanks (wake lock + OS settings).
- The swimmer waits at the start until a swim is started (`space` / the rail's ▶ start) and the streaks show
  *now* meanwhile. No Pico gesture starts a swim yet — map ● tap to `space` in `tools/pi/pico/code.py` if the
  frame should play them.
- Live data refreshes on the app's own schedule; with no network it keeps animating from the
  bundled year (tides, currents for both views, water-temperature climatology shown with `≈`).
- The nightly reload (`kiosk.reloadAt`, 04:00) picks up any app update copied to
  `/opt/aquatic-park`. The chosen view survives it (`localStorage`).
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

`js/ambient.js` (kiosk only) polls `/ambient.json` and eases a black overlay (plus a faint warm
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

Bundles for next year appear by themselves in December (`tools/pi/refresh-bundles.sh`); to
regenerate by hand run the bundle commands in the main README's "Rebuilding the data".
