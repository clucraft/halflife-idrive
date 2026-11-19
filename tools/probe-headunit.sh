#!/bin/sh
# Read-only probe of the iDrive 7 (MGU) head unit for the Half-Life port.
#
# Nothing here changes the head unit: no file is created, no module is loaded,
# no device node is opened, no service is started or stopped, nothing is
# mounted. The script is fed to the remote shell on stdin, so it is not copied
# to the car either:
#
#   ssh <head-unit> 'sh -s' < tools/probe-headunit.sh > recon-raw/probe.txt
#
# Written for BusyBox ash. No here-documents (bash backs them with a temp
# file), no redirection to anything but /dev/null.

PATH=/usr/sbin:/usr/bin:/sbin:/bin:$PATH
LC_ALL=C
export PATH LC_ALL

sec()  { echo; echo "=== $* ==="; }
run()  { echo "\$ $*"; "$@" 2>&1; echo "[rc=$?]"; }
have() { command -v "$1" >/dev/null 2>&1; }
show() {
  for f in "$@"; do
    if [ -r "$f" ]; then echo "--- $f"; cat "$f" 2>&1; else echo "--- $f (absent or unreadable)"; fi
  done
}
val()  { cat "$1" 2>/dev/null || echo "?"; }

KREL=$(uname -r)

# ---------------------------------------------------------------- identity
sec system
run uname -a
show /etc/os-release /proc/version /proc/cmdline
run id
run uptime
show /proc/loadavg

# --------------------------------------------------------------------- cpu
sec cpu
grep -E '^(vendor_id|cpu family|model|model name|stepping|microcode|cache size|cpu cores|siblings)[[:space:]]*:' /proc/cpuinfo | sort -u
echo "logical cpus: $(grep -c '^processor' /proc/cpuinfo)"
grep -m1 '^flags' /proc/cpuinfo
have lscpu && run lscpu
for c in /sys/devices/system/cpu/cpu[0-9]*; do
  [ -d "$c/cpufreq" ] || continue
  echo "$(basename "$c"): governor=$(val "$c/cpufreq/scaling_governor") cur=$(val "$c/cpufreq/scaling_cur_freq") min=$(val "$c/cpufreq/cpuinfo_min_freq") max=$(val "$c/cpufreq/cpuinfo_max_freq") driver=$(val "$c/cpufreq/scaling_driver")"
done
show /sys/devices/system/cpu/online /sys/devices/system/cpu/isolated /sys/devices/system/cpu/intel_pstate/no_turbo

# ------------------------------------------------------------------ memory
sec memory
show /proc/meminfo /proc/swaps
show /proc/sys/vm/overcommit_memory /proc/sys/vm/swappiness /proc/sys/vm/min_free_kbytes

# --------------------------------------------------------------------- pci
sec pci
for d in /sys/bus/pci/devices/*; do
  drv=$(readlink "$d/driver" 2>/dev/null); drv=${drv##*/}
  echo "$(basename "$d") class=$(val "$d/class") id=$(val "$d/vendor"):$(val "$d/device") rev=$(val "$d/revision") driver=${drv:-none}"
done
have lspci && run lspci -nn

# --------------------------------------------------------------------- gpu
sec gpu-drm
run ls -l /dev/dri
[ -d /dev/dri/by-path ] && run ls -l /dev/dri/by-path
for n in /sys/class/drm/*; do
  b=$(basename "$n")
  case "$b" in
    card[0-9]|renderD*|controlD*)
      drv=$(readlink "$n/device/driver" 2>/dev/null); drv=${drv##*/}
      echo "$b: dev=$(val "$n/dev") id=$(val "$n/device/vendor"):$(val "$n/device/device") driver=${drv:-?}" ;;
    card*-*)
      echo "$b: status=$(val "$n/status") enabled=$(val "$n/enabled") dpms=$(val "$n/dpms") modes=$(tr '\n' ' ' < "$n/modes" 2>/dev/null)" ;;
    version) echo "drm version: $(val "$n")" ;;
  esac
