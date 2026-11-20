'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
// Removes the engine's frame file (/dev/shm, memory). Runs as the service's ExecStopPost (also after a crash or
// a kill) and as the tool's deactivate (an uninstall, before anything else goes). Never fails: a failing
// deactivate would refuse the removal. Saves and config in /var/opt/clucraft-halflife/state go with the tool's
// folder; saves on a stick are the owner's and stay.
try { require('fs').unlinkSync(require('./engine').VIDEO_PATH); console.log('clucraft-halflife: removed the frame file'); } catch (e) { /* none */ }
process.exit(0);
