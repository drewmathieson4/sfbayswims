#!/usr/bin/env python3
"""The dial on the Pi's own GPIO header. A quadrature encoder with a push switch becomes the same "SFBay Buttons"
keyboard the Pico presents (tools/pi/pico/code.py): a detent is a left/right arrow tap, `b` is held while the knob is
pressed, and `w` joins it after eight seconds (tools/pi/wifi_reset.py). The gestures are decoded in the browser
(js/frame/button.js, controls.js), so neither it nor the Wi-Fi reset knows which board is fitted. Root (systemd), for
/dev/uinput. Needs python3-gpiozero + python3-lgpio (on Raspberry Pi OS already) and python3-evdev.

  encoder  A → GPIO17 (pin 11)    C, the middle leg → GND (pin 9)    B → GPIO27 (pin 13)
  switch   one leg → GPIO22 (pin 15)    the other → GND (pin 14)
  Internal pull-ups: no 3V3 and no resistors. GPIO2/3 (pins 3, 5) stay free for the light sensor.

  --dry      print the events without creating the keyboard — a bench test over SSH; needs neither root nor evdev
  --reverse  if clockwise goes back in time (or swap the A and B wires)"""
import argparse, signal, sys, threading

HOLD_W = 8.0      # seconds of hold before `w` (forget Wi-Fi)
DEBOUNCE = 0.02   # the switch only; the encoder's state machine rejects bounce by itself


class Keys:
    def __init__(self, dry=False, verbose=False):
        self.ui, self.verbose, self.down, self.lock = None, verbose or dry, set(), threading.Lock()
        if dry: return
        import evdev
        e = self.e = evdev.ecodes
        # every ordinary key, so udev tags this as a keyboard and the compositor hands its keys to Chromium
        self.ui = evdev.UInput({e.EV_KEY: list(range(e.KEY_ESC, e.KEY_KPDOT + 1)) + [e.KEY_LEFT, e.KEY_RIGHT]}, name="SFBay Buttons")

    def _write(self, key, value):
        if self.verbose: print(key, "down" if value else "up", flush=True)
        if self.ui: self.ui.write(self.e.EV_KEY, self.e.ecodes["KEY_" + key], value); self.ui.syn()

    def press(self, key):
        with self.lock:
            if key not in self.down: self.down.add(key); self._write(key, 1)

    def release(self, key):
        with self.lock:
            if key in self.down: self.down.discard(key); self._write(key, 0)

    def tap(self, key):
        with self.lock: self._write(key, 1); self._write(key, 0)

    def close(self):
        if self.ui: self.ui.close()


def wire(encoder, switch, keys, reverse=False):
    cw, ccw = ("LEFT", "RIGHT") if reverse else ("RIGHT", "LEFT")
    encoder.when_rotated_clockwise = lambda: keys.tap(cw)
    encoder.when_rotated_counter_clockwise = lambda: keys.tap(ccw)
    switch.when_pressed = lambda: keys.press("B")
    switch.when_held = lambda: keys.press("W")                       # stays down until release, as on the Pico
    switch.when_released = lambda: (keys.release("B"), keys.release("W"))


def main():
    ap = argparse.ArgumentParser(description="GPIO dial → the 'SFBay Buttons' keyboard")
    ap.add_argument("--a", type=int, default=17); ap.add_argument("--b", type=int, default=27); ap.add_argument("--sw", type=int, default=22)
    ap.add_argument("--reverse", action="store_true"); ap.add_argument("--dry", action="store_true"); ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    from gpiozero import RotaryEncoder, Button
    keys = Keys(args.dry, args.verbose)
    encoder = RotaryEncoder(args.a, args.b, max_steps=0)             # endless: count without limits
    switch = Button(args.sw, pull_up=True, bounce_time=DEBOUNCE, hold_time=HOLD_W)
    wire(encoder, switch, keys, args.reverse)
    print(f"dial on GPIO{args.a}/GPIO{args.b}, switch on GPIO{args.sw}" + (" (dry run)" if args.dry else ""), flush=True)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try: signal.pause()
    except KeyboardInterrupt: pass
    finally: keys.close()


if __name__ == "__main__": main()
