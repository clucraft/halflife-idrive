# Building and testing on the PC

Everything here runs on the PC. Nothing touches the car, and the game data is only ever mounted read-only.

## What you need

- Linux with Docker. On Windows that is WSL2 with Docker Engine inside the distro; Docker Desktop is not needed.
- Node.js and Python 3 on the PC, for the unit tests and the emulator. Any current version.
- Your own copy of Half-Life for the tests that run the real engine. The scripts expect the Steam folder at `/mnt/d/SteamLibrary/steamapps/common/Half-Life`; set `HL_DATA` if yours is elsewhere.

## The parts

| Folder | What it is |
|---|---|
| `port/` | This project's changes to the engine: `engine.patch` (edits to upstream files), `engine/` (new files), `pins.env` (the upstream commits). |
| `native/clucraft-halflife/` | The Store tool: the service and, in `bin/`, the built engine. |
| `apps/clucraft_halflife/` | The Store app: launcher, game view, status, log. |
| `kit/` | The MGU App Kit the app is built with, as plex-idrive carries it. |
| `tools/`, `test/`, `docker/` | Build, test and emulator scripts. |
| `mgu-repo.json` | What the MGU Store reads when this repository is added as a source. |

## Build the engine

```sh
bash tools/build/build.sh
bash tools/build/stage.sh
```

`build.sh`:

1. Fetches Xash3D FWGS and hlsdk-portable at the commits in `port/pins.env` into a work folder outside this repository (`~/hl-idrive`, or `HL_WORK`).
2. Lays this project's changes over the engine source.
3. Builds in an Ubuntu 18.04 container (GCC 7.5, glibc 2.27, the head unit's C library version).
4. Runs `tools/build/check-elf.sh` over the result and fails if any file could not load on the head unit.

`stage.sh` copies the result into `native/clucraft-halflife/bin/`. The Store installs a tool from files committed in the repository, so these binaries are committed. `bin/BUILD.json` records the upstream commits, the hashes of this project's engine changes and the hash of every file; `npm test` fails when `bin/` is not what those sources build.

| File in `bin/` | What it is |
|---|---|
| `clucraft-hl` | The engine's launcher, under a name of its own (the head unit's crash handler knows programs by file name). The only executable. |
| `libxash.so` | The engine, with this project's backend. |
| `filesystem_stdio.so`, `libref_soft.so`, `libmenu.so` | The engine's file system, software renderer and main menu. |
| `hl_amd64.so`, `client_amd64.so` | The game libraries from hlsdk-portable. |
| `extras.pk3` | The engine's own menu art and font. |

9.8 MB in all.

### What the check enforces

- The launcher names the loader at `/lib/ld-linux-x86-64.so.2`, the only place the head unit has it.
- No file asks for a glibc symbol newer than 2.27.
- No file needs the system's C++ runtime; it is linked in, because the unit's is older than the container's.
- Shared libraries needed from the system are only `libc`, `libm`, `libdl`, `libpthread`, `librt` and `libasound.so.2`.

That list comes from another owner's car (see RECON.md). The probe of this car has to confirm it. On the car, the service runs the engine's self-test at every start and the Store's check fails the install if it does not pass.

### Changing the engine

Edit upstream files in `<work>/xash3d-fwgs`, then run `bash tools/build/save-patch.sh` before the next build. The build resets that source to the pinned commit and applies the patch again, so unsaved edits there are lost. New files go under `port/engine/`.

## The engine backend

`port/engine/platform/mgu/`, selected with the engine option `--enable-mgu`:

- **Video** (`vid_mgu.c`): no window. The software renderer draws into a buffer, and each finished frame is converted to I420 and written to the next slot of a frame file in the format mgu-render shows (`mgvf.h`). Default size 1280x480; `-width` and `-height` change it.
- **Sound** (`snd_mgu.c`): ALSA, written for the car's sound service. It opens the device at 48 kHz (`-alsarate`), converts the engine's 44.1 kHz itself, takes whatever buffer the device has, and never waits for it. While the device takes nothing (the car has not connected it to the speakers) the sound is dropped instead of queued. The engine's own ALSA code gave up on a 48 kHz device behind a rate converter, which is what the car has.
- **Input** (`sys_mgu.c`): nothing opens a device. Keys, pad axes and touch arrive as commands on stdin (`mgu_key`, `mgu_axis`, `mgu_touch`).
- **Hold** (`sys_mgu.c`): `mgu_hold 1` stops the main loop where it stands: no frame, no game time, no sound, no CPU. `mgu_hold 0` lets it go on as if no time had passed.
- **Frame rate**: capped at 30 in the backend (`-mgufps`). The engine's own cap steps aside when its vsync setting is on, which is the default.
- **Life cycle**: SIGTERM, SIGINT and SIGHUP quit the ordinary way (config saved, frame file removed, exit code 0); a second signal ends it at once. When stdin ends, the service is gone and the engine quits. It refuses to run as root.
- **Crashes**: no core dump can be written (the process is undumpable). The engine's crash report goes to the log, then the process ends within three seconds with the signal's exit code.
- **Status**: with `-mgustatus <fd>`, one line a second: state, map, frames a second, picture size, sound.
- **Self-test**: `-mguselftest` loads every library beside the program and leaves.

