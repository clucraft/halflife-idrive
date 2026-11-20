'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * gamepad.js - a USB gamepad for the game: what the pad tells (pad.js), as the engine's input.
 *
 * The head unit's kernel has no driver for a gamepad. pad.js (nes-idrive's, proven there on the owner's car with
 * an Xbox One S pad on a cable) reads one through usbfs with the help of a small program, bin/clucraft-hl-pad:
 * the same program as nes-idrive's nes-usbpipe, under this tool's own file name. The service runs it as itself
 * (nobody); what lets it open the pad's node is the unit's group mgu_usb.
 *
 * While a game runs, this module looks for a pad every two seconds, reads the first it finds, and turns its
 * state into the engine's input events (service.js passes them on by the same rule as every other input: only
 * while the car is parked and the game is on the screen):
 *
 *   buttons       the engine's own pad keys, so the game's menus work with A, B and the D-pad as they are, and
 *                 the engine's Xbox layout applies in the game (engine.js sends mgu_pad 1 once a pad is read)
 *   left stick    move: side and forward          right stick    look: turn and up/down
 *   triggers      as the engine's two trigger axes (it makes buttons of them at half way)
 *
 * The pad says "up" with the greater number; the engine wants it the other way round, as SDL gives it. Sticks
 * rest a little off centre: inside the dead zone they count as centred. A button is passed on the moment it
 * changes; sticks and triggers at most a hundred times a second, in steps.
 *
 *   const gp = createGamepad({ pipe, send(events, force) -> n, announce(), log });
 *   gp.check()        -> Promise { ok, line }: does the program run on this head unit?
 *   gp.want(on)       look for a pad and read it, or let it go
 *   gp.neutral()      everything let go, as far as the engine knows (before the game is held)
 *   gp.resync()       what is held on the pad right now, sent again (after a hold)
 *   gp.state()        { reading, name, found, error, program }
 *
 * Plain Node 8.
 */
const path = require('path');
const cp = require('child_process');
const pads = require('./pad');

const PROGRAM = 'clucraft-hl-pad';
const SCAN_MS = 2000;
const FLUSH_MS = 10;
const DEAD = 4000;      // of 32767: a stick this near its middle is in the middle (a real pad rests 1000 to 3000 off)
const STEP = 256;       // sticks and triggers are told in steps of this
// the engine's key numbers (xash3d-fwgs engine/keydefs.h: K_A_BUTTON is K_AUX1, 207) by pad.js's names
const KEY = { A: 207, B: 208, X: 209, Y: 210, L: 211, R: 212, SELECT: 213, START: 215, LS: 216, RS: 217, UP: 222, DOWN: 223, LEFT: 224, RIGHT: 225 };
// the engine's axes in its default order ("sfpyrl": side, forward, pitch, yaw, right trigger, left trigger)
const AXES = 6;
const rest = () => ({ buttons: 0, lt: 0, rt: 0, lx: 0, ly: 0, rx: 0, ry: 0 });

const stick = (v) => (Math.abs(v) < DEAD ? 0 : Math.max(-32767, Math.min(32767, Math.round(v / STEP) * STEP)));
const trigger = (t) => Math.max(0, Math.min(32767, Math.round(t * 32767 / pads.TRIGGER_MAX / STEP) * STEP));
/** a pad state's six axis values as the engine takes them */
function axes(s) {
    return [stick(s.lx), stick(-s.ly), stick(-s.ry), stick(s.rx), trigger(s.rt), trigger(s.lt)];
}
/** the key events that turn the buttons `from` into `to` */
function buttonEvents(from, to) {
    const ev = [];
    Object.keys(KEY).forEach((name) => {
        const bit = pads.PAD_FULL[name];
        if ((from & bit) !== (to & bit)) ev.push(['k', KEY[name], to & bit ? 1 : 0]);
    });
    return ev;
}
/** the axis events that turn the axis values `from` into `to` */
function axisEvents(from, to) {
    const ev = [];
    for (let i = 0; i < AXES; i++) if (from[i] !== to[i]) ev.push(['a', i, to[i]]);
    return ev;
}

