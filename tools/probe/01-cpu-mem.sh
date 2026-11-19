#!/bin/sh
# CPU model, frequency scaling, memory.
# Read-only. External commands: only cat ls dmesg zcat grep readlink uname lsmod head hexdump.
# Run: ssh <head-unit> sh -s < tools/probe/01-cpu-mem.sh

PATH=/usr/sbin:/usr/bin:/sbin:/bin
sec()  { echo; echo "=== $* ==="; }
val()  { cat "$1" 2>/dev/null || echo "?"; }
show() { for f in "$@"; do if [ -r "$f" ]; then echo "--- $f"; cat "$f" 2>&1; else echo "--- $f (absent or unreadable)"; fi; done; }

sec cpu
grep -E '^(vendor_id|cpu family|model|model name|stepping|microcode|cache size|cpu cores|siblings|cpu MHz)[[:space:]]*:' /proc/cpuinfo
echo "--- flags (first cpu)"
grep -m1 '^flags' /proc/cpuinfo
for c in /sys/devices/system/cpu/cpu[0-9]*; do
  [ -d "$c/cpufreq" ] || continue
  echo "${c##*/}: driver=$(val "$c/cpufreq/scaling_driver") governor=$(val "$c/cpufreq/scaling_governor") cur=$(val "$c/cpufreq/scaling_cur_freq") min=$(val "$c/cpufreq/cpuinfo_min_freq") max=$(val "$c/cpufreq/cpuinfo_max_freq") scaling_max=$(val "$c/cpufreq/scaling_max_freq")"
done
show /sys/devices/system/cpu/online /sys/devices/system/cpu/isolated \
     /sys/devices/system/cpu/intel_pstate/status /sys/devices/system/cpu/intel_pstate/no_turbo \
     /sys/devices/system/cpu/intel_pstate/max_perf_pct /sys/devices/system/cpu/intel_pstate/min_perf_pct

sec memory
show /proc/meminfo /proc/swaps /proc/sys/vm/overcommit_memory /proc/sys/vm/min_free_kbytes
echo "--- cpu counters"
head -1 /proc/stat
