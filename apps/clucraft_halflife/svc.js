'use strict';
/**
 * svc.js - the app's line to the Half-Life service (native/clucraft-halflife, /run/clucraft-halflife.sock).
 * The socket is the app's own group's: no other app can use the service.
 * (After clucraft_plex's svc.js, from amn_iptv's lib/svc.js, M850i-amn/idrive7-apps, MIT: see NOTICE.)
 *
 *   const svc = require('./svc');
 *   const s = await svc.ask({ cmd: 'beat', parked: true, shown: false });   one short connection a question;
 *                                              rejects with code ENOSVC when the service is not installed
 *   svc.send({ cmd: 'input', ev: [...] });     over one kept connection, no answer waited for: the controller
 *                                              and the touch screen (many small messages; a lost one is lost)
 *
 * Node 8.
 */
const net = require('net');
const SOCK = process.env.HLD_SOCK || '/run/clucraft-halflife.sock';
// a number: a local TCP port (tests and the emulator on a computer); else the unit's socket
const target = () => (/^\d+$/.test(SOCK) ? { port: Number(SOCK), host: '127.0.0.1' } : SOCK);

function ask(m, timeoutMs) {
    return new Promise((resolve, reject) => {
        const c = net.connect(target());
        let buf = '', done = false;
        const finish = (err, v) => { if (done) return; done = true; clearTimeout(t); try { c.destroy(); } catch (e) { /* gone */ } if (err) reject(err); else resolve(v); };
        const t = setTimeout(() => finish(Object.assign(new Error('the Half-Life service did not answer'), { code: 'ETIMEDOUT' })), timeoutMs || 15000);
        c.setEncoding('utf8');
        c.on('connect', () => c.write(JSON.stringify(m) + '\n'));
        c.on('data', (d) => {
            buf += d;
            const i = buf.indexOf('\n');
            if (i < 0) return;
            let v;
            try { v = JSON.parse(buf.slice(0, i)); } catch (e) { return finish(new Error('the Half-Life service answered something unreadable')); }
            finish(null, v);
        });
        c.on('error', (e) => {
            if (e.code === 'ENOENT' || e.code === 'ECONNREFUSED') return finish(Object.assign(new Error('the Half-Life service is not installed'), { code: 'ENOSVC' }));
            if (e.code === 'EACCES') return finish(Object.assign(new Error('the Half-Life service is not open to this app yet: restart the head unit once'), { code: 'EACCES' }));
            finish(e);
        });
    });
}

let line = null;
function send(m) {
    if (!line || line.destroyed) {
        const c = net.connect(target());
        c.on('error', () => { if (line === c) line = null; });
        c.on('close', () => { if (line === c) line = null; });
        c.on('data', () => { /* the answers are not read */ });
        line = c;
    }
    // (a line that does not drain is not fed further: input is only worth sending while it is fresh)
    if (line.bufferSize > 16384) return false;
    try { line.write(JSON.stringify(m) + '\n'); return true; } catch (e) { line = null; return false; }
}

module.exports = { ask, send, SOCK };
