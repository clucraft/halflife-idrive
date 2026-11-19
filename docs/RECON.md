# Recon: Half-Life on the iDrive 7 head unit

Phase 0 of the port. What we know before writing any engine code, where each fact comes from, and what is still a guess.

> **Nothing in this document has been measured on the car by this project yet.** The head-unit facts below come from reading the reference repositories and from a controller probe done for nes-idrive on 2026-11-19. The probe batches in `tools/probe/` have only run on the PC. Section 9 is filled in when they run on the car.

Sources are marked like this:

| Mark | Meaning |
|---|---|
| **[car]** | Read from the head unit itself, read-only (so far: only the nes-idrive controller probe). |
| **[code]** | What reference code does. It tells us what its author expected of the unit, not that it ran there. |
| **[doc]** | A README or protocol document says so. |
| **[pc]** | Checked on the build PC. |
| **[guess]** | Inference. Needs a probe or a test. |

## 1. Build PC [pc]

- Windows 11, with WSL2 (Ubuntu 26.04, kernel 6.18) as the only distro.
- No Docker Desktop. Docker Engine 29.8.1 runs inside the WSL2 distro, the user is in the `docker` group, and `D:` is visible there as `/mnt/d`. That is enough for an `ubuntu:18.04` build container.
- 16 logical CPUs and 47 GB RAM are visible to WSL.
- Git 2.45 and the GitHub CLI (signed in as `clucraft`) are on the Windows side.

## 2. Game data [pc]

- Steam copy at `D:\SteamLibrary\steamapps\common\Half-Life`, build id 15961492, `steam.inf` PatchVersion 1.1.2.2. Treated as read-only.
- It is the 25th-anniversary build: `sprites/` has the 1280 and 2560 HUD sets, and `liblist.gam` carries `animated_title` and `hd_background`.
- `valve/` is 517 MB in 4,250 loose files. There is no `.pak`; eight `.wad` files sit at the top level.
- `valve/dlls` and `valve/cl_dlls` hold Valve's Windows, macOS and 32-bit Linux libraries. We use none of them (section 7).
- `gfx/shell` holds only the three key-binding lists, not the old WON menu art.
- `valve_hd` (8.9 MB) and `platform` (1.6 MB) are not needed.

## 3. Head unit: what is already known

| Fact | Source |
|---|---|
| x86-64 Intel Apollo Lake, 4 cores | [doc] kit README; [code] `CPUQuota=200%` comment in plex-idrive |
| Kernel `4.14.198-apl`, systemd, BusyBox | [car] nes-idrive controller probe |
| glibc 2.27. The loader is only at `/lib/ld-linux-x86-64.so.2`; there is no `/lib64` | [code] plex-idrive build gates |
| Intel HD Graphics 505, i915, Mesa with EGL and GLES2 | [doc] kit README |
| RAM size | unknown |
| Centre display 1920x720 | [doc] kit README; [code] plex-idrive full view |
| System compositor "Winston": `XDG_RUNTIME_DIR=/run/wayland`, socket `wayland-0`, group `mgu_wayland`, ivi-shell | [code] renderer unit file in the kit |
| Root filesystem read-only; `/var/opt` writable (eMMC); `/run` and `/dev/shm` tmpfs | [doc] kit README |
| A 2.5" disk with a writable share of about 90 GB at `/var/opt/hdshare` | [doc] kit README |
| Node 8 at `/usr/bin/node`; apps run one process each under their own uid, all in group `tm_oap_app` | [code] kit runtime |
| `/proc/config.gz` is absent | [car] |
| No HID core, usbhid, hidraw, evdev, joydev, uinput or xpad. No `/dev/input`. The only input device is the power button | [car] |
| USB drivers registered with nothing plugged in: `hub`, `usb`, `usbfs` only | [car] |
| Raw USB works: `/dev/bus/usb/<bus>/<dev>`, mode `crw-rw----`, `root:mgu_usb` | [car] |
| An Xbox One S pad (045e:02ea) enumerates at full speed, 500 mA, behind the unit's hub; no driver binds | [car] |
| `scp` and `sftp` are missing in some firmware builds; file transfer is tar over ssh | [doc] |
| The unit can power-cycle itself mid-session when the car sleeps and wakes | [car] |

