# Name the board "Aquatic Buttons" (the Pi's Wi-Fi-reset service watches for that name), and hide the CIRCUITPY drive
# so the Pi only sees a keyboard — hold ● (GP4) while plugging in to get the drive back for editing. The serial console
# stays on for debugging.
import board, digitalio, storage, supervisor, usb_hid
supervisor.set_usb_identification(manufacturer="Aquatic Park", product="Aquatic Buttons")
btn = digitalio.DigitalInOut(board.GP4); btn.direction = digitalio.Direction.INPUT; btn.pull = digitalio.Pull.UP
if btn.value: storage.disable_usb_drive()
btn.deinit()
usb_hid.enable((usb_hid.Device.KEYBOARD,))
