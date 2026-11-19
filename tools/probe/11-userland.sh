#!/bin/sh
# Which tools exist on the unit, C library and C++ runtime versions, Node version.
# Read-only. External commands: only cat ls dmesg zcat grep readlink uname lsmod head hexdump.
# Run: ssh <head-unit> sh -s < tools/probe/11-userland.sh

PATH=/usr/sbin:/usr/bin:/sbin:/bin
sec()  { echo; echo "=== $* ==="; }
val()  { cat "$1" 2>/dev/null || echo "?"; }
show() { for f in "$@"; do if [ -r "$f" ]; then echo "--- $f"; cat "$f" 2>&1; else echo "--- $f (absent or unreadable)"; fi; done; }

sec tools
for d in /bin /sbin /usr/bin /usr/sbin /usr/local/bin; do
  [ -d "$d" ] && { echo "--- $d"; ls "$d"; }
done

sec c-library
ls -l /lib/libc.so.6 /lib/libc-*.so /lib/ld-linux-x86-64.so.2 /lib/ld-*.so /lib64 2>&1

sec c++-runtime
for f in /usr/lib/libstdc++.so.6.* /lib/libstdc++.so.6.*; do
  [ -f "$f" ] || continue
  echo "--- $f"
  grep -a -o -E 'GLIBCXX_3\.4\.2[0-9]|CXXABI_1\.3\.1[0-9]' "$f"
done

sec node
ls -l /usr/bin/node 2>&1
grep -a -o -E 'node v[0-9]+\.[0-9]+\.[0-9]+|v8\.[0-9]+\.[0-9]+' /usr/bin/node 2>/dev/null | head -5
ls /usr/lib/node_modules 2>&1 | head -40

sec loader-path
show /etc/ld.so.conf
ls -l /etc/ld.so.conf.d /etc/ld.so.cache 2>&1
