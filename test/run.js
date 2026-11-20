'use strict';
/**
 * Tests of the Half-Life app and its service. No car, no game data and no network are needed:
 *
 *   node test/run.js                      on this computer's Node
 *   node tools/node8.js test/run.js       on Node 8, as the head unit runs both
 *
 * - the pieces: finding the game data on a stick, where saves go, the drive gate, the controller's and a finger's
 *   meaning, the frame file's header
 * - the service (native/clucraft-halflife) with a stand-in engine (test/fake-engine.js): no game unless parked,
 *   the hold, input, save and continue, the app going away, a crash, a hang, an engine that does not load
 * - the app's store and pages (tools/stage.js): every page drawn, taps on its targets
 * - main.js on a stand-in head unit, from the package the kit's build stages (needs Python 3; skipped without)
 * - the repository: versions and manifests agree, the engine's files are the ones the manifest names, and no game
 *   data is in it
 *
 * What these cannot say: anything about the real engine (tools/run/service.sh runs it, with the owner's game data)
 * and anything about the car (docs/STATUS.md lists it).
 */
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const Module = require('module');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'apps', 'clucraft_halflife');
const SVC = path.join(ROOT, 'native', 'clucraft-halflife');
const { createStage, makeStick, serviceOptions, sleep } = require(path.join(ROOT, 'tools', 'stage'));
const { createService } = require(path.join(SVC, 'service'));
const GD = require(path.join(SVC, 'gamedata'));

// the service logs to the console: kept out of the tests' own lines (TEST_LOG=1 shows it)
const print = console.log.bind(console);
if (!process.env.TEST_LOG) console.log = () => {};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const tmpdir = (n) => fs.mkdtempSync(path.join(os.tmpdir(), n));
async function until(fn, ms, what) {
    const t0 = Date.now();
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() - t0 > (ms || 6000)) throw new Error('timeout waiting for ' + what);
        await sleep(30);
    }
}
/** a service with the stand-in engine and an invented stick; `beat(parked, shown)` is the app's word */
function service(o) {
    const opts = o || {};
    const tmp = tmpdir('hl-svc-');
    const stick = makeStick(tmp, opts.stick || 'ro');
    const svc = createService(serviceOptions(tmp, stick, opts.service));
    svc.start();
    const ask = (m) => svc.command(m);
    const beat = (parked, shown) => ask({ cmd: 'beat', parked, shown });
    const state = (s, map) => () => ask({ cmd: 'status' }).then((x) => x.engine.stat && x.engine.stat.state === s && (!map || x.engine.stat.map === map) && x);
    const stopped = () => ask({ cmd: 'status' }).then((x) => x.engine.state === 'stopped' && x);
    return { svc, ask, beat, state, stopped, tmp, stick, video: path.join(tmp, 'video'), close: () => svc.stop(0) };
}

/* ---------------- the pieces ---------------- */

test('game data: found on a stick whatever the case of its names; an incomplete copy and no stick say so', () => {
    const tmp = tmpdir('hl-gd-');
    const a = makeStick(tmp, 'ro');
    let f = GD.find({ mounts: a.mounts, roots: [a.media] });
    assert.strictEqual(f.found, true);
    assert.strictEqual(f.root, path.join(a.dir, 'Half-Life'));
    assert.deepStrictEqual([f.mount.ro, f.mount.type, f.mount.dir], [true, 'vfat', a.dir]);
    // FAT keeps names as they were typed
    fs.renameSync(path.join(a.dir, 'Half-Life'), path.join(a.dir, 'HALFLIFE'));
    fs.renameSync(path.join(a.dir, 'HALFLIFE', 'valve'), path.join(a.dir, 'HALFLIFE', 'Valve'));
    fs.renameSync(path.join(a.dir, 'HALFLIFE', 'Valve', 'liblist.gam'), path.join(a.dir, 'HALFLIFE', 'Valve', 'LIBLIST.GAM'));
    f = GD.find({ mounts: a.mounts, roots: [a.media] });
    assert.strictEqual(f.found, true, f.why);
    assert.strictEqual(f.root, path.join(a.dir, 'HALFLIFE'));
    // a copy that stopped half way
    fs.unlinkSync(path.join(a.dir, 'HALFLIFE', 'Valve', 'maps', 'c0a0.bsp'));
    f = GD.find({ mounts: a.mounts, roots: [a.media] });
    assert.strictEqual(f.found, false);
    assert.ok(/not complete/.test(f.why) && /c0a0\.bsp/.test(f.why), f.why);
    // valve at the stick's top
    const tmp2 = tmpdir('hl-gd-'), b = makeStick(tmp2, 'ro');
    fs.renameSync(path.join(b.dir, 'Half-Life', 'valve'), path.join(b.dir, 'valve'));
    assert.strictEqual(GD.find({ mounts: b.mounts, roots: [b.media] }).root, b.dir);
    // a stick without the game, and none
    const e = makeStick(tmpdir('hl-gd-'), 'empty'), n = makeStick(tmpdir('hl-gd-'), 'none');
    assert.ok(/No valve folder/.test(GD.find({ mounts: e.mounts, roots: [e.media] }).why));
    assert.ok(/No USB stick/.test(GD.find({ mounts: n.mounts, roots: [n.media] }).why));
    assert.strictEqual(GD.find({ mounts: path.join(tmp, 'no-such-file'), roots: ['/media'] }).found, false);
    // a mount point with a space, as /proc/mounts writes it
    assert.deepStrictEqual(GD.mountsUnder(a.mounts, [a.media]).map((m) => m.dir), [a.dir]);
    const sp = path.join(tmp, 'm2');
    fs.writeFileSync(sp, '/dev/sdb1 /media/MY\\040STICK exfat ro 0 0\n/dev/sdc1 /mediax/Z vfat rw 0 0\n');
    assert.deepStrictEqual(GD.mountsUnder(sp, ['/media']), [{ dir: '/media/MY STICK', dev: '/dev/sdb1', type: 'exfat', ro: true }]);
});

test('saves: on the stick only when it is mounted writable and really takes a file, else in the service\'s folder', () => {
    const tmp = tmpdir('hl-sv-'), state = path.join(tmp, 'state');
    fs.mkdirSync(state);
    const dir = path.join(tmp, 'stick');
    fs.mkdirSync(dir);
    let b = GD.pickBase({ dir, ro: true }, state);
    assert.deepStrictEqual([b.where, b.dir], ['unit', path.join(state, 'base')]);
    assert.strictEqual(fs.existsSync(path.join(dir, GD.SAVE_FOLDER)), false, 'a read-only stick was written to');
    b = GD.pickBase({ dir, ro: false }, state);
    assert.deepStrictEqual([b.where, b.dir], ['stick', path.join(dir, GD.SAVE_FOLDER)]);
    assert.deepStrictEqual(fs.readdirSync(b.dir), [], 'the write test left a file behind');
    // mounted "rw" but refusing (a stick that is gone, a full one): the unit's folder
    b = GD.pickBase({ dir: path.join(tmp, 'gone', 'deeper'), ro: false }, state);
    assert.strictEqual(b.where, 'unit');
    assert.strictEqual(GD.pickBase(null, state).where, 'unit');
});

test('saves: a writable stick is tried with a file once when it is found, not at every look', async () => {
    let t = Date.now();
    const s = service({ stick: 'rw', service: { now: () => t } });
    try {
        const first = await s.ask({ cmd: 'status' });
        assert.strictEqual(first.saves.where, 'stick');
        const dir = first.saves.dir, was = fs.statSync(dir).mtimeMs;
        await sleep(40);                        // (a later file made there would show in the folder's time)
        // the service looks at the stick again every three seconds while the app asks
        for (let i = 0; i < 5; i++) { t += 4000; assert.strictEqual((await s.ask({ cmd: 'status' })).saves.where, 'stick'); }
        assert.strictEqual(fs.statSync(dir).mtimeMs, was, 'the stick was written to again');
    } finally { await s.close(); }
});

test('drive gate: parked only on a fresh speed under 1 km/h with the selector in P; anything unknown is not parked', () => {
    const DG = require(path.join(APP, 'drivegate'));
    let t = 1000000;
    const g = DG.createGate({ now: () => t });
    assert.strictEqual(g.parked(), false, 'nothing known');
    g.stage('P');
    assert.strictEqual(g.parked(), false, 'no speed yet');
    g.speed({ speedVehicleCentreOfGravity: 0 });
    assert.strictEqual(g.parked(), true);
    g.speed({ speedVehicleCentreOfGravity: 65535 });             // "no value": the last real one stays, and ages
    assert.strictEqual(g.parked(), true);
    t += DG.STALE_MS + 1;
    assert.strictEqual(g.parked(), false, 'a speed that stopped arriving');
    g.speed({ speedVehicleCentreOfGravity: 64 * 30 });
    assert.strictEqual(g.parked(), false);
    assert.ok(/30\.0 km\/h/.test(g.why()), g.why());
    g.speed({ speedVehicleCentreOfGravity: 20 });                 // 0.3 km/h, but in D: a red light
    g.stage('D');
    assert.strictEqual(g.parked(), false, 'standing in D');
    g.stage('NP');
    assert.strictEqual(g.parked(), true, 'N or P, standing');
    g.speed({ speedVehicleCentreOfGravity: 64 * 3 });
    assert.strictEqual(g.parked(), false, 'N or P, rolling');
    assert.deepStrictEqual([DG.stageFromGearbox({ statusActualStageDrive: 1 }), DG.stageFromGearbox({ statusActualStageDrive: 'D' }), DG.stageFromGearbox({}),
        DG.stageFromSelection({ statusGearSelectionDrive: 3 }), DG.stageFromSelection({ statusGearSelectionDrive: 4 }), DG.stageFromSelection({ statusGearSelectionDrive: 2 })],
    ['P', 'D', undefined, 'P', 'NP', '2']);
    // a gate nothing feeds (no signals on this unit): never parked, and watch() does not throw
    assert.strictEqual(DG.watch(null, null, DG.createGate()).parked(), false);
    // there is no way around it in the module
    assert.deepStrictEqual(Object.keys(DG).sort(), ['MAX_KMH', 'STALE_MS', 'createGate', 'stageFromGearbox', 'stageFromSelection', 'watch']);
});

