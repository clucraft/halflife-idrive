#!/bin/bash
# Runs inside the build container, started by build.sh. Sources are in /work.
set -euo pipefail

march=${HL_MARCH:-silvermont}
jobs=${HL_JOBS:-4}
out=/work/out

# The head unit's CPU is an Apollo Lake Atom (Goldmont cores). GCC 7 has no
# name for those; Silvermont is the nearest older set of instructions.
opt="-O2 -march=$march -mtune=$march"

# The unit's libstdc++ is older than this container's, so the C++ runtime is
# linked in. Its loader is at /lib, not /lib64.
link="-static-libstdc++ -static-libgcc -Wl,--dynamic-linker=/lib/ld-linux-x86-64.so.2"

echo "== engine: configure"
cd /work/xash3d-fwgs
CFLAGS="$opt" CXXFLAGS="$opt" LDFLAGS="$link" python3 waf configure \
  -T release -8 \
  --enable-mgu \
  --enable-soft --disable-gl \
  --enable-bundled-deps \
  --enable-stbtt \
  --disable-werror \
  --prefix=/ >/work/engine-configure.log 2>&1 || { tail -40 /work/engine-configure.log; exit 1; }
tail -3 /work/engine-configure.log

echo "== engine: build"
python3 waf build -j"$jobs" >/work/engine-build.log 2>&1 || { grep -n -E "error|Error|undefined reference" /work/engine-build.log | head -60; tail -15 /work/engine-build.log; exit 1; }
tail -2 /work/engine-build.log

echo "== engine: install"
rm -rf "$out/engine"
python3 waf install --destdir="$out/engine" >/work/engine-install.log 2>&1 || { tail -30 /work/engine-install.log; exit 1; }

echo "== game libraries: configure and build"
mkdir -p /work/build-hlsdk
cd /work/build-hlsdk
cmake /work/hlsdk-portable \
  -DCMAKE_BUILD_TYPE=Release \
  -D64BIT=ON \
  -DGOLDSOURCE_SUPPORT=OFF \
  -DCMAKE_C_FLAGS="$opt" -DCMAKE_CXX_FLAGS="$opt" \
  -DCMAKE_SHARED_LINKER_FLAGS="-static-libstdc++ -static-libgcc" \
  >/work/hlsdk-configure.log 2>&1 || { tail -40 /work/hlsdk-configure.log; exit 1; }
make -j"$jobs" >/work/hlsdk-build.log 2>&1 || { grep -n -E "error|undefined reference" /work/hlsdk-build.log | head -40; tail -15 /work/hlsdk-build.log; exit 1; }

rm -rf "$out/game"
mkdir -p "$out/game"
find /work/build-hlsdk -name '*_amd64.so' -exec cp {} "$out/game/" \;
cp /work/hlsdk-portable/LICENSE "$out/game/LICENSE.hlsdk" 2>/dev/null || true

echo "== result"
cd "$out"
find . -type f | sort | while read -r f; do
  printf '%10s  %s\n' "$(stat -c %s "$f")" "$f"
done

echo "== checks"
bash /repo/tools/build/check-elf.sh "$out"
