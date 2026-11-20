#!/bin/bash
# Run the real service with the real engine on the PC, the way the head unit
# will: test/e2e.js plays the app's part (it says "parked", starts a game,
# presses keys, goes away) and checks what the service and the engine do.
#
#     bash tools/run/service.sh [name]          default name: e2e
#
# HL_E2E=engine or HL_E2E=service runs one half only; HL_E2E_HOLD=<seconds>
# shortens the long hold (75 s, longer than any timeout inside the engine).
#
# In the test image (docker/test): Node 8, no network, a read-only root, the
# game data mounted read-only, a sound device with a clock and no speakers.
# The engine is the fresh build in <work>/out/tool, or the one committed in
# native/clucraft-halflife/bin with HL_BIN=repo.
#
# Results in <work>/run/<name>/: result.txt, *.png (frames), sound.wav,
# service.log, state/ (what the engine wrote).
set -euo pipefail

name=${1:-e2e}
repo=$(cd "$(dirname "$0")/../.." && pwd)
work=${HL_WORK:-$HOME/hl-idrive}
data=${HL_DATA:-/mnt/d/SteamLibrary/steamapps/common/Half-Life}
image=halflife-idrive-test:bionic
run="$work/run/$name"

[ -d "$data/valve" ] || { echo "no valve folder under $data (set HL_DATA)"; exit 1; }
if [ "${HL_BIN:-}" = repo ]; then bin="$repo/native/clucraft-halflife/bin"; else bin="$work/out/tool"; fi
[ -x "$bin/clucraft-hl" ] || { echo "no engine in $bin: run tools/build/build.sh"; exit 1; }

docker build -q -t halflife-idrive-build:bionic "$repo/docker/build" >/dev/null
docker build -q -t "$image" "$repo/docker/test" >/dev/null

rm -rf "$run"
mkdir -p "$run"

docker run --rm \
  --user "$(id -u):$(id -g)" \
  --network none \
  --read-only --tmpfs /tmp \
  -e HOME=/tmp \
  -e HL_E2E="${HL_E2E:-}" \
  -e HL_E2E_HOLD="${HL_E2E_HOLD:-}" \
  -v "$bin":/opt/hl/tool:ro \
  -v "$data":/hl:ro \
  -v "$run":/run-hl \
  -v "$repo":/repo:ro \
  "$image" bash /repo/tools/run/service-in-container.sh

echo "== $run"
ls -l "$run" | sed 1d
