#!/bin/sh
# Compositor sockets, renderer sockets, and the processes that matter to us.
# Read-only. External commands: only cat ls dmesg zcat grep readlink uname lsmod head hexdump.
# Run: ssh <head-unit> sh -s < tools/probe/04-display-stack.sh

PATH=/usr/sbin:/usr/bin:/sbin:/bin
sec()  { echo; echo "=== $* ==="; }
val()  { cat "$1" 2>/dev/null || echo "?"; }
show() { for f in "$@"; do if [ -r "$f" ]; then echo "--- $f"; cat "$f" 2>&1; else echo "--- $f (absent or unreadable)"; fi; done; }

sec sockets
for d in /run/wayland /run/mgu-render /run/mgu-renderd /run/user /run/mgu-uplink; do
  [ -e "$d" ] && { echo "--- $d"; ls -la "$d"; }
done
echo "--- /run entries of interest"
ls -l /run 2>&1 | grep -i -E 'wayland|ivi|weston|render|mgu|oap|sock'

sec processes
grep -H -i -E 'weston|winston|wayland|layer|ivi|hmi|render|mgu|oap|node|audio|smartx|pulse|media|usb|mount|store|crash|dlt|watchdog' /proc/[0-9]*/comm
echo "--- process count"
ls -d /proc/[0-9]* | grep -c .