Standing rules for this unit, from the owner's SSH notes kept with nes-idrive: read-only; no remount; do not stop, start, restart or kill anything; do not reboot; no kernel modules; no writes to `/sys` or `/proc`. Only `cat ls dmesg zcat grep readlink uname lsmod head hexdump` run without asking; anything else is shown to the owner first.

## 4. Display path

The frame file is real and specified, but it is a video path, not a framebuffer.

- **Format** [code][doc]: `/dev/shm/mgu-video-<name>` is an "MGVF" file. A 64-byte header of sixteen little-endian `uint32` (magic `0x4656474d`, version 1, width, height, `seq`, `slot`, `nslot`, matrix, range, seven zero words), then `nslot` frames.
- **Pixels are I420 only** [code][doc]: each frame is `w*h*3/2` bytes, Y then U then V, rows unpadded. There is no RGB variant, so every game frame is converted from RGB and loses chroma resolution (4:2:0).
- **Limits** [doc]: width and height even, 16 to 2048; `w*h*3` at most 12 MiB per app; 1 to 4 slots.
- **No locking** [code]: the writer fills slot `(slot+1) % nslot`, stores `slot`, then stores `seq+1`. The renderer polls every 5 ms while the app is shown and redraws when `seq` changed.
- **Ownership** [code][doc]: a regular file, opened with `O_NOFOLLOW`, mode 0600, owned by the app's uid, root or `nobody`. The renderer keeps the file it opened, so the app must name the file again when its inode changes.
- **Showing it** [code]: the app (JavaScript) names the file to the renderer and draws it with a `video` operation, "fitted, aspect kept, centred". Full screen is a second renderer connection placed at 0,0 1920x720 that claims touch and grabs the controller.
- **Watchdog** [code][doc]: the renderer hides a layer whose app sends nothing for 3 s. New video frames do not count, so the app must keep talking at least once a second.
- **Only one kit has it** [code]: the `video` operation exists in the M850i-amn fork of the kit that plex-idrive copies, not in upstream idrive7-apps.
- **Not proven on a car** [doc]: the plex-idrive README says the client has not run on a car, and its player source says the picture on the GPU is unchecked. Phase 3 is this path's first real test for us.

Other pixel routes in the same renderer protocol [doc]: RGBA image uploads over the socket (up to 1024 or 4096 a side depending on dialect) and region updates of an indexed or RGBA pixmap up to 2048. Doom, NES and Swarm use those. They avoid the chroma loss but push every frame through a socket.

Consequences:

- 1280x720 would be pillarboxed on a 1920x720 screen. An 8:3 size fills it: 1280x480 is 0.9 MB per I420 slot and scales by exactly 1.5.
- The backend needs an RGB to I420 conversion per frame. At 1280x480 that is 614,400 pixels; cheap next to software rendering, and it can move into a shader once rendering is on the GPU.

## 5. Sound path

- **Route** [code]: the app asks the GENIVI audio manager over SOME/IP (`org.genivi.am.commandinterface.CommandControl`) to connect source 287 ("CarLife") to sink 1024 (front media), after marking the source available through the routing interface. plex-idrive releases it whenever playback is not running.
- **Device** [code]: ALSA `plug:smartx:CarLifeMedia_CF_48_STEREO`, S16LE stereo. The plug layer resamples; 48 kHz is native.
- **Access** [code]: the process must be in group `mgu_alsa`. Node gives a child no supplementary groups, so the native binary sets its own groups before it drops root.
- **When the route is not connected** [code]: writes return `EAGAIN` and plex-idrive drops the audio.
- **Shared source** [code]: source 287 is used by other community apps; a stale connection left by an earlier run has silenced everything before.
- **Interruptions** (park-distance beeps, calls): nothing in the reference code handles them. Unknown.
- **Not proven on a car** [doc], same as the picture.

## 6. Input

