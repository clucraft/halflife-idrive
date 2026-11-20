'use strict';
/**
 * e2e.js - the real service (native/clucraft-halflife) with the real engine, on the PC. Started in the test
 * container by tools/run/service.sh; it needs the built engine and the owner's game data, so it is not part of
 * "npm test".
 *
 * This script plays the app: it tells the service that the car is parked and the game is on the screen, starts
 * a game, presses keys, drives off, comes back, goes away. Every check is one line in /run-hl/result.txt, and
 * the exit code says whether all passed.
 *
 * Node 8.
 */
const fs = require('fs');
const net = require('net');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const { createService } = require(path.join(ROOT, 'native', 'clucraft-halflife', 'service'));
const { createEngine } = require(path.join(ROOT, 'native', 'clucraft-halflife', 'engine'));

const OUT = '/run-hl';
const SOCK = '/tmp/hl.sock';
const VIDEO = OUT + '/frame.mgvf';
const BIN = '/opt/hl/tool';
const ENV = { ALSA_CONFIG_PATH: process.env.E2E_ALSA_CONFIG || '', PULSE_SERVER: process.env.PULSE_SERVER || '', XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || '' };
const ONLY = (process.env.HL_E2E || '').split(',').filter(Boolean);
const K_ESCAPE = 27;
// a stand-in for a gamepad (test/fake-usbpipe.js): every line appended to PAD_FILE is one state of the pad
const PAD_FILE = OUT + '/pad.jsonl';
const PAD_DEV = { kind: 'gip', node: '/dev/bus/usb/001/004', iface: 0, epIn: 0x82, epOut: 0x02, packet: 64, vid: 0x045e, pid: 0x02ea, name: 'Controller' };
const pad = (state) => fs.appendFileSync(PAD_FILE, JSON.stringify(state || {}) + '\n');
const press = async (button, ms) => { pad({ buttons: [button] }); await sleep(ms || 150); pad({}); await sleep(150); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failed = 0;
function check(name, ok, detail) {
    const line = (ok ? 'ok     ' : 'FAILED ') + name + (detail ? '  (' + detail + ')' : '');
    results.push(line);
    if (!ok) failed++;
    fs.appendFileSync(OUT + '/result.txt', line + '\n');
    console.log('### ' + line);
}
const note = (s) => { fs.appendFileSync(OUT + '/result.txt', '       ' + s + '\n'); console.log('### ' + s); };

function ask(m) {
    return new Promise((resolve, reject) => {
        const c = net.connect(SOCK);
        let buf = '';
        c.setEncoding('utf8');
        c.on('connect', () => c.write(JSON.stringify(m) + '\n'));
        c.on('data', (d) => { buf += d; const i = buf.indexOf('\n'); if (i >= 0) { c.destroy(); resolve(JSON.parse(buf.slice(0, i))); } });
        c.on('error', reject);
    });
}
async function until(fn, ms, what) {
    const t0 = Date.now();
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() - t0 > ms) { note('timeout waiting for ' + what); return null; }
        await sleep(200);
    }
}
function shot(name) {
    try {
        fs.copyFileSync(VIDEO, '/tmp/frame.copy');
        return String(execFileSync('python3', [path.join(ROOT, 'tools', 'mgvf', 'mgvf2png.py'), '/tmp/frame.copy', OUT + '/' + name + '.png'])).split('\n')[0];
    } catch (e) { return 'no picture: ' + String(e.message).split('\n')[0]; }
}
const cpuTicks = (pid) => { const s = fs.readFileSync('/proc/' + pid + '/stat', 'utf8'); const f = s.slice(s.lastIndexOf(')') + 2).split(' '); return Number(f[11]) + Number(f[12]); };
const want = (name) => !ONLY.length || ONLY.indexOf(name) >= 0;

