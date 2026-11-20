# halflife-idrive

Half-Life (1998) running natively on a BMW iDrive 7 (MGU) head unit, as an app for the MGU Store: the picture on the centre screen, the sound through the car's speakers, a USB gamepad for input, the game read from your own USB stick. Built on the [Xash3D FWGS](https://github.com/FWGS/xash3d-fwgs) engine and [hlsdk-portable](https://github.com/FWGS/hlsdk-portable).

**Experimental. It has not run on a car yet.** Everything here is tested on a PC only. [docs/STATUS.md](docs/STATUS.md) says what works, what is untested and what is planned.

An unofficial project, not affiliated with or endorsed by Valve Corporation or BMW AG.

## Bring your own game files

No game data is in this repository or in anything built from it. You need your own copy of Half-Life (the Steam version, 25th-anniversary update); only its `valve` folder is used, read from a USB stick, and none of it is copied to the head unit.

## What it needs

- An iDrive 7 head unit with the MGU Store, its renderer (`mgu-render`) and, for the iDrive controller in the game, its controller gate (`mgu-inputgate`).
- A USB stick with `Half-Life/valve` on it.
- For playing: a wired Xbox One or Xbox Series pad. Other pads are not read.
- A parked car. The game does not start while the car moves, and it stands still when the car starts to move.

## What is in here

| Folder | |
|---|---|
| `apps/clucraft_halflife/` | The Store app: launcher, game view, status, log |
| `native/clucraft-halflife/` | The Store tool: the service and the built engine |
| `port/` | This project's changes to the engine, and the gamepad's USB program |
| `kit/` | The MGU App Kit the app is built with |
| `docs/` | [STATUS.md](docs/STATUS.md), [BUILD.md](docs/BUILD.md) (building and testing on a PC), [RECON.md](docs/RECON.md) (what is known of the head unit) |

## Licences

The parts have different licences; [NOTICE](NOTICE) lists them and what they are built on. In short: the app, tools, tests and docs are MIT; the service, the engine's changes and the built engine are GPL-3.0-or-later; the gamepad reader, from [nes-idrive](https://github.com/clucraft/nes-idrive), is GPL-2.0-or-later.