done
for f in gt_min_freq_mhz gt_max_freq_mhz gt_cur_freq_mhz gt_act_freq_mhz gt_boost_freq_mhz gt_RP0_freq_mhz gt_RPn_freq_mhz; do
  [ -r "/sys/class/drm/card0/$f" ] && echo "$f=$(val "/sys/class/drm/card0/$f")"
done
if [ -d /sys/module/i915/parameters ]; then
  echo "--- i915 parameters"
  for p in /sys/module/i915/parameters/*; do echo "$(basename "$p")=$(val "$p")"; done
fi
show /sys/module/i915/version /sys/module/i915/srcversion
[ -r /sys/kernel/debug/dri/0/i915_capabilities ] && show /sys/kernel/debug/dri/0/i915_capabilities
echo "--- who has a DRM node open"
for p in /proc/[0-9]*; do
  l=$(ls -l "$p/fd" 2>/dev/null | grep -E '/dev/dri/' | sed 's/.*-> //' | sort | uniq -c | tr '\n' ' ')
  [ -n "$l" ] && echo "pid ${p#/proc/} $(tr '\0' ' ' < "$p/cmdline" 2>/dev/null | cut -c1-80) user=$(awk '/^Uid:/{print $2}' "$p/status" 2>/dev/null): $l"
done
echo "--- framebuffer"
run ls -l /dev/fb0
show /sys/class/graphics/fb0/virtual_size /sys/class/graphics/fb0/bits_per_pixel /sys/class/graphics/fb0/name

sec gpu-libs
LIBDIRS=""
for d in /usr/lib /usr/lib64 /lib /lib64 /usr/lib/x86_64-linux-gnu /lib/x86_64-linux-gnu /usr/local/lib /opt; do
  [ -d "$d" ] && LIBDIRS="$LIBDIRS $d"
done
# shellcheck disable=SC2086
find $LIBDIRS -maxdepth 5 \( -name 'libEGL*' -o -name 'libGLES*' -o -name 'libGL.so*' -o -name 'libOpenGL*' \
  -o -name 'libgbm*' -o -name 'libdrm*' -o -name 'libglapi*' -o -name '*_dri.so' -o -name 'libwayland-*' \
  -o -name 'libilm*' -o -name 'libivi*' -o -name 'libweston*' -o -name 'libva.so*' -o -name 'libva-drm*' \
  -o -name 'libvulkan*' -o -name 'libxkbcommon*' -o -name 'libudev.so*' -o -name 'libinput.so*' \
  -o -name 'libevdev*' -o -name 'libSDL*' -o -name 'libasound.so*' -o -name 'libpulse.so*' \
  -o -name 'libstdc++.so*' -o -name 'libgcc_s.so*' -o -name 'libz.so*' -o -name 'libfreetype*' \
  -o -name 'libfontconfig*' -o -name 'libopus*' -o -name 'libbz2*' -o -name 'libusb*' \) 2>/dev/null | sort -u |
while read -r f; do ls -l "$f" 2>&1 | awk '{ $1=$1; print $5, $9, $10, $11 }'; done

echo "--- EGL platforms / extensions named in libEGL"
# shellcheck disable=SC2086
for f in $(find $LIBDIRS -maxdepth 5 -name 'libEGL*.so*' -type f 2>/dev/null); do
  echo "$f:"
  grep -a -o -E 'EGL_(EXT|KHR|MESA)_platform_[a-z_]+|EGL_KHR_surfaceless_context|EGL_MESA_configless_context|EGL_KHR_no_config_context|EGL_MESA_image_dma_buf_export|EGL_EXT_image_dma_buf_import|EGL_KHR_create_context|EGL_MESA_drm_image' "$f" 2>/dev/null | sort -u | tr '\n' ' '
  echo
done
echo "--- Mesa version strings"
# shellcheck disable=SC2086
for f in $(find $LIBDIRS -maxdepth 5 \( -name '*_dri.so' -o -name 'libGLESv2.so*' -o -name 'libEGL*.so*' -o -name 'libgbm.so*' \) -type f 2>/dev/null); do
  v=$(grep -a -o -E 'Mesa [0-9]+\.[0-9]+(\.[0-9]+)?(-[a-z0-9]+)?' "$f" 2>/dev/null | sort -u | tr '\n' ',')
  [ -n "$v" ] && echo "$f: $v"
done
echo "--- desktop GL hints in the DRI driver (does Mesa here do more than GLES?)"
# shellcheck disable=SC2086
for f in $(find $LIBDIRS -maxdepth 5 -name '*_dri.so' -type f 2>/dev/null); do
  echo "$f: GL_ARB_compatibility=$(grep -a -c 'GL_ARB_compatibility' "$f" 2>/dev/null) glBegin-ish=$(grep -a -c 'glBegin' "$f" 2>/dev/null) OES=$(grep -a -c 'GL_OES_' "$f" 2>/dev/null)"
done
echo "--- GL/EGL info tools present"
for t in eglinfo es2_info es2gears glmark2-es2 glmark2-es2-wayland glmark2-es2-drm kmscube weston-info weston-simple-egl wayland-info modetest LayerManagerControl vainfo intel_gpu_top; do
  have "$t" && echo "$t: $(command -v "$t")"
done

sec wayland
echo "XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-unset} WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-unset}"
run ls -l /run/user
for d in /run/user/* /run /tmp /var/run; do
  ls -l "$d" 2>/dev/null | grep -E 'wayland-|ivi|weston' | sed "s|^|$d: |"
done
ps 2>/dev/null | grep -i -E 'weston|wayland|layermanager|ivi|compositor|mgu-render|renderd' | grep -v grep

# ------------------------------------------------------------------- audio
sec audio
show /proc/asound/version /proc/asound/cards /proc/asound/devices /proc/asound/pcm
run ls -l /dev/snd
have aplay && run aplay -l
have aplay && run aplay -L
show /etc/asound.conf
[ -d /usr/share/alsa/alsa.conf.d ] && run ls -l /usr/share/alsa/alsa.conf.d
[ -d /etc/alsa ] && run ls -lR /etc/alsa
echo "--- streams open right now"
for s in /proc/asound/card*/pcm*/sub*/status; do
  st=$(head -1 "$s" 2>/dev/null)
  [ "$st" != "closed" ] && { echo "$s: $st"; cat "${s%status}hw_params" 2>/dev/null | sed 's/^/    /'; }
