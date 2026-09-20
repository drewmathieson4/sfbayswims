"""The GPIO dial speaks the Pico's keyboard protocol: arrow taps, `b` held while pressed, `w` joining after the long hold."""
import contextlib, importlib.util, io, unittest
from pathlib import Path
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('encoder', Path(__file__).resolve().parent.parent / 'tools/pi/encoder.py')
encoder = importlib.util.module_from_spec(spec); spec.loader.exec_module(encoder)


def rig(reverse=False):
    dial, switch, keys, out = SimpleNamespace(), SimpleNamespace(), encoder.Keys(dry=True), io.StringIO()
    encoder.wire(dial, switch, keys, reverse)
    def events(*callbacks):
        out.seek(0); out.truncate()
        with contextlib.redirect_stdout(out):
            for callback in callbacks: callback()
        return out.getvalue().split('\n')[:-1]
    return dial, switch, events


class EncoderProtocol(unittest.TestCase):
    def test_detents_are_arrow_taps(self):
        dial, _, events = rig()
        self.assertEqual(events(dial.when_rotated_clockwise, dial.when_rotated_counter_clockwise),
                         ['RIGHT down', 'RIGHT up', 'LEFT down', 'LEFT up'])

    def test_reverse_swaps_direction(self):
        dial, _, events = rig(reverse=True)
        self.assertEqual(events(dial.when_rotated_clockwise), ['LEFT down', 'LEFT up'])

    def test_press_holds_b_until_release(self):
        _, switch, events = rig()
        self.assertEqual(events(switch.when_pressed, switch.when_pressed), ['B down'])   # no repeats from a bounce
        self.assertEqual(events(switch.when_released, switch.when_released), ['B up'])

    def test_long_hold_adds_w_until_release(self):
        _, switch, events = rig()
        self.assertEqual(events(switch.when_pressed, switch.when_held, switch.when_released), ['B down', 'W down', 'B up', 'W up'])


if __name__ == '__main__': unittest.main()
