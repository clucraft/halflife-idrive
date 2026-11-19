# Recon: Half-Life on the iDrive 7 head unit

Phase 0 of the port. What we know before writing any engine code, where each fact comes from, and what is still a guess.

> **Nothing in this document has been measured on the car by this project yet.** The head-unit facts come from reading the reference repositories and from a controller probe done for nes-idrive on 2026-11-19. The probe batches in `tools/probe/` have only run on the PC. Section 10 is filled in when they run on the car.

Sources are marked like this:

| Mark | Meaning |
|---|---|
| **[car]** | Read from this head unit, read-only. So far only the nes-idrive controller probe. |
| **[other car]** | Another owner documented it from their own car. Firmware and kernel differ from ours (theirs `4.14.147-apl`, ours `4.14.198-apl`). |
| **[code]** | What reference code does. It shows what its author expected of the unit, not that it ran there. |
| **[doc]** | A README or protocol document says so. |
| **[pc]** | Checked on the build PC. |
| **[guess]** | Inference. Needs a probe or a test. |

Repositories read: clucraft/plex-idrive, nes-idrive and swarm-idrive; cauliflowermossgrape/idrive7-apps (the kit); robertnisipeanu/mgu-store (the Store, mgu-render 0.6.24); JustAnotherPU/moonride; Vizualyse/idrive-apps; FWGS/xash3d-fwgs and hlsdk-portable.

## 1. Build PC [pc]

- Windows 11, with WSL2 (Ubuntu 26.04, kernel 6.18) as the only distro.
- No Docker Desktop. Docker Engine 29.8.1 runs inside the WSL2 distro, the user is in the `docker` group, and `D:` is visible there as `/mnt/d`. That is enough for an `ubuntu:18.04` build container.
- 16 logical CPUs and 47 GB RAM are visible to WSL.
- Git 2.45 and the GitHub CLI (signed in as `clucraft`) are on the Windows side.

## 2. Game data [pc]

- Steam copy at `D:\SteamLibrary\steamapps\common\Half-Life`, build id 15961492, `steam.inf` PatchVersion 1.1.2.2. Treated as read-only.
- It is the 25th-anniversary build: `sprites/` has the 1280 and 2560 HUD sets, and `liblist.gam` carries `animated_title` and `hd_background`.
- `valve/` is 517 MB in 4,250 loose files. There is no `.pak`; eight `.wad` files sit at the top level.
- `valve/dlls` and `valve/cl_dlls` hold Valve's Windows, macOS and 32-bit Linux libraries. We use none of them (section 8).
- `valve_hd` (8.9 MB) and `platform` (1.6 MB) are not needed.

## 3. Head unit: what is already known

| Fact | Source |
|---|---|
| Kernel `4.14.198-apl`, systemd, BusyBox | [car] |
| `/proc/config.gz` is absent | [car] |
| No HID core, usbhid, hidraw, evdev, joydev, uinput or xpad. No `/dev/input`. The only input device is the power button | [car] |
| USB drivers registered with nothing plugged in: `hub`, `usb`, `usbfs` only | [car] |
| Raw USB works: `/dev/bus/usb/<bus>/<dev>`, mode `crw-rw----`, `root:mgu_usb` | [car] |
| An Xbox One S pad (045e:02ea) enumerates at full speed, 500 mA, behind the unit's hub; no driver binds | [car] |
| The unit can power-cycle itself mid-session when the car sleeps and wakes | [car] |
| Intel Atom A3960, 4 cores; about 5.6 GB RAM, not 8; zram swap | [other car] |
| GPU Intel HD Graphics 505 (`8086:5a84`, Gen9, 18 execution units), memory shared with the CPU; passively cooled | [other car] |
| Mesa 19.0.6 with the `i965` driver only: OpenGL ES 3.2, EGL 1.4, no Vulkan, no X11. libdrm 2.4.96, libwayland 1.15 | [other car] |
| EGL platforms are Wayland and GBM only. No surfaceless platform, and GBM offers no pbuffers | [other car] |
| `/dev/dri/renderD128` is group `video`. `/dev/dri/card0` belongs to the compositor and must not be opened | [other car] |
| glibc 2.27; libstdc++ 6.0.24; the loader is only at `/lib/ld-linux-x86-64.so.2`, there is no `/lib64` | [other car]; [code] build gates in plex-idrive and mgu-render |
| The kernel refuses modules not signed by BMW, and has no 32-bit emulation | [other car] |
| systemd 237; unit output goes nowhere unless the unit asks for the journal; the journal is in RAM | [other car] |
| `core_pattern` pipes to BMW's crash handler | [other car] |
| freetype is present; fontconfig, NSS and SDL are not | [other car] |
| Centre display 1920x720 at 60 Hz | [doc] Store, kit; [other car] |
| System compositor "Winston": `XDG_RUNTIME_DIR=/run/wayland`, socket `wayland-0`, group `mgu_wayland`, ivi-shell, no xdg-shell | [code] mgu-render; [other car] |
| Root filesystem read-only; `/var/opt` writable and kept across firmware updates; `/run`, `/tmp`, `/dev/shm` are tmpfs and empty after every start | [doc]; [other car] |
| A 2.5" disk with a writable share of about 90 GB at `/var/opt/hdshare` | [doc] kit |
| Node 8.16 at `/usr/bin/node`; apps run one process each under their own uid, all in group `tm_oap_app` | [code]; [doc] |
| `scp` and `sftp` are missing in some firmware builds; file transfer is tar over ssh | [doc] kit |
| Thermal behaviour, trip points, throttling | unknown everywhere |

