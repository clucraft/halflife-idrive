'use strict';
/**
 * stage.js - the Half-Life app's pages drawn on a PC, for tools/shots.js and the tests: the real store and ui (and
 * the kit's own recorder, fonts and software canvas), the real service (native/clucraft-halflife) with the
 * stand-in engine (test/fake-engine.js) and an invented stick, and a stand-in for what main.js gets from the head
 * unit (the page's place on the 1920 x 720 screen, the car).
 *
 *   const st = await createStage({ stick: 'ro' | 'rw' | 'none' | 'empty', engineEnv, service });
 *   st.S, st.ui, st.svc, st.car { parked, shown }
 *   st.beat()                the app's beat, as main.js sends it
 *   st.frame()               draws the page (or the game view) as main.js does; returns { cv, targets, game }
 *   st.tap(key)              runs the target `key` of the last frame (throws when there is none)
 *   st.png()                 the last frame as a 1920 x 720 PNG (Buffer)
 *   st.until(fn, ms, what)   beats and draws until fn() says so
 *   st.close()
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'apps', 'clucraft_halflife');
const KIT = path.join(ROOT, 'kit', 'runtime');
const SVC = path.join(ROOT, 'native', 'clucraft-halflife');
const record = require(path.join(KIT, 'record'));
const fonts = require(path.join(KIT, 'fonts'));
const { Canvas } = require(path.join(KIT, 'canvas'));
const FS = require(path.join(KIT, 'fullscreen'));
const { createService } = require(path.join(SVC, 'service'));
const GD = require(path.join(SVC, 'gamedata'));
const { createStore } = require(path.join(APP, 'store'));
const { createUi } = require(path.join(APP, 'ui'));
const DG = require(path.join(APP, 'drivegate'));

const W = 1600, H = 520, VID = 7;
// the full-screen layout on the 1920 x 720 display, as kit/runtime/display.js places a page with no bar under it
const PLACE = { x: 0, y: 0, w: 1920, h: 720, full: true, scale: 1.165, ox: 70, oy: 51, extra: 49 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAD = { kind: 'gip', node: '/dev/bus/usb/001/004', iface: 0, epIn: 0x82, epOut: 0x02, packet: 64, vid: 0x045e, pid: 0x02ea, name: 'Controller' };

let fontsDone = false;
function registerFonts() {
    if (fontsDone) return;
    fontsDone = true;
    ['cl_bold', 'cl_med'].forEach((n) => fonts.register(n, JSON.parse(fs.readFileSync(path.join(APP, 'data', 'fonts', n + '.json'), 'utf8'))));
}

/**
 * An invented stick: a folder that stands for /media/<label>, with a mounts file that names it. `kind`:
 * 'ro' a complete copy, mounted read-only (as the head unit mounts sticks); 'rw' the same, writable;
 * 'empty' a stick without the game; 'none' no stick. The "game data" is three empty files with the right names.
 */
function makeStick(tmp, kind) {
    const media = path.join(tmp, 'media'), dir = path.join(media, 'STICK'), mounts = path.join(tmp, 'mounts');
    fs.mkdirSync(media);
    if (kind === 'none') { fs.writeFileSync(mounts, 'tmpfs /tmp tmpfs rw 0 0\n'); return { media, mounts, dir: null }; }
    fs.mkdirSync(dir);
    if (kind !== 'empty') {
        const root = path.join(dir, 'Half-Life');
        GD.MARKS.forEach((m) => {
            let p = root;
            m.slice(0, -1).forEach((part) => { p = path.join(p, part); if (!fs.existsSync(p)) { if (!fs.existsSync(path.dirname(p))) fs.mkdirSync(path.dirname(p)); fs.mkdirSync(p); } });
            fs.writeFileSync(path.join(p, m[m.length - 1]), '');
        });
    }
    // (as the kernel writes /proc/mounts: a backslash is \134, a space \040)
    fs.writeFileSync(mounts, 'tmpfs /tmp tmpfs rw 0 0\n/dev/sda1 ' + dir.replace(/\\/g, '\\134').replace(/ /g, '\\040') + ' vfat ' + (kind === 'rw' ? 'rw' : 'ro') + ',nosuid,nodev,noexec 0 0\n');
    return { media, mounts, dir };
}

