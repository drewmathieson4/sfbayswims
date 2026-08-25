#!/usr/bin/env bash
# Fill in the tide/current bundles for this year and next (skips what exists; needs Wi-Fi).
set -e; cd "$(dirname "$(readlink -f "$0")")/../.."
for Y in $(date +%Y) $(( $(date +%Y) + 1 )); do
  [ -f "data/tides-$Y.json" ]               || python3 tools/precompute_tides.py "$Y"
  [ -f "data/currents-$Y.json" ]            || python3 tools/precompute_currents.py "$Y"
  [ -f "data/worlds/bay/currents-$Y.json" ] || python3 tools/precompute_currents.py --world bay "$Y"
done
echo "bundles ok ($(date))"
