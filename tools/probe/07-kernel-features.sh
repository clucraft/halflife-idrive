#!/bin/sh
# What the kernel can do, without /proc/config.gz: modules, built-ins, filesystems, drivers.
# Read-only. External commands: only cat ls dmesg zcat grep readlink uname lsmod head hexdump.
# Run: ssh <head-unit> sh -s < tools/probe/07-kernel-features.sh

PATH=/usr/sbin:/usr/bin:/sbin:/bin
sec()  { echo; echo "=== $* ==="; }
val()  { cat "$1" 2>/dev/null || echo "?"; }
show() { for f in "$@"; do if [ -r "$f" ]; then echo "--- $f"; cat "$f" 2>&1; else echo "--- $f (absent or unreadable)"; fi; done; }

sec kernel-config
if [ -r /proc/config.gz ]; then
  zcat /proc/config.gz | grep -E 'CONFIG_(INPUT_EVDEV|INPUT_JOYDEV|JOYSTICK_XPAD|INPUT_UINPUT|HID|HIDRAW|USB_HID|USB_STORAGE|USB_UAS|VFAT_FS|EXFAT|NTFS|FUSE_FS|EXT4_FS|DRM_I915|DRM_VGEM|MEMCG|CFS_BANDWIDTH|CGROUP|SECCOMP|PREEMPT|HZ|COREDUMP|WATCHDOG|MODULES|MODULE_SIG|SECURITY)'
else
  echo "/proc/config.gz absent"
fi
ls -l /boot 2>&1 | grep -i config

sec modules-loaded
lsmod

sec filesystems
cat /proc/filesystems

sec drivers
echo "--- usb drivers"
ls /sys/bus/usb/drivers
echo "--- hid bus"
ls /sys/bus/hid 2>&1
echo "--- input handlers"
cat /proc/bus/input/handlers 2>&1
echo "--- scsi drivers"
ls /sys/bus/scsi/drivers 2>&1
echo "--- everything under /sys/module"
ls /sys/module

sec module-tree
K=$(uname -r)
ls -l /lib/modules 2>&1
ls -l "/lib/modules/$K" 2>&1
for f in "/lib/modules/$K/modules.builtin" "/lib/modules/$K/modules.dep"; do
  if [ -r "$f" ]; then
    echo "--- $f: entries of interest"
    grep -o -E '^[^:]*(evdev|joydev|xpad|uinput|hid|usb-storage|uas|sd_mod|fat|exfat|ntfs|fuse|i915|vgem|snd[-_a-z0-9]*|loop|squashfs|overlay)[^/:]*\.ko' "$f"
  else
    echo "--- $f absent"
  fi
done