Standing rules for this unit, from the owner's SSH notes kept with nes-idrive: read-only; no remount; do not stop, start, restart or kill anything; do not reboot; no kernel modules; no writes to `/sys` or `/proc`. Only `cat ls dmesg zcat grep readlink uname lsmod head hexdump` run without asking; anything else is shown to the owner first.

## 4. Display path

The frame file is real and specified, but it is a video path, not a framebuffer.

- **Format** [code]: `/dev/shm/mgu-video-<name>` is an "MGVF" file. A 64-byte header of sixteen little-endian `uint32`: magic `0x4656474d`, version 1, width, height, `seq`, `slot`, `nslot`, matrix (0 BT.601, 1 BT.709), range (0 limited, 1 full), format (0 I420, 1 NV12), six zero words. Then `nslot` frames.
- **Pixels are YUV 4:2:0 only** [code]: each frame is `w*h*3/2` bytes, rows unpadded. I420 everywhere; NV12 only on mgu-render 0.6.24 and later. There is no RGB frame file, so every game frame is converted from RGB and loses chroma resolution.
- **Limits** [code]: width and height even, 16 to 2048; `w*h*3` at most 12 MiB per app and 32 MiB for all apps; 1 to 4 slots; 4 videos per app.
- **No locking** [code]: the writer fills slot `(slot+1) % nslot`, stores `slot`, then stores `seq+1`. The renderer polls the header every 5 ms while the app is shown.
- **Cost in the renderer** [code]: each new frame is read whole into memory and uploaded as textures; the YUV to RGB step is a shader. Scaling to the drawn rectangle is bilinear, "aspect kept, centred".
- **Ownership** [code]: a regular file, opened without following links, owned by the app's uid, root or `nobody`. The renderer keeps the file it opened, so the app names it again when its inode changes.
- **Who draws** [code]: the renderer is a root Wayland client of Winston that puts one ivi layer per app on the screen with EGL and GLES2. The app (JavaScript) names the frame file and sends a `video` draw operation. No C client for the renderer socket exists in any repository; every example drives it from Node.
- **Full screen** [code]: a layer placed at 0,0 1920x720 covers the HMI including its status strip and back column. An app is shown only while it is the front app, and layers yield to the camera surfaces.
- **Watchdog** [code]: the renderer hides a layer whose app sends nothing for 3 s. New video frames do not count, so the app must send at least one message a second.
- **Two renderers, two kits** [code]: the Store's `mgu-render` and the kit's `idrive7-renderd` are the same program under two names and sockets. The `video` operation in the JavaScript client exists in the M850i-amn fork of the kit that plex-idrive copies and in mgu-render's own client, not in the upstream kit runtime.
- **Seen working?** plex-idrive has not run on a car [doc]. Vizualyse's notes say video on the frame file worked on their unit, and moonride streams through it on a G05 [other car]. No measured frame rate or copy cost on an iDrive 7 car was found anywhere.

Other pixel routes in the same renderer protocol [code]: opaque or premultiplied RGBA pixmaps and INDEX8 pixmaps up to 2048 a side with region updates, sent over the socket (24 MiB message limit). The kit's Doom uses image uploads at up to 1920x504.

Consequences:

- 1280x720 would be pillarboxed on a 1920x720 screen. An 8:3 size fills it: 1280x480 is 0.9 MB per slot and scales by exactly 1.5.
- The backend needs an RGB to YUV conversion per frame, cheap next to software rendering, and it can move into a shader once rendering is on the GPU.

