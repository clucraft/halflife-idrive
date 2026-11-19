#!/bin/sh
# Mounts, partitions, writable places. Free space needs df: see 90-free-space.sh.
# Read-only. External commands: only cat ls dmesg zcat grep readlink uname lsmod head hexdump.
# Run: ssh <head-unit> sh -s < tools/probe/08-storage.sh

PATH=/usr/sbin:/usr/bin:/sbin:/bin
sec()  { echo; echo "=== $* ==="; }
val()  { cat "$1" 2>/dev/null || echo "?"; }
show() { for f in "$@"; do if [ -r "$f" ]; then echo "--- $f"; cat "$f" 2>&1; else echo "--- $f (absent or unreadable)"; fi; done; }

sec mounts
cat /proc/mounts

sec partitions
cat /proc/partitions

sec removable-media-dirs
for d in /media /run/media /mnt /var/run/media /var/opt/hdshare; do
  [ -e "$d" ] && { echo "--- $d"; ls -la "$d" 2>&1 | head -40; }
done

sec var-opt
ls -la /var/opt 2>&1 | head -80
echo "--- store apps"
ls -la /var/opt/public/oap 2>&1 | head -60

sec emmc
for f in /sys/block/mmcblk0/device/name /sys/block/mmcblk0/size /sys/block/mmcblk0/device/life_time /sys/block/mmcblk0/device/pre_eol_info; do
  [ -r "$f" ] && echo "$f: $(val "$f")"
done
