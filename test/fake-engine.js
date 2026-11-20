'use strict';
/**
 * fake-engine.js - the tests' and the emulator's stand-in for the game engine (bin/clucraft-hl): the same command
 * line, the same commands on stdin, the same "MGU {json}" status lines on fd 3 and a frame file of the same
 * format, but no game. It needs no game data, so the service and the app can be tried on any computer.
 * What the real one does with the real data is tools/run/service.sh's to show.
 *
 *   -mguselftest                    says its libraries load, and leaves (FAKE_SELFTEST_FAIL=1: they do not)
 *   +newgame / +load idrive         starts in the first map / where the save says; else in "its menu"
 *   stdin: mgu_hold 0|1, mgu_key <k> <d> (27, or a pad's Menu button 215: its menu over the game and back;
 *          13 in its menu: a new game), mgu_axis, mgu_touch, mgu_pad, save idrive, quit
 *   FAKE_STAT_MS (200)   FAKE_INPUT_LOG=<file>: every input line it got
 *   FAKE_HANG_KEY=<k>: says nothing more once that key came, and hears nothing
 *   FAKE_CRASH_KEY=<k>: ends like a crash (code 139), leaving its frame file
 *
 * Node 8.
 */
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const has = (k) => argv.indexOf(k) >= 0;

if (has('-mguselftest')) {
    const bad = !!process.env.FAKE_SELFTEST_FAIL;
    console.log('MGU selftest: ' + (bad ? 'FAILED libxash.so: version `GLIBC_2.28\' not found' : 'ok libref_soft.so'));
    console.log('MGU selftest: ' + (bad ? 'FAILED' : 'passed') + ', a stand-in engine, build 0');
    process.exit(bad ? 1 : 0);
}

const W = Number(arg('-width', 1280)), H = Number(arg('-height', 480)), FPS = Number(arg('-mgufps', 30));
const base = process.env.XASH3D_BASEDIR || '.', video = process.env.MGU_VIDEO_FILE || '';
const saveFile = path.join(base, 'valve', 'save', 'idrive.sav');
const statFd = Number(arg('-mgustatus', -1));
const statMs = Number(process.env.FAKE_STAT_MS) || 200;
const mkdirp = (d) => { if (!fs.existsSync(d)) { mkdirp(path.dirname(d)); try { fs.mkdirSync(d); } catch (e) { /* there */ } } };

let state = 'loading', map = '', held = false, frames = 0, hung = false, t0 = Date.now(), last = Date.now();
if (has('+newgame')) setTimeout(() => { state = 'game'; map = 'c0a0'; }, 300);
else if (has('+load')) setTimeout(() => { try { map = fs.readFileSync(saveFile, 'utf8').split('=')[1].trim(); state = 'game'; } catch (e) { state = 'menu'; } }, 300);
else setTimeout(() => { state = 'menu'; }, 300);
console.log('a stand-in engine: ' + W + 'x' + H + ', ' + FPS + ' fps, data ' + (process.env.XASH3D_RODIR || '?') + ', saves ' + base);

/* the frame file: the real header, three black frames; only the count moves */
const SLOTS = 3, frame = W * H * 3 / 2;
let fd = -1;
if (video) {
    try {
        fd = fs.openSync(video, 'w+', 0o600);
        const head = Buffer.alloc(64);
        [0x4656474d, 1, W, H, 0, 0, SLOTS, 0, 1, 0].forEach((v, i) => head.writeUInt32LE(v, i * 4));
        fs.writeSync(fd, head, 0, 64, 0);
        const black = Buffer.alloc(frame, 0);
        black.fill(128, W * H);
        for (let i = 0; i < SLOTS; i++) fs.writeSync(fd, black, 0, frame, 64 + i * frame);
    } catch (e) { console.error('frame file: ' + e.message); fd = -1; }
}
function removeVideo() { if (fd >= 0) { try { fs.closeSync(fd); } catch (e) { /* closed */ } fd = -1; try { fs.unlinkSync(video); } catch (e) { /* gone */ } } }

/* fd 3: the status */
let statOut = null;
if (statFd > 2) { try { statOut = fs.createWriteStream(null, { fd: statFd }); statOut.on('error', () => { statOut = null; }); } catch (e) { statOut = null; } }
function tick() {
    const now = Date.now();
    if (hung) return;
    if (!held && state !== 'loading') {
        frames += Math.round((now - last) / 1000 * FPS);
        if (fd >= 0) { const b = Buffer.alloc(8); b.writeUInt32LE(frames >>> 0, 0); b.writeUInt32LE(frames % SLOTS, 4); try { fs.writeSync(fd, b, 0, 8, 16); } catch (e) { /* gone */ } }
    }
    last = now;
    const s = held ? 'held' : state;
    if (statOut) statOut.write('MGU ' + JSON.stringify({ ev: 'stat', state: s, map: state === 'game' || state === 'paused' ? map : '', fps: held || state === 'loading' ? 0 : FPS, frames, w: W, h: H, sound: has('-nosound') ? 0 : 1, underruns: 0, stands: 0 }) + '\n');
}
setInterval(tick, statMs);

function quit(code) { removeVideo(); process.exit(code || 0); }
const note = (l) => { if (process.env.FAKE_INPUT_LOG) { try { fs.appendFileSync(process.env.FAKE_INPUT_LOG, l + '\n'); } catch (e) { /* no log */ } } };

function command(line) {
    const f = line.split(/\s+/);
    if (hung) return;
    if (f[0] === 'mgu_hold') { held = f[1] === '1'; tick(); return; }
    if (held) { pending.push(line); return; }                     // as the real one: its command buffer waits
    if (f[0] === 'mgu_key') {
        note(line);
        const k = Number(f[1]), down = f[2] === '1';
        if (String(k) === process.env.FAKE_HANG_KEY) { hung = true; return; }
        if (String(k) === process.env.FAKE_CRASH_KEY) { console.error('Crash: signal 11 errno 0 with code 1 at 0x0 (nil)'); if (fd >= 0) { try { fs.closeSync(fd); } catch (e) { /* closed */ } } process.exit(139); }
        if (!down) return;
        if ((k === 27 || k === 215) && state === 'game') state = 'paused';
        else if ((k === 27 || k === 215) && state === 'paused') state = 'game';
        else if (k === 13 && state === 'menu') { state = 'game'; map = 'c0a0'; }
    } else if (f[0] === 'mgu_axis' || f[0] === 'mgu_touch' || f[0] === 'mgu_pad') note(line);
    else if (f[0] === 'save' && (state === 'game' || state === 'paused')) { mkdirp(path.dirname(saveFile)); fs.writeFileSync(saveFile, 'map=' + map + '\n'); console.log('Saving game to ' + f[1]); }
    else if (f[0] === 'quit') quit(0);
    tick();
}
const pending = [];
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        command(line);
        if (!held && pending.length) pending.splice(0).forEach(command);
    }
});
// the service is gone: so is the game
process.stdin.on('end', () => { if (!hung) quit(0); });
process.stdin.on('error', () => { if (!hung) quit(0); });
process.on('SIGTERM', () => { if (!hung) quit(0); });
void t0;
