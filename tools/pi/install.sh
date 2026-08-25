#!/usr/bin/env bash
# Provision a Raspberry Pi (Raspberry Pi OS Desktop, labwc) as the Aquatic Park frame.
#   sudo bash tools/pi/install.sh [--user pi] [--no-comitup]
# Idempotent: re-run after editing the app — it re-syncs /opt/aquatic-park and restarts the services.
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
SRC=$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd); APP=/opt/aquatic-park; PI="$APP/tools/pi"
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

say "packages"
apt-get update -qq
apt-get install -y -qq chromium rsync curl >/dev/null || apt-get install -y -qq chromium-browser rsync curl >/dev/null   # required
apt-get install -y -qq python3-evdev python3-smbus i2c-tools >/dev/null || echo "(optional packages missing: buttons/light sensor need python3-evdev, python3-smbus)"
CHROMIUM=$(command -v chromium || command -v chromium-browser)
if [ "$WITH_COMITUP" = 1 ]; then apt-get install -y -qq comitup >/dev/null || { echo "comitup not in this repo — see README-frame.md §4"; WITH_COMITUP=0; }; fi

say "app → $APP (generated bundles are kept)"
mkdir -p "$APP"
rsync -a --delete --exclude .git --exclude venv --exclude __pycache__ --exclude .DS_Store \
  --exclude 'data/tides-*.json' --exclude 'data/currents-*.json' --exclude 'data/worlds/*/currents-*.json' "$SRC/" "$APP/"
rsync -a --ignore-existing "$SRC/data/" "$APP/data/"          # bundles from the checkout, never overwriting December's
chown -R "$USER_NAME:$USER_NAME" "$APP"; chmod +x "$APP/tools/serve.py" "$PI"/*.sh "$PI"/*.py

say "system: timezone, autologin, no blanking, i2c, linger"
timedatectl set-timezone America/Los_Angeles
command -v raspi-config >/dev/null && { raspi-config nonint do_boot_behaviour B4 || true; raspi-config nonint do_blanking 1 || true; raspi-config nonint do_i2c 0 || true; }
usermod -aG i2c,input,video "$USER_NAME" 2>/dev/null || true
loginctl enable-linger "$USER_NAME"

say "services"
for u in aquatic-serve aquatic-ambient aquatic-wifi-reset; do sed -e "s|@USER@|$USER_NAME|g" -e "s|@APP@|$APP|g" "$PI/systemd/$u.service" > "/etc/systemd/system/$u.service"; done
mkdir -p "$HOME_DIR/.config/systemd/user" "$HOME_DIR/.config/labwc" "$HOME_DIR/.kiosk"
sed -e "s|@CHROMIUM@|$CHROMIUM|g" -e "s|@HOME@|$HOME_DIR|g" -e "s|@UID@|$UID_NUM|g" "$PI/systemd/aquatic-kiosk.service" > "$HOME_DIR/.config/systemd/user/aquatic-kiosk.service"
# labwc runs the FIRST autostart it finds: ours sources the system one (panel, background, audio…), stops its screen
# blanker, then starts the kiosk browser under systemd once Wayland is up
if ! grep -q aquatic-kiosk "$HOME_DIR/.config/labwc/autostart" 2>/dev/null; then cat >> "$HOME_DIR/.config/labwc/autostart" <<'EOT'
[ -f /etc/xdg/labwc/autostart ] && . /etc/xdg/labwc/autostart
sleep 2; pkill -x swayidle || true                              # aquatic-park frame: display always on
systemctl --user import-environment WAYLAND_DISPLAY DISPLAY XDG_RUNTIME_DIR XDG_SESSION_TYPE
systemctl --user restart aquatic-kiosk.service &
EOT
fi
chown -R "$USER_NAME:$USER_NAME" "$HOME_DIR/.config" "$HOME_DIR/.kiosk"
systemctl daemon-reload
systemctl enable aquatic-serve.service aquatic-ambient.service aquatic-wifi-reset.service
systemctl restart aquatic-serve.service aquatic-ambient.service aquatic-wifi-reset.service
sudo -u "$USER_NAME" XDG_RUNTIME_DIR="/run/user/$UID_NUM" systemctl --user daemon-reload || true
sudo -u "$USER_NAME" XDG_RUNTIME_DIR="/run/user/$UID_NUM" systemctl --user enable aquatic-kiosk.service || true
sudo -u "$USER_NAME" XDG_RUNTIME_DIR="/run/user/$UID_NUM" systemctl --user restart aquatic-kiosk.service 2>/dev/null || true

if [ "$WITH_COMITUP" = 1 ]; then
  say "wi-fi captive portal (comitup): hotspot 'aquatic-park', password in tools/pi/comitup.conf"
  while IFS= read -r line; do key="${line%%:*}"; grep -q "^#\?\s*$key:" /etc/comitup.conf && sed -i "s|^#\?\s*$key:.*|$line|" /etc/comitup.conf || echo "$line" >> /etc/comitup.conf; done < "$PI/comitup.conf"
  systemctl enable --now comitup || true
fi

say "yearly bundles (every December morning until next year's exist)"
sed -e "s|@USER@|$USER_NAME|g" -e "s|@APP@|$APP|g" "$PI/aquatic-bundles.cron" > /etc/cron.d/aquatic-bundles; chmod 644 /etc/cron.d/aquatic-bundles

say "done — reboot. Then: journalctl -u aquatic-serve -u aquatic-ambient; systemctl --user status aquatic-kiosk"