test('input: the controller is arrow keys, Enter and Escape; a finger is a place between 0 and 1', () => {
    const IN = require(path.join(APP, 'input'));
    const K = IN.KEY;
    assert.deepStrictEqual(IN.fromController({ turn: 2, press: false, tilt: null }), [['k', K.DOWN, 1], ['k', K.DOWN, 0], ['k', K.DOWN, 1], ['k', K.DOWN, 0]]);
    assert.deepStrictEqual(IN.fromController({ turn: -1 }), [['k', K.UP, 1], ['k', K.UP, 0]]);
    assert.deepStrictEqual(IN.fromController({ turn: 0, press: true }), [['k', K.ENTER, 1], ['k', K.ENTER, 0]]);
    assert.deepStrictEqual(IN.fromController({ tilt: 'W' }), [['k', K.ESCAPE, 1], ['k', K.ESCAPE, 0]]);
    assert.deepStrictEqual(IN.fromController({ tilt: 'E' })[0], ['k', K.RIGHT, 1]);
    assert.strictEqual(IN.fromController({ turn: 500 }).length, IN.MAX_CLICKS * 2, 'a spin is capped');
    assert.deepStrictEqual(IN.fromController(null), []);
    assert.deepStrictEqual(IN.fromController({ turn: 'x', tilt: 'Q' }), []);
    assert.deepStrictEqual(IN.fromTouch(1, 800, 300, 1600, 600), [['t', 0, 0.5, 0.5]]);
    assert.deepStrictEqual(IN.fromTouch(2, 1600, 600, 1600, 600), [['t', 2, 1, 1]]);
    assert.deepStrictEqual(IN.fromTouch(3, -50, 9999, 1600, 600), [['t', 1, 0, 1]]);
    assert.deepStrictEqual(IN.fromTouch(4, 10, 10, 1600, 600), [], 'a cancelled finger is no tap');
});

test('frame file: the PC-side reader takes the header the engine writes and refuses what the renderer would', () => {
    const py = ['python3', 'python'].filter((p) => { try { return spawnSync(p, ['--version']).status === 0; } catch (e) { return false; } })[0];
    if (!py) { print('     (skipped: no Python 3)'); return; }
    const tmp = tmpdir('hl-mgvf-');
    const make = (w, h, nslot, over) => {
        const head = Buffer.alloc(64);
        [0x4656474d, 1, w, h, 5, 1, nslot, 0, 1, 0].forEach((v, i) => head.writeUInt32LE(v, i * 4));
        Object.keys(over || {}).forEach((i) => head.writeUInt32LE(over[i], Number(i) * 4));
        const f = path.join(tmp, 'f-' + w + 'x' + h + '-' + nslot + '-' + Object.keys(over || {}).join('') + '.mgvf');
        fs.writeFileSync(f, Buffer.concat([head, Buffer.alloc(w * h * 3 / 2 * nslot, 128)]));
        return f;
    };
    const read = (f) => spawnSync(py, [path.join(ROOT, 'tools', 'mgvf', 'mgvf2png.py'), f, path.join(tmp, 'out.png')], { encoding: 'utf8' });
    const ok = read(make(64, 32, 3));
    assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
    assert.ok(/64x32 I420, BT\.601 full range, seq 5, slot 1 of 3/.test(ok.stdout), ok.stdout);
    assert.ok(fs.statSync(path.join(tmp, 'out.png')).size > 60);
    assert.notStrictEqual(read(make(64, 32, 3, { 0: 0x12345678 })).status, 0, 'a wrong magic was taken');
    assert.notStrictEqual(read(make(64, 32, 3, { 2: 63 })).status, 0, 'an odd width was taken');
    assert.notStrictEqual(read(make(64, 32, 3, { 6: 5 })).status, 0, 'five slots were taken');
    assert.notStrictEqual(read(make(64, 32, 3, { 5: 3 })).status, 0, 'a slot past the last was taken');
});

/* ---------------- the service, with a stand-in engine ---------------- */

test('service: finds the stick, checks the engine once, and starts no game unless a fresh beat says "parked"', async () => {
    const s = service({ service: { beatMs: 300 } });
    try {
        let st = await until(() => s.ask({ cmd: 'status' }).then((x) => x.selftest && x), 6000, 'the self-test');
        assert.strictEqual(st.selftest.ok, true, st.selftest.line);
        assert.deepStrictEqual([st.data.found, st.data.root, st.data.ro], [true, path.join(s.stick.dir, 'Half-Life'), true]);
        assert.deepStrictEqual([st.saves.where, st.saves.canContinue], ['unit', false]);
        assert.deepStrictEqual([st.engine.state, st.sys], ['stopped', null]);
        // nobody said anything
        st = await s.ask({ cmd: 'start', mode: 'new' });
        assert.ok(st.engine.state === 'stopped' && /not parked/.test(st.refused), st.refused);
        // "moving"
        await s.beat(false, false);
        st = await s.ask({ cmd: 'start', mode: 'new' });
        assert.ok(st.engine.state === 'stopped' && /not parked/.test(st.refused), st.refused);
        // "parked", but said too long ago
        await s.beat(true, false);
        await sleep(350);
        st = await s.ask({ cmd: 'start', mode: 'new' });
        assert.ok(st.engine.state === 'stopped' && /not parked/.test(st.refused), 'an old "parked" started a game');
        assert.strictEqual(fs.existsSync(s.video), false);
    } finally { await s.close(); }
});

test('service: a game runs while the app says "parked, on the screen", stands still otherwise, and takes input only then', async () => {
    const tmp0 = tmpdir('hl-in-'), inputLog = path.join(tmp0, 'input.log');
    const s = service({ service: { beatMs: 400, engine: { env: { FAKE_INPUT_LOG: inputLog, FAKE_STAT_MS: '60' } } } });
    const beating = { parked: true, shown: true };
    const timer = setInterval(() => s.beat(beating.parked, beating.shown).catch(() => {}), 100);
    try {
        await until(() => s.ask({ cmd: 'status' }).then((x) => x.selftest), 6000, 'the self-test');
        await s.beat(true, true);
        let st = await s.ask({ cmd: 'start', mode: 'new', size: '960x360' });
        assert.strictEqual(st.refused, null, st.refused);
        st = await until(s.state('game', 'c0a0'), 6000, 'the first map');
        assert.deepStrictEqual([st.engine.stat.w, st.engine.stat.h, st.engine.want.size, st.engine.want.mode], [960, 360, '960x360', 'new']);
        assert.ok(fs.existsSync(s.video), 'no frame file');
        st = await s.ask({ cmd: 'start', mode: 'new' });
        assert.ok(/running already/.test(st.refused), 'a second game was started');

        // keys, an axis, a finger: as numbers, to the engine
        assert.deepStrictEqual(await s.ask({ cmd: 'input', ev: [['k', 27, 1], ['k', 27, 0], ['a', 3, -32767], ['t', 0, 0.25, 0.75]] }), { n: 4 });
        await until(s.state('paused'), 3000, 'the menu over the game');
        assert.deepStrictEqual(fs.readFileSync(inputLog, 'utf8').trim().split('\n'), ['mgu_key 27 1', 'mgu_key 27 0', 'mgu_axis 3 -32767', 'mgu_touch 0 0.2500 0.7500']);
        // anything that is not a number in range never reaches the engine's console
        assert.deepStrictEqual(await s.ask({ cmd: 'input', ev: [['k', 'quit', 1], ['k', 0, 1], ['k', 256, 1], ['a', 6, 0], ['a', 0, 'x'], ['t', 3, 0, 0], ['t', 0, '0.5\nquit', 0.5], 'quit', null, ['x', 1]] }), { n: 0 });
        assert.deepStrictEqual(await s.ask({ cmd: 'input', ev: 'quit' }), { n: 0 });
        assert.strictEqual(fs.readFileSync(inputLog, 'utf8').trim().split('\n').length, 4);
        assert.strictEqual((await s.ask({ cmd: 'status' })).engine.state, 'running');

        // the car moves
        beating.parked = false;
        st = await until(() => s.ask({ cmd: 'status' }).then((x) => x.engine.held && x), 3000, 'the hold');
        const frames = st.engine.stat.frames;
        assert.deepStrictEqual(await s.ask({ cmd: 'input', ev: [['k', 27, 1]] }), { n: 0 }, 'input reached a game that stands still');
        await sleep(300);
        assert.strictEqual((await s.ask({ cmd: 'status' })).engine.stat.frames, frames, 'frames were drawn while held');
        beating.parked = true;
        await until(() => s.ask({ cmd: 'status' }).then((x) => !x.engine.held && x.engine.stat.frames > frames), 3000, 'the game going on');
        // the app is not on the screen
        beating.shown = false;
        await until(() => s.ask({ cmd: 'status' }).then((x) => x.engine.held), 3000, 'the hold');
        beating.shown = true;
        await until(() => s.ask({ cmd: 'status' }).then((x) => !x.engine.held), 3000, 'the game going on');
        // the app stops talking, without having said "moving": held all the same, within the beat's time
        clearInterval(timer);
        st = await until(() => s.ask({ cmd: 'status' }).then((x) => x.engine.held && x), 3000, 'the hold on silence');
        assert.strictEqual(st.gate.fresh, false);
    } finally { clearInterval(timer); await s.close(); }
});