## 5. Sound path

- **Route** [code]: the app asks the GENIVI audio manager over SOME/IP (`org.genivi.am.commandinterface.CommandControl`) to connect source 287 ("CarLife") to sink 1024 (front media), after marking the source available through the routing interface. Without that step the connect never completes [other car]. plex-idrive, moonride and Vizualyse all do it this way.
- **Device** [code]: ALSA `plug:smartx:CarLifeMedia_CF_48_STEREO`, S16LE stereo, 48 kHz native. There is no `default` device and no `aplay` on the unit [other car].
- **Buffering** [other car]: SmartXbar imposes three periods of 1024 frames (64 ms).
- **Access** [code]: group `mgu_alsa`. moonride's whole service runs as `nobody` with `video`, `mgu_usb` and `mgu_alsa` as supplementary groups.
- **Root must never open the stream first** [other car]: a root process that does leaves a root-owned lock in `/run/smartx`, and CarPlay stayed silent until the unit restarted. Our binary must have dropped root before it touches ALSA.
- **When the route is not connected** [code]: writes return `EAGAIN`; both players drop audio then.
- **Shared source** [code]: source 287 is used by other community apps; a connection left behind by an earlier run has silenced everything. Always disconnect and mark the source unavailable on the way out.
- **Other quirks** [other car]: the first open after boot can take very long to connect; the car's volume knob works; the volume popup is drawn under a full-screen layer.
- **Interruptions** (park-distance beeps, navigation prompts, calls): no repository handles or documents them. Unknown.

## 6. Input

- **Gamepad**: the kernel has no input layer [car] and accepts no unsigned modules [other car], so no pad ever produces `/dev/input` nodes and the engine's evdev code is useless here. The only route is a userspace reader on usbfs with group `mgu_usb`.
- **What exists** [code]: moonride and Vizualyse both read Xbox 360-protocol pads (interface class `ff/5d/01`) through usbfs ioctls, with a start-up LED packet; an 8BitDo adapter in X-input mode and a Flydigi pad are reported working [other car]. Neither supports Xbox One "GIP" pads. nes-idrive's reader does GIP, with start-up packets taken from the kernel's `xpad.c`, and has run only against a stand-in.
- **The owner's pad** is an Xbox One S pad [car], which is GIP: it needs the start-up handshake before it reports anything. Supporting both protocols is the safe plan.
- **iDrive controller** [code]: SOME/IP field `statusRotaryEncoderState` of `de.bmw.infotainment.controlelements.FrontCCU` (turn counter, press, tilt). With the `mgu-inputgate` tool installed an app can hold the controller so the HMI stops reacting. That tool is preloaded into the HMI by its own Store package, and the brief allows nothing beyond it.
- **Touch**: the display's touch packets reach an app only if it claims regions through the renderer. One owner reports two unit restarts after claiming touch on older firmware and forbids it; moonride and the Store rely on it on newer firmware [other car, conflicting]. The first versions should not claim touch at all.
- **BACK, MENU, HOME** always stay with the HMI [code].
- **Nothing reaches a native process directly** [code]: both Moonlight clients forward controller and touch events from the JavaScript app over a control socket.

## 7. USB stick

- **Mounting** [other car]: udisks2 mounts sticks at `/media/<label or uuid>`, `ro,nosuid,nodev,noexec`. FAT32 appears with every file world-readable. The kernel has vfat, Tuxera exFAT and NTFS, and ext4; exFAT is still listed as untried by that owner.
- **Discovery** [code]: the Store and Vizualyse read `/proc/mounts` for entries under `/media`; nes-idrive looks in `/media/*`.
- **Writing**: not as mounted. Vizualyse remounts the stick read-write as root; that changes a system mount and is outside this project's rules unless the owner asks for it.
- **On this car** [car]: with no stick plugged in, no USB storage driver was registered. It may load on plug-in. Unverified until the stick test.

Consequences: the game data can be read from the stick by `nobody`, if this unit mounts sticks like the other one does. Saves and config cannot go on the stick as mounted. Game libraries cannot run from it either (noexec), which is fine because they ship in the tool.

## 8. Engine: Xash3D FWGS and hlsdk-portable

Read at xash3d-fwgs `11ed246c` and hlsdk-portable `89e83b92` (both 2026-11-08). Nothing was built.

### Platform layer