## Tests

| Command | What it runs | Needs |
|---|---|---|
| `npm test` | The service with a stand-in engine, the app's pages, `main.js` from the staged package, the manifests | Node, Python 3 |
| `bash tools/run/tests-node8.sh` | The same on Node 8, in a container | Docker |
| `bash tools/run/service.sh` | The real service with the real engine and your game data: picture, sound, input, hold, save, crash, hang | Docker, the game |
| `bash tools/run/headless.sh <name> <seconds> [args]` | The engine alone, for one picture or a timedemo | Docker, the game |
| `npm run emu` | The app in the kit's emulator, in a browser | Node, Python 3 |
| `npm run shots` | The app's pages as pictures into `docs/` | Node |

`npm run emu` fetches the kit's emulator from GitHub once, or takes a checkout you name with `--kit`. On the emulator's panel set **Manual**, speed 0 and gear P, or no game starts: with nothing known about the car, it is not parked. The emulator shows no video, so the game view there says where the picture would be.

`tools/run/service.sh` runs in a container with no network, a read-only root and the game data mounted read-only. Sound goes to a 48 kHz device with a clock and no speakers (a PulseAudio null sink), and what arrives there is recorded and checked.

## Phase 2 results (2026-11-19)

All on the PC. None of it has run on the car.

| Test | Result |
|---|---|
| `npm test` | 16 of 16 on Node 24 (Windows) and on Node 8.10 (container) |
| `tools/run/service.sh` | 35 of 35 checks, with the 25th-anniversary Steam data |
| App in the kit's emulator | Launcher, start, game view, "not parked" hold, return to the launcher: all seen working |

What the run with the real engine showed:

| | |
|---|---|
| Frame rate | 30.0 every second, at 1280x480 |
| Cost of a frame | 2.5 ms in the tram ride, 8% of one core, on a Ryzen 7 9800X3D |
| Memory | 97 MB in `c0a0` |
| Sound | Recorded at 48 kHz without a gap in 12 seconds of the tram ride; silent during a hold |
| Hold | No frames and 0.0% CPU over 75 seconds, then the game goes on in the same map |
| Stop | The game is saved, the engine quits with code 0, the frame file is gone; "Continue" loads the save |
| The app goes away | The game is saved and ended after the set time |
| Crash (SIGSEGV) | Exit code 139 within seconds, no core file, no frame file, the report in the log |
| Hang (SIGSTOP) | Ended by the service, with SIGKILL as the last step |
| What the engine wrote | 0.1 MB: config, one save, an id file |

The head unit's Atom is several times slower per core than the PC. 2.5 ms a frame here says the software renderer has room at 30 frames a second, not that the car reaches it. That is Phase 3's to measure.

## Phase 1 results (2026-11-19)

| Test | Result |
|---|---|
| Main menu | Draws, with the anniversary background and animated title. Fonts come from the engine's own pack. |
| `c0a0` (tram ride) and `c1a0` (first chapter) | Load and draw. The software-renderer crash reported upstream (issue 2666) did not occur. |
| HUD with the anniversary sprites | Draws (health, armour, ammo, flashlight). |
| Writes | Only under the writable base folder. Nothing in the game data, nothing elsewhere. |
| No sound device, no network | The engine reports it and carries on. |

### Timedemo baseline

A 38-second demo of the `c0a0` tram ride (3,763 frames), played back as fast as possible. Software renderer, one thread, including the conversion to I420 and the writes to the frame file.

| Size | Seconds | Frames a second |
|---|---|---|
| 1280x480 | 10.25 | 367 |
| 960x360 | 8.24 | 456 |
| 640x240 | 6.64 | 567 |

Measured on an AMD Ryzen 7 9800X3D, before the Phase 2 changes. To repeat it:

```sh
export HL_BASE=~/hl-idrive/run/shared
HL_STDIN="sleep 12;record tram;sleep 40;stop;sleep 2" bash tools/run/headless.sh record 60 +map c0a0
bash tools/run/headless.sh timedemo 240 -timedemo tram
```
