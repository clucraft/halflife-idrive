# clucraft-halflife: the Half-Life service

The service of the app **Half-Life** (`apps/clucraft_halflife`) for the BMW iDrive 7 head unit. It runs the game natively, on the Xash3D FWGS engine, while the app is open and the car is parked.

It contains **no game data**. It reads your own copy of Half-Life (the `valve` folder) from a USB stick and copies none of it to the head unit.

Not run on a car yet. `docs/STATUS.md` in the repository says what is tested and where.

## What it is

| File | What it does |
|---|---|
| `service.js` | The service: answers the app on `/run/clucraft-halflife.sock`, starts and ends the engine, keeps the rules below. Node 8, the head unit's own. |
| `engine.js` | Starts the engine as a child, talks to it, ends it. |
| `gamedata.js` | Finds the game data on a mounted stick, and picks where saves go. |
| `sockgroup.js` | Gives the control socket to the Half-Life app alone. |
| `check.js`, `cleanup.js` | The Store's check after an install, and the frame file's removal. |
| `bin/clucraft-hl`, `bin/*.so` | The engine and the game libraries, built from source (`docs/BUILD.md`). `bin/BUILD.json` names the commits. |
| `bin/extras.pk3` | The engine's own menu art and fonts. |

## The rules it keeps

- It runs as `nobody`, never as root, and its engine refuses to run as root.
- It starts when the app first asks and ends a minute after the app's last question. Nothing of it runs at boot.
- A game starts only when the app has just said that the car is parked.
- The game stands still whenever the app has not said within 1.5 seconds that the car is parked and the game is on the screen. Silence counts as moving.
- After 20 seconds without a word from the app, or 5 minutes standing still, the game is saved and ended.
- An engine that gives no sign of life for a minute is ended.
- CPU and memory are limited by its systemd unit (`systemd/clucraft-halflife.service`), and no core dump is ever written.
- It has no internet access and asks for none.

## What it writes, and where

| What | Where |
|---|---|
| Saves and config | On the stick, in `halflife-idrive/`, when the stick is mounted writable. Otherwise in `/var/opt/clucraft-halflife/state/base/`. |
| The picture | `/dev/shm/mgu-video-clucraft-halflife`, in memory, while a game runs. |
| The control socket | `/run/clucraft-halflife.sock`, made by systemd. |

Nothing else. Uninstalling through the Store removes all of it; **saves kept on the head unit go with it**. Saves on a stick stay.

## Licences

GPL-3.0-or-later for the service and the engine. The game libraries are under Valve's Half Life 1 SDK licence (`bin/LICENSE.hlsdk`). `NOTICE` lists every part.
