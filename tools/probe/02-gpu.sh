#!/bin/sh
# PCI devices, DRM nodes, connectors and modes, i915 settings.
# Read-only. External commands: only cat ls dmesg zcat grep readlink uname lsmod head hexdump.
# Run: ssh <head-unit> sh -s < tools/probe/02-gpu.sh

PATH=/usr/sbin:/usr/bin:/sbin:/bin
sec()  { echo; echo "=== $* ==="; }
val()  { cat "$1" 2>/dev/null || echo "?"; }
show() { for f in "$@"; do if [ -r "$f" ]; then echo "--- $f"; cat "$f" 2>&1; else echo "--- $f (absent or unreadable)"; fi; done; }

sec pci
for d in /sys/bus/pci/devices/*; do
  drv=$(readlink "$d/driver" 2>/dev/null)
  echo "${d##*/} class=$(val "$d/class") id=$(val "$d/vendor"):$(val "$d/device") rev=$(val "$d/revision") driver=${drv##*/}"
done

sec drm
ls -l /dev/dri /dev/dri/by-path 2>&1
for n in /sys/class/drm/*; do
  b=${n##*/}
  case "$b" in
    version) echo "drm version: $(val "$n")" ;;
    card[0-9]|renderD*|controlD*)
      drv=$(readlink "$n/device/driver" 2>/dev/null)
      echo "$b: dev=$(val "$n/dev") id=$(val "$n/device/vendor"):$(val "$n/device/device") driver=${drv##*/}" ;;
    card*-*)
      echo "$b: status=$(val "$n/status") enabled=$(val "$n/enabled") dpms=$(val "$n/dpms")"
      [ -r "$n/modes" ] && cat "$n/modes" ;;
  esac
done
echo "--- gpu frequency"
for f in gt_min_freq_mhz gt_max_freq_mhz gt_cur_freq_mhz gt_act_freq_mhz gt_boost_freq_mhz gt_RP0_freq_mhz gt_RP1_freq_mhz gt_RPn_freq_mhz; do
  [ -r "/sys/class/drm/card0/$f" ] && echo "$f=$(val "/sys/class/drm/card0/$f")"
done
echo "--- i915 parameters"
for p in /sys/module/i915/parameters/*; do
  [ -r "$p" ] && echo "${p##*/}=$(val "$p")"
done
show /sys/kernel/debug/dri/0/i915_capabilities
echo "--- framebuffer device"
ls -l /dev/fb0 2>&1
show /sys/class/graphics/fb0/name /sys/class/graphics/fb0/virtual_size /sys/class/graphics/fb0/bits_per_pixel
