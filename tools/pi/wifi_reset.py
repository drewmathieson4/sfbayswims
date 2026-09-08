#!/usr/bin/env python3
"""Forget every saved Wi-Fi network when the button board sends `w` key-down after ● is held 8 s, so comitup raises
the "aquatic-park" setup hotspot again. Root (systemd). Watches only the keyboard named "Aquatic Buttons"."""
import subprocess, time, sys
try: import evdev
except ImportError: print("python3-evdev missing — Wi-Fi reset disabled"); sys.exit(0)

def find_board():
    board = None
    for path in evdev.list_devices():
        d = evdev.InputDevice(path)
        if board is None and "aquatic buttons" in d.name.lower(): board = d
        else: d.close()
    return board

def forget_wifi():
    out = subprocess.run(["nmcli", "-t", "-f", "UUID,TYPE,NAME", "connection", "show"], capture_output=True, text=True).stdout
    for line in out.splitlines():
        uuid, typ, name = line.split(":", 2)
        if typ == "802-11-wireless" and not name.lower().startswith("comitup"):
            subprocess.run(["nmcli", "connection", "delete", "uuid", uuid]); print("forgot", name, flush=True)
    subprocess.run(["systemctl", "restart", "comitup"], stderr=subprocess.DEVNULL)

def main():
    while True:
        board = find_board()
        if board is None: time.sleep(10); continue
        print("watching", board.name, flush=True)
        try:
            for ev in board.read_loop():
                if ev.type != evdev.ecodes.EV_KEY or ev.code != evdev.ecodes.KEY_W: continue
                if ev.value == 1: forget_wifi()  # the Pico has already timed the eight-second hold
        except OSError:
            pass                                   # unplugged → rescan
        finally:
            try: board.close()
            except Exception: pass
        time.sleep(2)

if __name__ == "__main__": main()
