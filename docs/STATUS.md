# Status

Last updated 2026-11-19. Phase 0 (recon): reading finished, car probe not yet run.

## Works

- Nothing of the port exists yet.
- The car probe (`tools/probe/`) passes its allowlist check on the PC.

## Done on the PC, untested on the car

- Reading of all reference repositories, written up in [RECON.md](RECON.md).
- Probe batches: never run on the car.

## Not started

- Phase 1: engine and game libraries built in an Ubuntu 18.04 container.
- Phase 2: platform backend, service, app, Store package.
- Phases 3 to 5.

## Open questions

Waiting on the owner:

1. SSH key path and head-unit address for the probe.
2. OK to run `df` on the unit (it is not on the ten-command list).
3. Has the frame-file picture or the CarLife sound route ever worked on this car?
4. Is an Xbox 360-protocol pad or adapter available besides the Xbox One S pad?
5. Are saves under `/var/opt` acceptable? Sticks mount read-only, and an app's data folder is wiped when its process dies.

Waiting on the probe (full list in RECON.md, section 12):

1. Does this unit mount a USB stick at `/media` like the other documented car?
2. RAM, Mesa version, EGL platforms, render-node permissions, libstdc++ version.
3. Core-dump handling, thermal zones and trip points.

## Risks carried forward

- A crash of a process the crash handler does not know restarts the head unit. The service must make that impossible before the first run on the car.
- Most head-unit facts come from another owner's car with older firmware.
- The frame-file display path and the CarLife sound route are unproven on this car.
- The engine tracker has an open report of the software renderer crashing on map load on linux-amd64.
- The kernel has no input layer, so the gamepad needs our own USB reader, and the owner's pad uses the harder protocol.
- Nobody has documented the unit's thermal behaviour under sustained load.