done

sec users-groups
grep -E 'mgu|alsa|audio|video|render|input|plugdev|disk|usb|storage|node|store' /etc/group
echo "--- passwd (names, ids, shells only)"
cut -d: -f1,3,4,7 /etc/passwd | grep -E 'mgu|node|store|root|nobody|app|hmi'

# ------------------------------------------------------------------- input
sec input
show /proc/bus/input/devices /proc/bus/input/handlers
run ls -l /dev/input
[ -d /dev/input/by-id ] && run ls -l /dev/input/by-id
[ -d /dev/input/by-path ] && run ls -l /dev/input/by-path
ls -l /dev/hidraw* /dev/uinput /dev/input/js* 2>&1
[ -d /sys/class/hidraw ] && run ls -l /sys/class/hidraw

sec usb
have lsusb && run lsusb
have lsusb && run lsusb -t
for d in /sys/bus/usb/devices/*; do
  b=$(basename "$d")
  case "$b" in
    *:*) drv=$(readlink "$d/driver" 2>/dev/null); drv=${drv##*/}
         echo "  if $b class=$(val "$d/bInterfaceClass")/$(val "$d/bInterfaceSubClass")/$(val "$d/bInterfaceProtocol") driver=${drv:-none}" ;;
    *)   echo "dev $b id=$(val "$d/idVendor"):$(val "$d/idProduct") speed=$(val "$d/speed") class=$(val "$d/bDeviceClass") maxpower=$(val "$d/bMaxPower") '$(val "$d/manufacturer")' '$(val "$d/product")'" ;;
  esac