- `engine/platform/linux` does have `vid_fbdev.c`, `in_evdev.c` and `s_alsa.c`, selected when a Linux client is built without SDL (`--enable-fbdev`). **Confirmed.**
- That client is unmaintained and, from reading, will not link as it stands: the fbdev backend lacks two functions the engine references unconditionally, and the evdev reader uses a 16-byte event size that is wrong on x86-64. Treat it as a template.
- The supported way to add a backend is the porting guide's: new ids in `common/backends.h`, a new branch in `common/defaults.h`, and a new directory under `engine/platform/`. The PS4 port in the tree is a complete non-SDL example.
- The video backend is about seventeen functions (`R_Init_Video`, `VID_SetMode`, `GL_SwapBuffers`, `SW_CreateBuffer`, `SW_LockBuffer`, `SW_UnlockBuffer` and so on).

### Renderers

- **Software** (`ref_soft`, off by default, `--enable-soft`): the platform owns the target buffer and reports its layout; 2, 3 or 4 bytes per pixel work. `SW_UnlockBuffer` is the natural "frame ready" hook.
- **GL family**: `ref_gl` (desktop GL), `ref_gles3compat` (built-in shader emulation of fixed function, no extra dependency), `ref_gl4es`, `ref_gles2` (deprecated wrapper), `ref_gles1`.
- `ref_gles3compat` asks for an ES 2.0 context and by default generates `#version 310 es` shaders; `-minshaders` drops to `#version 100`. The unit's ES 3.2 covers the default.
- **No EGL code exists in the engine.** The platform backend creates the context; the renderer only calls back for attributes, symbols and buffer swaps.
- The renderer draws to framebuffer 0. Since the unit has no pbuffers, an offscreen context needs either a GBM surface (which has a framebuffer 0) or a surfaceless context plus a small renderer change to target our own framebuffer object.

### Sound

- The ALSA backend opens the device named by `-alsadev` (default `default`), S16 stereo at 44100 Hz with "rate near", period 2048 frames, non-blocking, written from the main loop with no thread. Rate and period will need matching to SmartXbar's 48 kHz and 1024 frames.

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
- No report of a Linux problem with this data was found.
- **Tried in Phase 1 on the PC:** the menu, `c0a0`, `c1a0`, the HUD and a save all work with this data (BUILD.md). No need to switch Steam to the legacy branch.

### Game libraries

- On 64-bit Linux the engine asks for `cl_dlls/client_amd64.so` and `dlls/hl_amd64.so`, which is what hlsdk-portable builds with `-D64BIT=1`. Valve's own libraries in the data are never requested.
- They need not sit in the game folder: `-dll` and `-clientlib` take absolute paths.

### Build

- `./waf configure -8 ...`; bundled copies of the codecs with `--enable-bundled-deps`. The bundled waf wants Python 3; Ubuntu 18.04's Python 3.6 is new enough (built in Phase 1).
- Link-time optimisation uses a flag GCC 7 does not have, so no `--enable-lto` in the 18.04 container.
- The menu library and the game libraries are C++. Ubuntu 18.04's libstdc++ is newer than the unit's 6.0.24, so it must be linked statically, as plex-idrive does.
- Fonts: the unit has freetype but no fontconfig; the engine's `--enable-stbtt` option avoids both. The menu then loads its font from the engine's own `extras.pk3` (seen working in Phase 1).
- Outputs: launcher `xash3d`, `libxash.so`, `filesystem_stdio.so`, renderer libraries, the menu library, and `extras.pk3`.

### Running without a screen

- A client cannot be built with no video backend, and there is no movie writer. `screenshot` writes PNGs and `-timedemo <name>` prints frames, seconds and fps, then quits.
- Our own frame-file backend is headless by nature, so Phase 1 can use it directly and read the frames back on the PC.

### Behaviour that matters for a locked-down service

- A non-SDL client has no SIGTERM handler: it dies without saving config and leaves its frame file behind (seen in Phase 1). Our backend installs one and quits from the main loop.
- A client reads no console commands from stdin; only the dedicated server does. Our backend adds that behind `-stdincmds`, as the service's way to talk to the engine.
- `extras.pk3` need not sit in the game folder: `XASH3D_EXTRAS_PAK1` names it, so it can stay in the install folder.
- The crash handler catches SIGSEGV, SIGABRT, SIGBUS and SIGILL, prints a backtrace and then shuts down normally.
- It writes an id file under `$HOME` unless `HOME` is unset, and reads `/etc/machine-id`, disk ids and MAC addresses to build that id.
- It initialises HTTP and master-server code at start. The service's user has no route out, so this should fail quietly; to be watched.
- Single-threaded apart from a resolver thread.

