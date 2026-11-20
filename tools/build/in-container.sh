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

# What the Store tool ships (native/clucraft-halflife/bin): one flat folder,
# stripped. The launcher gets a name of its own, because the head unit's crash
# handler knows programs by file name and "xash3d" could be anybody's. Only
# the launcher is executable: the Store lists every executable ELF file with
# the crash handler, and the libraries are not programs.
echo "== tool files"
tool="$out/tool"
rm -rf "$tool"
mkdir -p "$tool"
cp "$out/engine/xash3d" "$tool/clucraft-hl"
cp "$out/engine/libxash.so" "$out/engine/filesystem_stdio.so" \
   "$out/engine/libref_soft.so" "$out/engine/libmenu.so" \
   "$out/game/hl_amd64.so" "$out/game/client_amd64.so" "$tool/"
strip --strip-unneeded "$tool"/clucraft-hl "$tool"/*.so
cp "$out/engine/valve/extras.pk3" "$tool/extras.pk3"
cp "$out/game/LICENSE.hlsdk" "$tool/LICENSE.hlsdk"
chmod 0755 "$tool/clucraft-hl"
chmod 0644 "$tool"/*.so "$tool/extras.pk3" "$tool/LICENSE.hlsdk"

# What these files were built from, so the copy committed in the repository
# can be checked against its sources (test/run.js does).
. /repo/port/pins.env
ENGINE_URL="$ENGINE_URL" HLSDK_URL="$HLSDK_URL" HL_FLAGS="$opt" python3 - "$tool" <<'EOF'
import hashlib, json, os, subprocess, sys

tool = sys.argv[1]
sha = lambda data: hashlib.sha256(data).hexdigest()
lf = lambda data: data.replace(b'\r\n', b'\n')
rev = lambda d: subprocess.check_output(['git', '-C', d, 'rev-parse', 'HEAD']).decode().strip()

# this project's own engine files, as one hash: each file's path, then its text
backend = hashlib.sha256()
root = '/repo/port/engine'
for d, _, names in sorted(os.walk(root)):
    for n in sorted(names):
        p = os.path.join(d, n)
        backend.update((os.path.relpath(p, '/repo').replace(os.sep, '/') + '\n').encode())
        backend.update(lf(open(p, 'rb').read()))

files = {}
for n in sorted(os.listdir(tool)):
    if n == 'BUILD.json':
        continue
    data = open(os.path.join(tool, n), 'rb').read()
    files[n] = {'size': len(data), 'sha256': sha(data)}

out = {
    'engine': {'url': os.environ['ENGINE_URL'], 'commit': rev('/work/xash3d-fwgs'),
               'patch': sha(lf(open('/repo/port/engine.patch', 'rb').read())), 'backend': backend.hexdigest()},
    'hlsdk': {'url': os.environ['HLSDK_URL'], 'commit': rev('/work/hlsdk-portable')},
    'built': {'image': 'ubuntu:18.04', 'gcc': subprocess.check_output(['gcc', '-dumpfullversion']).decode().strip(),
              'flags': os.environ['HL_FLAGS']},
    'files': files,
}
with open(os.path.join(tool, 'BUILD.json'), 'w') as f:
    json.dump(out, f, indent=2, sort_keys=True)
    f.write('\n')
EOF

echo "== result"
cd "$out"
find . -type f | sort | while read -r f; do
  printf '%10s  %s\n' "$(stat -c %s "$f")" "$f"
done

echo "== checks"
bash /repo/tools/build/check-elf.sh "$out"