/* ---------- the engine alone: the cap, the cost of a frame, a long hold ---------- */
async function engineAlone() {
    const eng = createEngine({ bin: BIN, videoPath: VIDEO, env: ENV, log: (s) => console.log(s) });
    const st = await eng.selftest();
    check('the engine\'s libraries load (self-test)', st.ok, st.lines[st.lines.length - 1]);
    // the gamepad's program as it is committed: it runs here (no pad: it says how it is used and leaves with 2)
    const prog = require('child_process').spawnSync(path.join(ROOT, 'native', 'clucraft-halflife', 'bin', 'clucraft-hl-pad'), [], { encoding: 'utf8' });
    check('the gamepad\'s program runs', prog.status === 2 && /usage/.test(prog.stderr || ''), 'exit ' + prog.status + ': ' + String(prog.stderr || prog.error || '').trim().slice(0, 90));
    fs.mkdirSync(OUT + '/alone');
    eng.start({ root: '/hl', base: OUT + '/alone', width: 1280, height: 480, mode: 'new', alsa: 'car', dev: true });
    const inGame = await until(() => { const s = eng.state().stat; return s && s.state === 'game' && s.map === 'c0a0'; }, 40000, 'the first map');
    check('"new game" opens the first map', !!inGame, JSON.stringify(eng.state().stat));
    await sleep(3000);

    // 30 frames a second, and what they cost
    // (the engine's own count, one status line a second: this script's clock is not the frames')
    const pid = eng.state().pid, t0 = Date.now(), c0 = cpuTicks(pid);
    const seen = [];
    for (let i = 0; i < 10; i++) { await sleep(1000); seen.push(eng.state().stat.fps); }
    const secs = (Date.now() - t0) / 1000, cpu = (cpuTicks(pid) - c0) / 100 / secs * 100, fps = seen.reduce((a, v) => a + v, 0) / seen.length;
    check('the frame rate is capped at 30', seen.every((v) => v > 29 && v < 31), 'per second: ' + seen.join(' '));
    note('cost at 1280x480, 30 fps, in the tram: ' + cpu.toFixed(0) + '% of one core of this PC (' + (cpu / fps * 10).toFixed(2) + ' ms a frame)');
    check('the sound device is open', eng.state().stat.sound === 1);
    note('picture: ' + shot('1-tram'));

    // a hold longer than any timeout in the engine: afterwards the game goes on as if no time had passed
    const HOLD = Number(process.env.HL_E2E_HOLD) || 75;
    eng.hold(true);
    await until(() => eng.state().held, 3000, 'the hold');
    const c1 = cpuTicks(pid), f1 = eng.state().stat.frames;
    await sleep(HOLD * 1000);
    const idle = (cpuTicks(pid) - c1) / 100 / HOLD * 100;
    check('held: no frame is drawn and the engine uses no CPU', eng.state().held && eng.state().stat.frames === f1 && idle < 2, 'frames +' + (eng.state().stat.frames - f1) + ', cpu ' + idle.toFixed(1) + '% over ' + HOLD + ' s');
    eng.hold(false);
    await sleep(4000);
    const after = eng.state().stat;
    check('after a ' + HOLD + ' s hold the game goes on in the same map', after.state === 'game' && after.map === 'c0a0' && after.frames > f1 + 60 && after.fps > 28, JSON.stringify(after));
    note('picture: ' + shot('2-after-hold'));

    await eng.stop('test');
    const last = eng.state().last;
    check('asked to stop, the engine saves and quits by itself', last && last.code === 0 && last.signal === null && eng.hasSave(OUT + '/alone'), JSON.stringify(last));
    check('its frame file is gone', !fs.existsSync(VIDEO));
}

