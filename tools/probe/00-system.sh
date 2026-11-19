#!/bin/sh
# Kernel, OS release, uptime, who we are.
# Read-only. External commands: only cat ls dmesg zcat grep readlink uname lsmod head hexdump.
# Run: ssh <head-unit> sh -s < tools/probe/00-system.sh

PATH=/usr/sbin:/usr/bin:/sbin:/bin
sec()  { echo; echo "=== $* ==="; }
val()  { cat "$1" 2>/dev/null || echo "?"; }
show() { for f in "$@"; do if [ -r "$f" ]; then echo "--- $f"; cat "$f" 2>&1; else echo "--- $f (absent or unreadable)"; fi; done; }

sec system
uname -a
show /etc/os-release /proc/version /proc/cmdline /proc/uptime /proc/loadavg
echo "--- who am i"
grep -E '^(Uid|Gid|Groups):' /proc/self/status
echo "--- cpu counters"
head -1 /proc/stat
