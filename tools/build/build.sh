#!/bin/bash
# Build the engine and the game libraries for the head unit.
#
# Run inside WSL (or any Linux with Docker):
#     bash tools/build/build.sh
#
# What it does:
#   1. fetches the upstream sources at the commits in port/pins.env into a
#      work folder outside this repository (default ~/hl-idrive),
#   2. lays this repository's changes over the engine source
#      (port/engine.patch and the files under port/engine/),
#   3. builds everything in an Ubuntu 18.04 container,
#   4. checks that the result can run on the head unit's C library,
#   5. leaves the result in <work>/out and prints where.
#
# Nothing here touches the car or the game data.
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
. "$repo/port/pins.env"
work=${HL_WORK:-$HOME/hl-idrive}
image=halflife-idrive-build:bionic

mkdir -p "$work"

fetch() {
  local dir=$1 url=$2 rev=$3
  if [ ! -d "$work/$dir/.git" ]; then
    git clone -q "$url" "$work/$dir"
  fi
  if ! git -C "$work/$dir" cat-file -e "$rev^{commit}" 2>/dev/null; then
    git -C "$work/$dir" fetch -q origin
  fi
  git -C "$work/$dir" checkout -q -f "$rev"
  git -C "$work/$dir" submodule update -q --init --recursive
}

echo "== sources"
fetch xash3d-fwgs "$ENGINE_URL" "$ENGINE_REV"
fetch hlsdk-portable "$HLSDK_URL" "$HLSDK_REV"

echo "== overlay"
git -C "$work/xash3d-fwgs" clean -q -fd -- engine/platform/mgu
git -C "$work/xash3d-fwgs" apply --whitespace=nowarn "$repo/port/engine.patch"
cp -r "$repo/port/engine/." "$work/xash3d-fwgs/engine/"
git -C "$work/xash3d-fwgs" status --short

echo "== image"
docker build -q -t "$image" "$repo/docker/build" >/dev/null

echo "== build"
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e HL_MARCH="${HL_MARCH:-silvermont}" \
  -e HL_JOBS="${HL_JOBS:-$(nproc)}" \
  -v "$work":/work \
  -v "$repo":/repo:ro \
  "$image" bash /repo/tools/build/in-container.sh

echo "== done: $work/out"
