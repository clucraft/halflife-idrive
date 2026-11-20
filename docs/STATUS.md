# Status

Last updated 2026-11-19.

- Phase 0 (recon): reading finished. The car probe is deferred until the car is back on Wi-Fi.
- Phase 1 (PC build): finished.
- Phase 2 (backend, service, app, Store package, gamepad): finished on the PC. Details in [BUILD.md](BUILD.md).
- Phase 3 (first run on the car): not started. It needs the probe first, and the owner's OK for each write.

Nothing of this project has run on the car.

## Known from the owner's other apps on this car

Reported by the owner on 2026-11-19. These are the same head unit, other programs.

- **plex-idrive works here:** video through mgu-render's frame file, and sound through the CarLife route to the speakers. So the display path and the sound route this project uses exist and work on this car, and so do the user `nobody` and the group `mgu_alsa`.
- **nes-idrive's gamepad reader works here** (branch `mgu-store`, loader 0.2.0) with a wired Xbox One S pad, installed through the Store. This project carries that reader. Seen from the real pad: buttons, D-pad, both sticks, right trigger. Not seen from it: left trigger, stick clicks.

- **Only the GPU renderer's path shows a picture here.** Pictures an app pushes to the HMI directly are refused, and the kit's renderer path serves an app's first canvas screen only (found with nes-idrive; the PC emulator shows neither). This app has one canvas screen with every page on it and requires a renderer, and a unit test keeps it so. Its fallback for a head unit without a renderer (the HMI's bar buttons) will show nothing on this car.
- **An app's log** is a plain file on the unit: `/var/opt/public/oap/oap_<uid>/data/clucraft_halflife.log`. Phase 3 can read it with `cat`.

What that does not cover is listed under "Untested on the car".

## Works on the PC

- The engine and the game libraries build in an Ubuntu 18.04 container, pass the check against the head unit's C library, and are staged in `native/clucraft-halflife/bin`.
- The engine's backend: picture into mgu-render's frame file, sound through ALSA at 48 kHz, input and "hold" as commands from the service, a 30 frames a second cap, no core dump on a crash.
- The service with the real engine and the 25th-anniversary Steam data: 41 of 41 checks (`tools/run/service.sh`). New game, the game's menu, save on stop, "Continue", three picture sizes, recorded sound.
- The rules the service keeps: no game unless the app has just said "parked"; the game stands still when the car moves, when the app is not on the screen and when the app says nothing; it ends when the app goes away, after a crash and after a hang.
- **Gamepad**, with a stand-in for the pad's USB packets and the real engine: the engine applies its Xbox layout, the right stick turns the view, the left stick walks, Menu opens the game's menu and B closes it, and a new game can be started from the game's own menu with D-pad and A alone. A pad's input never reaches a game that stands still, and the engine is told "everything let go" before a hold.
- The gamepad's USB program is built from nes-idrive's source and is byte for byte nes-idrive's own file. It runs in the test container.
- The app: launcher, game view, status, log, three settings. 18 of 18 unit tests on Node 24 and on Node 8.10, and it runs in the kit's emulator.
- The Store package: `mgu-repo.json`, the tool's `component.json` and units, the app's `app.json`; checked against the Store's documented rules by the unit tests. Not checked by the Store itself.

## Untested on the car

Everything of this project. In particular:

- Probe batches: never run. On 2026-11-19 the head unit was not on the network; two connection attempts timed out before login, so nothing ran there.
- Whether the built files load on this car's firmware. The check uses library facts from another owner's car. The service tests this itself at every start, and the Store rolls the tool back if it fails.
- **This engine's own frame writer.** plex-idrive's player writes the frame file on this car; ours writes the same format with its own code, read so far only by a PC-side reader.
- **This engine's own sound code.** The route works for plex-idrive's player; our backend opens the same device with its own code. The PC test device has a clock and takes 48 kHz, and that is all it has in common with SmartXbar.
- Speed on the Atom. A frame costs 2.5 ms on the build PC; the Atom is several times slower per core.
- **The pad through this service.** nes-idrive runs the USB program as the app's user with the group of the pad's node; here it runs as `nobody` with the group `mgu_usb` from the service's unit. If `nobody` cannot open the node that way, the pad is not read and the launcher says so.
- Which way the sticks point, with a real pad. The directions were checked on the PC against the real engine, from nes-idrive's statement that right and up are the greater numbers.
- The service's unit as a whole: `User=nobody`, `SupplementaryGroups=mgu_alsa mgu_usb`, `PermissionsStartOnly`, the limits.
- The iDrive controller in the game view (it needs the controller gate), the long press to leave the game, and touch.
- The parked gate with real signals, with the ignition in each state.
- Temperature under load. The service reads the thermal zones and logs them with the frame rate every 15 seconds while a game runs; nobody has documented the unit's limits.
- Input delay of the pad. Not measured anywhere.

