#!/usr/bin/env bash
# The same validated, atomic bundle refresh used by CI.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/../.."
exec python3 tools/refresh_bundles.py "$@"