test('service: stop saves and ends the game; "continue" loads that save; saves go to a writable stick', async () => {
    const s = service({ stick: 'rw' });
    const timer = setInterval(() => s.beat(true, true).catch(() => {}), 100);
    try {
        await until(() => s.ask({ cmd: 'status' }).then((x) => x.selftest), 6000, 'the self-test');
        let st = await s.beat(true, true);
        assert.deepStrictEqual([st.saves.where, st.saves.dir, st.data.ro], ['stick', path.join(s.stick.dir, GD.SAVE_FOLDER), false]);
        // "continue" with nothing saved opens the game's menu
        st = await s.ask({ cmd: 'start', mode: 'continue' });
        assert.strictEqual(st.engine.want.mode, 'menu');
        await until(s.state('menu'), 6000, 'the menu');
        // Enter in its menu: a new game
        await s.ask({ cmd: 'input', ev: [['k', 13, 1], ['k', 13, 0]] });
        await until(s.state('game', 'c0a0'), 3000, 'the game');
        st = await s.ask({ cmd: 'stop' });
        assert.deepStrictEqual([st.engine.state, st.engine.last.code, st.engine.last.why, st.saves.canContinue], ['stopped', 0, 'the app asked', true]);
        assert.ok(fs.existsSync(path.join(s.stick.dir, GD.SAVE_FOLDER, 'valve', 'save', 'idrive.sav')), 'the save is not on the stick');
        assert.strictEqual(fs.existsSync(path.join(s.tmp, 'state', 'base')), false, 'something was written to the unit beside a writable stick');
        assert.strictEqual(fs.existsSync(s.video), false, 'the frame file stayed');
        st = await s.ask({ cmd: 'start', mode: 'continue' });
        assert.strictEqual(st.engine.want.mode, 'continue');
        await until(s.state('game', 'c0a0'), 6000, 'the saved game');
    } finally { clearInterval(timer); await s.close(); }
});

test('service: the app going away, standing still too long, a crash and a hang all end the game and leave nothing', async () => {
    const s = service({ service: { beatMs: 300, goneMs: 900, heldMs: 700, hangMs: 1200, engine: { env: { FAKE_CRASH_KEY: '99', FAKE_HANG_KEY: '98', FAKE_STAT_MS: '60' } } } });
    let timer = null;
    const beats = (parked, shown) => { clearInterval(timer); timer = setInterval(() => s.beat(parked, shown).catch(() => {}), 80); return s.beat(parked, shown); };
    const game = async () => { await beats(true, true); const st = await s.ask({ cmd: 'start', mode: 'new' }); assert.strictEqual(st.refused, null, st.refused); await until(s.state('game'), 6000, 'the game'); };
    try {
        await until(() => s.ask({ cmd: 'status' }).then((x) => x.selftest), 6000, 'the self-test');
        // the app goes away without a word
        await game();
        clearInterval(timer);
        let st = await until(s.stopped, 6000, 'the engine ending');
        assert.ok(/app went away/.test(st.engine.last.why) && st.engine.last.code === 0, JSON.stringify(st.engine.last));
        assert.strictEqual(st.saves.canContinue, true, 'the game was not saved on the way out');
        assert.strictEqual(fs.existsSync(s.video), false);
        // standing still for too long (the car drove off with the app open)
        await game();
        await beats(false, true);
        st = await until(s.stopped, 6000, 'the engine ending');
        assert.ok(/stood still/.test(st.engine.last.why), JSON.stringify(st.engine.last));
        // a crash: the engine is gone with its signal's code, its frame file with it; the service says so
        await game();
        await s.ask({ cmd: 'input', ev: [['k', 99, 1]] });
        st = await until(s.stopped, 6000, 'the crash');
        assert.strictEqual(st.engine.last.code, 139);
        assert.ok(/ended by itself/.test(st.engine.error), st.engine.error);
        assert.strictEqual(fs.existsSync(s.video), false, 'the frame file stayed after a crash');
        assert.ok((await s.ask({ cmd: 'log' })).engine.some((l) => /Crash: signal 11/.test(l)), 'the crash is not in the log');
        // a hang: nothing heard for hangMs, then signals until it is gone
        await game();
        assert.strictEqual((await s.ask({ cmd: 'status' })).engine.error, null, 'the last crash is still shown beside a running game');
        await s.ask({ cmd: 'input', ev: [['k', 98, 1]] });
        st = await until(s.stopped, 20000, 'the hung engine ending');
        assert.ok(/no sign of life/.test(st.engine.last.why), JSON.stringify(st.engine.last));
        assert.strictEqual(fs.existsSync(s.video), false, 'the frame file stayed after a kill');
        assert.strictEqual(st.engine.exits, 4);
    } finally { clearInterval(timer); await s.close(); }
});