function createGamepad(o) {
    const log = o.log || (() => {});
    const pipe = o.pipe || [path.join(__dirname, 'bin', PROGRAM)];
    const find = o.find || (() => pads.find());
    const scanMs = o.scanMs || SCAN_MS;
    let wanted = false, reader = null, scanTimer = null, flushTimer = null, error = null;
    let found = [], foundAt = 0, program = null;
    let cur = rest();                                   // what the pad says now
    let sent = { buttons: 0, axes: axes(rest()) };      // what the engine has been told

    function look() {
        try { found = find() || []; } catch (e) { found = []; log('gamepad: ' + e.message); }
        foundAt = Date.now();
        return found;
    }

    function sendButtons(force) {
        const ev = buttonEvents(sent.buttons, cur.buttons);
        if (ev.length && o.send(ev, force) > 0) sent.buttons = cur.buttons;
    }
    function flush(force) {
        clearTimeout(flushTimer); flushTimer = null;
        const now = axes(cur), ev = axisEvents(sent.axes, now);
        if (ev.length && o.send(ev, force) > 0) sent.axes = now;
    }
    /** the engine is told that nothing is held: it would otherwise keep walking where the stick last pointed */
    function neutral() {
        clearTimeout(flushTimer); flushTimer = null;
        const zero = axes(rest()), ev = buttonEvents(sent.buttons, 0).concat(axisEvents(sent.axes, zero));
        if (ev.length) o.send(ev, true);
        sent = { buttons: 0, axes: zero };
    }
    function resync() { sendButtons(false); flush(false); }

    function read(dev) {
        const me = { dev, handle: null };
        reader = me; error = null; cur = rest();
        log('gamepad: reading ' + dev.name + ' (' + dev.vid.toString(16) + ':' + dev.pid.toString(16) + ') at ' + dev.node);
        me.handle = pads.open(dev, {
            pipe, env: o.env,
            log: (l) => log('gamepad: ' + l),
            onState(s) {
                if (reader !== me) return;
                cur = s;
                sendButtons(false);
                if (!flushTimer) flushTimer = setTimeout(() => flush(false), FLUSH_MS);
            },
            onClose(why, unplugged) {
                if (reader !== me) return;
                reader = null; cur = rest();
                neutral();
                error = unplugged ? null : why;
                log('gamepad: ' + (unplugged ? 'unplugged' : why));
            },
        });
        if (o.announce) o.announce();
    }
    function scan() {
        if (!wanted || reader) return;
        const dev = look()[0];
        if (dev) read(dev);
    }
    function want(on) {
        on = !!on;
        if (on === wanted) return;
        wanted = on;
        clearInterval(scanTimer); scanTimer = null;
        if (on) { scan(); scanTimer = setInterval(scan, scanMs); return; }
        if (reader) { const r = reader; reader = null; try { r.handle.close(); } catch (e) { /* gone */ } }
        cur = rest(); error = null;
        neutral();
    }

    /** does the program run here? With no arguments it says how it is used and leaves with 2 */
    function check() {
        return new Promise((resolve) => {
            let out = '', done = false, child;
            const finish = (ok, line) => { if (done) return; done = true; clearTimeout(t); program = { ok, line }; resolve(program); };
            const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* gone */ } finish(false, 'no answer'); }, 5000);
            try { child = cp.spawn(pipe[0], pipe.slice(1), { cwd: '/', env: o.env || { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'ignore', 'pipe'] }); }
            catch (e) { return finish(false, e.code || e.message); }
            child.stderr.on('data', (d) => { out = (out + d).slice(-400); });
            child.on('error', (e) => finish(false, e.code || e.message));
            child.on('exit', (code) => finish(code === 2 && /usage/.test(out), code === 2 && /usage/.test(out) ? 'runs' : 'ended with ' + code + (out ? ': ' + out.trim().split('\n')[0].slice(0, 120) : '')));
        });
    }

    function state() {
        if (!reader && Date.now() - foundAt > scanMs) look();
        const dev = reader ? reader.dev : found[0] || null;
        return { reading: !!reader, name: dev ? dev.name : null, found: reader ? Math.max(1, found.length) : found.length, error, program };
    }
    return { check, want, neutral, resync, state };
}

module.exports = { createGamepad, axes, buttonEvents, axisEvents, KEY, PROGRAM, DEAD, STEP };
