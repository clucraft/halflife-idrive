#!/bin/sh
# Which processes hold the GPU, sound or USB device nodes open, and as which user.
# Read-only. External commands: only cat ls dmesg zcat grep readlink uname lsmod head hexdump.
# Run: ssh <head-unit> sh -s < tools/probe/05-open-devices.sh

PATH=/usr/sbin:/usr/bin:/sbin:/bin
sec()  { echo; echo "=== $* ==="; }
val()  { cat "$1" 2>/dev/null || echo "?"; }
show() { for f in "$@"; do if [ -r "$f" ]; then echo "--- $f"; cat "$f" 2>&1; else echo "--- $f (absent or unreadable)"; fi; done; }

sec open-device-nodes
for p in /proc/[0-9]*; do
  l=$(ls -l "$p/fd" 2>/dev/null | grep -o -E '/dev/(dri|snd|fb|bus/usb|shm)[^ ]*')
  [ -n "$l" ] || continue
  echo "pid ${p##*/} comm=$(val "$p/comm") $(grep -m1 '^Uid:' "$p/status" 2>/dev/null)"
  echo "$l"
done

sec shm
ls -la /dev/shm
