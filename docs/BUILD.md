# Building and testing on the PC

Everything here runs on the PC. Nothing touches the car, and the game data is only ever mounted read-only.

## What you need

- Linux with Docker. On Windows that is WSL2 with Docker Engine inside the distro; Docker Desktop is not needed.
- Your own copy of Half-Life for the tests. The scripts expect the Steam folder at `/mnt/d/SteamLibrary/steamapps/common/Half-Life`; set `HL_DATA` if yours is elsewhere.

## Build

```sh
bash tools/build/build.sh
```

1. Fetches Xash3D FWGS and hlsdk-portable at the commits in `port/pins.env` into a work folder outside this repository (`~/hl-idrive`, or `HL_WORK`).
2. Lays this project's changes over the engine source: `port/engine.patch` (edits to upstream files) and `port/engine/` (new files).
3. Builds in an Ubuntu 18.04 container (GCC 7.5, glibc 2.27, the head unit's C library version).
4. Runs `tools/build/check-elf.sh` over the result and fails if any file could not load on the head unit.

The result is in `<work>/out`: about 10 MB stripped, 5 MB compressed.

| File | What it is |
|---|---|
| `engine/xash3d` | launcher |
| `engine/libxash.so` | engine, with this project's platform backend |
| `engine/filesystem_stdio.so` | the engine's file system |
| `engine/libref_soft.so` | software renderer |
| `engine/libmenu.so` | main menu |
| `engine/valve/extras.pk3` | the engine's own menu art and font |
| `game/hl_amd64.so`, `game/client_amd64.so` | game libraries from hlsdk-portable |

### What the check enforces

- The launcher names the loader at `/lib/ld-linux-x86-64.so.2`, the only place the head unit has it.
- No file asks for a glibc symbol newer than 2.27.
- No file needs the system's C++ runtime; it is linked in, because the unit's is older than the container's.
- Shared libraries needed from the system are only `libc`, `libm`, `libdl`, `libpthread`, `librt` and `libasound.so.2`.

That list comes from another owner's car (see RECON.md). The probe of this car has to confirm it.

### Changing the engine

Edit upstream files in `<work>/xash3d-fwgs`, then run `bash tools/build/save-patch.sh` before the next build. The build resets that source to the pinned commit and applies the patch again, so unsaved edits there are lost. New files go under `port/engine/`.

## The platform backend

`port/engine/platform/mgu/`, selected with the engine option `--enable-mgu`:

- **Video** (`vid_mgu.c`): no window. The software renderer draws into a buffer, and each finished frame is converted to I420 and written to the next slot of a frame file in the format mgu-render shows (`mgvf.h`). The file is `/dev/shm/mgu-video-clucraft-halflife` unless `MGU_VIDEO_FILE` or `-mgufile` says otherwise. Default size 1280x480; `-width` and `-height` change it.
- **Life cycle** (`sys_mgu.c`): SIGTERM, SIGINT and SIGHUP make the engine quit the ordinary way: config saved, frame file removed, exit code 0. A second signal ends it at once. With `-stdincmds`, lines on stdin are console commands.
- **Sound**: the engine's own ALSA backend. Not exercised yet beyond "no device".
- **Input**: none yet.

## Run without a screen

```sh
bash tools/run/headless.sh menu 20
bash tools/run/headless.sh c1a0 30 +map c1a0
```

The engine runs in the same container image with no network, a read-only root, `HOME` unset and the game data mounted read-only. After the given seconds the newest frame is read out of the frame file the way the renderer reads it and saved as `<work>/run/<name>/frame.png`. Then the engine gets SIGTERM.

`tools/mgvf/mgvf2png.py` is that reader. It also checks the header against the renderer's limits.

## Phase 1 results (2026-11-19)

All on the PC, with the 25th-anniversary Steam data. None of it has run on the car.

| Test | Result |
|---|---|
| Main menu | Draws, with the anniversary background and animated title. Fonts come from the engine's own pack. |
| `c0a0` (tram ride) and `c1a0` (first chapter) | Load and draw. The software-renderer crash reported upstream (issue 2666) did not occur. |
| HUD with the anniversary sprites | Draws (health, armour, ammo, flashlight). |
| Save game | `save/phase1.sav` written under the writable base folder. |
| Writes | Only under the writable base folder: config, saves, a font cache, an id file. Nothing in the game data, nothing elsewhere. |
| Stop on SIGTERM | Config saved, frame file removed, exit code 0. |
| No sound device | The engine reports it and carries on without sound. |
| No network | Starts and runs normally. |
| Memory | 63 MB at the menu, 100 MB in `c1a0` (peak resident). |

### Timedemo baseline

A 38-second demo of the `c0a0` tram ride (3,763 frames), played back as fast as possible. Software renderer, one thread, including the conversion to I420 and the writes to the frame file.

| Size | Seconds | Frames a second |
|---|---|---|
| 1280x480 | 10.25 | 367 |
| 960x360 | 8.24 | 456 |
| 640x240 | 6.64 | 567 |

Measured on an AMD Ryzen 7 9800X3D. The head unit's Atom is several times slower per core, so these numbers only show that the renderer has room. What the car reaches is unknown until Phase 3.

To repeat it:

```sh
export HL_BASE=~/hl-idrive/run/shared
HL_STDIN="sleep 12;record tram;sleep 40;stop;sleep 2" bash tools/run/headless.sh record 60 +map c0a0
bash tools/run/headless.sh timedemo 240 -timedemo tram
```