### Licences

- Engine: GPL 3.0 or later (per-file headers; the checkout has no top-level licence file). Menu library: GPL 2.0 or later.
- hlsdk-portable: Valve's Half-Life 1 SDK licence. Binaries may be distributed only free of charge and with the LICENSE file; commercial use needs Valve.
- mgu-render and both Moonlight clients are GPL 3.0 or later, so their usbfs code is licence-compatible with the engine.
- Game data is covered by none of these and is never distributed by this project.

## 9. Store and service rules, and what must never happen

### What the precedents are

- **No native game ships in the kit.** Its Doom is doomgeneric compiled to WebAssembly, running inside the app's Node 8 process, with no sound and no gamepad.
- **The closest precedents** are the two Moonlight clients (native decoder as a Store tool, frame file, ALSA, usbfs pad) and Vizualyse's Steam tool, which runs native games from a stick [other car].

### Packaging

- **Repository layout** [doc]: `mgu-repo.json` at the root. Apps are built from source on the head unit by the kit's Python build (Node 8.16 or Python 3.12, no network, 10 minutes, 200 MB). A native program ships only as a "tool": a folder with a `component.json` naming prebuilt, committed files, units and drop-ins.
- **Limits** [code]: a repository tarball of 64 MiB in this layout; an icon of 128 KiB; an app's data folder of 20 MiB by default.
- **A public repository is not required** [doc]: private ones work with a token. Public only avoids the token and GitHub's API rate limit. The hard rule is different: no BMW SDK or firmware-derived file in the repository.
- **Install locations** [code]: tools in `/var/opt/<id>/versions/<version>/` behind a `current` link, state in `/var/opt/<id>/`, units in `/etc/systemd/system` (the Store's deploy tool handles the read-only root itself). Apps in `/var/opt/public/oap/oap_<uid>/`.
- **Everything uninstalls through the Store** when the component is marked `uninstallable`; `deactivate` hooks clean up.

### Service lifetime

- **A new tool's units start only after the next head-unit start** [doc], because the restart manager reads its list at boot. So the first install needs one restart of the head unit.
- **Pattern to copy** [code]: plex-idrive's socket activation on `/run/<id>.sock`. The service starts when the app first connects and exits by itself when idle; it is never enabled at boot. The socket is given the app's own gid, not the group all apps share.
- **Health gate** [doc]: every unit a tool starts must be up and not restarting 10 s later, and its `check` must pass, or the tool rolls back.
- **Limits**: the Store adds `LimitCORE=1` and start-rate limits to every tool unit. It imposes no CPU or memory limit; authors add their own. plex-idrive uses `CPUQuota=200%`, `MemoryLimit=768M`, `TasksMax=48`, `Nice=10`.
- **Memory** [other car]: apps share about 1000 MiB and the app manager kills apps when memory runs low, so a large native process belongs in its own memory group. Swap thrash froze that unit for seconds near the cap.

### Things that restart or wipe the head unit

1. **A crash of a process whose file name is not on the crash handler's list restarts the head unit** [doc]. Every shipped executable is listed by name through `crashNames`, and the list takes effect from the next boot. Units keep `LimitCORE=1` (1, not 0: with a pipe handler the kernel still dumps at 0). moonride also clears the dumpable flag and turns fatal signals into a plain exit. For a game engine this is the main safety item.
2. **Stopping a service that is not on the restart manager's list restarts the head unit** [other car]. Never hand-make trial units; let the Store install them.
3. **An app process that exits unexpectedly loses its data folder, and is uninstalled the second time** [doc]. Never kill an app. So saves must not live in the app's data folder.
4. **Never restart `hmi.service` or `oapcontroller`**, and never stop a renderer that has an app surface up [doc].
5. **Never open `/dev/dri/card0`, never ship a GPU driver** [other car]. One i915 context parameter hung that unit.
6. Three head-unit starts that end within five minutes put the Store in safe mode with every tool off [doc].
7. `ExecStartPost` and `deactivate` scripts must always exit 0, or the socket unit fails or removal is refused [code].
8. The sound device is closed before the process exits, and the process is not SIGKILLed with it open [code].
9. Symbols newer than glibc 2.27 must be avoided; plex-idrive stays at 2.25 and wraps `powf` and `log2f` [code].
10. Node 8 only in the app: ES2017, no optional chaining, no object spread [code].

### Parked-only gate

- **Speed** [code]: SOME/IP `de.bmw.infotainment.vehicle.Vehicle2`, field `statusCarSpeed2.speedVehicleCentreOfGravity`, 0.015625 km/h per unit, 65535 invalid. It is polled every 2 s because a standing car may not notify.
- **Selector** [code]: `de.bmw.infrastructure.VehicleInformation`, `statusGearboxDrive` or `DataPowerTrain2`; some cars never send the first.
- **Existing gates** [code]: the kit treats "no speed ever read" as parked, because counting silence as moving once locked a parked car out of Doom. moonride's strict variant and plex-idrive do treat unknown as moving, which is what the brief asks for. Most vehicle data needs the ignition on [other car], so the gate needs a test with the ignition in each state.
- **Where it is enforced** [code]: only in the JavaScript app, in every project. For this port the service should also stop the engine when the app stops reporting a parked car.

## 10. Probe of the car

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

Most of section 3 comes from another car, so the probe's first job is to confirm it on this one.

What a read-only probe cannot answer:

- **Whether an offscreen EGL context works on the render node.** We can see the node, its group, the libraries and the EGL platform names. Creating a context means running a small program on the unit, which is a write. That test belongs to Phase 3 with the owner's OK.
- **Whether pad buttons arrive.** That needs the usbfs reader.
- **Whether the frame file and the sound route work on this car.** Phase 3.

### Results

Pending.

## 11. What this changes in the plan

| Brief | Finding | Proposed change |
|---|---|---|
| Doom already ships natively for this platform | The kit's Doom is WebAssembly inside Node, without sound or gamepad | The Moonlight clients are the model for a native tool |
| Add a video backend under `engine/platform/linux` | The non-SDL Linux client there is broken and has no GL path | A backend directory of our own, following the porting guide; reuse `s_alsa.c` |
| Frames to the mgu-render frame file | The file is YUV 4:2:0 video; seen working on other cars, not on this one | Keep it as the plan and convert in the backend; RGBA pixmaps over the socket are the fallback |
| Start at 1280x720 or lower | The screen is 1920x720 | Start at 1280x480, capped at 30 fps |
| Input from the gamepad (evdev) | No input layer in the kernel, and no way to add one | A usbfs reader of our own for Xbox 360 and Xbox One pads; controller forwarded by the app |
| Touch for menus | Claiming touch restarted one owner's unit twice | No touch in the first versions |
| Game data on a USB stick | Sticks mount read-only and noexec on another car; unverified here | Read the data from the stick with `-rodir`; the stick test confirms |
| Saves on the stick if writable, otherwise the app's data folder | The stick is read-only as mounted, and the app's data folder is wiped when its process dies | Saves in the tool's own folder under `/var/opt`. Remounting the stick read-write is possible but changes a system mount |
| Run headless with the software renderer in Phase 1 | No null video backend; an open report of the software renderer crashing on map load on linux-amd64 (xash3d-fwgs issue 2666) | Build our frame-file backend first and use it headless; if the crash reproduces, bring the GPU renderer forward |
| Offscreen EGL context on the render node, with readback | No pbuffers and no surfaceless platform; GBM with a surfaceless context is what Vizualyse ships | GBM device on the render node, then readback into the same frame file. The alternative, our own ivi surface, needs root in `mgu_wayland` for the life of the process |
| The service drops root as early as it can | Root must not open the sound stream at all | Drop to `nobody` with groups `video`, `mgu_alsa`, `mgu_usb` before anything else is opened |
| The repo must be public before the Store install | Private repositories work with a token | Public is a choice, not a requirement |
| Probably 8 GB RAM | About 5.6 GB on another car, about 1.4 GB available under load | Keep the engine's memory limit well under 1 GB |

## 12. Open questions

For the probe:

1. Does this unit mount a USB stick the way the other car does: where, which filesystem, which options, readable by `nobody`?
2. Does a hub change anything for the pad or the stick?
3. RAM, and how much is available with the HMI up.
4. Mesa version, EGL platforms and libstdc++ version on this firmware.
5. Group and mode of `/dev/dri/renderD128`.
6. Which ALSA PCM names the smartx plugin defines.
7. `core_pattern`, and the systemd defaults for core dumps.
8. Thermal zones and trip points. Nobody has documented these.
9. Which renderer is installed and at which version (NV12 and the `video` operation depend on it).

For the owner:

1. Has the frame-file path or the CarLife sound route ever worked on this car?
2. Xbox One S pad only, or is an Xbox 360-protocol pad or adapter available too?
3. Are saves under `/var/opt` acceptable, given that the stick is read-only as mounted?
