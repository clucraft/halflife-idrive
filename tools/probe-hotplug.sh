#!/bin/sh
# Read-only snapshot of what the head unit sees on its USB ports.
# Run it once per state (nothing plugged, pad, stick, both, both through a hub)
# and diff the snapshots on the PC:
#
#   ssh <head-unit> 'sh -s' < tools/probe-hotplug.sh > recon-raw/usb-<state>.txt
#
# Nothing is written, mounted, unmounted or opened for writing. The only device
# read is the first 32 MB of a USB disk (raw, read-only) to time the port, and
# only when READ_TEST=1 is prepended to the script by the caller.

PATH=/usr/sbin:/usr/bin:/sbin:/bin:$PATH
LC_ALL=C
export PATH LC_ALL

sec()  { echo; echo "=== $* ==="; }
val()  { cat "$1" 2>/dev/null || echo "?"; }
have() { command -v "$1" >/dev/null 2>&1; }

sec usb-tree
for d in /sys/bus/usb/devices/*; do
  b=$(basename "$d")
  case "$b" in
    *:*) drv=$(readlink "$d/driver" 2>/dev/null); drv=${drv##*/}
         echo "  if $b class=$(val "$d/bInterfaceClass")/$(val "$d/bInterfaceSubClass")/$(val "$d/bInterfaceProtocol") eps=$(val "$d/bNumEndpoints") driver=${drv:-none}" ;;
    *)   echo "dev $b id=$(val "$d/idVendor"):$(val "$d/idProduct") bcd=$(val "$d/bcdDevice") speed=$(val "$d/speed") class=$(val "$d/bDeviceClass") maxpower=$(val "$d/bMaxPower") authorized=$(val "$d/authorized") '$(val "$d/manufacturer")' '$(val "$d/product")'" ;;
  esac
done
have lsusb && { echo "--- lsusb"; lsusb 2>&1; echo "--- lsusb -t"; lsusb -t 2>&1; }
echo "--- /dev/bus/usb"
ls -lR /dev/bus/usb 2>&1

sec input
cat /proc/bus/input/devices 2>&1
echo "--- handlers"; cat /proc/bus/input/handlers 2>&1
echo "--- nodes"
ls -l /dev/input 2>&1
ls -l /dev/input/by-id /dev/input/by-path 2>&1
ls -l /dev/hidraw* /dev/input/js* 2>&1
for h in /sys/class/hidraw/hidraw*; do
  [ -e "$h" ] || continue
  echo "$(basename "$h"): $(grep -E 'HID_(ID|NAME)' "$h/device/uevent" 2>/dev/null | tr '\n' ' ')"
done
echo "--- per event node: name, ids, capability bitmaps, owning driver"
for e in /sys/class/input/event*; do
  [ -e "$e" ] || continue
  d="$e/device"
  drv=$(readlink "$d/device/driver" 2>/dev/null); drv=${drv##*/}
  echo "$(basename "$e"): '$(val "$d/name")' bus=$(val "$d/id/bustype") id=$(val "$d/id/vendor"):$(val "$d/id/product") ver=$(val "$d/id/version") phys=$(val "$d/phys") driver=${drv:-?}"
  echo "    ev=$(val "$d/capabilities/ev") key=$(val "$d/capabilities/key")"
  echo "    abs=$(val "$d/capabilities/abs") rel=$(val "$d/capabilities/rel") ff=$(val "$d/capabilities/ff")"
done

sec storage
cat /proc/partitions 2>&1
echo "--- mounts"; cat /proc/mounts 2>&1
have lsblk && { echo "--- lsblk"; lsblk -o NAME,SIZE,TYPE,FSTYPE,RO,RM,TRAN,MOUNTPOINT 2>&1; }
have blkid && { echo "--- blkid (no probing writes)"; blkid 2>&1; }
echo "--- usb block devices"
for b in /sys/block/sd*; do
  [ -e "$b" ] || continue
  n=$(basename "$b")
  echo "$n: removable=$(val "$b/removable") ro=$(val "$b/ro") size_sectors=$(val "$b/size") model='$(val "$b/device/model")' vendor='$(val "$b/device/vendor")' sysfs=$(readlink -f "$b" 2>/dev/null)"
  for p in "$b"/"$n"*; do
    [ -e "$p" ] && echo "    $(basename "$p"): size_sectors=$(val "$p/size") ro=$(val "$p/ro")"
  done
done
echo "--- mounted removable filesystems: options, space, top level"
awk '$1 ~ /^\/dev\/sd/ || $3 ~ /^(vfat|exfat|ntfs|fuseblk|fuse\.|msdos|texfat)/ { print $1, $2, $3, $4 }' /proc/mounts |
while read -r dev mp fs opts; do
  echo "$dev on $mp type $fs"
  echo "    options: $opts"
  df -h "$mp" 2>&1 | tail -1 | sed 's/^/    df: /'
  ls -ld "$mp" 2>&1 | sed 's/^/    dir: /'
  echo "    entries: $(ls -A "$mp" 2>/dev/null | wc -l)"
  ls -la "$mp" 2>&1 | head -12 | sed 's/^/    /'
done
echo "--- automounter"
ps 2>/dev/null | grep -i -E 'udisk|automount|udev|mdev|usbmount|media|storage|mount' | grep -v grep | cut -c1-160
ls -la /media /run/media /mnt /var/run/media 2>&1 | head -40

sec kernel-log-tail
dmesg 2>&1 | tail -80

if [ "${READ_TEST:-0}" = "1" ]; then
  sec read-speed
  for b in /sys/block/sd*; do
    [ -e "$b" ] || continue
    [ "$(val "$b/removable")" = "1" ] || continue
    n=$(basename "$b")
    echo "reading 32 MB from /dev/$n (read-only)"
    ( time dd if="/dev/$n" of=/dev/null bs=1M count=32 ) 2>&1
  done
fi

sec done
date 2>&1
