# Status

Last updated 2026-11-19.

- Phase 0 (recon): reading finished. The car probe is deferred until the car is back on Wi-Fi.
- Phase 1 (PC build): finished, ahead of the probe, because it needs only the PC. Details in [BUILD.md](BUILD.md).

## Works on the PC

- The engine and the game libraries build in an Ubuntu 18.04 container and pass the check against the head unit's C library.
- The engine runs with no screen through this project's own platform backend and writes its picture to a frame file in mgu-render's format.
- With the 25th-anniversary Steam data: main menu, `c0a0`, `c1a0`, HUD, save game.
- Clean stop on SIGTERM: config saved, frame file removed, exit code 0.
- Timedemo baseline: 367 frames a second at 1280x480 on the build PC (software renderer, one thread).
- The car probe (`tools/probe/`) passes its allowlist check on the PC.

## Untested on the car

Everything. In particular:

- Probe batches: never run. On 2026-11-19 the head unit was not on the network; two connection attempts timed out before login, so nothing ran there.
- Whether the built files load on this car's firmware. The check uses library facts from another owner's car.
- Whether mgu-render on this car shows the frame file. Only a PC-side reader has read it so far.
- Speed on the Atom. The baseline is from a desktop CPU several times faster.
- Sound. The ALSA backend is compiled in but has only met "no device".

## Not started

- Phase 2: service, app, Store package, sound route, input.
- Phases 3 to 5.
- Licence files and the README.

## Notes from the owner

- SSH details for the probe: the ones in the owner's local notes. They stay out of this repository.
- A USB gamepad reader is being built in the owner's nes-idrive project and is not finished. This project waits for that work and reuses it instead of writing a second reader.

## Open questions

Waiting on the owner:

1. The car awake and on Wi-Fi, for the probe.
2. OK to run `df` on the unit (it is not on the ten-command list).
3. Has the frame-file picture or the CarLife sound route ever worked on this car?
4. Are saves under `/var/opt` acceptable? Sticks mount read-only, and an app's data folder is wiped when its process dies.

Waiting on the probe (full list in RECON.md, section 12):

1. Does this unit mount a USB stick at `/media` like the other documented car?
2. RAM, Mesa version, EGL platforms, render-node permissions, libstdc++ version.
3. Core-dump handling, thermal zones and trip points.

## Risks carried forward

- A crash of a process the crash handler does not know restarts the head unit. The service must make that impossible before the first run on the car.
- Most head-unit facts come from another owner's car with older firmware. Phase 1 built against those facts; the probe has to confirm them.
- The frame-file display path and the CarLife sound route are unproven on this car.
- The software renderer is fast enough on a desktop CPU; whether it holds 30 frames a second on the Atom is unknown. Its picture is coarse (16-bit colour inside). The GPU renderer stays the plan for Phase 4.
- The kernel has no input layer, so the gamepad needs a USB reader in user space, and the owner's pad uses the harder protocol.
- Nobody has documented the unit's thermal behaviour under sustained load.