/* ---------- the service, with this script as the app ---------- */
async function withService() {
    const svc = createService({
        stateDir: OUT + '/state', dataRoot: '/hl', exit: false, alsa: 'car', dev: true,
        idleMs: 3600 * 1000, goneMs: 6000, heldMs: 9000, hangMs: 10000,
        engine: { bin: BIN, videoPath: VIDEO, env: ENV },
        padFind: () => [PAD_DEV], padPipe: [process.execPath, path.join(ROOT, 'test', 'fake-usbpipe.js')], padEnv: { FAKE_PAD_FILE: PAD_FILE, PATH: process.env.PATH || '' },
    });
    fs.writeFileSync(PAD_FILE, '');
    const padOn = async () => { await until(() => fs.existsSync(PAD_FILE + '.on'), 5000, 'the stand-in pad being switched on'); fs.unlinkSync(PAD_FILE + '.on'); };
    const server = net.createServer();
    svc.serve(server);
    await new Promise((r) => server.listen(SOCK, r));
    svc.start();

    // the app's beat, twice a second, saying what `car` says
    const car = { parked: true, shown: true, alive: false };
    let st = null;
    const beat = setInterval(() => { if (car.alive) ask({ cmd: 'beat', parked: car.parked, shown: car.shown }).then((s) => { st = s; }, () => {}); }, 400);
    const status = async () => { st = await ask({ cmd: 'status' }); return st; };
    const engineIs = (state, map) => () => status().then((s) => s.engine.stat && s.engine.stat.state === state && (!map || s.engine.stat.map === map) && s);
    const stopped = () => status().then((s) => s.engine.state === 'stopped' && s);

    check('the service knows the engine loads', !!(await until(() => status().then((s) => s.selftest && s.selftest.ok), 20000, 'the self-test')), st.selftest && st.selftest.line);
    check('it finds the game data', st.data.found === true, st.data.root);
    check('saves go to its own folder when there is no writable stick', st.saves && st.saves.where === 'unit', st.saves && st.saves.dir);

    let r = await ask({ cmd: 'start', mode: 'new' });
    check('no game starts while nobody says the car is parked', r.engine.state === 'stopped' && /not parked/.test(r.refused || ''), r.refused);
    car.alive = true; car.parked = false;
    await sleep(1000);
    r = await ask({ cmd: 'start', mode: 'new' });
    check('no game starts while the car moves', r.engine.state === 'stopped' && /not parked/.test(r.refused || ''), r.refused);

    car.parked = true;
    await sleep(1000);
    r = await ask({ cmd: 'start', mode: 'new', size: '1280x480' });
    check('parked: the game starts', r.engine.state !== 'stopped' && !r.refused, r.refused || r.engine.state);
    check('the first map is reached', !!(await until(engineIs('game', 'c0a0'), 40000, 'c0a0')), JSON.stringify(st.engine.stat));
    await sleep(2500);
    note('status: ' + JSON.stringify((await status()).sys));

    // the car moves: the game stands still within the beat's 1.5 s, and goes on when it is parked again
    car.parked = false;
    const held = await until(() => status().then((s) => s.engine.held && s), 3000, 'the hold');
    const f0 = held ? held.engine.stat.frames : -1;
    await sleep(2000);
    check('the car moves: the game stands still', !!held && (await status()).engine.stat.frames === f0, 'frames ' + f0 + ' -> ' + st.engine.stat.frames);
    r = await ask({ cmd: 'input', ev: [['k', K_ESCAPE, 1], ['k', K_ESCAPE, 0]] });
    check('no input reaches a game that stands still', r.n === 0);
    car.parked = true;
    check('parked again: it goes on', !!(await until(() => status().then((s) => !s.engine.held && s.engine.stat.frames > f0 + 30), 5000, 'the game going on')));

    // input: Escape opens the game's menu over the game, Escape again closes it
    await ask({ cmd: 'input', ev: [['k', K_ESCAPE, 1], ['k', K_ESCAPE, 0]] });
    check('a key reaches the game (Escape: its menu)', !!(await until(engineIs('paused'), 4000, 'the menu')));
    note('picture: ' + shot('3-menu-over-game'));
    await ask({ cmd: 'input', ev: [['k', K_ESCAPE, 1], ['k', K_ESCAPE, 0]] });
    check('and again (Escape: back to the game)', !!(await until(engineIs('game'), 4000, 'the game')));
    r = await ask({ cmd: 'input', ev: [['k', 'quit', 1], ['x'], ['t', 0, '0.5; quit', 0.5], ['a', 9, 0], 'quit', ['k', 300, 1]] });
    check('input that is not numbers in range is dropped', r.n === 0 && (await status()).engine.state === 'running');

    // a gamepad (a stand-in for the pad itself; the engine and what it does with the pad are real)
    check('a gamepad is read while the game runs', !!(await until(() => status().then((x) => x.pad && x.pad.reading), 5000, 'the pad being read')), JSON.stringify(st.pad));
    await padOn();
    await sleep(500);
    check('the engine lays out the pad\'s buttons (its Xbox preset)', (await ask({ cmd: 'log' })).engine.some((l) => /Applying "xbox" gamepad preset/.test(l)));
    note('picture: ' + shot('6-pad-before'));
    pad({ rx: 32767 }); await sleep(900); pad({}); await sleep(400);
    note('picture, the right stick pushed right for 0.9 s: ' + shot('7-pad-turned-right'));
    pad({ ly: 32767 }); await sleep(1500); pad({}); await sleep(400);
    note('picture, the left stick pushed up for 1.5 s: ' + shot('8-pad-walked-forward'));
    await press('START');
    check('the pad\'s Menu button opens the game\'s menu', !!(await until(engineIs('paused'), 4000, 'the menu')));
    await press('B');
    check('and its B button goes back to the game', !!(await until(engineIs('game'), 4000, 'the game')));

    // the app is not on the screen (HOME was pressed): the game stands still too
    car.shown = false;
    check('the app is not on the screen: the game stands still', !!(await until(() => status().then((s) => s.engine.held), 3000, 'the hold')));
    car.shown = true;
    await until(() => status().then((s) => !s.engine.held), 4000, 'the game going on');

    r = await ask({ cmd: 'stop' });
    check('stop: the game is saved and the engine quits', r.engine.state === 'stopped' && r.engine.last && r.engine.last.code === 0 && r.saves.canContinue === true, JSON.stringify(r.engine.last));
    check('the frame file is gone', !fs.existsSync(VIDEO));

    r = await ask({ cmd: 'start', mode: 'continue', size: '960x360' });
    const cont = await until(engineIs('game', 'c0a0'), 40000, 'the saved game');
    check('"continue" loads that save, at another size', !!cont && cont.engine.stat.w === 960 && cont.engine.stat.h === 360, JSON.stringify(st.engine.stat));
    await sleep(1500);
    note('picture: ' + shot('4-continued-960x360'));

    // the app goes away without a word (closed, or crashed)
    car.alive = false;
    const gone = await until(stopped, 6000 + 12000, 'the engine ending');
    check('the app goes away: the game ends by itself', !!gone && /app went away/.test(gone.engine.last.why) && gone.engine.last.code === 0, gone && JSON.stringify(gone.engine.last));

    // standing still for too long ends the game as well (9 s here, 5 minutes in the car)
    car.alive = true; car.parked = true; car.shown = true;
    await sleep(1000);
    await ask({ cmd: 'start', mode: 'menu', size: '640x240' });
    check('the game\'s own menu opens, at 640x240', !!(await until(() => status().then((s) => s.engine.stat && s.engine.stat.state === 'menu' && s.engine.stat.w === 640 && s), 30000, 'the menu')));
    await sleep(1500);
    note('picture: ' + shot('5-menu-640x240'));
    car.shown = false;
    const stood = await until(stopped, 9000 + 14000, 'the engine ending');
    check('standing still too long: the game ends', !!stood && /stood still/.test(stood.engine.last.why), stood && JSON.stringify(stood.engine.last));
    car.shown = true;

    // a crash: the engine is gone, nothing is left behind, the service lives
    await sleep(1000);
    await ask({ cmd: 'start', mode: 'menu' });
    await until(engineIs('menu'), 30000, 'the menu');
    process.kill(svc.engine.state().pid, 'SIGSEGV');
    const crashed = await until(stopped, 8000, 'the crash');
    check('a crash (SIGSEGV): the engine ends within seconds with the signal\'s exit code', !!crashed && crashed.engine.last.code === 139, crashed && JSON.stringify(crashed.engine.last));
    check('no frame file and no core file are left', !fs.existsSync(VIDEO) && !fs.readdirSync(BIN).concat(fs.readdirSync('/tmp')).some((n) => /^core/.test(n)));
    check('the service says so and still answers', /ended by itself/.test((await status()).engine.error || ''), st.engine.error);
    const trace = (await ask({ cmd: 'log' })).engine.filter((l) => /Crash: signal 11/.test(l));
    check('the engine\'s crash report is in the log', trace.length > 0, trace[0]);

    // a hang: an engine that says nothing for hangMs is ended, with SIGKILL when nothing else helps
    await ask({ cmd: 'start', mode: 'menu' });
    await until(engineIs('menu'), 30000, 'the menu');
    process.kill(svc.engine.state().pid, 'SIGSTOP');
    const hung = await until(stopped, 10000 + 11000 + 6000, 'the hung engine ending');
    check('a hang (SIGSTOP): the service ends the engine', !!hung && /no sign of life/.test(hung.engine.last.why), hung && JSON.stringify(hung.engine.last));
    check('the frame file is gone after the kill too', !fs.existsSync(VIDEO));

    clearInterval(beat);
    const log = await ask({ cmd: 'log' });
    fs.writeFileSync(OUT + '/service-lines.txt', log.service.join('\n') + '\n');
    fs.writeFileSync(OUT + '/engine-lines.txt', log.engine.join('\n') + '\n');
    await svc.stop(0);
    server.close();
}