done
echo "--- usb drivers registered"
ls /sys/bus/usb/drivers 2>&1 | tr '\n' ' '; echo
echo "--- hid drivers registered"
ls /sys/bus/hid/drivers 2>&1 | tr '\n' ' '; echo
run ls -lR /dev/bus/usb
echo "--- usbfs / authorisation policy"
for h in /sys/bus/usb/devices/usb*; do
  echo "$(basename "$h"): authorized_default=$(val "$h/authorized_default") interface_authorized_default=$(val "$h/interface_authorized_default")"
done

# ----------------------------------------------------------- kernel config
sec kernel-config
KEYS='CONFIG_INPUT_EVDEV|CONFIG_INPUT_JOYDEV|CONFIG_INPUT_JOYSTICK|CONFIG_JOYSTICK_XPAD|CONFIG_JOYSTICK_XPAD_FF|CONFIG_INPUT_UINPUT|CONFIG_INPUT_FF_MEMLESS|CONFIG_HID=|CONFIG_HID_GENERIC|CONFIG_HIDRAW|CONFIG_USB_HID=|CONFIG_USB_HIDDEV|CONFIG_HID_SONY|CONFIG_HID_PLAYSTATION|CONFIG_HID_MICROSOFT|CONFIG_HID_LOGITECH|CONFIG_HID_NINTENDO|CONFIG_HID_STEAM|CONFIG_UHID|CONFIG_USB_DEVICEFS|CONFIG_USB_DEFAULT_PERSIST|CONFIG_USB_ANNOUNCE_NEW_DEVICES|CONFIG_USB_XHCI_HCD|CONFIG_USB_STORAGE|CONFIG_USB_UAS|CONFIG_VFAT_FS|CONFIG_FAT_DEFAULT|CONFIG_EXFAT|CONFIG_NTFS|CONFIG_FUSE_FS|CONFIG_EXT4_FS|CONFIG_OVERLAY_FS|CONFIG_SQUASHFS|CONFIG_DRM_I915|CONFIG_DRM=|CONFIG_DRM_VGEM|CONFIG_DRM_FBDEV_EMULATION|CONFIG_FB=|CONFIG_SND_|CONFIG_CGROUP|CONFIG_MEMCG|CONFIG_CFS_BANDWIDTH|CONFIG_CPUSETS|CONFIG_SECCOMP|CONFIG_NAMESPACES|CONFIG_USER_NS|CONFIG_SECURITY|CONFIG_DEFAULT_SECURITY|CONFIG_PREEMPT|CONFIG_HZ|CONFIG_NO_HZ|CONFIG_X86_INTEL_PSTATE|CONFIG_CPU_FREQ_DEFAULT_GOV|CONFIG_THERMAL|CONFIG_INTEL_POWERCLAMP|CONFIG_X86_PKG_TEMP_THERMAL|CONFIG_SENSORS_CORETEMP|CONFIG_TRANSPARENT_HUGEPAGE|CONFIG_SHMEM|CONFIG_TMPFS|CONFIG_MODULES=|CONFIG_MODULE_SIG|CONFIG_IKCONFIG|CONFIG_COREDUMP|CONFIG_WATCHDOG|CONFIG_HIGH_RES_TIMERS|CONFIG_POSIX_MQUEUE|CONFIG_FUTEX|CONFIG_EPOLL|CONFIG_SIGNALFD|CONFIG_TIMERFD|CONFIG_EVENTFD|CONFIG_MEMFD|CONFIG_INOTIFY'
if [ -r /proc/config.gz ]; then
  echo "source: /proc/config.gz"
  zcat /proc/config.gz 2>/dev/null | grep -E "$KEYS"
elif [ -r "/boot/config-$KREL" ]; then
  echo "source: /boot/config-$KREL"
  grep -E "$KEYS" "/boot/config-$KREL"
