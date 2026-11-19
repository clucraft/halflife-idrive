# Status

Last updated 2026-11-19. Phase 0 (recon) in progress.

## Works

- Nothing of the port exists yet.
- The car probe (`tools/probe/`) passes its allowlist check on the PC.

## Done on the PC, untested on the car

- Reading of the reference repositories, written up in [RECON.md](RECON.md).
- Probe batches: never run on the car.

## Not started

- Phase 1: engine and game libraries built in an Ubuntu 18.04 container.
- Phase 2: platform backend, service, app, Store package.
- Phases 3 to 5.

## Open questions

Waiting on the owner:

1. SSH key path and head-unit address for the probe.
2. OK to run `df` on the unit (it is not on the ten-command list).
3. Has the Plex client ever shown a picture or played sound on the car? Its README says it has not run there.

Waiting on the probe (full list in RECON.md, section 11):

1. Does the unit mount a USB stick at all? No storage driver was registered when nes-idrive probed it with no stick in.
2. RAM, Mesa version, EGL platforms, render-node permissions.
3. Core-dump handling, thermal trip points.

## Risks carried forward

- The frame-file display path and the CarLife sound route are unproven on a car.
- The engine tracker has an open report of the software renderer crashing on map load on linux-amd64.
- The kernel has no input layer, so the gamepad needs our own USB reader.
- An engine crash that dumps core can restart the head unit. The service must make that impossible before the first run on the car.
