# Aquatic Park button board — Raspberry Pi Pico / Pico 2 with CircuitPython + adafruit_hid. The Pi sees a plain USB
# keyboard named "Aquatic Buttons" (boot.py), so the frame needs no driver or OS config.
#
#   ◀ GP2   ▶ GP3   ● GP4   — momentary buttons to GND (internal pull-ups)
#   ◀ / ▶ press … release   → Left / Right arrow held for the duration (tap = 5 min, hold = accelerating time travel)
#   ● tap / double / triple → Down (next route) / p (photo mode) / v (switch view)
#   ● hold 1–8 s, release   → n (back to current)
#   ● hold ≥ 8 s            → w, held (forget Wi-Fi → the setup hotspot comes back)
import time, board, digitalio, usb_hid
from adafruit_hid.keyboard import Keyboard
from adafruit_hid.keycode import Keycode

kbd = Keyboard(usb_hid.devices); kbd.release_all()
def pin(p):
    d = digitalio.DigitalInOut(p); d.direction = digitalio.Direction.INPUT; d.pull = digitalio.Pull.UP; return d
LEFT, RIGHT, SEL = pin(board.GP2), pin(board.GP3), pin(board.GP4)
DEBOUNCE, TAP_WINDOW, HOLD_N, HOLD_W = 0.02, 0.4, 1.0, 8.0

class Debounced:
    def __init__(self, d): self.d = d; self.state = False; self.last = time.monotonic(); self.raw = False
    def update(self):
        raw = not self.d.value; now = time.monotonic()
        if raw != self.raw: self.raw = raw; self.last = now
        if raw != self.state and now - self.last >= DEBOUNCE: self.state = raw; return True
        return False

def tap(code): kbd.press(code); time.sleep(0.03); kbd.release(code)

left, right, sel = Debounced(LEFT), Debounced(RIGHT), Debounced(SEL)
taps, down_at, last_up, w_sent = 0, None, None, False
while True:
    if left.update(): (kbd.press if left.state else kbd.release)(Keycode.LEFT_ARROW)
    if right.update(): (kbd.press if right.state else kbd.release)(Keycode.RIGHT_ARROW)
    now = time.monotonic()
    if sel.update():
        if sel.state: down_at, w_sent = now, False
        else:
            held = now - down_at if down_at else 0; down_at = None
            if w_sent: kbd.release(Keycode.W)                        # the long hold ends
            elif held >= HOLD_N: tap(Keycode.N)                      # a 1–8 s hold: back to current
            else: taps += 1; last_up = now                           # anything shorter counts as a tap
    if down_at is not None and not w_sent and now - down_at >= HOLD_W: kbd.press(Keycode.W); w_sent = True   # held: `w` stays down until release
    if taps and down_at is None and last_up is not None and now - last_up >= TAP_WINDOW:
        tap(Keycode.DOWN_ARROW if taps == 1 else Keycode.P if taps == 2 else Keycode.V); taps = 0
    time.sleep(0.005)
