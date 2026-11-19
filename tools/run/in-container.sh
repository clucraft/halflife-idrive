#!/bin/bash
# Runs inside the container, started by headless.sh.
set -u

seconds=${HL_SECONDS:-20}
frame=/run-hl/frame.mgvf

export XASH3D_BASEDIR=/run-hl/base
export XASH3D_RODIR=/hl
export XASH3D_EXTRAS_PAK1=/opt/hl/engine/valve/extras.pk3
export MGU_VIDEO_FILE=$frame

cd /opt/hl/engine

# stdin stays open and silent unless HL_STDIN names console commands to type
# once the engine is up ("cmd1;cmd2"), each after a pause of its own.
# HL_STDIN is a script for the engine's console, steps separated by ";":
# "sleep N" waits, anything else is typed as a console command.
#     HL_STDIN="sleep 10;record tram;sleep 30;stop"
feed() {
  if [ -n "${HL_STDIN:-}" ]; then
    printf '%s\n' "$HL_STDIN" | tr ';' '\n' | while read -r line; do
      case "$line" in
        "sleep "*) sleep "${line#sleep }" ;;
        *) printf '%s\n' "$line" ;;
      esac
    done
  fi
  sleep 100000
}

# HL_SOUND=1 lets the engine try the sound device. There is none in the
# container, so that run shows what a refused sound route does to the engine.
sound=-nosound
[ "${HL_SOUND:-}" = 1 ] && sound=

# HOME is unset, as it will be for the service: the engine then keeps its id
# file in the base folder only.
# Not a pipeline: "wait" on a pipeline's last process waits for all of it.
env -u HOME ./xash3d -game valve \
    -dll /opt/hl/game/hl_amd64.so \
    -clientlib /opt/hl/game/client_amd64.so \
    $sound -dev 1 -stdincmds "$@" < <(feed) >/run-hl/engine.log 2>&1 &

pid=$!
sleep 1
if ! kill -0 "$pid" 2>/dev/null; then
  echo "engine did not start"
  tail -30 /run-hl/engine.log
  echo 127 >/run-hl/exit-code
  exit 1
fi

# wait, but notice an early exit
for _ in $(seq "$seconds"); do
  kill -0 "$pid" 2>/dev/null || break
  sleep 1
done

if [ -f "$frame" ]; then
  cp "$frame" /tmp/frame.copy
  python3 /repo/tools/mgvf/mgvf2png.py /tmp/frame.copy /run-hl/frame.png
else
  echo "no frame file"
fi

if kill -0 "$pid" 2>/dev/null; then
  grep -E '^(VmRSS|VmHWM|Threads):' "/proc/$pid/status" | tr '\n' ' '; echo
  kill -TERM "$pid"
  for _ in $(seq 10); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "engine ignored SIGTERM for 10 s; killing it"
    kill -KILL "$pid"
  fi
  wait "$pid"; code=$?
  echo "stopped on SIGTERM, exit code $code" | tee /run-hl/exit-code
else
  wait "$pid"; code=$?
  echo "engine exited by itself within the $seconds s, exit code $code" | tee /run-hl/exit-code
fi

[ -f "$frame" ] && echo "frame file left behind after exit: yes" || echo "frame file left behind after exit: no"
echo "--- files written outside the base folder (the copy of the frame is ours)"
find /tmp -type f ! -name frame.copy | head -10
echo "--- files written under the base folder"
(cd /run-hl/base && find . -type f ! -path './valve/.fontcache/*' | sort | head -40)
echo "--- last log lines"
tail -25 /run-hl/engine.log
