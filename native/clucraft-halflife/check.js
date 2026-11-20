'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
// The deploy tool's check after an install: the service answers on its control socket, and its engine's
// libraries load on this head unit (the service runs the engine's self-test at each start, as nobody).
// Exit 0: both. Anything else rolls the tool back, so a build this firmware cannot run never stays installed.
// (After clucraft-plex's check.js, from amn-iptv's, M850i-amn/idrive7-apps, GPL-3.0-or-later.)
const net = require('net');
const sockPath = process.argv[2] || process.env.HLD_SOCK || '/run/clucraft-halflife.sock';
let tries = 0;
function attempt() {
    const c = net.connect(/^\d+$/.test(sockPath) ? { port: Number(sockPath), host: '127.0.0.1' } : sockPath);
    let buf = '';
    const t = setTimeout(() => { c.destroy(); retry('no answer'); }, 3000);
    c.on('connect', () => c.write('{"cmd":"status"}\n'));
    c.on('data', (d) => {
        buf += d;
        if (buf.indexOf('\n') < 0) return;
        clearTimeout(t);
        c.destroy();
        let s;
        try { s = JSON.parse(buf.slice(0, buf.indexOf('\n'))); } catch (e) { return retry('bad answer'); }
        if (!s.selftest) return retry('the engine\'s self-test has not finished');
        if (!s.selftest.ok) { console.error('clucraft-halflife ' + s.version + ': the engine does not load here: ' + s.selftest.line); process.exit(1); }
        console.log('clucraft-halflife ' + s.version + ' answers; ' + s.selftest.line);
        process.exit(0);
    });
    c.on('error', (e) => { clearTimeout(t); retry(e.code || e.message); });
}
function retry(why) {
    if (++tries >= 20) { console.error('clucraft-halflife: ' + why); process.exit(1); }
    setTimeout(attempt, 1000);
}
attempt();
