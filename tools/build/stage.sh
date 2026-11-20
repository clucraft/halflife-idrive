#!/bin/bash
# Put the built engine where the Store takes it from: the tool's bin/ folder
# in this repository. The Store installs a tool from files committed in the
# repository, so these binaries are committed, with BUILD.json beside them
# saying which sources they were built from.
#
#     bash tools/build/build.sh && bash tools/build/stage.sh
#
# No game data is involved: these are the engine and the game libraries only.
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
work=${HL_WORK:-$HOME/hl-idrive}
from="$work/out/tool"
to="$repo/native/clucraft-halflife/bin"

[ -f "$from/BUILD.json" ] || { echo "nothing built yet in $from: run tools/build/build.sh"; exit 1; }
bash "$repo/tools/build/check-elf.sh" "$from" >/dev/null || { echo "the build does not pass tools/build/check-elf.sh: not staged"; exit 1; }

mkdir -p "$to"
rm -f "$to"/*
cp "$from"/* "$to/"

echo "staged in native/clucraft-halflife/bin:"
(cd "$to" && ls -l | sed 1d | awk '{ printf "%10s  %s\n", $5, $9 }')
du -sh "$to" | awk '{ print "total " $1 }'
