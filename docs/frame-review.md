# Frame inspection notes

Collect requested changes here while Drew inspects the frame. Implement them as a batch only when requested.

## Applied — September 8, 2026

- Remove the start/end time labels from the current-cycle graph; its 12-hour span is understood. Keep the selected-time marker. Applied locally and included in the frame-only package.
- Remove the approximation symbol (`≈`) from the frame's FLOOD/EBB current-speed reading. Example: `FLOOD ≈1.4 KN` → `FLOOD 1.4 KN`. Jean-Marc understands these are predictions. Applied locally and included in the frame-only package. This request does not change the temperature reading or prediction data.

- Always show the date alongside the time. Show a relative offset only while browsing time with the dial; returning to now clears it. No LIVE label. Applied locally and included in the frame-only package.
