# Aquatic Park button board — Raspberry Pi Pico / Pico 2 with CircuitPython + adafruit_hid. The Pi sees a plain USB
# keyboard named "Aquatic Buttons" (boot.py), so the frame needs no driver or OS config. The gestures (click, double,
# triple, hold) are decoded in the browser (js/frame/button.js); this board only reports the button's state.
#
#   ◀ GP2   ▶ GP3   ● GP4   — momentary buttons to GND (internal pull-ups)
#   ● press … release       → `b` held for the duration (the frame decodes taps and the 0.6-s hold)
#   ● held ≥ 8 s            → `w` pressed as well, until release (tools/pi/wifi_reset.py: forget Wi-Fi → the setup hotspot)
#   ◀ / ▶ press … release   → Left / Right arrow held (unused by the frame; kept for a future mapping)
import time, board, digitalio, usb_hid
from adafruit_hid.keyboard import Keyboard
from adafruit_hid.keycode import Keycode

kbd = Keyboard(usb_hid.devices); kbd.release_all()
def pin(p):
    d = digitalio.DigitalInOut(p); d.direction = digitalio.Direction.INPUT; d.pull = digitalio.Pull.UP; return d
LEFT, RIGHT, SEL = pin(board.GP2), pin(board.GP3), pin(board.GP4)
DEBOUNCE, HOLD_W = 0.02, 8.0

class Debounced:
    def __init__(self, d): self.d = d; self.state = False; self.last = time.monotonic(); self.raw = False
    def update(self):
        raw = not self.d.value; now = time.monotonic()
        if raw != self.raw: self.raw = raw; self.last = now
        if raw != self.state and now - self.last >= DEBOUNCE: self.state = raw; return True
        return False

left, right, sel = Debounced(LEFT), Debounced(RIGHT), Debounced(SEL)
down_at, w_sent = None, False
while True:
    if left.update(): (kbd.press if left.state else kbd.release)(Keycode.LEFT_ARROW)
    if right.update(): (kbd.press if right.state else kbd.release)(Keycode.RIGHT_ARROW)
    now = time.monotonic()
    if sel.update():
        if sel.state: kbd.press(Keycode.B); down_at, w_sent = now, False
        else:
            kbd.release(Keycode.B); down_at = None
            if w_sent: kbd.release(Keycode.W); w_sent = False
    if down_at is not None and not w_sent and now - down_at >= HOLD_W: kbd.press(Keycode.W); w_sent = True   # the long hold: `w` stays down until release
    time.sleep(0.005)
