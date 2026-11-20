# Status

Last updated 2026-11-20.

- Phase 0 (recon): the car was probed on 2026-11-20, read-only ([RECON.md](RECON.md), section 10). Two reads are left: one with the stick and the pad plugged in, and the free space (`df`, waiting for the owner's OK).
- Phase 1 (PC build): finished.
- Phase 2 (backend, service, app, Store package, gamepad): finished on the PC. Details in [BUILD.md](BUILD.md).
- Phase 3 (first run on the car): prepared, not started. Nothing is installed. The steps, what each writes on the head unit and how to undo it are under "Phase 3, step by step"; each waits for the owner.

Nothing of this project has run on the car.

## Read from the car on 2026-11-20

Read-only, with the car awake on Wi-Fi and nothing plugged into its USB ports. The full table is in RECON.md, section 10.

- **Everything the staged files need is there:** glibc 2.27 with the loader at `/lib/ld-linux-x86-64.so.2`, `libasound.so.2` with the SmartXbar plugin, Node 8.16.2, the user `nobody`, the groups `mgu_alsa` and `mgu_usb`, the CarLife route's shared memory, a CPU with every instruction the build uses (no AVX is used, and the car has none).
- **Store:** `mgu-deploy` 0.8.20 (this tool asks for 0.7.0), `mgu-render` 0.6.23, and the controller gate `mgu-inputgate` 1.1.0. plex-idrive's and nes-idrive's tools are installed the way this one will be.
- **Firmware:** BMW MGU `J18_21w31.5-1-5`, kernel `4.14.198-apl`. Atom A3960 with four cores and turbo off; 5.5 GiB RAM, 2.2 GB available. The screen runs 1920x720.
- **About one and a half of the four cores are busy with only the HMI up.**
- **No thermal zone.** The CPU's own sensor read 54 to 57 C at rest and names 110 C as its limit. The service read thermal zones only; it now reads this sensor.
- **`TasksMax` is not enforced on this car** (no `pids` controller). `CPUQuota`, `MemoryLimit` and `LimitCORE` are what limits the service here.
- **A stick:** the modules for FAT, exFAT and NTFS are on the unit and a udev rule has udisks mount sticks at `/media/<volume name>`. How it is mounted (read-only or not, readable by `nobody` or not) is unknown until a stick is in.
- **The owner's stick** (prepared 2026-11-20) is 57 GB, **exFAT**, without a volume name. The unit has an exFAT module, but the one owner who documented sticks had only tried FAT32. Whether this unit mounts it, and where without a name, is what the read with the stick in the car answers. If it does not, FAT32 is the fallback, and formatting is the owner's to do.

## Works on the PC

- The engine and the game libraries build in an Ubuntu 18.04 container, pass the check against the head unit's C library, and are staged in `native/clucraft-halflife/bin`.
- The engine's backend: picture into mgu-render's frame file, sound through ALSA at 48 kHz, input and "hold" as commands from the service, a 30 frames a second cap, no core dump on a crash.
- The service with the real engine and the 25th-anniversary Steam data (`tools/run/service.sh`). New game, the game's menu, save on stop, "Continue", three picture sizes, recorded sound.
- The rules the service keeps: no game unless the app has just said "parked"; the game stands still when the car moves, when the app is not on the screen and when the app says nothing; it ends when the app goes away, after a crash and after a hang.
- **Gamepad**, with a stand-in for the pad's USB packets and the real engine: the engine applies its Xbox layout, the right stick turns the view, the left stick walks, Menu opens the game's menu and B closes it, and a new game can be started from the game's own menu with D-pad and A alone. A pad's input never reaches a game that stands still, and the engine is told "everything let go" before a hold.
- The gamepad's USB program is built from nes-idrive's source and is byte for byte nes-idrive's own file. It runs in the test container.
- The app: launcher, game view, status, log, four settings (picture size, sound, touch, the figures over the game). 22 of 22 unit tests on Node 24 and on Node 8.10, and the app runs in the kit's emulator.
- **The app's log carries the run.** The service's log lives in the head unit's memory and the engine's in the service's. The app copies both into its own log, each line once: who the service runs as, where the data and the saves are, the engine's check, and every 15 seconds of a game the frame rate, CPU, memory, temperature, load and sound counters. That log is a file on the unit which `cat` can read, so a run on the car can be read back without any command outside the owner's list.
- The Store package: `mgu-repo.json`, the tool's `component.json` and units, the app's `app.json`; checked against the Store's documented rules by the unit tests. Not checked by the Store itself.

## Untested on the car

Everything of this project. In particular:

- **Whether the built files load on this car.** The probe found every library they ask for; nothing has been loaded there. The service tests this itself at every start, and the Store rolls the tool back if it fails.
- **This engine's own frame writer.** plex-idrive's player writes the frame file on this car; ours writes the same format with its own code, read so far only by a PC-side reader.
- **This engine's own sound code.** The route works for plex-idrive's player; our backend opens the same device with its own code. The PC test device has a clock and takes 48 kHz, and that is all it has in common with SmartXbar.
- **Speed on the Atom.** A frame costs 2.5 ms on the build PC; the Atom is several times slower per core, and the HMI already takes a core and a half.
- **The pad through this service.** nes-idrive runs the USB program as the app's user with the group of the pad's node; here it runs as `nobody` with the group `mgu_usb` from the service's unit. The nodes are `crw-rw---- root:mgu_usb` on this car, so that should open them. If it does not, the pad is not read and the launcher says so.
- Which way the sticks point, with a real pad. The directions were checked on the PC against the real engine, from nes-idrive's statement that right and up are the greater numbers.
- The service's unit as a whole: `User=nobody`, `SupplementaryGroups=mgu_alsa mgu_usb`, `PermissionsStartOnly`, the limits. The service's first log line names the user and groups it really got.
- The iDrive controller in the game view (the gate it needs is installed), the long press to leave the game, and touch.
- The parked gate with real signals, with the ignition in each state.
- Temperature under load. The service logs it with the frame rate every 15 seconds while a game runs; nobody has documented what the unit does when it gets hot.
- Reading the game from a stick as this unit mounts it.
- Input delay of the pad. Not measured anywhere.

## Phase 3, step by step

Each step waits for the owner. Steps 1 to 3 write nothing on the head unit.

| | Step | Who | Writes on the head unit | Undo |
|---|---|---|---|---|
| 1 | **Done 2026-11-20.** `valve` (4,250 files, 506 MiB) copied from the Steam folder to the stick as `Half-Life\valve`, and every file compared with the source by SHA-256: identical. The stick was empty and was not formatted. The service's own finder, pointed at it on the PC, finds the game there | Claude | Nothing | Delete the folder from the stick |
| 2 | Stick and pad into the car; one more run of `tools/probe/20-usb-snapshot.sh` | Owner plugs, Claude reads | Nothing | - |
| 3 | `df` once, for the free space under `/var/opt` | Claude, with the owner's OK (it is not on the ten-command list) | Nothing | - |
| 4 | Push the commits made since the last push | Claude, with the owner's OK | Nothing | - |
| 5 | Let the Store read the repository: make it public, or give the Store a token | Owner's choice | Nothing | Make it private again |
| 6 | In the Store: add the source `clucraft/halflife-idrive`, install the tool `clucraft-halflife` and the app "Half-Life" | Owner, in the car | The Store writes: the tool's files under `/var/opt/clucraft-halflife/versions/0.1.0` with a `current` link (12 MB); two units and their drop-ins in `/etc/systemd/system` (`clucraft-halflife.socket`, `.service`), the socket enabled; the names `clucraft-hl` and `clucraft-hl-pad` on its crash-handler list and the unit names on its recovery list; the app in its own folder under `/var/opt/public/oap` with a user of its own. Nothing of BMW's is changed. By the Store's documentation a new tool's units start only after the next head-unit start | Uninstall the app, then the tool, in the Store. The Store removes all of the above; the tool's `cleanup.js` removes the frame file |
| 7 | Restart the head unit once. At that start the Store runs the tool's check: the service starts as `nobody`, loads the engine's libraries once and answers. This is the first time anything of this project runs on the car. If the libraries do not load, the Store takes the tool off again | Owner | The service makes its folder `/var/opt/clucraft-halflife/state` | As step 6 |
| 8 | **Picture.** Setting "Sound" off, no pad plugged in. Open the app: the launcher's checks say what was found. Start a new game, look, hold the controller a second to leave, stop | Owner in the car, Claude reads the app's log | While a game runs: the frame file in `/dev/shm` (memory). Saves and config: on the stick if it is mounted writable, else under that state folder (0.1 MB). The app's log in its data folder, 2 MB at most | Stop the game; uninstalling the tool deletes the state folder |
| 9 | **Sound.** Setting "Sound" on, start again | Owner, Claude reads the log | As step 8 | As step 8 |
| 10 | **Input.** Pad in, start again: menu with D-pad and A, walk, turn, shoot | Owner, Claude reads the log | As step 8 | As step 8 |
| 11 | Ten minutes of the first chapter with "Show frames a second" on: frame rate, CPU, temperature from the log | Owner plays, Claude reads the log | As step 8 | As step 8 |

Claude's own commands on the head unit stay on the ten-command list throughout: after step 6 it only reads (`ls`, `cat`) what the Store wrote and the app's log. It starts, stops and restarts nothing there.

If something goes wrong: the game is a child of the service and the service is one unit. Leaving the app ends the game within 20 seconds. The Store's own safe mode switches every tool off after three head-unit starts that end early.

## Not done yet

- Phases 3 to 5.
- The full README (Phase 5). A short one, the licence files and the notices for everything shipped are in place.
- Other pads: Xbox 360, PlayStation, plain HID and wireless dongles are not read.
- A gamepad layout of this project's own. The engine's Xbox layout is used as it is (`native/clucraft-halflife/README.md` lists it); Phase 5 can change it.

## Decisions made so far, for the owner to overrule

1. **The launcher takes touch through the kit**, as plex-idrive's pages do. **The game view claims no touch** unless the setting "Touch in the game's menus" is on; it is off by default, because one owner reported head-unit restarts after claiming touch on older firmware. With it off, a touch on the game leaves the game view.
2. **BACK belongs to the HMI** and leaves the whole app. The way from the game back to the launcher is holding the controller down for a second.
3. **Saves**: on the stick when it is mounted writable; otherwise in `/var/opt/clucraft-halflife/state/base`, the tool's own folder. Not the app's data folder: that is wiped when the app's process dies. Uninstalling the tool deletes saves kept on the head unit.
4. **The service never runs as root.** The engine refuses to. That is why the pad's program runs as `nobody` here and not as nes-idrive runs it.
5. **The app's title is "Half-Life"**, with "unofficial" in its description. Its icon is this project's own drawing, not the game's logo.
6. **Committed binaries.** The Store installs a tool from files in the repository, so `native/clucraft-halflife/bin` (12 MB) is committed.
7. **The gamepad reader is a copy inside this tool**, not a tool shared with nes-idrive: its own service, socket and program file name, as the owner described. `pad.js` and the program's source are kept unchanged so a fix in nes-idrive can be taken over as it is.
8. **The run is logged to the app's log file** on the head unit (2 MB at most, the kit's own limit), because that is the one log the owner's command list can read. About 25 KB an hour of play.
9. **A setting "Sound"**, on by default. Off, the engine opens no sound device and the app asks for no speakers. It is there so the first run on the car can be the picture alone.
10. **A writable stick is tried with one small file when it is found**, to see whether it really takes one, and not again while it stays mounted.

