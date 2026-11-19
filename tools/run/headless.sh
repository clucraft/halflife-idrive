#!/bin/bash
# Run the built engine on the PC with no screen, the way the head unit's
# service will run it, and save what it drew.
#
#     bash tools/run/headless.sh <name> <seconds> [engine arguments...]
#
#     bash tools/run/headless.sh menu 20
#     bash tools/run/headless.sh c1a0 40 +map c1a0
#
# The game data is mounted read-only (HL_DATA, default the Steam folder on D:).
# The engine may write only to <work>/run/<name>/base; the container's own
# filesystem is read-only and it has no network, like the service on the car.
# After <seconds> the newest frame is copied out of the frame file, then the
# engine gets SIGTERM, as systemd would send it.
#
# Results in <work>/run/<name>/: engine.log, frame.png, exit-code.
set -euo pipefail

name=${1:?name}
seconds=${2:?seconds}
shift 2

repo=$(cd "$(dirname "$0")/../.." && pwd)
work=${HL_WORK:-$HOME/hl-idrive}
data=${HL_DATA:-/mnt/d/SteamLibrary/steamapps/common/Half-Life}
image=halflife-idrive-build:bionic
run="$work/run/$name"

[ -d "$data/valve" ] || { echo "no valve folder under $data (set HL_DATA)"; exit 1; }
[ -x "$work/out/engine/xash3d" ] || { echo "nothing built yet: run tools/build/build.sh"; exit 1; }

rm -rf "$run"
mkdir -p "$run/base"

# HL_BASE: a writable base folder that outlives one run (a demo recorded in
# one run and played in the next). Default: a fresh one per run.
base_mount=()
if [ -n "${HL_BASE:-}" ]; then
  mkdir -p "$HL_BASE"
  base_mount=(-v "$HL_BASE":/run-hl/base)
fi

docker run --rm \
  --user "$(id -u):$(id -g)" \
  --network none \
  --read-only --tmpfs /tmp \
  -e HOME=/tmp \
  -e HL_SECONDS="$seconds" \
  -e HL_STDIN="${HL_STDIN:-}" \
  -e HL_SOUND="${HL_SOUND:-}" \
  -v "$work/out":/opt/hl:ro \
  -v "$data":/hl:ro \
  -v "$run":/run-hl \
  "${base_mount[@]}" \
  -v "$repo":/repo:ro \
  "$image" bash /repo/tools/run/in-container.sh "$@"

echo "== $run"
ls -l "$run" | sed 1d
