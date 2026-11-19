#!/bin/bash
# Refresh port/engine.patch from edits made to upstream files in the work
# folder's engine source. Run this before build.sh, which resets that source
# to the pinned commit and applies the patch again.
#
#     bash tools/build/save-patch.sh
#
# New files do not belong in the patch: they live under port/engine/.
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
work=${HL_WORK:-$HOME/hl-idrive}

git -C "$work/xash3d-fwgs" diff --no-color > "$repo/port/engine.patch"
git -C "$work/xash3d-fwgs" diff --stat