## Notes from the owner

- SSH details for the probe: the ones in the owner's local notes. They stay out of this repository, and so does the probe's raw output.
- The repository is on GitHub as `clucraft/halflife-idrive`, private. Ask before each push.

## Open questions

Waiting on the owner:

1. ~~The stick's drive letter on the PC, for the copy.~~ Done.
2. Stick and pad plugged into the car, for the second read.
3. OK to run `df` on the unit (it is not on the ten-command list).
4. Public repository, or a token for the Store?
5. Are saves under `/var/opt` acceptable if the stick turns out read-only (decision 3)?

Answered by the probe: the controller gate is installed; the unit has `scp`, though tar over ssh stays the plan.

Still open after the probe: how a stick is mounted here; the Mesa version (Phase 4); what the unit does when it gets hot.

## Risks carried forward

- A crash of a process the crash handler does not know restarts the head unit. Three things stand against it: the unit's `LimitCORE=1` (the Store adds its own on top, as seen on plex-idrive's unit), the two programs' names on the crash handler's list (from the head unit's next start after the install), and the engine making itself undumpable. The pad's program has only the first two. Only the engine's own part is tested, and only on the PC.
- The HMI alone keeps about a core and a half busy. The software renderer may not hold 30 frames a second beside it. Its picture is coarse (16-bit colour inside). The GPU renderer stays the plan for Phase 4.
- SmartXbar's buffer is 64 ms. A frame that takes longer than that makes a gap in the sound.
- plex-idrive and this app use the same sound source (287). Only one of them can have the speakers at a time; this app takes them while a game is on the screen and gives them back.
- Head-unit facts that neither the probe nor the owner's other apps cover still come from another owner's car with older firmware: chiefly how a stick is mounted, and SmartXbar's behaviour when the route is not connected.
