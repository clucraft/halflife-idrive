#!/bin/sh
# Thermal zones, trip points, cooling devices, hwmon sensors, throttle counters.
# Read-only. External commands: only cat ls dmesg zcat grep readlink uname lsmod head hexdump.
# Run: ssh <head-unit> sh -s < tools/probe/09-thermal.sh

PATH=/usr/sbin:/usr/bin:/sbin:/bin
sec()  { echo; echo "=== $* ==="; }
val()  { cat "$1" 2>/dev/null || echo "?"; }
show() { for f in "$@"; do if [ -r "$f" ]; then echo "--- $f"; cat "$f" 2>&1; else echo "--- $f (absent or unreadable)"; fi; done; }

sec thermal-zones
for z in /sys/class/thermal/thermal_zone*; do
  [ -d "$z" ] || continue
  echo "${z##*/}: type=$(val "$z/type") temp=$(val "$z/temp") policy=$(val "$z/policy") mode=$(val "$z/mode")"
  for t in "$z"/trip_point_*_temp; do
    [ -r "$t" ] && echo "    ${t##*/}=$(val "$t") type=$(val "${t%_temp}_type")"
  done
done

sec cooling-devices
for c in /sys/class/thermal/cooling_device*; do
  [ -d "$c" ] && echo "${c##*/}: type=$(val "$c/type") cur=$(val "$c/cur_state") max=$(val "$c/max_state")"
done

sec hwmon
for h in /sys/class/hwmon/hwmon*; do
  [ -d "$h" ] || continue
  echo "${h##*/}: name=$(val "$h/name")"
  for t in "$h"/temp*_input "$h"/fan*_input; do
    [ -r "$t" ] && echo "    ${t##*/}=$(val "$t") label=$(val "${t%_input}_label") max=$(val "${t%_input}_max") crit=$(val "${t%_input}_crit")"
  done
done

sec throttle-counters
for c in /sys/devices/system/cpu/cpu[0-9]*/thermal_throttle; do
  [ -d "$c" ] && echo "$c: core=$(val "$c/core_throttle_count") package=$(val "$c/package_throttle_count")"
done
echo "(end)"
