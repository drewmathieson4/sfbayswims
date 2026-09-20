#!/usr/bin/env bash
# Provision a Raspberry Pi (Raspberry Pi OS Desktop, labwc) as the SF Bay Swims frame.
#   sudo bash tools/pi/install.sh [--user pi] [--no-comitup]
# Idempotent: re-run after editing the app — it re-syncs /opt/sfbayswims and restarts the services.
set -euo pipefail
USER_NAME="${SUDO_USER:-pi}"; WITH_COMITUP=1
while [ $# -gt 0 ]; do
  case "$1" in
    --user) [ $# -ge 2 ] || { echo "--user needs a name"; exit 1; }; USER_NAME="$2"; shift ;;
    --no-comitup) WITH_COMITUP=0 ;;
    *) echo "unknown option: $1"; exit 1 ;;
  esac; shift
done
HOME_DIR=$(getent passwd "$USER_NAME" | cut -d: -f6); UID_NUM=$(id -u "$USER_NAME")
SRC=$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd); APP=/opt/sfbayswims; PI="$APP/tools/pi"
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

say "packages"
apt-get update -qq
apt-get install -y -qq chromium rsync curl >/dev/null || apt-get install -y -qq chromium-browser rsync curl >/dev/null   # required
apt-get install -y -qq python3-evdev python3-gpiozero python3-lgpio python3-smbus i2c-tools >/dev/null || echo "(optional packages missing: the dial needs python3-evdev, python3-gpiozero, python3-lgpio; the light sensor python3-smbus)"
CHROMIUM=$(command -v chromium || command -v chromium-browser)
if [ "$WITH_COMITUP" = 1 ]; then apt-get install -y -qq comitup >/dev/null || { echo "comitup not in this repo — see README-frame.md §4"; WITH_COMITUP=0; }; fi

say "app → $APP (generated bundles are kept)"
mkdir -p "$APP"
rsync -a --delete --exclude .git --exclude venv --exclude __pycache__ --exclude .DS_Store --exclude node_modules --exclude site --exclude test-results --exclude playwright-report \
  --exclude 'data/tides-*.json' --exclude 'data/currents-*.json' --exclude 'data/worlds/*/currents-*.json' --exclude 'data/frame.local.json' "$SRC/" "$APP/"
rsync -a --ignore-existing "$SRC/data/" "$APP/data/"          # bundles from the checkout, preserving the Pi's generated data
chown -R "$USER_NAME:$USER_NAME" "$APP"; chmod +x "$APP/tools/serve.py" "$PI"/*.sh "$PI"/*.py

say "system: timezone, autologin, no blanking, i2c, wi-fi country + no power save, linger"
timedatectl set-timezone America/Los_Angeles
command -v raspi-config >/dev/null && { raspi-config nonint do_boot_behaviour B4 || true; raspi-config nonint do_blanking 1 || true; raspi-config nonint do_i2c 0 || true; raspi-config nonint do_wifi_country US || true; }
# without a country the radio stays on world rules (listen-only on some 5 GHz channels, a REGDOM-CHANGE log line every 3 s);
# with power save on it sleeps through multicast, so <hostname>.local stops answering — the remote-fix path
mkdir -p /etc/NetworkManager/conf.d; printf '[connection]\nwifi.powersave = 2\n' > /etc/NetworkManager/conf.d/wifi-powersave-off.conf
usermod -aG i2c,input,video "$USER_NAME" 2>/dev/null || true
loginctl enable-linger "$USER_NAME"

say "services"
for u in sfbayswims-serve sfbayswims-ambient sfbayswims-wifi-reset sfbayswims-encoder; do sed -e "s|@USER@|$USER_NAME|g" -e "s|@APP@|$APP|g" "$PI/systemd/$u.service" > "/etc/systemd/system/$u.service"; done
mkdir -p "$HOME_DIR/.config/systemd/user" "$HOME_DIR/.config/labwc" "$HOME_DIR/.kiosk"
sed -e "s|@CHROMIUM@|$CHROMIUM|g" -e "s|@HOME@|$HOME_DIR|g" -e "s|@UID@|$UID_NUM|g" "$PI/systemd/sfbayswims-kiosk.service" > "$HOME_DIR/.config/systemd/user/sfbayswims-kiosk.service"
# labwc runs the FIRST autostart it finds: ours sources the system one (panel, background, audio…), stops its screen
# blanker, then starts the kiosk browser under systemd once Wayland is up
if ! grep -q sfbayswims-kiosk "$HOME_DIR/.config/labwc/autostart" 2>/dev/null; then cat >> "$HOME_DIR/.config/labwc/autostart" <<'EOT'
[ -f /etc/xdg/labwc/autostart ] && . /etc/xdg/labwc/autostart
sleep 2; pkill -x swayidle || true                              # sfbayswims frame: display always on
systemctl --user import-environment WAYLAND_DISPLAY DISPLAY XDG_RUNTIME_DIR XDG_SESSION_TYPE
systemctl --user restart sfbayswims-kiosk.service &
EOT
fi
chown -R "$USER_NAME:$USER_NAME" "$HOME_DIR/.config" "$HOME_DIR/.kiosk"
systemctl daemon-reload
systemctl enable sfbayswims-serve.service sfbayswims-ambient.service sfbayswims-wifi-reset.service sfbayswims-encoder.service
systemctl restart sfbayswims-serve.service sfbayswims-ambient.service sfbayswims-wifi-reset.service sfbayswims-encoder.service
sudo -u "$USER_NAME" XDG_RUNTIME_DIR="/run/user/$UID_NUM" systemctl --user daemon-reload || true
sudo -u "$USER_NAME" XDG_RUNTIME_DIR="/run/user/$UID_NUM" systemctl --user enable sfbayswims-kiosk.service || true
sudo -u "$USER_NAME" XDG_RUNTIME_DIR="/run/user/$UID_NUM" systemctl --user restart sfbayswims-kiosk.service 2>/dev/null || true

if [ "$WITH_COMITUP" = 1 ]; then
  say "wi-fi captive portal (comitup): hotspot 'sfbayswims', password in tools/pi/comitup.conf"
  while IFS= read -r line; do key="${line%%:*}"; grep -q "^#\?\s*$key:" /etc/comitup.conf && sed -i "s|^#\?\s*$key:.*|$line|" /etc/comitup.conf || echo "$line" >> /etc/comitup.conf; done < "$PI/comitup.conf"
  systemctl enable --now comitup || true
fi

say "validated bundle refresh (daily; network only when due)"
sed -e "s|@USER@|$USER_NAME|g" -e "s|@APP@|$APP|g" "$PI/sfbayswims-bundles.cron" > /etc/cron.d/sfbayswims-bundles; chmod 644 /etc/cron.d/sfbayswims-bundles

say "done — reboot. Then: journalctl -u sfbayswims-serve -u sfbayswims-ambient; systemctl --user status sfbayswims-kiosk"