/* ---------- the game's own menu with the pad alone, as on the car: no keyboard, no developer mode ---------- */
async function padInMenu() {
    const svc = createService({
        stateDir: OUT + '/state-menu', dataRoot: '/hl', exit: false, alsa: 'car', dev: false, idleMs: 3600 * 1000,
        engine: { bin: BIN, videoPath: VIDEO, env: ENV },
        padFind: () => [PAD_DEV], padPipe: [process.execPath, path.join(ROOT, 'test', 'fake-usbpipe.js')], padEnv: { FAKE_PAD_FILE: PAD_FILE, PATH: process.env.PATH || '' },
    });
    fs.writeFileSync(PAD_FILE, '');
    try { fs.unlinkSync(PAD_FILE + '.on'); } catch (e) { /* none */ }
    const beat = setInterval(() => svc.command({ cmd: 'beat', parked: true, shown: true }).catch(() => {}), 400);
    const stat = () => svc.command({ cmd: 'status' }).then((s) => s.engine.stat || {});
    svc.start();
    try {
        await until(() => svc.command({ cmd: 'status' }).then((s) => s.selftest), 20000, 'the self-test');
        await svc.command({ cmd: 'beat', parked: true, shown: true });
        await svc.command({ cmd: 'start', mode: 'menu', size: '960x360' });
        await until(() => stat().then((s) => s.state === 'menu'), 30000, 'the menu');
        await until(() => fs.existsSync(PAD_FILE + '.on'), 5000, 'the stand-in pad being switched on');
        await sleep(1500);
        // D-pad down puts the mark on the first entry ("New game"); A opens it; down and A take "Easy"
        const steps = ['DOWN', 'A', 'DOWN', 'A'];
        for (let i = 0; i < steps.length && (await stat()).state === 'menu'; i++) {
            await press(steps[i]);
            await sleep(1200);
            note('menu, after ' + steps.slice(0, i + 1).join(' ') + ': ' + (await stat()).state + ', ' + shot('9-menu-pad-' + (i + 1)));
        }
        const s = await until(() => stat().then((x) => x.state === 'game' && x.map === 'c0a0' && x), 40000, 'the first map');
        check('a new game can be started from the game\'s own menu with the pad alone', !!s, JSON.stringify(await stat()));
    } finally {
        clearInterval(beat);
        await svc.stop(0);
    }
}

function written() {
    const list = [];
    (function walk(d, rel) {
        fs.readdirSync(d).forEach((n) => {
            const p = path.join(d, n), s = fs.lstatSync(p);
            if (s.isDirectory()) { if (n !== '.fontcache') walk(p, rel + n + '/'); } else list.push(rel + n + ' ' + s.size);
        });
    })(OUT + '/state', '');
    note('files under the state folder: ' + list.join(', '));
    const total = list.reduce((a, l) => a + Number(l.split(' ').pop()), 0);
    check('what the engine wrote is small', total < 16 * 1024 * 1024, (total / 1048576).toFixed(1) + ' MB');
}

(async () => {
    try { fs.unlinkSync(OUT + '/result.txt'); } catch (e) { /* none */ }
    if (want('engine')) await engineAlone();
    if (want('service')) { await withService(); written(); }
    if (want('padmenu')) await padInMenu();
    note(failed ? failed + ' check(s) FAILED' : 'all ' + results.length + ' checks passed');
    process.exit(failed ? 1 : 0);
})().catch((e) => { check('the test itself', false, String(e && e.stack || e)); process.exit(2); });
