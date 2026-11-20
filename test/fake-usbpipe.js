'use strict';
/**
 * fake-usbpipe.js - the tests' stand-in for a gamepad on its USB program (bin/clucraft-hl-pad): the same lines
 * of hex on stdin and stdout, with an Xbox One S pad's packets, and no USB. What the real program does with a
 * real pad on the owner's car is nes-idrive's to show; this checks what the service makes of the packets.
 *
 *   node fake-usbpipe.js <device node> <interface> <IN> <OUT> [<packet bytes>]
 *
 * As a pad does: it says hello, and tells nothing until the packets that switch it on have come. Then every line
 * a test appends to the file FAKE_PAD_FILE is one state of the pad, as JSON:
 *   {"buttons":["A","UP"],"lt":0,"rt":1023,"lx":0,"ly":32767,"rx":0,"ry":0}     an input report
 *   {"unplug":true}                                                            the pad is pulled out (exit 1)
 * Only lines appended after it was switched on count; it writes FAKE_PAD_FILE + ".on" when that is.
 * With no arguments it says how it is used and leaves with 2, as the real one does.
 *
 * Node 8.
 */
const fs = require('fs');

if (process.argv.length < 6) {
    process.stderr.write('nes-usbpipe: usage: nes-usbpipe <device node> <interface> <IN endpoint, hex> <OUT endpoint, hex> [<packet bytes>]\n');
    process.exit(2);
}
const file = process.env.FAKE_PAD_FILE || '';
// the report's bits (the kernel's xpad.c, xpadone_process_packet; pad.js reads them back)
const B4 = { START: 0x04, SELECT: 0x08, A: 0x10, B: 0x20, X: 0x40, Y: 0x80 };
const B5 = { UP: 0x01, DOWN: 0x02, LEFT: 0x04, RIGHT: 0x08, L: 0x10, R: 0x20, LS: 0x40, RS: 0x80 };
let seq = 0, on = false, offset = 0, got = [];
// (only what is appended from now on: a pad plugged in again does not repeat what the last one did)
try { offset = fs.readFileSync(file, 'utf8').length; } catch (e) { offset = 0; }

function report(s) {
    const d = Buffer.alloc(18);
    d[0] = 0x20; d[2] = seq++ & 0xff; d[3] = 0x0e;
    (s.buttons || []).forEach((n) => { if (B4[n]) d[4] |= B4[n]; if (B5[n]) d[5] |= B5[n]; });
    d.writeUInt16LE(s.lt || 0, 6); d.writeUInt16LE(s.rt || 0, 8);
    d.writeInt16LE(s.lx || 0, 10); d.writeInt16LE(s.ly || 0, 12); d.writeInt16LE(s.rx || 0, 14); d.writeInt16LE(s.ry || 0, 16);
    return d.toString('hex');
}
const out = (line) => process.stdout.write(line + '\n');

// hello (GIP announce), as every pad says at the start
out(Buffer.from([0x02, 0x20, 0x01, 0x1c, 0x7e, 0xed, 0x8c, 0x11, 0xa4, 0x9c, 0x00, 0x00, 0x5e, 0x04, 0xea, 0x02]).toString('hex'));

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!/^([0-9a-f]{2})+$/.test(line)) continue;
        got.push(line);
        // "power on" (05 20 ..) is the packet a pad waits for. <file>.on then tells a test that states count from now
        if (line.slice(0, 4) === '0520' && !on) { on = true; if (file) { try { fs.writeFileSync(file + '.on', String(process.pid)); } catch (e) { /* no such folder */ } } }
    }
});
process.stdin.on('end', () => process.exit(0));

setInterval(() => {
    if (!on || !file) return;
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return; }
    const lines = text.slice(offset).split('\n');
    lines.pop();                                    // (a line still being written)
    lines.forEach((l) => {
        offset += l.length + 1;
        let s = null;
        try { s = JSON.parse(l); } catch (e) { return; }
        if (s.unplug) { process.stderr.write('nes-usbpipe: the device is gone\n'); process.exit(1); }
        out(report(s));
    });
}, 15);
void got;