else
  echo "no kernel config exposed; falling back to runtime evidence below"
fi
echo "--- loaded modules"
show /proc/modules
echo "--- module tree for $KREL"
run ls /lib/modules
for f in "/lib/modules/$KREL/modules.builtin" "/lib/modules/$KREL/modules.dep"; do
  if [ -r "$f" ]; then
    echo "--- $f (input/hid/usb/sound/fs of interest)"
    grep -E 'evdev|joydev|xpad|hidraw|hid-generic|usbhid|hid-sony|hid-microsoft|hid-logitech|uinput|usb-storage|uas|vfat|exfat|ntfs|fuse|snd-|i915|vgem' "$f" | cut -d: -f1
  fi
done
show /proc/filesystems
echo "--- sysfs evidence"
for p in /sys/module/evdev /sys/module/joydev /sys/module/xpad /sys/module/hid /sys/module/usbhid /sys/module/hid_generic /sys/module/hidraw /sys/module/uinput /sys/module/usb_storage /sys/module/vfat /sys/module/exfat /sys/module/fuse /sys/module/i915 /sys/class/hidraw /sys/bus/usb/drivers/xpad /sys/bus/usb/drivers/usbhid /sys/bus/usb/drivers/usbfs /sys/bus/usb/drivers/usb-storage; do
  [ -e "$p" ] && echo "present: $p" || echo "absent:  $p"
done

# ----------------------------------------------------------------- storage
sec storage
run df -h
show /proc/mounts /proc/partitions
have lsblk && run lsblk -o NAME,SIZE,TYPE,FSTYPE,RO,MOUNTPOINT
echo "--- where could a native binary run from? (rw and exec mounts)"
awk '{ ro = ($4 ~ /(^|,)ro(,|$)/) ? "ro" : "rw"; ne = ($4 ~ /noexec/) ? "noexec" : "exec"; print ro, ne, $3, $2 }' /proc/mounts | sort -u
run ls -la /dev/shm

# ----------------------------------------------------------------- thermal
sec thermal
for z in /sys/class/thermal/thermal_zone*; do
  [ -d "$z" ] || continue
  echo "$(basename "$z"): type=$(val "$z/type") temp=$(val "$z/temp") policy=$(val "$z/policy") mode=$(val "$z/mode")"
  for t in "$z"/trip_point_*_temp; do
    [ -r "$t" ] && echo "    $(basename "$t")=$(val "$t") type=$(val "${t%_temp}_type")"
  done
done
for c in /sys/class/thermal/cooling_device*; do
  [ -d "$c" ] && echo "$(basename "$c"): type=$(val "$c/type") cur=$(val "$c/cur_state") max=$(val "$c/max_state")"
done
for h in /sys/class/hwmon/hwmon*; do
  [ -d "$h" ] || continue
  echo "$(basename "$h"): name=$(val "$h/name")"
  for t in "$h"/temp*_input "$h"/fan*_input; do
    [ -r "$t" ] && echo "    $(basename "$t")=$(val "$t") label=$(val "${t%_input}_label") crit=$(val "${t%_input}_crit") max=$(val "${t%_input}_max")"
  done
done
echo "--- throttle counters"
for c in /sys/devices/system/cpu/cpu[0-9]*/thermal_throttle; do
  [ -d "$c" ] && echo "$c: core=$(val "$c/core_throttle_count") pkg=$(val "$c/package_throttle_count")"
done

# ----------------------------------------------- service manager and limits
sec systemd-cgroups
have systemctl && run systemctl --version
show /proc/cgroups
grep -E 'cgroup' /proc/mounts
show /proc/self/cgroup
have systemctl && run systemctl list-units --type=service --state=running --no-pager --no-legend
have systemctl && { systemctl list-unit-files --no-pager --no-legend 2>/dev/null | grep -i -E 'mgu|store|render|plex|doom|nes|swarm|moon'; }

