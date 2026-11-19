#!/bin/sh
# cgroups, core-dump handling, systemd defaults, watchdogs, the renderer's own unit files.
# Read-only. External commands: only cat ls dmesg zcat grep readlink uname lsmod head hexdump.
# Run: ssh <head-unit> sh -s < tools/probe/10-services-limits.sh

PATH=/usr/sbin:/usr/bin:/sbin:/bin
sec()  { echo; echo "=== $* ==="; }
val()  { cat "$1" 2>/dev/null || echo "?"; }
show() { for f in "$@"; do if [ -r "$f" ]; then echo "--- $f"; cat "$f" 2>&1; else echo "--- $f (absent or unreadable)"; fi; done; }

sec cgroups
show /proc/cgroups /proc/self/cgroup
grep cgroup /proc/mounts

sec core-dumps
show /proc/sys/kernel/core_pattern /proc/sys/kernel/core_uses_pid /proc/sys/fs/suid_dumpable

sec security
show /sys/kernel/security/lsm /proc/self/attr/current /proc/sys/kernel/randomize_va_space /proc/sys/kernel/yama/ptrace_scope

sec systemd
ls /lib/systemd /usr/lib/systemd 2>/dev/null | grep -i -E 'shared|^systemd$'
show /etc/systemd/system.conf
ls -l /dev/watchdog /dev/watchdog0 2>&1

sec units
for d in /etc/systemd/system /run/systemd/system /lib/systemd/system /usr/lib/systemd/system; do
  [ -d "$d" ] || continue
  echo "--- $d (store, renderer, apps, hmi)"
  ls -l "$d" | grep -i -E 'mgu|oap|render|store|hmi|inputgate|uplink|clucraft|doom|plex|nes|swarm|moon'
done
for u in /etc/systemd/system/*render*.service /etc/systemd/system/*render*.socket; do
  [ -r "$u" ] && { echo "--- $u"; cat "$u"; }
done

sec limits-of-this-shell
show /proc/self/limits