test('service: an engine that does not load on this head unit starts no game, and the Store\'s check fails', async () => {
    const s = service({ service: { engine: { env: { FAKE_SELFTEST_FAIL: '1' } } } });
    const server = net.createServer();
    s.svc.serve(server);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const check = (port) => new Promise((resolve) => {
        const c = require('child_process').spawn(process.execPath, [path.join(SVC, 'check.js'), String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
        c.on('exit', (code) => resolve({ code, out }));
    });
    try {
        const st = await until(() => s.ask({ cmd: 'status' }).then((x) => x.selftest && x), 6000, 'the self-test');
        assert.strictEqual(st.selftest.ok, false);
        await s.beat(true, true);
        const r = await s.ask({ cmd: 'start', mode: 'new' });
        assert.ok(r.engine.state === 'stopped' && /does not load/.test(r.refused), r.refused);
        const c = await check(server.address().port);
        assert.ok(c.code === 1 && /does not load here/.test(c.out), 'check.js passed an engine that does not load: ' + c.out);
    } finally { server.close(); await s.close(); }
    // and one that loads passes
    const good = service();
    const server2 = net.createServer();
    good.svc.serve(server2);
    await new Promise((r) => server2.listen(0, '127.0.0.1', r));
    try {
        const c = await check(server2.address().port);
        assert.ok(c.code === 0 && /answers/.test(c.out), c.out);
    } finally { server2.close(); await good.close(); }
});

test('gamepad: buttons are the engine\'s pad keys; sticks and triggers its axes, "up" turned round, with a dead zone', () => {
    const GP = require(path.join(SVC, 'gamepad')), P = require(path.join(SVC, 'pad'));
    const pad = (o) => Object.assign({ buttons: 0, lt: 0, rt: 0, lx: 0, ly: 0, rx: 0, ry: 0 }, o);
    assert.deepStrictEqual(GP.axes(pad({})), [0, 0, 0, 0, 0, 0]);
    // a real pad rests one to three thousand off centre: that is "in the middle"
    assert.deepStrictEqual(GP.axes(pad({ lx: 2900, ly: -1800, rx: 3100, ry: 900 })), [0, 0, 0, 0, 0, 0]);
    // the pad says right and up with the greater number; the engine wants side +, forward -, look up -, turn right +
    assert.deepStrictEqual(GP.axes(pad({ lx: 32767, ly: 32767, rx: 32767, ry: 32767 })), [32767, -32767, -32767, 32767, 0, 0]);
    assert.deepStrictEqual(GP.axes(pad({ lx: -32768, ly: -32768, rx: -32768, ry: -32768 })), [-32767, 32767, 32767, -32767, 0, 0]);
    assert.strictEqual(GP.axes(pad({ lx: 20000 }))[0], 19968, 'sticks are told in steps of 256');
    assert.deepStrictEqual(GP.axes(pad({ rt: 1023, lt: 512 })).slice(4), [32767, 16384]);
    assert.deepStrictEqual(GP.axisEvents(GP.axes(pad({})), GP.axes(pad({ lx: 20000, rt: 1023 }))), [['a', 0, 19968], ['a', 4, 32767]]);
    // buttons: the engine's own key numbers (K_A_BUTTON is 207, K_START_BUTTON 215, K_DPAD_UP 222)
    const B = P.PAD_FULL;
    assert.deepStrictEqual(GP.buttonEvents(0, B.A | B.UP), [['k', 207, 1], ['k', 222, 1]]);
    assert.deepStrictEqual(GP.buttonEvents(B.A | B.UP, B.UP | B.START), [['k', 207, 0], ['k', 215, 1]]);
    assert.deepStrictEqual(GP.buttonEvents(B.LS, B.LS), []);
    assert.deepStrictEqual(Object.keys(GP.KEY).sort(), Object.keys(B).sort(), 'a button pad.js tells has no key, or the other way round');
    // this copy of nes-idrive's pad.js reads an Xbox One S pad's report as that project's does
    const g = new P.Gip({ vid: 0x045e, pid: 0x02ea });
    assert.ok(g.start().some((p) => p[0] === 0x05 && p[1] === 0x20), 'no "power on" among the packets that switch the pad on');
    const d = Buffer.alloc(18);
    d[0] = 0x20; d[3] = 0x0e; d[4] = 0x10 | 0x04; d[5] = 0x01 | 0x40;
    d.writeUInt16LE(1023, 8); d.writeInt16LE(-5000, 10); d.writeInt16LE(30000, 12); d.writeInt16LE(123, 14); d.writeInt16LE(-32768, 16);
    assert.deepStrictEqual(g.packet(d).state, { buttons: B.A | B.START | B.UP | B.LS, lt: 0, rt: 1023, lx: -5000, ly: 30000, rx: 123, ry: -32768 });
});

test('service: a gamepad is read only while a game runs; what it tells reaches the engine, but never a game that stands still', async () => {
    const tmp0 = tmpdir('hl-pad-'), inputLog = path.join(tmp0, 'input.log'), padFile = path.join(tmp0, 'pad.jsonl');
    fs.writeFileSync(padFile, '');
    const dev = { kind: 'gip', node: '/dev/bus/usb/001/004', iface: 0, epIn: 0x82, epOut: 0x02, packet: 64, vid: 0x045e, pid: 0x02ea, name: 'Controller' };
    let plugged = true;
    const s = service({ service: { beatMs: 400, padScanMs: 150, padFind: () => (plugged ? [dev] : []),
        padPipe: [process.execPath, path.join(ROOT, 'test', 'fake-usbpipe.js')], padEnv: { FAKE_PAD_FILE: padFile, PATH: process.env.PATH || '' },
        engine: { env: { FAKE_INPUT_LOG: inputLog, FAKE_STAT_MS: '60' } } } });
    const beating = { parked: true, shown: true };
    const timer = setInterval(() => s.beat(beating.parked, beating.shown).catch(() => {}), 100);
    const pad = (st) => fs.appendFileSync(padFile, JSON.stringify(st) + '\n');
    const got = () => { try { return fs.readFileSync(inputLog, 'utf8').trim().split('\n').filter(Boolean); } catch (e) { return []; } };
    const count = (line) => got().filter((l) => l === line).length;
    const seen = async (line, n) => { try { await until(() => count(line) >= (n || 1), 3000, ''); } catch (e) { throw new Error('the engine did not get "' + line + '"' + (n ? ' ' + n + ' times' : '') + '; it got: ' + got().join(' | ')); } };
    const status = () => s.ask({ cmd: 'status' });
    // (the stand-in pad counts what is appended once it is switched on, and says when that is)
    const switchedOn = () => until(() => fs.existsSync(padFile + '.on'), 3000, 'the pad being switched on');
    try {
        let st = await until(() => status().then((x) => x.selftest && x.pad.program && x), 6000, 'the checks');
        // plugged in, no game: it is seen, and left alone
        assert.deepStrictEqual([st.pad.program.ok, st.pad.found, st.pad.name, st.pad.reading], [true, 1, 'Controller', false]);
        await s.beat(true, true);
        assert.strictEqual((await s.ask({ cmd: 'start', mode: 'new' })).refused, null);
        await until(s.state('game'), 6000, 'the game');
        await until(() => status().then((x) => x.pad.reading), 3000, 'the pad being read');
        await switchedOn();
        await seen('mgu_pad 1');
        // a button, the moment it changes
        pad({ buttons: ['A'] }); await seen('mgu_key 207 1');
        pad({ buttons: [] }); await seen('mgu_key 207 0');
        // the left stick up and to the right; the right trigger
        pad({ lx: 20000, ly: 32767, rt: 1023 });
        await seen('mgu_axis 0 19968'); await seen('mgu_axis 1 -32767'); await seen('mgu_axis 4 32767');
        // the Menu button: the game's menu over the game
        pad({ buttons: ['START'], lx: 20000, ly: 32767, rt: 1023 }); await seen('mgu_key 215 1');
        await until(s.state('paused'), 3000, 'the game\'s menu');
        pad({ lx: 20000, ly: 32767, rt: 1023 }); await seen('mgu_key 215 0');

        // the car moves with the stick still pushed: the engine is told everything is let go, then nothing more
        beating.parked = false;
        await until(() => status().then((x) => x.engine.held), 3000, 'the hold');
        await seen('mgu_axis 0 0'); await seen('mgu_axis 1 0'); await seen('mgu_axis 4 0');
        pad({ buttons: ['B'], lx: 20000, ly: 32767, rt: 1023 });
        await sleep(400);
        assert.strictEqual(count('mgu_key 208 1'), 0, 'a button reached a game that stands still');
        // parked again: what is held on the pad now is told again
        beating.parked = true;
        await until(() => status().then((x) => !x.engine.held), 3000, 'the game going on');
        await seen('mgu_key 208 1'); await seen('mgu_axis 0 19968', 2); await seen('mgu_axis 1 -32767', 2);

        // pulled out: everything let go, no error; plugged in again: read again
        plugged = false;
        pad({ unplug: true });
        st = await until(() => status().then((x) => !x.pad.reading && x), 3000, 'the pad going');
        assert.deepStrictEqual([st.pad.error, st.pad.found], [null, 0]);
        await seen('mgu_key 208 0'); await seen('mgu_axis 0 0', 2);
        assert.strictEqual(st.engine.state, 'running', 'the game ended with the pad');
        fs.unlinkSync(padFile + '.on');
        plugged = true;
        await until(() => status().then((x) => x.pad.reading), 3000, 'the pad being read again');
        await switchedOn();
        pad({ buttons: ['X'] }); await seen('mgu_key 209 1');
        // the game ends: the pad is let go
        await s.ask({ cmd: 'stop' });
        st = await until(() => status().then((x) => !x.pad.reading && x), 3000, 'the pad let go');
        assert.deepStrictEqual([st.engine.state, st.pad.found], ['stopped', 1]);
    } finally { clearInterval(timer); await s.close(); }
});

test('service: no stick, or a stick without the game: no game, and the reason is the stick\'s', async () => {
    for (const kind of ['none', 'empty']) {
        const s = service({ stick: kind });
        try {
            await until(() => s.ask({ cmd: 'status' }).then((x) => x.selftest), 6000, 'the self-test');
            await s.beat(true, true);
            const st = await s.ask({ cmd: 'start', mode: 'new' });
            assert.strictEqual(st.engine.state, 'stopped');
            assert.ok((kind === 'none' ? /No USB stick/ : /No valve folder/).test(st.refused), st.refused);
        } finally { await s.close(); }
    }
});

test('service: the temperature is the hottest sensor; the owner\'s car has no thermal zone, only the CPU\'s under hwmon', () => {
    const { temperature } = require(path.join(SVC, 'service'));
    const tmp = tmpdir('hl-temp-');
    const mkdirs = (d) => { if (!fs.existsSync(d)) { mkdirs(path.dirname(d)); fs.mkdirSync(d); } };   // (Node 8 has no "recursive")
    const put = (file, text) => { mkdirs(path.dirname(file)); fs.writeFileSync(file, text); };
    const thermal = path.join(tmp, 'thermal'), hwmon = path.join(tmp, 'hwmon');
    // nothing to read: no reading, and no error
    assert.strictEqual(temperature(thermal, hwmon), null);
    // the car as probed on 2026-11-20: cooling devices but no zone; coretemp with the package and four cores
    put(path.join(thermal, 'cooling_device0', 'type'), 'Processor\n');
    put(path.join(hwmon, 'hwmon0', 'name'), 'coretemp\n');
    [57000, 57000, 57000, 54000, 54000].forEach((v, i) => {
        put(path.join(hwmon, 'hwmon0', 'temp' + (i + 1) + '_input'), v + '\n');
        put(path.join(hwmon, 'hwmon0', 'temp' + (i + 1) + '_crit'), '110000\n');      // a limit, not a reading
    });
    assert.strictEqual(temperature(thermal, hwmon), 57);
    // a unit that has zones too: the hottest of both
    put(path.join(thermal, 'thermal_zone0', 'temp'), '61500\n');
    put(path.join(thermal, 'thermal_zone1', 'temp'), '-1\n');                         // a zone that tells nothing
    assert.strictEqual(temperature(thermal, hwmon), 62);
});

/* ---------------- the app: its store and pages ---------------- */

test('app: what the service and the engine say is copied into the app\'s own log, each line once', async () => {
    const { createStore } = require(path.join(APP, 'store'));
    const s = service({ service: { beatMs: 400, engine: { env: { FAKE_STAT_MS: '60' } } } });
    const got = [];
    const S = createStore({ ask: (m) => s.ask(m), settings: { get: () => '1280x480' }, log: { info: (x) => got.push(x), warn() {} } });
    const timer = setInterval(() => S.poll(true, true), 60);
    const has = (re) => () => got.some((x) => re.test(x));
    try {
        // the service's first words: who it runs as, where the game data and the saves are, whether the engine loads
        await until(has(/^service: [0-9:]+ clucraft-halflife \S+ \(uid /), 6000, 'the service\'s first line');
        await until(has(/^service: [0-9:]+ game data: .*; saves: /), 3000, 'the place of the data and the saves');
        await until(has(/^service: [0-9:]+ MGU selftest: passed/), 6000, 'the self-test');
        assert.ok(await S.play('new', true), S.toastText());
        // the engine's start, and the engine's own words
        await until(has(/^service: [0-9:]+ engine: started \(pid \d+, 1280x480, new, /), 3000, 'the start');
        await until(has(/^engine: a stand-in engine: 1280x480/), 3000, 'the engine\'s own line');
        await until(has(/^service: [0-9:]+ engine: running/), 3000, 'the engine running');
        await S.stop();
        await until(has(/^service: [0-9:]+ engine: ended \(code 0, the app asked\)/), 6000, 'the end');
        await sleep(300);
        const svcLines = got.filter((x) => /^service: /.test(x));
        assert.strictEqual(new Set(svcLines).size, svcLines.length, 'a line was copied twice:\n' + svcLines.join('\n'));
        assert.ok(!got.some((x) => /^service: .* engine says: /.test(x)), 'the engine\'s words were copied from both logs');
        // as many of the service's lines as it logged, no more
        const no = (await s.ask({ cmd: 'log' })).no;
        assert.strictEqual(svcLines.length, no.service - (await s.ask({ cmd: 'log' })).service.filter((x) => / engine says: /.test(x)).length);
    } finally { clearInterval(timer); await s.close(); }
});

test('app: from the launcher into a game and back, by taps; BACK leaves the game, which then stands still', async () => {
    const st = await createStage({ service: { beatMs: 400, engine: { env: { FAKE_STAT_MS: '60' } } } });
    const S = st.S;
    try {
        await st.until(() => S.st && S.st.selftest, 6000, 'the status');
        let f = st.frame();
        const keys = () => st.frame().targets.map((t) => t.key);
        assert.deepStrictEqual(keys().filter((k) => !/^page_/.test(k)), ['new', 'menu'], 'the launcher\'s buttons with nothing saved');
        assert.deepStrictEqual(st.ui.checks().map((r) => r[1]), ['Service', 'Engine', 'Game data', 'Saves', 'Gamepad', 'Car']);
        // everything a game needs is there; no pad is plugged in, which is said and stops nothing
        assert.ok(st.ui.checks().filter((r) => r[1] !== 'Gamepad').every((r) => r[0] === st.ui.C.green), JSON.stringify(st.ui.checks()));
        assert.deepStrictEqual(st.ui.checks().filter((r) => r[1] === 'Gamepad')[0].slice(0, 1), [st.ui.C.amber]);
        // not parked: nothing starts, and the page says why
        st.car.parked = false;
        await st.beat();
        st.frame(); await st.tap('new');
        assert.ok(/Park the car/.test(S.toastText()), S.toastText());
        assert.strictEqual(S.view, 'pages');
        st.car.parked = true;
        await st.beat();
        st.frame(); await st.tap('new');
        await st.until(() => S.view === 'game' && S.stat() && S.stat().state === 'game', 6000, 'the game');
        f = st.frame();
        assert.strictEqual(f.game, true);
        assert.deepStrictEqual(f.targets, [], 'the game view has buttons of its own');
        // BACK: the pages again; the app says "not on the screen" and the service holds the game
        assert.strictEqual(S.back(), true);
        await st.until(() => S.engine().held, 4000, 'the hold');
        assert.deepStrictEqual(keys().filter((k) => !/^page_/.test(k)), ['resume', 'stop']);
        st.tap('resume');
        await st.until(() => S.view === 'game' && !S.engine().held, 4000, 'the game going on');
        // driving off with the game up: no picture, and a line that says so
        st.car.parked = false;
        await st.until(() => S.engine().held, 4000, 'the hold');
        const cv = st.frame().cv;
        assert.ok(!hasVideo(cv), 'a picture is drawn while the car is not parked');
        st.car.parked = true;
        await st.until(() => !S.engine().held, 4000, 'the game going on');
        S.back();
        st.frame(); await st.tap('stop');
        await st.until(() => !S.running(), 8000, 'the game ending');
        assert.deepStrictEqual(keys().filter((k) => !/^page_/.test(k)), ['continue', 'new', 'menu'], 'a saved game is offered first');
        st.frame(); await st.tap('continue');
        await st.until(() => S.view === 'game' && S.stat() && S.stat().map === 'c0a0', 6000, 'the saved game');
        assert.strictEqual(S.back(), true); assert.strictEqual(S.back(), false, 'BACK on the first page is the HMI\'s');
    } finally { await st.close(); }
});

/** does a recording hold the video op? (record.js: op 19, 7 words) */
function hasVideo(cv) {
    const rec = require(path.join(ROOT, 'kit', 'runtime', 'record'));
    let found = false;
    const real = { video() { found = true; } };
    const w = new Proxy(real, { get: (t, k) => (k in t ? t[k] : () => w) });
    try { rec.play(cv.words(), w, 1); } catch (e) { /* the player wants a real canvas for some ops: the video op is all that is asked */ }
    return found;
}

test('app: with the setting "Sound" off a game starts silent, and the service says which kind of game runs', async () => {
    const st = await createStage({ settings: { sound: false }, service: { beatMs: 400, engine: { env: { FAKE_STAT_MS: '60' } } } });
    try {
        await st.until(() => st.S.st && st.S.st.selftest, 6000, 'the self-test');
        assert.strictEqual(st.S.st.sound, true, 'no game runs: the service can make sound');
        assert.ok(await st.S.play('new', true), st.S.toastText());
        await st.until(() => st.S.stat() && st.S.stat().state === 'game', 6000, 'the game');
        // the engine was started without a sound device (the stand-in tells it as the real one does), and main.js
        // routes the speakers only while this is true
        assert.deepStrictEqual([st.S.stat().sound, st.S.st.sound, st.S.engine().want.sound], [0, false, false]);
        await st.S.stop();
        await st.until(() => !st.S.running(), 6000, 'the end');
        // the next start, with the setting on
        st.settings.set('sound', true);
        assert.ok(await st.S.play('new', true), st.S.toastText());
        await st.until(() => st.S.stat() && st.S.stat().state === 'game', 6000, 'the game');
        assert.deepStrictEqual([st.S.stat().sound, st.S.st.sound, st.S.engine().want.sound], [1, true, true]);
    } finally { await st.close(); }
});

test('app: every page draws, with the service missing, not open yet, without a stick and with an engine that fails', async () => {
    const draw = async (st, pages) => {
        for (const p of pages || ['home', 'status', 'log']) {
            st.S.go(p);
            await st.settle(120);
            const png = st.png();
            assert.ok(png.length > 2000 && png.slice(1, 4).toString() === 'PNG', 'page ' + p + ' is no picture');
        }
        st.S.go('home');
    };
    // as it should be, a game running, its view and the pages over it
    let st = await createStage({ settings: { stats: true }, service: { engine: { env: { FAKE_STAT_MS: '60' } } } });
    try {
        await st.until(() => st.S.st && st.S.st.selftest, 6000, 'the status');
        await draw(st);
        st.frame(); await st.tap('page_status');
        assert.strictEqual(st.S.page, 'status');
        st.frame(); await st.tap('page_log');
        await st.until(() => st.S.logs, 3000, 'the log');
        assert.ok(st.S.logs.service.some((l) => /clucraft-halflife 0\.1\.0/.test(l)), st.S.logs.service.join('|'));
        st.S.go('home'); st.frame(); await st.tap('menu');
        await st.until(() => st.S.view === 'game' && st.S.stat(), 6000, 'the game');
        await st.settle(300);
        assert.ok(st.png().length > 2000);
        st.S.leave();
        await draw(st);
        // (read from /proc, which only Linux has)
        if (fs.existsSync('/proc/self/stat')) assert.ok(st.S.st.sys && st.S.st.sys.rssMb > 0, 'the status has no word on the engine\'s load');
    } finally { await st.close(); }
    // no stick; a stick without the game; an engine that does not load
    for (const o of [{ stick: 'none' }, { stick: 'empty' }, { service: { engine: { env: { FAKE_SELFTEST_FAIL: '1' } } } }]) {
        st = await createStage(o);
        try {
            await st.until(() => st.S.st && st.S.st.selftest, 6000, 'the status');
            await draw(st, ['home', 'status']);
            assert.ok(st.ui.checks().filter((r) => r[1] !== 'Gamepad').some((r) => r[0] !== st.ui.C.green), 'nothing on the launcher says what is wrong');
            st.frame(); await st.tap('new');
            assert.ok(st.S.toastText() && st.S.view === 'pages', 'a game started');
        } finally { await st.close(); }
    }
    // the service not installed, and installed but not open to the app before the head unit's restart
    for (const code of ['ENOSVC', 'EACCES', 'ETIMEDOUT']) {
        st = await createStage({ ask: () => Promise.reject(Object.assign(new Error(code === 'ENOSVC' ? 'the Half-Life service is not installed' : code === 'EACCES' ? 'the Half-Life service is not open to this app yet: restart the head unit once' : 'the Half-Life service did not answer'), { code })) });
        try {
            await st.beat();
            await draw(st);
            assert.deepStrictEqual(st.ui.checks()[0].slice(0, 2), [st.ui.C.red, 'Service']);
            st.frame(); await st.tap('new');
            assert.ok(/service/.test(st.S.toastText()), st.S.toastText());
        } finally { await st.close(); }
    }
});

/* ---------------- main.js, from the staged package ---------------- */

test('main.js: starts on a stand-in head unit from the staged package; the beat, the full view, the controller, the speakers, a silent game', async () => {
    const py = ['python3', 'python'].filter((p) => { try { return spawnSync(p, ['--version']).status === 0; } catch (e) { return false; } })[0];
    if (!py) { print('     (skipped: no Python 3 for the kit\'s build)'); return; }
    // the kit's build needs an SDK folder: a clearly marked stand-in, never loaded here and refused by a car build
    const sdk = path.join(ROOT, 'oap-sdk');
    if (!fs.existsSync(path.join(sdk, 'index.js'))) {
        fs.mkdirSync(sdk);
        fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ name: 'oap-sdk', version: '0.0.0-pc-placeholder', description: 'NOT BMW\'s SDK: an empty stand-in so the kit\'s build can stage the app on a PC.' }, null, 2) + '\n');
        fs.writeFileSync(path.join(sdk, 'index.js'), '\'use strict\';\n// NOT BMW\'s SDK: an empty stand-in so the kit\'s build can stage the app on a PC (which never loads it).\nthrow new Error(\'oap-sdk PC placeholder\');\n');
    }
    const b = spawnSync(py, [path.join(ROOT, 'kit', 'tools', 'build.py'), 'clucraft_halflife'], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(b.status, 0, 'the kit\'s build failed:\n' + b.stdout + b.stderr);
    const JS = path.join(ROOT, 'dist', 'clucraft_halflife', 'source', 'javascript');
    ['app.js', 'store.js', 'ui.js', 'svc.js', 'drivegate.js', 'caraudio.js', 'fullview.js', 'input.js', 'fonts.pack', path.join('kit', 'fullscreen.js')]
        .forEach((f) => assert.ok(fs.existsSync(path.join(JS, f)), 'the package has no ' + f));

    // the service on a local port, for the package's own svc.js
    const tmp0 = tmpdir('hl-main-'), inputLog = path.join(tmp0, 'input.log');
    const s = service({ service: { beatMs: 1500, engine: { env: { FAKE_INPUT_LOG: inputLog, FAKE_STAT_MS: '60' } } } });
    const server = net.createServer();
    s.svc.serve(server);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    process.env.HLD_SOCK = String(server.address().port);

    // the head unit: what main.js asks of the kit
    const EventEmitter = require('events');
    const logged = { error: [], warn: [], info: [] };
    const log = { info: (x) => logged.info.push(String(x)), warn: (x) => logged.warn.push(String(x)), error: (x) => logged.error.push(String(x)), debug() {} };
    const values = { size: '640x240', touch: false, stats: false }, listeners = [];
    const settings = { get: (k) => values[k], set(k, v) { values[k] = v; listeners.forEach((fn) => fn(k, v)); }, onChange(fn) { listeners.push(fn); } };
    // the car's audio manager: it keeps the connections it was asked for
    const watched = {}, calls = [];
    let mains = [], mainId = 41;
    const signals = {
        watch(iface, inst, handlers) { watched[iface] = handlers; return Promise.resolve({ available: true }); },
        proxy(iface) { return Promise.resolve({ iface }); },
        call(p, method, params) {
            calls.push({ iface: p.iface, method, params });
            if (method === 'getListMainConnections') return Promise.resolve(mains.slice());
            if (method === 'connect') { mains.push({ mainConnectionID: ++mainId, sourceID: params.sourceID, sinkID: params.sinkID }); return Promise.resolve({ amError: 'E_OK', mainConnectionID: mainId }); }
            if (method === 'disconnect') mains = mains.filter((c) => c.mainConnectionID !== params.mainConnectionID);
            return Promise.resolve({ amError: 'E_OK' });
        },
    };
    const record = require(path.join(JS, 'kit', 'record'));
    const PLACE = require(path.join(ROOT, 'tools', 'stage')).PLACE;
    class Gpu extends EventEmitter {
        constructor() { super(); this.ready = true; this.native = true; this.touch = true; this.info = { video: true, touch: true, controller: true }; this.visible = true; this.videos = []; this.frames = 0; this.waiting = false; this.claims = []; this.grabs = []; }
        connect() { setImmediate(() => this.emit('ready')); return this; }
        place() {} close() {}
        claim(r) { this.claims.push(r); } grab(on) { this.grabs.push(on); }
        show(v) { this.visible = !!v; }
        video(id, file) { this.videos.push([id, file]); return true; }
        frame() { this.frames++; }
    }
    const gpu = new Gpu(), fullGpus = [];
    const dataDir = tmpdir('hl-app-data-');
    let loopFn = null, backFn = null, lastCv = null;
    const clicks = {};
    const ctx = {
        log, settings, signals, dataDir,
        ui: { onClick(n, fn) { clicks[n] = fn; }, isVisible: (n) => n === 'MAIN', hasFocus: () => true, onVisible() {}, image(n, cv) { lastCv = cv; return Promise.resolve(); } },
        display: { gpu, place: PLACE, closeSheet() {}, _syncVisible() { gpu.visible = true; } },
        canvas(w, h) { const cv = new record.Recorder(w, h, { textScale: PLACE.scale }); cv.place = PLACE; cv.own = true; cv.extra = PLACE.extra; cv.chrome = null; return cv; },
        loop(name, fps, fn) { loopFn = fn; return { stop() {} }; },
        theme: () => ({}), hideButton() {},
        onTouch() {}, onBack(fn) { backFn = fn; }, onScroll() {},
    };
    let impl = null;
    const realLoad = Module._load;
    Module._load = function (req, parent) {
        if (parent && parent.filename && parent.filename.indexOf(JS) === 0 && parent.filename.indexOf(path.join(JS, 'kit')) !== 0) {
            if (req === './kit/mgu') return { run(i) { impl = i; } };
            if (req === './kit/renderd') return { RenderClient: class extends Gpu { constructor() { super(); fullGpus.push(this); } } };
        }
        return realLoad.apply(this, arguments);
    };
    // the engine's frame file "exists" while a game runs: main.js looks for it at its fixed place
    const realStat = fs.statSync;
    fs.statSync = function (p) { if (p === '/dev/shm/mgu-video-clucraft-halflife') { if (!fs.existsSync(s.video)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return { ino: realStat(s.video).ino || 77 }; } return realStat.apply(fs, arguments); };
    const timers = [], realInterval = global.setInterval;
    global.setInterval = function () { const t = realInterval.apply(this, arguments); timers.push(t); return t; };
    try {
        require(path.join(JS, 'app.js'));
        assert.ok(impl && typeof impl.start === 'function', 'main.js did not hand the kit its start');
        await impl.start(ctx);
        global.setInterval = realInterval;
        assert.ok(loopFn && backFn, 'main.js did not take the loop and back');
        ['BTN_PLAY', 'BTN_STOP', 'BTN_STATUS'].forEach((n) => assert.ok(clicks[n], 'no handler for ' + n));
        assert.ok(watched['de.bmw.infotainment.vehicle.Vehicle2'] && watched['de.bmw.infrastructure.VehicleInformation'], 'the drive gate does not watch the car');
        const speed = (kmh) => watched['de.bmw.infotainment.vehicle.Vehicle2'].statusCarSpeed2({ speedVehicleCentreOfGravity: Math.round(kmh * 64) });
        const gear = (g) => watched['de.bmw.infrastructure.VehicleInformation'].statusGearboxDrive({ statusActualStageDrive: g });
        const frames = async (ms) => { const t = Date.now() + ms; while (Date.now() < t) { await loopFn(); await sleep(60); } };
        const tap = (key) => { const t = lastCv.targets.filter((x) => x.key === key)[0]; assert.ok(t, 'no target ' + key + ' (' + lastCv.targets.map((x) => x.key).join(' ') + ')'); return t.run(); };
        const status = () => s.ask({ cmd: 'status' });

        // nothing known about the car: the app beats "not parked", and a tap on "New game" starts nothing
        await frames(1200);
        let st = await status();
        assert.deepStrictEqual([st.gate.parked, st.gate.fresh], [false, true], 'the app does not beat');
        tap('new');
        await frames(400);
        assert.strictEqual((await status()).engine.state, 'stopped', 'a game started without a parked car');

        speed(0); gear('P');
        await frames(700);
        assert.strictEqual((await status()).gate.parked, true);
        tap('new');
        await frames(2500);
        st = await status();
        assert.deepStrictEqual([st.engine.state, st.engine.stat.state, st.engine.stat.w, st.gate.shown, st.engine.held], ['running', 'game', 640, true, false], JSON.stringify(st.engine));
        assert.strictEqual(fullGpus.length, 1, 'no second connection for the full view');
        assert.ok(fullGpus[0].frames > 3, 'the full view drew nothing');
        assert.strictEqual(gpu.visible, false, 'the page is not hidden under the full view');
        assert.ok(gpu.videos.length === 1 && fullGpus[0].videos.length === 1 && gpu.videos[0][1] === '/dev/shm/mgu-video-clucraft-halflife', 'the frame file was not named to the renderer');
        assert.deepStrictEqual(fullGpus[0].claims[fullGpus[0].claims.length - 1], [], 'touch is claimed with its setting off');
        assert.strictEqual(fullGpus[0].grabs[fullGpus[0].grabs.length - 1], true, 'the controller is not grabbed');
        const con = calls.filter((c) => c.method === 'connect')[0];
        assert.ok(con && con.params.sourceID === 287 && con.params.sinkID === 1024, 'the sound was not routed to the speakers: ' + JSON.stringify(calls.map((c) => c.method)));

        // the controller on the full view: pushed left is Escape, the game's menu over the game
        fullGpus[0].emit('ccu', { frontRotaryEncoderOperation: 10, frontRotaryEncoderPushButton: 0, frontRotaryEncoderDeflection: 0 });
        fullGpus[0].emit('ccu', { frontRotaryEncoderOperation: 10, frontRotaryEncoderPushButton: 0, frontRotaryEncoderDeflection: 10 });
        await frames(600);
        assert.strictEqual((await status()).engine.stat.state, 'paused', 'the controller did not reach the game');
        fullGpus[0].emit('ccu', { frontRotaryEncoderOperation: 12, frontRotaryEncoderPushButton: 0, frontRotaryEncoderDeflection: 0 });
        await frames(400);
        assert.deepStrictEqual(fs.readFileSync(inputLog, 'utf8').trim().split('\n'), ['mgu_key 27 1', 'mgu_key 27 0', 'mgu_key 129 1', 'mgu_key 129 0', 'mgu_key 129 1', 'mgu_key 129 0']);
        // a finger: nothing while the setting is off; with it, the screen is claimed and the finger goes to the game
        fullGpus[0].emit('touch', 1, 800, 300);
        await frames(300);
        settings.set('touch', true);
        await frames(700);
        assert.strictEqual(fullGpus[0].claims[fullGpus[0].claims.length - 1].length, 1, 'touch is not claimed with its setting on');
        fullGpus[0].emit('touch', 1, 800, 300);
        await frames(400);
        assert.strictEqual(fs.readFileSync(inputLog, 'utf8').trim().split('\n').pop(), 'mgu_touch 0 0.5000 0.5000');

        // the car moves: the app says so, the service holds the game, the speakers are given back
        speed(30); gear('D');
        await frames(1500);
        st = await status();
        assert.deepStrictEqual([st.gate.parked, st.engine.held], [false, true]);
        assert.ok(calls.some((c) => c.method === 'disconnect') && mains.length === 0, 'moving: the speakers were not given back');
        speed(0); gear('P');
        await frames(1500);
        assert.strictEqual((await status()).engine.held, false);
        assert.strictEqual(mains.length, 1, 'parked again: the speakers were not asked for again');

        // a short press is Enter, told when the knob is let go; held down for a second it leaves the game view
        // instead, and no Enter goes to the game
        const keysSoFar = () => fs.readFileSync(inputLog, 'utf8').trim().split('\n').filter((l) => /^mgu_key 13 /.test(l)).length;
        fullGpus[0].emit('ccu', { frontRotaryEncoderOperation: 12, frontRotaryEncoderPushButton: 1, frontRotaryEncoderDeflection: 0 });
        fullGpus[0].emit('ccu', { frontRotaryEncoderOperation: 12, frontRotaryEncoderPushButton: 0, frontRotaryEncoderDeflection: 0 });
        await frames(400);
        assert.strictEqual(keysSoFar(), 2, 'a short press is not Enter');
        fullGpus[0].emit('ccu', { frontRotaryEncoderOperation: 12, frontRotaryEncoderPushButton: 1, frontRotaryEncoderDeflection: 0 });
        await frames(1400);
        fullGpus[0].emit('ccu', { frontRotaryEncoderOperation: 12, frontRotaryEncoderPushButton: 0, frontRotaryEncoderDeflection: 0 });
        await frames(1200);
        st = await status();
        assert.deepStrictEqual([st.gate.shown, st.engine.held, gpu.visible, keysSoFar()], [false, true, true, 2], 'holding the controller down did not leave the game view');
        tap('resume');
        await frames(1500);
        assert.deepStrictEqual([(await status()).gate.shown, gpu.visible], [true, false]);

        // the kit's back does the same: the page is back, the game stands still
        backFn();
        await frames(1500);
        st = await status();
        assert.deepStrictEqual([st.gate.shown, st.engine.held, gpu.visible], [false, true, true]);
        assert.ok(lastCv.targets.some((t) => t.key === 'resume'), 'the page does not offer the game: ' + lastCv.targets.map((t) => t.key).join(' '));
        clicks.BTN_STOP();
        await until(() => status().then((x) => x.engine.state === 'stopped'), 12000, 'the game ending');
        await frames(600);
        assert.strictEqual((await status()).saves.canContinue, true);

        // the setting "Sound" off: the next game starts silent, and the speakers are left alone
        settings.set('sound', false);
        const connects = calls.filter((c) => c.method === 'connect').length;
        await frames(400);
        tap('new');
        await frames(2500);
        st = await status();
        assert.deepStrictEqual([st.engine.state, st.engine.stat.sound, st.sound], ['running', 0, false], JSON.stringify(st.engine));
        assert.deepStrictEqual([calls.filter((c) => c.method === 'connect').length, mains.length], [connects, 0], 'a silent game asked for the speakers');
        clicks.BTN_STOP();
        await until(() => status().then((x) => x.engine.state === 'stopped'), 12000, 'the silent game ending');
        await frames(400);
        assert.deepStrictEqual(logged.error, [], 'main.js logged errors');
        assert.ok(logged.info.some((l) => /^started 0\.1\.0/.test(l)), logged.info.join('\n'));
    } finally {
        global.setInterval = realInterval;
        timers.forEach(clearInterval);
        Module._load = realLoad; fs.statSync = realStat; delete process.env.HLD_SOCK;
        server.close();
        await s.close();
    }
});

/* ---------------- the repository ---------------- */

test('emulator: what tools/emu.js changes in the kit is there to change, once', () => {
    const E = require(path.join(ROOT, 'tools', 'emu'));
    assert.ok(/^[0-9a-f]{40}$/.test(E.EMU_COMMIT), 'the emulator is pinned to a commit');
    const mine = E.ADAPT.filter((a) => a[0] === 'kit/runtime/renderd.js');
    assert.strictEqual(mine.length, 1);
    assert.strictEqual(fs.readFileSync(path.join(ROOT, mine[0][0]), 'utf8').split(mine[0][2]).length, 2, 'renderd.js has the line once');
    const kit = [process.env.IDRIVE7_APPS, path.join(ROOT, 'vendor', 'idrive7-apps')].filter(Boolean).find((d) => fs.existsSync(path.join(d, 'kit', 'tools', 'emu.js')));
    for (const [file, what, from, to] of E.ADAPT) {
        assert.ok(from !== to && to.length > from.length - 40 && what, file);
        if (!kit || file === 'kit/runtime/renderd.js') continue;
        assert.strictEqual(fs.readFileSync(path.join(kit, file), 'utf8').replace(/\r\n/g, '\n').split(from).length, 2, file + ': ' + what);
    }
    const src = fs.readFileSync(path.join(ROOT, 'tools', 'emu.js'), 'utf8');
    assert.ok(/HLD_SOCK: backendPort/.test(src) && /NOT BMW's SDK/.test(src));
});

test('repository: versions and manifests agree; the engine\'s files are the ones named; no game data and nothing of BMW\'s is in it', () => {
    const j = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    const app = j('apps/clucraft_halflife/app.json'), comp = j('native/clucraft-halflife/component.json'), repo = j('mgu-repo.json'), pkg = j('package.json');
    const ver = (f, re) => (re.exec(fs.readFileSync(path.join(ROOT, f), 'utf8')) || [])[1];
    assert.strictEqual(ver('apps/clucraft_halflife/main.js', /const VERSION = '([\d.]+)'/), app.version, 'main.js and app.json');
    assert.strictEqual(ver('native/clucraft-halflife/service.js', /const VERSION = '([\d.]+)'/), comp.version, 'service.js and component.json');
    assert.strictEqual(app.requires['clucraft-halflife'], comp.version, 'the app asks for another service version');
    assert.strictEqual(pkg.version, app.version);
    assert.strictEqual(repo.apps.manifest, 'app.json');
    assert.deepStrictEqual(repo.components.map((c) => c.id + ':' + c.path), ['clucraft-halflife:native/clucraft-halflife']);
    assert.deepStrictEqual([comp.id, comp.kind, comp.uninstallable, comp.internet], ['clucraft-halflife', 'tool', true, undefined]);
    // the shape the Store's packer and installer take (mgu-store deploy/hu and deploy/README.md, "component.json")
    assert.ok(/^[a-z0-9][a-z0-9-]*$/.test(comp.id) && /^\d+\.\d+\.\d+$/.test(comp.version), 'the tool\'s id or version');
    const safeRel = (p) => typeof p === 'string' && p.length > 0 && p[0] !== '/' && p.split('/').every((x) => x && x !== '.' && x !== '..') && p.indexOf('\\') < 0;
    comp.files.forEach((f) => assert.ok(safeRel(f.path) && safeRel(f.from) && /^[0-7]{3,4}$/.test(f.mode), 'files[] entry ' + JSON.stringify(f)));
    comp.units.forEach((u) => assert.ok(/^[A-Za-z0-9_.@-]+\.(service|socket)$/.test(u.name) && safeRel(u.from), 'units[] entry ' + JSON.stringify(u)));
    comp.crashNames.forEach((n) => assert.ok(/^[A-Za-z0-9._+-]+$/.test(n) && n.length <= 15, 'crash name ' + n + ' (a process name holds 15 characters)'));
    comp.recmgr.forEach((n) => assert.ok(/^[A-Za-z0-9:._+@-]+$/.test(n), 'recmgr name ' + n));
    assert.deepStrictEqual([comp.check, comp.deactivate, comp.restart], [['check.js'], ['node', 'cleanup.js'], ['clucraft-halflife.service']]);
    assert.ok(comp.requires['mgu-deploy'], 'deactivate needs mgu-deploy 0.7.0 or later');
    assert.ok(fs.statSync(path.join(APP, 'icon.png')).size <= 128 * 1024, 'the icon is over the Store\'s 128 KiB');
    assert.ok(/^[a-z0-9_]+$/.test(app.id) && app.mguHmi.join() === 'ID7' && comp.mguHmi.join() === 'ID7');
    // every script of the tool is in its manifest (a file left out would be missing on the car)
    fs.readdirSync(SVC).filter((f) => /\.js$/.test(f)).forEach((f) => assert.ok(comp.files.some((x) => x.from === f), f + ' is not in component.json'));
    // the engine's files: each one the service needs is shipped, only the launcher is executable (the Store lists
    // executable programs with the crash handler by name), and its name is the one the manifest gives the handler
    const { FILES } = require(path.join(SVC, 'engine'));
    FILES.forEach((f) => assert.ok(comp.files.some((x) => x.path === 'bin/' + f), 'bin/' + f + ' is not in component.json'));
    const { PROGRAM } = require(path.join(SVC, 'gamepad'));
    assert.deepStrictEqual(comp.files.filter((x) => x.mode === '0755').map((x) => x.path), ['bin/clucraft-hl', 'bin/' + PROGRAM]);
    assert.deepStrictEqual(comp.crashNames, ['clucraft-hl', PROGRAM]);
    // the gamepad's program: built from the source in port/usbpipe, which is nes-idrive's, and (with the same Go)
    // byte for byte that project's own
    const padJson = path.join(SVC, 'bin', 'PAD.json');
    if (fs.existsSync(padJson)) {
        const P = JSON.parse(fs.readFileSync(padJson, 'utf8'));
        assert.strictEqual(P.file.name, PROGRAM);
        assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(path.join(SVC, 'bin', PROGRAM))).digest('hex'), P.file.sha256, 'bin/' + PROGRAM + ' is not the file PAD.json describes');
        assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'port', 'usbpipe', 'main.go'), 'utf8').replace(/\r\n/g, '\n')).digest('hex'), P.source.sha256, 'port/usbpipe/main.go changed since the program was built: node tools/build/build-pad.js');
        assert.strictEqual(P.sameAsOrigin, true, 'the program is not the same bytes as nes-idrive\'s (it was built with ' + P.built.go + ')');
    }
    assert.ok(/^SupplementaryGroups=mgu_alsa mgu_usb$/m.test(fs.readFileSync(path.join(SVC, 'systemd', 'clucraft-halflife.service'), 'utf8')), 'the service lacks the group of the pad\'s USB node');
    assert.ok(comp.files.some((x) => x.path === 'bin/LICENSE.hlsdk'), 'the game libraries ship without their licence');
    // the units: never root, never at boot, with limits and no core dump
    const unit = fs.readFileSync(path.join(SVC, 'systemd', 'clucraft-halflife.service'), 'utf8');
    ['User=nobody', 'LimitCORE=1', 'CPUQuota=', 'MemoryLimit=', 'TasksMax=', 'Restart=no'].forEach((l) => assert.ok(unit.split('\n').some((x) => x.indexOf(l) === 0), 'the service unit has no ' + l));
    assert.ok(!/^\[Install\]/m.test(unit) && !/^ExecStart\S*=[-@]*\+/m.test(unit), 'the service is enabled at boot, or runs a command with full privileges');
    assert.deepStrictEqual(comp.enable, [{ unit: 'clucraft-halflife.socket', target: 'sockets.target' }]);
    const missing = comp.files.concat(comp.units).filter((f) => !fs.existsSync(path.join(SVC, f.from))).map((f) => f.from);
    if (missing.length && missing.every((f) => /^bin\//.test(f))) print('     (the engine is not staged: bash tools/build/stage.sh after a build; ' + missing.length + ' files of bin/ are missing)');
    else assert.deepStrictEqual(missing, [], 'component.json names files that are not there');
    // staged: the files are the build's own, by its manifest
    const build = path.join(SVC, 'bin', 'BUILD.json');
    if (fs.existsSync(build)) {
        const B = JSON.parse(fs.readFileSync(build, 'utf8'));
        const pins = fs.readFileSync(path.join(ROOT, 'port', 'pins.env'), 'utf8');
        assert.ok(pins.indexOf('ENGINE_REV=' + B.engine.commit) >= 0 && pins.indexOf('HLSDK_REV=' + B.hlsdk.commit) >= 0, 'bin/ was built from other commits than port/pins.env names');
        Object.keys(B.files).forEach((f) => {
            const sum = crypto.createHash('sha256').update(fs.readFileSync(path.join(SVC, 'bin', f))).digest('hex');
            assert.strictEqual(sum, B.files[f].sha256, 'bin/' + f + ' is not the file BUILD.json describes');
        });
        assert.deepStrictEqual(Object.keys(B.files).sort(), FILES.concat(['LICENSE.hlsdk']).sort());
        const patch = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'port', 'engine.patch'), 'utf8').replace(/\r\n/g, '\n')).digest('hex');
        assert.strictEqual(B.engine.patch, patch, 'port/engine.patch changed since bin/ was built: build and stage again');
        // this project's own engine files, hashed as tools/build/in-container.sh does: each file's path, then its text
        const h = crypto.createHash('sha256'), dirs = [];
        (function collect(d) { dirs.push(d); fs.readdirSync(d).forEach((n) => { if (fs.statSync(path.join(d, n)).isDirectory()) collect(path.join(d, n)); }); })(path.join(ROOT, 'port', 'engine'));
        const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
        dirs.sort((a, b) => (rel(a) < rel(b) ? -1 : 1)).forEach((d) => fs.readdirSync(d).sort().forEach((n) => {
            const p = path.join(d, n);
            if (fs.statSync(p).isDirectory()) return;
            h.update(rel(p) + '\n');
            h.update(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'));
        }));
        assert.strictEqual(B.engine.backend, h.digest('hex'), 'port/engine/ changed since bin/ was built: build and stage again');
    }
    assert.strictEqual(app.settings.filter((x) => x.key === 'touch')[0].default, false);
    // Found on the owner's car with nes-idrive: only what goes through the GPU renderer shows there (pictures pushed
    // to the HMI directly are refused), and the kit's renderer path serves an app's first canvas screen only. So:
    // one screen, a canvas, with everything drawn on it, and a renderer required. (The game itself is not a
    // screen of the kit's: it is a second connection to the renderer, as plex-idrive's player is.)
    assert.deepStrictEqual(app.screens.map((x) => x.name + ':' + x.kind), ['MAIN:canvas'], 'the app must have one canvas screen and no other');
    assert.deepStrictEqual(app.needs, ['renderer']);
    const mainJs = fs.readFileSync(path.join(APP, 'main.js'), 'utf8');
    assert.deepStrictEqual((mainJs.match(/ctx\.loop\('([A-Z_]+)'/g) || []), ["ctx.loop('MAIN'"], 'main.js draws on another screen than MAIN');
    assert.deepStrictEqual((mainJs.match(/ui\.image\('([A-Z_]+)'/g) || []), ["ui.image('MAIN_GFX'"], 'main.js pushes a picture to another screen than MAIN');
    // what must never be committed
    const ignored = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    ['valve/', '*.bsp', '*.wad', '*.sav', '/oap-sdk/', 'dist/', 'id_*'].forEach((p) => assert.ok(ignored.split('\n').indexOf(p) >= 0, '.gitignore does not name ' + p));
    const sources = [], all = [];
    const walk = (d) => fs.readdirSync(d).forEach((f) => {
        const p = path.join(d, f);
        if (/^(\.git|node_modules|dist|oap-sdk|\.cache|vendor|out)$/.test(f)) return;
        if (fs.statSync(p).isDirectory()) walk(p); else { all.push(p); if (/\.(js|json|md|service|socket|sh|c|h)$/.test(f)) sources.push(p); }
    });
    walk(ROOT);
    // no file of the game: by name, and nothing large that is not the engine's own
    const game = all.filter((p) => /\.(bsp|wad|pak|mdl|spr|sav|dem|hpk)$/i.test(p) || /(^|[\\/])(liblist\.gam|steam\.inf)$/i.test(p) || /[\\/]valve[\\/]/i.test(p));
    assert.deepStrictEqual(game.map((p) => path.relative(ROOT, p)), [], 'game data is in the repository');
    const big = all.filter((p) => fs.statSync(p).size > 600 * 1024 && path.relative(SVC, p).indexOf('bin') !== 0 && !/fonts[\\/].*\.json$/.test(p));
    assert.deepStrictEqual(big.map((p) => path.relative(ROOT, p)), [], 'large files outside the engine\'s folder');
    // the Store downloads the repository as one tarball of 64 MiB at most
    const total = all.reduce((a, p) => a + fs.statSync(p).size, 0);
    assert.ok(total < 40 * 1024 * 1024, 'the repository holds ' + Math.round(total / 1048576) + ' MiB');
    sources.filter((p) => p !== __filename).forEach((p) => {
        const t = fs.readFileSync(p, 'utf8');
        assert.ok(!/isParked\(\)\s*\{[^}]*return true;/.test(t) && !/FORCES "PARKED"/.test(t), path.relative(ROOT, p) + ' forces "parked"');
        assert.ok(!/\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}(?:\.\d{1,3})?\b/.test(t.replace(/127\.0\.0\.\d/g, '')) || /0\.0\.0-/.test(t), path.relative(ROOT, p) + ' holds a private network address');
        assert.ok(!/BEGIN [A-Z ]*PRIVATE KEY/.test(t), path.relative(ROOT, p) + ' holds a key');
    });
});

/* ---------------- run ---------------- */
(async () => {
    const only = process.argv[2];
    let failed = 0, ran = 0;
    for (const t of tests) {
        if (only && t.name.indexOf(only) < 0) continue;
        ran++;
        const t0 = Date.now();
        try { await t.fn(); print('ok   ' + t.name + '  (' + (Date.now() - t0) + ' ms)'); }
        catch (e) { failed++; print('FAIL ' + t.name + '\n     ' + String(e && e.stack || e).split('\n').slice(0, 8).join('\n     ')); }
    }
    print('\n' + (ran - failed) + ' of ' + ran + ' passed on Node ' + process.version);
    setTimeout(() => process.exit(failed ? 1 : 0), 200);
})();
