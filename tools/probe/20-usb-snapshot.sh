#!/bin/sh
# One snapshot of the USB ports, input nodes and mounts.
# Run once per plug state (nothing, pad, stick, both, both through a hub) and diff on the PC.
# Read-only. External commands: only cat ls dmesg zcat grep readlink uname lsmod head hexdump.
# Run: ssh <head-unit> sh -s < tools/probe/20-usb-snapshot.sh

PATH=/usr/sbin:/usr/bin:/sbin:/bin
sec()  { echo; echo "=== $* ==="; }
val()  { cat "$1" 2>/dev/null || echo "?"; }
show() { for f in "$@"; do if [ -r "$f" ]; then echo "--- $f"; cat "$f" 2>&1; else echo "--- $f (absent or unreadable)"; fi; done; }

sec usb-tree
for d in /sys/bus/usb/devices/*; do
  b=${d##*/}
  case "$b" in
    *:*) drv=$(readlink "$d/driver" 2>/dev/null)
         echo "  if $b class=$(val "$d/bInterfaceClass")/$(val "$d/bInterfaceSubClass")/$(val "$d/bInterfaceProtocol") eps=$(val "$d/bNumEndpoints") driver=${drv##*/}" ;;
    *)   echo "dev $b id=$(val "$d/idVendor"):$(val "$d/idProduct") speed=$(val "$d/speed") class=$(val "$d/bDeviceClass") maxpower=$(val "$d/bMaxPower") authorized=$(val "$d/authorized") '$(val "$d/manufacturer")' '$(val "$d/product")'" ;;
  esac
done
echo "--- usb drivers registered"
ls /sys/bus/usb/drivers
echo "--- device nodes"
ls -lR /dev/bus/usb 2>&1

sec input
cat /proc/bus/input/devices 2>&1
ls -l /dev/input /dev/hidraw* 2>&1

sec block
cat /proc/partitions
for b in /sys/block/sd*; do
  [ -e "$b" ] || continue
  echo "${b##*/}: removable=$(val "$b/removable") ro=$(val "$b/ro") sectors=$(val "$b/size") vendor='$(val "$b/device/vendor")' model='$(val "$b/device/model")' path=$(readlink "$b")"
done

sec mounts
cat /proc/mounts
for d in /media /run/media /mnt /var/run/media; do
  [ -e "$d" ] && { echo "--- $d"; ls -la "$d" 2>&1 | head -30; }
done

sec modules
lsmod

sec kernel-log
# No line limit here: the newest lines are the ones a plug event adds, and
# "head" would keep the oldest. The kernel's buffer is small; trim on the PC.
dmesg | grep -i -E 'usb|scsi|sd[a-z]|fat|ntfs|ext4|mount|storage|hub|xhci|uas|fuse'
