#!/bin/sh
# Which graphics, sound and base libraries the unit has; EGL platforms; Mesa version.
# Read-only. External commands: only cat ls dmesg zcat grep readlink uname lsmod head hexdump.
# Run: ssh <head-unit> sh -s < tools/probe/03-gfx-libs.sh

PATH=/usr/sbin:/usr/bin:/sbin:/bin
sec()  { echo; echo "=== $* ==="; }
val()  { cat "$1" 2>/dev/null || echo "?"; }
show() { for f in "$@"; do if [ -r "$f" ]; then echo "--- $f"; cat "$f" 2>&1; else echo "--- $f (absent or unreadable)"; fi; done; }

sec libraries
for d in /usr/lib /lib /usr/lib64 /lib64 /usr/lib/x86_64-linux-gnu /usr/local/lib; do
  [ -d "$d" ] || continue
  echo "--- $d"
  ls -l "$d" | grep -E 'EGL|GLES|libGL\.|OpenGL|gbm|libdrm|glapi|wayland|ilm|ivi|weston|libva|mfx|vulkan|xkbcommon|udev|libinput|evdev|SDL|asound|pulse|stdc\+\+|gcc_s|libz\.|freetype|fontconfig|opus|bz2|libusb|libpng|jpeg|libm[.-]|libc[.-]|ld-|pthread|librt|libdl|systemd'
done
for d in /usr/lib/dri /usr/lib64/dri /usr/lib/x86_64-linux-gnu/dri /usr/lib/egl /usr/lib/gbm /usr/lib/mediasdk /usr/lib/alsa-lib; do
  [ -d "$d" ] && { echo "--- $d"; ls -l "$d"; }
done

sec egl
for f in /usr/lib/libEGL*.so* /lib/libEGL*.so* /usr/lib64/libEGL*.so* /usr/lib/x86_64-linux-gnu/libEGL*.so*; do
  [ -f "$f" ] || continue
  [ -L "$f" ] && continue
  echo "--- platforms and extensions named in $f"
  grep -a -o -E 'EGL_(EXT|KHR|MESA)_platform_[a-z_]+|EGL_KHR_surfaceless_context|EGL_KHR_no_config_context|EGL_MESA_configless_context|EGL_KHR_create_context|EGL_MESA_image_dma_buf_export|EGL_EXT_image_dma_buf_import|EGL_MESA_drm_image|EGL_KHR_gl_renderbuffer_image' "$f"
done

sec mesa
for f in /usr/lib/dri/*_dri.so /usr/lib64/dri/*_dri.so /usr/lib/x86_64-linux-gnu/dri/*_dri.so /usr/lib/libGLESv2.so* /usr/lib/libgbm.so* /usr/lib/libEGL.so*; do
  [ -f "$f" ] || continue
  [ -L "$f" ] && continue
  echo "--- $f"
  grep -a -o -E 'Mesa [0-9]+\.[0-9]+(\.[0-9]+)?(-[a-z0-9.]+)?' "$f" | head -3
  echo "mentions: GL_ARB_compatibility=$(grep -a -c 'GL_ARB_compatibility' "$f") GL_OES_=$(grep -a -c 'GL_OES_' "$f") GL_ARB_framebuffer_object=$(grep -a -c 'GL_ARB_framebuffer_object' "$f")"
done

sec gl-tools
for t in eglinfo es2_info es2gears glmark2-es2 glmark2-es2-wayland glmark2-es2-drm kmscube weston-info wayland-info weston-simple-egl modetest LayerManagerControl vainfo intel_gpu_top; do
  p=$(command -v "$t" 2>/dev/null) && echo "$t: $p"
done
echo "(end of list)"
