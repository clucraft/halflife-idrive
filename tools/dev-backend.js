'use strict';
/**
 * dev-backend.js - what the app talks to when it runs in the kit's emulator on a PC: the real Half-Life service
 * (native/clucraft-halflife) on a local TCP port, with an invented USB stick (three empty files with the right
 * names: no game data) and the stand-in engine (test/fake-engine.js: it keeps a game's state and draws nothing).
 *
 *   node tools/dev-backend.js [port]          default 8078; then start the app with HLD_SOCK=<port>
 *
 *   DEV_STICK=ro | rw | empty | none          the stick (default ro: as the head unit mounts sticks)
 *   BACKEND_LOG=1                             the service's own log lines
 *
 * Everything it writes is in a temporary folder.
 */
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { createService } = require('../native/clucraft-halflife/service');
const { makeStick, serviceOptions } = require('./stage');

const PORT = Number(process.argv[2]) || 8078;
const quiet = process.env.BACKEND_LOG ? console.log.bind(console) : () => {};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-dev-'));
const stick = makeStick(tmp, process.env.DEV_STICK || 'ro');
const say = console.log.bind(console);
console.log = quiet;                                   // the service's own log lines (BACKEND_LOG=1 shows them)
// (the emulator's page is not the head unit's 10 frames a second: a slower beat must not hold the game)
const svc = createService(serviceOptions(tmp, stick, { idleMs: 24 * 3600 * 1000, beatMs: 3000 }));
const server = net.createServer();
svc.serve(server);
server.listen(PORT, '127.0.0.1', () => {
    svc.start();
    say('dev-backend: the Half-Life service on 127.0.0.1:' + PORT + ' (HLD_SOCK=' + PORT + '), a stand-in engine, an invented stick at ' + (stick.dir || '(none)'));
});
const end = () => { svc.stop(0).then(() => process.exit(0)); setTimeout(() => process.exit(0), 3000); };
process.on('SIGINT', end); process.on('SIGTERM', end);