## Not done yet

- Phases 3 to 5.
- The README (Phase 5). Licence files and notices for everything shipped are in place.
- Other pads: Xbox 360, PlayStation, plain HID and wireless dongles are not read.
- A gamepad layout of this project's own. The engine's Xbox layout is used as it is (`native/clucraft-halflife/README.md` lists it); Phase 5 can change it.

## Decisions made in Phase 2, for the owner to overrule

1. **The launcher takes touch through the kit**, as plex-idrive's pages do. **The game view claims no touch** unless the setting "Touch in the game's menus" is on; it is off by default, because one owner reported head-unit restarts after claiming touch on older firmware. With it off, a touch on the game leaves the game view.
2. **BACK belongs to the HMI** and leaves the whole app. The way from the game back to the launcher is holding the controller down for a second.
3. **Saves**: on the stick when it is mounted writable; otherwise in `/var/opt/clucraft-halflife/state/base`, the tool's own folder. Not the app's data folder: that is wiped when the app's process dies. Uninstalling the tool deletes saves kept on the head unit.
4. **The service never runs as root.** The engine refuses to. That is why the pad's program runs as `nobody` here and not as nes-idrive runs it.
5. **The app's title is "Half-Life"**, with "unofficial" in its description. Its icon is this project's own drawing, not the game's logo.
6. **Committed binaries.** The Store installs a tool from files in the repository, so `native/clucraft-halflife/bin` (12 MB) is committed.
7. **The gamepad reader is a copy inside this tool**, not a tool shared with nes-idrive: its own service, socket and program file name, as the owner described. `pad.js` and the program's source are kept unchanged so a fix in nes-idrive can be taken over as it is.

## Notes from the owner

- SSH details for the probe: the ones in the owner's local notes. They stay out of this repository.
- The repository is on GitHub as `clucraft/halflife-idrive`, private. Ask before each push.

## Open questions

Waiting on the owner:

1. The car awake and on Wi-Fi, for the probe.
2. OK to run `df` on the unit (it is not on the ten-command list).
3. Are saves under `/var/opt` acceptable (decision 3)?
4. Is the controller gate (`mgu-inputgate`) installed on this car? The game view needs it for the controller.

Waiting on the probe (full list in RECON.md, section 12):

1. Does this unit mount a USB stick at `/media` like the other documented car?
2. RAM, Mesa version, EGL platforms, render-node permissions, libstdc++ version.
3. Core-dump handling, thermal zones and trip points.
4. Which ALSA names SmartXbar defines, and the mode and group of the pad's USB node as `nobody` sees it.

## Risks carried forward

- A crash of a process the crash handler does not know restarts the head unit. Three things stand against it: the unit's `LimitCORE=1`, the two programs' names on the crash handler's list (from the head unit's next start after the install), and the engine making itself undumpable. The pad's program has only the first two. Only the engine's own part is tested, and only on the PC.
- Head-unit facts that neither the owner's other apps nor the nes-idrive probe cover still come from another owner's car with older firmware. The probe has to confirm them before Phase 3.
- The software renderer may not hold 30 frames a second on the Atom. Its picture is coarse (16-bit colour inside). The GPU renderer stays the plan for Phase 4.
- SmartXbar's buffer is 64 ms. A frame that takes longer than that makes a gap in the sound.
- plex-idrive and this app use the same sound source (287). Only one of them can have the speakers at a time; this app takes them while a game is on the screen and gives them back.
