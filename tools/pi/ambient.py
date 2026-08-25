#!/usr/bin/env python3
"""Room light → /run/aquatic/ambient.json {"lux": …, "t": …} every 2 s (smoothed), read by js/ambient.js.

Sensor on I²C-1: VEML7700 (0x10) or BH1750 (0x23). Without a sensor it exits quietly (the app then stays at full
brightness). Options: --out PATH (default /run/aquatic/ambient.json), --print.
"""
import json, os, sys, time

def opt(name, default=None):
    a = sys.argv[1:]; return a[a.index(name) + 1] if name in a else default
OUT = opt("--out", "/run/aquatic/ambient.json"); PRINT = "--print" in sys.argv

class VEML7700:
    ADDR = 0x10
    def __init__(self, bus): self.bus = bus; bus.write_word_data(self.ADDR, 0x00, 0x1000)   # gain 1/8, 100 ms, power on
    def lux(self):
        lux = self.bus.read_word_data(self.ADDR, 0x04) * 0.4608                              # 1/8 gain @ 100 ms → 0.4608 lx/count
        if lux > 1000: lux = 6.0135e-13 * lux**4 - 9.3924e-9 * lux**3 + 8.1488e-5 * lux**2 + 1.0023 * lux   # datasheet correction
        return lux
class BH1750:
    ADDR = 0x23
    def __init__(self, bus): self.bus = bus; bus.write_byte(self.ADDR, 0x01)                # power on
    def lux(self):
        d = self.bus.read_i2c_block_data(self.ADDR, 0x20, 2)                                # one-shot high-res measurement
        return ((d[0] << 8) | d[1]) / 1.2

def open_sensor(bus):
    for cls in (VEML7700, BH1750):
        try: s = cls(bus); s.lux(); print("sensor:", cls.__name__, flush=True); return s
        except Exception: pass
    return None

def main():
    try: import smbus
    except ImportError: print("python3-smbus not installed — no light sensor"); return 0
    try: bus = smbus.SMBus(1)
    except Exception as e: print("no i2c bus:", e); return 0
    sensor = open_sensor(bus)
    if sensor is None: print("no light sensor found on i2c-1 (VEML7700 0x10 / BH1750 0x23)"); return 0
    ema = None
    while True:
        try:
            lux = sensor.lux(); ema = lux if ema is None else ema + (lux - ema) * 0.3
            tmp = OUT + ".tmp"
            with open(tmp, "w") as f: json.dump({"lux": round(ema, 2), "raw": round(lux, 2), "t": int(time.time() * 1000)}, f)
            os.replace(tmp, OUT)
            if PRINT: print(f"{ema:8.1f} lx", flush=True)
        except Exception as e:
            print("ambient:", e, file=sys.stderr, flush=True); time.sleep(5)
        time.sleep(2)

if __name__ == "__main__": sys.exit(main() or 0)
