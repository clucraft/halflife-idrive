#!/bin/bash
# Runs inside the test container, started by service.sh.
set -u

# A sound device with a clock: PulseAudio with one 48 kHz null sink and no
# other module. The engine reaches it through the ALSA name car
# (asound-test.conf); parec records what arrives there.
export HOME=/tmp/home XDG_RUNTIME_DIR=/tmp/xdg   # PulseAudio wants a home of its user's own
mkdir -p "$HOME" "$XDG_RUNTIME_DIR" && chmod 700 "$HOME" "$XDG_RUNTIME_DIR"
export PULSE_SERVER=unix:/tmp/pulse.sock
pulseaudio -n --daemonize=yes --exit-idle-time=-1 --log-target=file:/run-hl/pulse.log \
  --load="module-native-protocol-unix socket=/tmp/pulse.sock auth-anonymous=1" \
  --load="module-null-sink sink_name=car rate=48000 channels=2 format=s16le" \
  || echo "pulseaudio did not start: the sound checks will fail"
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -S /tmp/pulse.sock ] && break; sleep 0.3; done

parec --device=car.monitor --format=s16le --rate=48000 --channels=2 --latency-msec=50 >/run-hl/sound.raw 2>/run-hl/parec.log &
rec=$!

export E2E_ALSA_CONFIG=/usr/share/alsa/alsa.conf:/repo/tools/run/asound-test.conf
node /repo/test/e2e.js >/run-hl/service.log 2>&1
code=$?

kill "$rec" 2>/dev/null
wait "$rec" 2>/dev/null
pulseaudio --kill 2>/dev/null

# what was recorded: its length, how loud it is, and a WAV to listen to
python3 - <<'EOF' | tee -a /run-hl/result.txt
import struct, array, math, os
p = '/run-hl/sound.raw'
raw = open(p, 'rb').read() if os.path.exists(p) else b''
raw = raw[:len(raw) // 4 * 4]
a = array.array('h'); a.frombytes(raw)
secs = len(a) / 2 / 48000.0
loud = [abs(v) for v in a[::7]]
rms = math.sqrt(sum(v * v for v in loud) / len(loud)) if loud else 0.0
nonzero = sum(1 for v in loud if v > 64) / float(len(loud)) if loud else 0.0
with open('/run-hl/sound.wav', 'wb') as f:
    f.write(b'RIFF' + struct.pack('<I', 36 + len(raw)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 2, 48000, 48000 * 4, 4, 16) + b'data' + struct.pack('<I', len(raw)) + raw)
os.remove(p)
print('sound recorded: %.1f s at 48 kHz, RMS %.0f of 32768, %.0f%% of it above silence' % (secs, rms, nonzero * 100))
# (judged only on a run long enough to hold a stretch of the game: the whole test, or its engine half)
print('SOUND ' + ('ok' if secs > 20 and rms > 100 else 'FAILED' if secs > 20 else 'not judged: a short run'))
EOF

echo "--- e2e exit code $code"
cat /run-hl/result.txt
exit $code
