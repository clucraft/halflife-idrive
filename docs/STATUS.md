# Status

Last updated 2026-11-19.

- Phase 0 (recon): reading finished. The car probe is deferred until the car is back on Wi-Fi.
- Phase 1 (PC build): started ahead of the probe, because it needs only the PC.

## Works

- Nothing of the port exists yet.
- The car probe (`tools/probe/`) passes its allowlist check on the PC.

## Done on the PC, untested on the car

- Reading of all reference repositories, written up in [RECON.md](RECON.md).
- Probe batches: never run on the car. On 2026-11-19 the head unit was not on the network; two connection attempts timed out before login, so nothing ran there.

## Not started

- Phase 2: service, app, Store package, sound, input.
- Phases 3 to 5.

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
- Most head-unit facts come from another owner's car with older firmware. Phase 1 builds against those facts until the probe confirms them.
- The frame-file display path and the CarLife sound route are unproven on this car.
- The engine tracker has an open report of the software renderer crashing on map load on linux-amd64.
- The kernel has no input layer, so the gamepad needs a USB reader in user space, and the owner's pad uses the harder protocol.
- Nobody has documented the unit's thermal behaviour under sustained load.
