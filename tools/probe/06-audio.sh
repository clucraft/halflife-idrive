#!/bin/sh
# ALSA cards and PCMs, the smartx plugin configuration, sound groups.
# Read-only. External commands: only cat ls dmesg zcat grep readlink uname lsmod head hexdump.
# Run: ssh <head-unit> sh -s < tools/probe/06-audio.sh

PATH=/usr/sbin:/usr/bin:/sbin:/bin
sec()  { echo; echo "=== $* ==="; }
val()  { cat "$1" 2>/dev/null || echo "?"; }
show() { for f in "$@"; do if [ -r "$f" ]; then echo "--- $f"; cat "$f" 2>&1; else echo "--- $f (absent or unreadable)"; fi; done; }

sec alsa
show /proc/asound/version /proc/asound/cards /proc/asound/devices /proc/asound/pcm
ls -l /dev/snd 2>&1
echo "--- streams open right now"
for s in /proc/asound/card*/pcm*/sub*/status; do
  [ -r "$s" ] || continue
  st=$(head -1 "$s")
  [ "$st" = "closed" ] && continue
  echo "$s: $st"
  cat "${s%status}hw_params" 2>/dev/null
done

sec alsa-config
show /etc/asound.conf
for d in /etc/alsa /usr/share/alsa /usr/share/alsa/alsa.conf.d /etc/alsa/conf.d /usr/share/alsa/pcm; do
  [ -d "$d" ] && { echo "--- $d"; ls -l "$d"; }
done
echo "--- files that mention smartx or CarLife"
grep -r -l -i -E 'smartx|carlife' /etc/asound.conf /etc/alsa /usr/share/alsa /etc/smartx /etc/ias 2>/dev/null
echo "--- PCM names that look like smartx routes"
grep -r -h -o -i -E '(smartx:)?[A-Za-z0-9_]*(CarLife|Entertainment|Media)[A-Za-z0-9_]*' /etc/asound.conf /etc/alsa /usr/share/alsa/alsa.conf.d 2>/dev/null | head -80

sec groups
grep -E 'mgu|alsa|audio|video|render|input|usb|wayland|oap|disk|storage|nobody' /etc/group
