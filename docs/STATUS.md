# Status

Last updated 2026-11-19.

- Phase 0 (recon): reading finished. The car probe is deferred until the car is back on Wi-Fi.
- Phase 1 (PC build): finished.
- Phase 2 (backend, service, app, Store package): finished on the PC. Details in [BUILD.md](BUILD.md).
- Phase 3 (first run on the car): not started. It needs the probe first, and the owner's OK for each write.

## Works on the PC

- The engine and the game libraries build in an Ubuntu 18.04 container, pass the check against the head unit's C library, and are staged in `native/clucraft-halflife/bin`.
- The engine's backend: picture into mgu-render's frame file, sound through ALSA at 48 kHz, input and "hold" as commands from the service, a 30 frames a second cap, no core dump on a crash.
- The service (`native/clucraft-halflife`) with the real engine and the 25th-anniversary Steam data: 35 of 35 checks (`tools/run/service.sh`). New game, the game's menu, save on stop, "Continue", three picture sizes, recorded sound.
- The rules the service keeps: no game unless the app has just said "parked"; the game stands still when the car moves, when the app is not on the screen and when the app says nothing; it ends when the app goes away, after a crash and after a hang.
- The app (`apps/clucraft_halflife`): launcher, game view, status, log, three settings. 16 of 16 unit tests on Node 24 and on Node 8.10, and it runs in the kit's emulator.
- The Store package: `mgu-repo.json`, the tool's `component.json` and units, the app's `app.json`; checked against the Store's documented rules by the unit tests. Not checked by the Store itself.

## Untested on the car

Everything. In particular:

- Probe batches: never run. On 2026-11-19 the head unit was not on the network; two connection attempts timed out before login, so nothing ran there.
- Whether the built files load on this car's firmware. The check uses library facts from another owner's car. The service tests this itself at every start, and the Store rolls the tool back if it fails.
- Whether mgu-render on this car shows the frame file. Only a PC-side reader has read it so far.
- Speed on the Atom. A frame costs 2.5 ms on the build PC; the Atom is several times slower per core.
- Sound on the car: the device name, its three-periods-of-1024 buffer rule, the route to the speakers. The PC test device has a clock and takes 48 kHz, and that is all it has in common with SmartXbar.
- The service's unit: `User=nobody` with the group `mgu_alsa`, `PermissionsStartOnly`, the limits. If that group does not exist on this car, the service will not start.
- The iDrive controller in the game view (it needs the controller gate), the long press to leave the game, and touch.
- The parked gate with real signals, with the ignition in each state.
- Temperature under load. The service reads the thermal zones and logs them with the frame rate every 15 seconds while a game runs; nobody has documented the unit's limits.

## Not done yet

- **Gamepad.** The engine takes pad axes and buttons from the service already, but nothing reads a pad. The reader is being built in the owner's nes-idrive project; this project waits for it and reuses it. Until then the game can be started and its menus worked, not played.
- Phases 3 to 5.
- The README (Phase 5). Licence files and notices for everything shipped are in place.

## Decisions made in Phase 2, for the owner to overrule

1. **The launcher takes touch through the kit**, as plex-idrive's pages do. **The game view claims no touch** unless the setting "Touch in the game's menus" is on; it is off by default, because one owner reported head-unit restarts after claiming touch on older firmware. With it off, a touch on the game leaves the game view.
2. **BACK belongs to the HMI** and leaves the whole app. The way from the game back to the launcher is holding the controller down for a second.
3. **Saves**: on the stick when it is mounted writable; otherwise in `/var/opt/clucraft-halflife/state/base`, the tool's own folder. Not the app's data folder: that is wiped when the app's process dies. Uninstalling the tool deletes saves kept on the head unit.
4. **The service never runs as root.** The engine refuses to.
5. **The app's title is "Half-Life"**, with "unofficial" in its description. Its icon is this project's own drawing, not the game's logo.
6. **Committed binaries.** The Store installs a tool from files in the repository, so `native/clucraft-halflife/bin` (9.8 MB) is committed.

## Notes from the owner

- SSH details for the probe: the ones in the owner's local notes. They stay out of this repository.
- A USB gamepad reader is being built in the owner's nes-idrive project and is not finished.

## Open questions

Waiting on the owner:

1. The car awake and on Wi-Fi, for the probe.
2. OK to run `df` on the unit (it is not on the ten-command list).
3. Has the frame-file picture or the CarLife sound route ever worked on this car?
4. Are saves under `/var/opt` acceptable (decision 3)?
5. Is the controller gate (`mgu-inputgate`) installed on this car? The game view needs it for the controller.

Waiting on the probe (full list in RECON.md, section 12):

1. Does this unit mount a USB stick at `/media` like the other documented car?
2. RAM, Mesa version, EGL platforms, render-node permissions, libstdc++ version.
3. Core-dump handling, thermal zones and trip points.
4. Do the user `nobody` and the group `mgu_alsa` exist, and which ALSA names does SmartXbar define?

## Risks carried forward

- A crash of a process the crash handler does not know restarts the head unit. Three things stand against it: the unit's `LimitCORE=1`, the launcher's name on the crash handler's list (from the head unit's next start after the install), and the engine making itself undumpable. Only the last is tested, and only on the PC.
- Most head-unit facts come from another owner's car with older firmware. The probe has to confirm them before Phase 3.
- The frame-file display path and the CarLife sound route are unproven on this car.
- The software renderer may not hold 30 frames a second on the Atom. Its picture is coarse (16-bit colour inside). The GPU renderer stays the plan for Phase 4.
- SmartXbar's buffer is 64 ms. A frame that takes longer than that makes a gap in the sound.
- The kernel has no input layer, so the gamepad needs a USB reader in user space, and the owner's pad uses the harder protocol.