- **Gamepad**: the kernel has no input layer at all [car], so the engine's evdev code cannot be used and no pad produces `/dev/input` nodes. The only route is a userspace reader on usbfs. nes-idrive has one (`usbpipe`, a static Go program driven by `pad.js`, with the Xbox "GIP" start-up packets taken from the kernel's `xpad.c`); it has run against a stand-in, never a real pad.
- **Which pads**: the Xbox One S pad needs a start-up handshake on its OUT endpoint before it reports anything. An Xbox 360 wired pad streams without one. A generic HID pad is the simplest protocol but still needs our own reader here.
- **iDrive controller** [code]: SOME/IP field `statusRotaryEncoderState` of `de.bmw.infotainment.controlelements.FrontCCU` (turn counter, press, tilt). With the `mgu-inputgate` tool installed, an app can hold the controller so the HMI stops reacting; that tool is preloaded into the HMI by its own Store package, and the brief allows nothing beyond it.
- **Touch** [code]: only through the renderer, for regions the app claims. The HMI keeps the top 76 px and the left 84 px.
- **BACK, MENU, HOME** always stay with the HMI [code].

Consequence: all input reaches the engine through our own code. The pad comes from a usbfs reader, and the controller and touch come from the app over the service socket.

## 7. Engine: Xash3D FWGS and hlsdk-portable

Read at xash3d-fwgs `11ed246c` and hlsdk-portable `89e83b92` (both 2026-11-08). Nothing was built.

### Platform layer

- `engine/platform/linux` does have `vid_fbdev.c`, `in_evdev.c` and `s_alsa.c`, selected when a Linux client is built without SDL (`--enable-fbdev`). **Confirmed.**
- That client is unmaintained and, from reading, will not link as it stands: the fbdev backend lacks two functions the engine references unconditionally, and the evdev reader uses a 16-byte event size that is wrong on x86-64. Treat it as a template.
- The supported way to add a backend is the porting guide's: new ids in `common/backends.h`, a new branch in `common/defaults.h`, and a new directory under `engine/platform/`. The PS4 port in the tree is a complete non-SDL example.
- The video backend is about seventeen functions (`R_Init_Video`, `VID_SetMode`, `GL_SwapBuffers`, `SW_CreateBuffer`, `SW_LockBuffer`, `SW_UnlockBuffer` and so on).

### Renderers

- **Software** (`ref_soft`, off by default, `--enable-soft`): the platform owns the target buffer and reports its layout; 2, 3 or 4 bytes per pixel work. `SW_UnlockBuffer` is the natural "frame ready" hook.
- **GL family**: `ref_gl` (desktop GL), `ref_gles3compat` (built-in shader emulation of fixed function, no extra dependency), `ref_gl4es`, `ref_gles2` (deprecated wrapper), `ref_gles1`.
- `ref_gles3compat` asks for an ES 2.0 context and by default generates `#version 310 es` shaders; `-minshaders` drops to `#version 100`.
- **No EGL code exists in the engine.** The platform backend creates the context; the renderer only calls back for attributes, symbols and buffer swaps. An EGL pbuffer fits without renderer changes, because the renderer draws to framebuffer 0. A surfaceless context would need the renderer pointed at our own framebuffer object.

### Sound

- The ALSA backend opens the device named by `-alsadev` (default `default`), S16 stereo at 44100 Hz with "rate near", period 2048 frames, non-blocking, written from the main loop with no thread.

### Input API a pad reader feeds

- Axes: `Joy_AxisMotionEvent( axis, short )`. Buttons: ordinary `Key_Event( K_A_BUTTON ... )`. Default pad bindings exist, and in menus the left stick becomes arrow keys.
- Whether the menu library reacts to pad buttons could not be checked (its source is a submodule). Our reader can send Enter, Escape and arrows while a menu is up.

### Files

- `-rodir <path>` exists and does what the brief hoped. **Confirmed.** The read-only root is searched first; a separate writable root (`XASH3D_BASEDIR`, else the current directory) receives config, saves and screenshots under `<root>/valve/`. Nothing is written to the read-only root.
- File-name lookup falls back to a case-insensitive match, so Windows-cased data on FAT or exFAT works.
- The filesystem is a separate library, `filesystem_stdio.so`.

### Anniversary data

- Supported as far as the source shows: the new `liblist.gam` keys are parsed, the entity limit was raised for it, and hlsdk-portable `master` picks the 320/640/1280/2560 HUD sprites.
- The tracker's "doesn't work with anniversary assets" report (xash3d-fwgs issue 1894) is Valve's Windows `client.dll` failing to load. It does not apply to us.
- No report of a Linux problem with this data was found. Not yet tried here; Phase 1 does that.

