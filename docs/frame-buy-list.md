# Frame purchase checklist — September 8, 2026

Assumptions: 15.6-inch landscape display, US wall outlets, existing Raspberry Pi 4 and SD card.
Drew selected a black metal knob, tactile detents and a built-in push switch, connected directly to Pi GPIO.
He has a breadboard and jumper wires and can borrow a friend's soldering tools. No items below are recorded as ordered.
The existing Pi power supply's label and the final screen size still need confirmation.

## One DigiKey order

Prices and availability were checked on September 8; checkout determines shipping, tax, tariffs and delivery.
Use DigiKey-stocked items together rather than separately shipped marketplace alternatives.

| Qty | Part | Purpose | Line cost |
| --- | --- | --- | ---: |
| 1 | [Adafruit 377](https://www.digikey.com/en/products/detail/adafruit-industries-llc/377/7902287) | Endless encoder, tactile detents, built-in push switch | $4.50 |
| 1 | [Adafruit 5527](https://www.digikey.com/en/products/detail/adafruit-industries-llc/5527/16653407) | Black aluminum 20 mm knob, 6 mm bore, set screw | $2.95 |
| 1 | [Adafruit 4162](https://www.digikey.com/en/products/detail/adafruit-industries-llc/4162/9997696) | VEML7700 ambient light sensor for app dimming | $4.95 |
| 1 | [Adafruit 4397](https://www.digikey.com/en/products/detail/adafruit-industries-llc/4397/10824270) | 150 mm QT-to-female GPIO cable for sensor | $0.95 |
| 1 | [DFRobot FIT0664](https://www.digikey.com/en/products/detail/dfrobot/FIT0664/13166488) | Micro-HDMI male to full-size HDMI female adapter for Pi | $3.90 |
| 1 | [Raspberry Pi SC1158](https://www.digikey.com/en/products/detail/raspberry-pi/SC1158/21658259) | Black US 27 W USB-C PD supply, recommended for monitor | $12.00 |
| 2 | [Adafruit 5248](https://www.digikey.com/en/products/detail/adafruit-industries-llc/5248/17039168) | Eight M2.5 nylon standoffs, screws and nuts total, for Pi and sensor | $3.00 |

Subtotal: **$32.25**. Omit the HDMI adapter if an equivalent is already owned.
The mounting kits suit a thin internal mounting plate; attachment to a thick wooden back may need longer fasteners.

Conditional additions:

- [Seeed 110991327 Pi 4 heatsink kit](https://www.digikey.com/en/products/detail/seeed-technology-co-ltd/110991327/10451876),
  $0.99 if the Pi does not already have heatsinks or a cooling case. Enclosed thermal performance remains untested;
  a fan is conditional on that test, not assumed necessary from the current open-air temperature.
- A second SC1158 supply, $12, only if the existing Pi supply is unsuitable or will not be included with the gift.
- Jumper leads with female sockets if the existing wires are all male-to-male. A permanent encoder harness needs
  insulated solder joints, a removable Pi connection, and strain relief; use the existing wires if suitable.

The [27 W supply](https://www.raspberrypi.com/products/27w-power-supply/) is a USB-C PD supply;
its available power is sufficient based on the monitor's published requirements. This is a specification-based
recommendation, not a tested or manufacturer-certified VA1655 pairing. Power the Pi and monitor independently.
The supply has an attached USB-C cable; an additional USB power cable is not needed for this arrangement.

## Monitor order

[ViewSonic VA1655](https://www.viewsonic.com/us/va1655-15-6-portable-1080p-ips-monitor-with-usb-c-and-mini-hdmi.html):
**$109.99**, listed in stock at ViewSonic. No DigiKey listing was found. Compare delivered price and return terms
at ViewSonic and its retailers; do not assume free shipping or a guaranteed arrival date.

This is a complete 15.6-inch 1920×1080 IPS anti-glare monitor; keep its housing intact. No separate LCD controller
board is required. The US package lists an HDMI-to-mini-HDMI cable and a USB-C cable but no wall power adapter.
Video path: Pi micro-HDMI → FIT0664 adapter → included HDMI-to-mini-HDMI cable → monitor.

Published physical size is about 359.3 × 227 × 17.4 mm, with a 344.16 × 193.59 mm active image
([manual](https://manuals.viewsonic.com/VA1655_Specifications)). Measure the delivered unit, folded stand,
connectors and cable bend clearance before cutting the mat or making mounting brackets.

Monitor plus DigiKey subtotal: **$142.24** before shipping/tax/tariffs, or **$143.23** with the optional heatsinks.
This excludes framing, wall mounting, any replacement Pi supply, assembly consumables and a power strip.

## Reuse or borrow

- Existing Pi 4, SD card, breadboard, suitable jumper leads and verified Pi power supply.
- Soldering iron, electronics solder, wire stripper/cutter, heat-shrink tubing and suitable heat source.
- 2 mm hex key for the knob, small Phillips screwdriver, and multimeter for checking encoder/switch terminals.
- Small cable ties and cable anchors for strain relief.
- A finished, certified power strip with enough spacing for two wall adapters, if one cable to the wall is wanted.
  Keep the wall adapters outside the wooden frame; route their low-voltage leads to the Pi and monitor.

## Specify with the framer after the monitor arrives

- Deep wooden frame or shadow box, mat cut to the actual image, and no extra glazing over the anti-glare screen.
- Removable, ventilated rear panel and thin internal mounting plate for electronics.
- Padded mechanical supports retaining the monitor by its housing, without pressure on its LCD.
- Thin bracket or recessed mount for the encoder, with press travel and finger clearance for its knob.
- Sensor opening exposed to room light, positioned away from the display's own light; place the Pi close enough
  for the 150 mm sensor cable or determine the required extension after laying out the parts.
- Protected cable exits, strain relief, screws appropriate to the actual wood and hardware, and a wall hanger
  rated for the completed assembly and the recipient's wall type.
- Protective packing for shipment. Reserve the framer's time now; finalize dimensions only after acceptance tests.

## Checks before committing to custom framing

1. Monitor picture quality and controls at 1920×1080 on the Pi with VNC disconnected.
2. Automatic recovery after removing/restoring power, HDMI input selection, and brightness setting retention.
   These monitor behaviors are not yet verified. Buy with a usable return window.
3. Physical encoder detents, direction, fast turns and all press gestures. Direct GPIO software still needs implementation.
4. Room-light dimming and Wi-Fi handoff on this Trixie installation.
5. Closed-frame 48-hour run, thermal check and repeated cold starts. Current physical animation was user-approved,
   but the measured Bay update rate was about 14/s, not a verified 30/s.

Aim to receive and test the monitor and electronics before final fabrication, leave several days for the enclosed
test, and choose shipping for the recipient's actual early-October delivery date.
