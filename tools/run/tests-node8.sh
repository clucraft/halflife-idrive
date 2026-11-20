#!/bin/bash
# The unit tests (test/run.js) on Node 8, in the test image: Ubuntu 18.04's
# Node is 8.10, the head unit's is 8.16. Syntax and library calls the car's
# Node does not have fail here instead of in the car.
#
#     bash tools/run/tests-node8.sh [a test's name, or part of it]
#
# No network, no game data. The repository is mounted writable because the
# app's build writes dist/ and a marked stand-in oap-sdk/ (both git-ignored).
# "npm run test:node8" does the same on Windows or macOS with a Node 8 it
# downloads from nodejs.org.
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
image=halflife-idrive-test:bionic

docker build -q -t halflife-idrive-build:bionic "$repo/docker/build" >/dev/null
docker build -q -t "$image" "$repo/docker/test" >/dev/null

docker run --rm \
  --user "$(id -u):$(id -g)" \
  --network none \
  -e HOME=/tmp \
  -v "$repo":/repo \
  -w /repo \
  "$image" node test/run.js "$@"