### Game libraries

- On 64-bit Linux the engine asks for `cl_dlls/client_amd64.so` and `dlls/hl_amd64.so`, which is what hlsdk-portable builds with `-D64BIT=1`. Valve's own libraries in the data are never requested.
- They need not sit in the game folder: `-dll` and `-clientlib` take absolute paths.

### Build

- `./waf configure -8 ...`; bundled copies of the codecs with `--enable-bundled-deps`. The bundled waf wants Python 3; whether Ubuntu 18.04's Python 3.6 is new enough is unverified.
- Link-time optimisation uses a flag GCC 7 does not have, so no `--enable-lto` in the 18.04 container.
- Outputs: launcher `xash3d`, `libxash.so`, `filesystem_stdio.so`, renderer libraries, the menu library, and `extras.pk3`.

### Running without a screen

- A client cannot be built with no video backend, and there is no movie writer. `screenshot` writes PNGs and `-timedemo <name>` prints frames, seconds and fps, then quits.
- Our own frame-file backend is headless by nature, so Phase 1 can use it directly and read the frames back on the PC.

### Behaviour that matters for a locked-down service

- A non-SDL client has no SIGTERM handler: it dies without saving config. Our backend must install one that calls `CL_RequestQuit`.
- The crash handler catches SIGSEGV, SIGABRT, SIGBUS and SIGILL, prints a backtrace and then shuts down normally.
- It writes an id file under `$HOME` unless `HOME` is unset, and reads `/etc/machine-id`, disk ids and MAC addresses to build that id.
- It initialises HTTP and master-server code at start. The service's user has no route out, so this should fail quietly; to be watched.
- Single-threaded apart from a resolver thread.

### Licences

- Engine: GPL 3.0 or later (per-file headers; the checkout has no top-level licence file). Menu library: GPL 2.0 or later.
- hlsdk-portable: Valve's Half-Life 1 SDK licence. Binaries may be distributed only free of charge and with the LICENSE file; commercial use needs Valve.
- Game data is covered by neither and is never distributed by this project.

## 8. Service and Store mechanics, and what must never happen

From plex-idrive and nes-idrive [code], with the kit's documents [doc].

- **Packaging**: a native service is a Store "tool": a folder with `component.json`, listed in `mgu-repo.json`, installed to `/var/opt/<id>/current/` with its state in `/var/opt/<id>/state`. The app requires it by id and version.
- **Lifetime**: systemd socket activation on `/run/<id>.sock`. The service starts when the app first connects and exits by itself when idle. It is never enabled at boot.
- **Who may connect**: the socket is given the app's own gid, not the group all apps share.
- **Dropping root**: the service runs as root; the native binary sets its groups (`video`, `mgu_alsa`, and for us `mgu_usb`), then becomes `nobody`, and refuses to continue if that failed.
- **Limits** [code]: plex-idrive uses `CPUQuota=200%`, `MemoryLimit=768M`, `TasksMax=48`, `Nice=10`, idle I/O class.
- **App limits** [code]: 20 MiB disk, 60% CPU and about 190 MB memory by default.

Things the reference projects warn about [doc][code]:

1. **An app process that exits unexpectedly loses its data folder, and is uninstalled the second time.** So saves must not live in the app's data folder. If they cannot go on the stick, they go in the tool's state folder.
2. **A core dump from an unknown program makes the crash handler restart the head unit.** Every unit sets `LimitCORE=1` and names its binaries in `crashNames`. For a game engine this is the main safety item.
3. **Never restart `hmi.service`**, and never stop a renderer that has app surfaces up: both can reboot the unit.
4. `ExecStartPost` and `deactivate` scripts must always exit 0, or the socket unit fails or removal is refused.
5. The sound device must be closed before the process exits, and the process should not be SIGKILLed with it open.
6. Symbols newer than the unit's glibc must be avoided (`powf`, `log2f` and friends changed version in 2.27).
7. Node 8 only: ES2017, no optional chaining, no object spread.
8. Counting an unreadable speed as "moving" once locked a parked car out of Doom [doc]. The brief asks for exactly that rule, so the gate needs a test with the ignition in each state.