/** the service's options for the stand-in engine and an invented stick */
function serviceOptions(tmp, stick, more) {
    const m = more || {};
    const engine = Object.assign({
        bin: tmp, exe: process.execPath, args: [path.join(ROOT, 'test', 'fake-engine.js')], files: [],
        videoPath: path.join(tmp, 'video'), env: {},
    }, m.engine || {});
    return Object.assign({
        stateDir: path.join(tmp, 'state'), mounts: stick.mounts, roots: [stick.media], exit: false, thermal: path.join(tmp, 'no-thermal'), hwmon: path.join(tmp, 'no-hwmon'),
        // the gamepad: the stand-in for its program (test/fake-usbpipe.js), and no pad plugged in unless a test says so
        // (never this computer's own USB devices)
        padPipe: [process.execPath, path.join(ROOT, 'test', 'fake-usbpipe.js')], padFind: () => [],
    }, m, { engine });
}

async function createStage(opts) {
    const o = Object.assign({ stick: 'ro' }, opts || {});
    registerFonts();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-stage-'));
    const stick = makeStick(tmp, o.stick);
    // o.pad: a gamepad is plugged in (an Xbox One S pad, as the head unit lists it)
    const plugged = o.pad ? { padFind: () => [PAD] } : {};
    const svc = createService(serviceOptions(tmp, stick, Object.assign(plugged, o.service || {}, { engine: Object.assign({ env: o.engineEnv || {} }, (o.service && o.service.engine) || {}) })));
    svc.start();

    const values = Object.assign({ size: '1280x480', sound: true, touch: false, stats: false }, o.settings || {});
    const settings = { get: (k) => values[k], set: (k, v) => { values[k] = v; } };
    // o.carPaths: what the service says is shown with the head unit's paths in place of this computer's temporary
    // folder (for pictures: a page should look as it does in the car)
    const carPath = (s) => {
        if (s.indexOf(tmp) < 0) return s;
        return s.split(tmp).map((part, i) => {
            if (i === 0) return part;
            const m = /^[^\s,)]*/.exec(part)[0], p = m.replace(/\\/g, '/');
            return (p.indexOf('/state') === 0 ? '/var/opt/clucraft-halflife' + p : p.indexOf('/video') === 0 ? '/dev/shm/mgu-video-clucraft-halflife' : p) + part.slice(m.length);
        }).join('');
    };
    const shownAs = (v) => (typeof v === 'string' ? carPath(v) : Array.isArray(v) ? v.map(shownAs) : v && typeof v === 'object' ? Object.keys(v).reduce((a, k) => { a[k] = shownAs(v[k]); return a; }, {}) : v);
    const S = createStore({ ask: (m) => (o.ask ? o.ask(m, svc) : svc.command(m)).then((r) => (o.carPaths ? shownAs(r) : r)), settings });

    // the car, as the test says it is
    const gate = DG.createGate();
    const car = {
        parked: true, shown: null, video: true, audio: { on: false, connected: false, taken: false, error: null },
        feed() { gate.speed({ speedVehicleCentreOfGravity: car.parked ? 0 : 64 * 62 }); gate.stage(car.parked ? 'P' : 'D'); },
    };
    const B = { font: 'cl_bold', literal: true }, M = { font: 'cl_med', literal: true };
    const btn = (cv, key, x, y, w, h, fn, r) => FS.button(cv, key, x, y, w, h, fn, { r: r != null ? r : 16, slop: 4 });
    const ui = createUi({ S, B, M, btn, env: {
        W, VID, version: 'test', noVideo: true, videoReady: () => car.video && S.running() && !!S.stat(),
        parked: () => { car.feed(); return gate.parked(); }, parkedWhy: () => { car.feed(); return gate.why(); },
        audio: () => car.audio, stats: () => values.stats === true,
    } });
    // as main.js: the game is "on the screen" while its view is wanted (a test may say otherwise: car.shown)
    const shown = () => (car.shown !== null ? car.shown : S.view === 'game' && S.running());
    const beat = () => { car.feed(); return S.poll(gate.parked(), shown()); };

    let last = null;
    function frame() {
        const cv = new record.Recorder(W, H, { textScale: PLACE.scale });
        cv.place = PLACE; cv.own = true; cv.extra = PLACE.extra; cv.chrome = null; cv.pictures = 'blend';
        const A = FS.area(cv), fullH = H + cv.extra;
        const game = S.view === 'game' && S.running();
        if (game) ui.drawGame(cv, fullH); else ui.draw(cv, A, fullH);
        last = { cv, targets: cv.targets.slice(), game, A, fullH };
        return last;
    }
    function tap(key) {
        const t = (last || frame()).targets.filter((x) => x.key === String(key))[0];
        if (!t) throw new Error('no target "' + key + '" on ' + (last.game ? 'the game view' : 'page ' + S.page) + ' (there: ' + last.targets.map((x) => x.key).join(' ') + ')');
        return t.run();
    }
    /** the last frame on the 1920 x 720 screen: the page where the kit puts it, the game view over all of it */
    function png() {
        const f = last || frame();
        const out = new Canvas(1920, 720);
        out.clear('#000000');
        if (f.game) {
            // (the game view is recorded at W x 600 and shown at 1.2: the whole screen)
            const page = new Canvas(1920, 720);
            page.clear('#000000');
            record.play(f.cv.words(), page, 1920 / W);
            out.drawImage(page.d, page.w, page.h, 0, 0, page.w, page.h);
            return Buffer.from(out.png());
        }
        const page = new Canvas(Math.round(W * PLACE.scale), Math.round(f.fullH * PLACE.scale));
        page.clear('#000000');
        record.play(f.cv.words(), page, PLACE.scale);
        out.drawImage(page.d, page.w, page.h, PLACE.ox, PLACE.oy, page.w, page.h);
        // the HMI's own parts over it, as a reminder of what is not the app's: the title strip and the back column
        out.fillRect(0, 0, 1920, 80, '#000000');
        out.fillRect(0, 78, 1920, 2, [255, 255, 255, 56]);
        out.fillRect(0, 80, 84, 640, '#000000');
        const t = new record.Recorder(1920, 80, { textScale: 1 });
        t.text('Half-Life', 104, 54, 40, '#ffffff', B);
        t.line(52, 372, 36, 392, 4, '#ffffff'); t.line(36, 392, 52, 412, 4, '#ffffff');
        record.play(t.words(), out, 1);
        return Buffer.from(out.png());
    }
    async function until(fn, ms, what) {
        const t0 = Date.now();
        for (;;) {
            await beat(); frame();
            const v = fn();
            if (v) return v;
            if (Date.now() - t0 > (ms || 8000)) throw new Error('timeout waiting for ' + what + ' (page ' + S.page + ', view ' + S.view + ', engine ' + JSON.stringify(S.engine()) + ')');
            await sleep(40);
        }
    }
    async function settle(ms) { const t = Date.now() + (ms || 300); while (Date.now() < t) { await beat(); frame(); await sleep(40); } }
    async function close() { await svc.stop(0); await sleep(50); }
    return { S, ui, svc, car, values, settings, gate, tmp, stick, beat, frame, tap, png, until, settle, close, PLACE };
}

module.exports = { createStage, makeStick, serviceOptions, sleep, ROOT, APP, KIT, SVC, W, H, PLACE };