sec limits-security
echo "--- ulimit -a"; ulimit -a 2>&1
show /proc/sys/kernel/core_pattern /proc/sys/kernel/core_uses_pid /proc/sys/fs/suid_dumpable
show /proc/sys/kernel/sched_rt_runtime_us /proc/sys/kernel/pid_max /proc/sys/kernel/randomize_va_space
show /sys/kernel/security/lsm /proc/self/attr/current
show /proc/sys/kernel/yama/ptrace_scope /proc/sys/kernel/unprivileged_userns_clone
run ls -l /dev/watchdog /dev/watchdog0
have systemctl && { systemctl show --no-pager -p RuntimeWatchdogUSec -p ShutdownWatchdogUSec -p DefaultMemoryAccounting -p DefaultCPUAccounting -p DefaultTasksMax 2>&1; }

# ---------------------------------------------------------------- userland
sec userland
have busybox && { busybox 2>&1 | head -2; echo "--- applets"; busybox --list 2>/dev/null | tr '\n' ' '; echo; }
for t in sh bash ash scp sftp-server rsync tar gzip gunzip xz bzip2 unzip zcat dd nc socat curl wget strace ltrace gdb gdbserver ldd strings readelf objdump file nm \
         lsusb lspci evtest aplay arecord amixer alsactl speaker-test node nodejs python python3 perl lua \
         setpriv su sudo chpst runuser capsh systemd-run nice ionice chrt taskset cpulimit timeout stdbuf top htop perf flock inotifywait udevadm; do
  if have "$t"; then echo "have    $t -> $(command -v "$t")"; else echo "missing $t"; fi
done
have node && run node --version
have node && node -e 'console.log(JSON.stringify(process.versions)); console.log(process.arch, process.platform)' 2>&1
echo "--- C library"
for l in /lib/libc.so.6 /lib64/libc.so.6 /lib/x86_64-linux-gnu/libc.so.6 /usr/lib/libc.so.6; do
  [ -e "$l" ] && { ls -l "$l"; grep -a -o -E 'GNU C Library[^\n]{0,60}' "$l" 2>/dev/null | head -1; grep -a -o -E 'GLIBC_2\.[0-9]+' "$l" 2>/dev/null | sort -t. -k2 -n -u | tail -1; }
done
have ldd && { ldd --version 2>&1 | head -1; }
echo "--- libstdc++ newest symbol versions"
# shellcheck disable=SC2086
for l in $(find $LIBDIRS -maxdepth 3 -name 'libstdc++.so.6*' -type f 2>/dev/null); do
  echo "$l: $(grep -a -o -E 'GLIBCXX_3\.4\.[0-9]+' "$l" 2>/dev/null | sort -t. -k3 -n -u | tail -1) $(grep -a -o -E 'CXXABI_1\.3\.[0-9]+' "$l" 2>/dev/null | sort -t. -k3 -n -u | tail -1)"
done
echo "--- dynamic loader"
ls -l /lib64/ld-linux-x86-64.so.2 /lib/ld-linux-x86-64.so.2 /lib/ld-musl-x86_64.so.1 2>&1
show /etc/ld.so.conf
[ -d /etc/ld.so.conf.d ] && run ls -l /etc/ld.so.conf.d

# -------------------------------------------------------- store and apps
sec mgu-store
for d in /opt /var/opt /data /var/data /var/lib /mnt /media /run/media /home /usr/local; do
  [ -d "$d" ] && { echo "--- $d"; ls -la "$d" 2>&1 | head -60; }
done
echo "--- anything named like the store, renderer or our sibling apps"
ps 2>/dev/null | grep -i -E 'mgu|store|render|plex|doom|nes|swarm|moon|node' | grep -v grep | cut -c1-200

sec load
have top && { top -b -n 1 2>/dev/null | head -30; }
echo "--- process count: $(ls -d /proc/[0-9]* 2>/dev/null | wc -l)"

sec done
date 2>&1