## 9. Probe of the car

Not run yet.

The probe is thirteen short batches in `tools/probe/`, each fed to the unit's shell on stdin so that nothing is copied to the car. They use only the ten allowed commands; `tools/probe/check.sh` proves that on the PC by running each batch where no other command exists. `90-free-space.sh` uses `df` and waits for the owner's OK.

| Batch | Answers |
|---|---|
| `00-system` | kernel, OS release, uptime |
| `01-cpu-mem` | CPU model, frequency scaling, RAM |
| `02-gpu` | GPU PCI id, DRM nodes and their permissions, connectors and modes |
| `03-gfx-libs` | EGL, GLES, GBM, DRM, Wayland, ALSA and C++ libraries present; EGL platforms; Mesa version; desktop GL hints |
| `04-display-stack` | compositor and renderer sockets, relevant processes |
| `05-open-devices` | who holds the GPU, sound and USB nodes open, and as which user |
| `06-audio` | ALSA cards and PCMs, the smartx configuration, sound groups |
| `07-kernel-features` | loaded and built-in modules, filesystems, drivers |
| `08-storage` | mounts, partitions, writable places, eMMC wear |
| `09-thermal` | zones, trip points, cooling devices, throttle counters |
| `10-services-limits` | cgroups, core-dump handling, systemd defaults, renderer unit files |
| `11-userland` | tools on the unit, C library, C++ runtime, Node version |
| `20-usb-snapshot` | USB tree, block devices, mounts, kernel log; run once per plug state |
| `90-free-space` | free space per filesystem (needs `df`) |

What a read-only probe cannot answer:

- **Whether the render node is usable for offscreen EGL.** We can see the node, its group, the libraries and the EGL platform names. Creating a context means running a small program on the unit, which is a write. That test belongs to Phase 3 with the owner's OK.
- **Whether the stick is writable in practice.** Mount options tell us most of it; a real write test waits for permission.
- **Whether pad buttons arrive.** That needs the usbfs reader.

### Results

Pending.

## 10. What this changes in the plan

| Brief | Finding | Proposed change |
|---|---|---|
| Add a video backend under `engine/platform/linux` | The non-SDL Linux client there is broken and has no GL path | A new backend directory of our own, following the porting guide; reuse `s_alsa.c` |
| Frames to the mgu-render frame file | The file is I420 video, on one fork of the kit, unproven on a car | Keep it as the plan, convert RGB to I420 in the backend, and keep the RGBA pixmap route as the fallback |
| Start at 1280x720 or lower | The screen is 1920x720 | Start at 1280x480, capped at 30 fps |
| Input from the gamepad (evdev) | No input layer in the kernel | A usbfs pad reader of our own; controller and touch forwarded by the app |
| Game data on a USB stick | No storage driver was registered with no stick in; mounting is unverified | The stick test decides. Fallback is the disk share, which the brief would rather avoid |
| Saves in the app's data folder if the stick is read-only | That folder is wiped when the app process dies | Use the tool's state folder instead |
| Run headless with the software renderer in Phase 1 | No null video backend; an open report of the software renderer crashing on map load on linux-amd64 (xash3d-fwgs issue 2666) | Build our file backend first and use it headless; if the crash reproduces, bring the GPU renderer forward |
| GLES2 renderer in Phase 4 | `ref_gles3compat` needs no wrapper library; a pbuffer context needs no renderer changes | Prefer pbuffer plus readback into the same frame file, subject to the probe |

## 11. Open questions

1. Does the unit mount a USB stick at all, where, with which filesystem and options, and can a root tool or `nobody` read it?
2. Does a hub change anything for the pad or the stick?
3. How much RAM, and how much of it is free with the HMI up?
4. Which Mesa version, which EGL platforms (GBM, surfaceless, Wayland), and is desktop GL built in?
5. Who may open `/dev/dri/renderD128`?
6. Which ALSA PCM names does the smartx plugin define, and at what rates?
7. What does `core_pattern` point at, and what are the systemd defaults for core dumps?
8. Thermal headroom: which zones exist, and where are the trip points?
9. Has the frame-file path or the CarLife sound route ever worked on this car?
