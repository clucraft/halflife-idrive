'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * engine.js - the game engine (bin/clucraft-hl: Xash3D FWGS with this project's head-unit backend) as a child of
 * the service. One process at a time. It has the service's user (nobody), its limits and its LimitCORE.
 *
 * To the engine:   its stdin, one console command a line (port/engine/platform/mgu/sys_mgu.c has the list)
 * From the engine: fd 3, one "MGU {json}" line a second (state, map, frame rate); stdout and stderr, its log
 *
 *   const eng = createEngine({ bin, videoPath, log, now });
 *   eng.selftest()            -> Promise { ok, lines }: do the engine's libraries load on this head unit?
 *   eng.start({ root, base, width, height, mode, sound, alsa, alsaRate, fps, dev })
 *   eng.hold(on)              stop the game where it stands, or let it go on
 *   eng.pad(on)               a gamepad is being read (gamepad.js)
 *   eng.input(events)         [['k', key, down], ['a', axis, value], ['t', phase, x, y]]
 *   eng.stop(why)             -> Promise: save, quit; then SIGTERM, then SIGKILL as a last resort
 *   eng.state()               { state, held, pid, since, stat, statAge, exits, last, error }
 *   eng.killSync()            for the service's own exit
 *
 * Plain Node 8.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const VIDEO_PATH = '/dev/shm/mgu-video-clucraft-halflife';
const ALSA_DEVICE = 'plug:smartx:CarLifeMedia_CF_48_STEREO';
const ALSA_RATE = 48000;
const SAVE_NAME = 'idrive';
// how long each step of an ending may take: asked to quit, SIGTERM (it quits from its main loop), SIGTERM again
// (its handler then leaves at once), SIGKILL
const QUIT_MS = 6000, TERM_MS = 3000, TERM2_MS = 2000;
const LOG_LINES = 300;

/** the engine's files, as the Store installs them (component.json "files") */
const FILES = ['clucraft-hl', 'libxash.so', 'filesystem_stdio.so', 'libref_soft.so', 'libmenu.so', 'hl_amd64.so', 'client_amd64.so', 'extras.pk3'];

function lines(stream, fn) {
    let b = '';
    stream.setEncoding('utf8');
    stream.on('data', (d) => {
        b += d;
        let i;
        while ((i = b.indexOf('\n')) >= 0) { fn(b.slice(0, i)); b = b.slice(i + 1); }
        if (b.length > 65536) b = '';
    });
    stream.on('error', () => {});
}
// the engine colours its log with ^1..^7: not for a log page
const plain = (s) => String(s).replace(/\^[0-9]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, 300);
const int = (v, lo, hi) => { const n = Math.round(Number(v)); return isFinite(n) && n >= lo && n <= hi ? n : null; };
const unit = (v) => { const n = Number(v); return isFinite(n) ? Math.max(0, Math.min(1, n)).toFixed(4) : null; };

function createEngine(o) {
    const log = o.log || (() => {});
    const now = o.now || Date.now;
    const binDir = o.bin || path.join(__dirname, 'bin');
    const exe = o.exe || path.join(binDir, 'clucraft-hl');
    const videoPath = o.videoPath || VIDEO_PATH;
    const st = { state: 'stopped', held: false, pid: null, since: 0, stat: null, statAt: 0, exits: 0, last: null, error: null };
    const ring = [];
    let cur = null;   // { child, done, onEnded: [], why }

    function keep(s) { ring.push(s); if (ring.length > LOG_LINES) ring.shift(); }
    const removeVideo = () => { try { fs.unlinkSync(videoPath); } catch (e) { /* none */ } };
    // (o.exe, o.args, o.files: the tests' stand-in engine is a script)
    const missing = () => (o.files || FILES).filter((f) => !fs.existsSync(path.join(binDir, f)));

    /** the libraries, loaded with every symbol resolved (the engine's -mguselftest) */
    function selftest() {
        return new Promise((resolve) => {
            const gone = missing();
            if (gone.length) return resolve({ ok: false, lines: ['missing: ' + gone.join(', ')] });
            let out = '', done = false, child;
            const finish = (ok) => { if (done) return; done = true; clearTimeout(t); resolve({ ok, lines: out.split('\n').map(plain).filter((l) => /selftest|refus/i.test(l)) }); };
            const t = setTimeout(() => { out += '\nMGU selftest: no answer in 15 s'; try { child.kill('SIGKILL'); } catch (e) { /* gone */ } finish(false); }, 15000);
            try { child = cp.spawn(exe, (o.args || []).concat(['-mguselftest']), { cwd: binDir, env: Object.assign({ PATH: '/usr/bin:/bin' }, o.env || {}), stdio: ['ignore', 'pipe', 'pipe'] }); }
            catch (e) { out = 'MGU selftest: ' + e.message; return finish(false); }
            child.stdout.on('data', (d) => { out += d; });
            child.stderr.on('data', (d) => { out += d; });
            child.on('error', (e) => { out += '\nMGU selftest: ' + e.message; finish(false); });
            child.on('exit', (code) => finish(code === 0 && /selftest: passed/.test(out)));
        });
    }

    function start(p) {
        if (cur) return false;
        const gone = missing();
        if (gone.length) { st.error = 'the engine is not complete: ' + gone.join(', ') + ' missing'; log(st.error); return false; }
        const args = (o.args || []).concat([
            '-game', 'valve',
            '-dll', path.join(binDir, 'hl_amd64.so'),
            '-clientlib', path.join(binDir, 'client_amd64.so'),
            '-stdincmds', '-mgustatus', '3',
            '-width', String(p.width), '-height', String(p.height),
            '-mgufps', String(p.fps || 30),
        ]);
        // the car's sound device is 48 kHz: the engine opens it at that and converts its own 44.1 kHz itself
        if (p.sound === false) args.push('-nosound'); else args.push('-alsadev', p.alsa || ALSA_DEVICE, '-alsarate', String(p.alsaRate || ALSA_RATE));
        if (p.dev) args.push('-dev', '1');
        // what the game opens with: its own menu, a new game, or where the last session ended
        if (p.mode === 'new') args.push('+newgame');
        else if (p.mode === 'continue') args.push('+load', SAVE_NAME);
        // (no HOME: the engine then keeps its id file in the writable folder and nowhere else)
        const env = Object.assign({
            PATH: '/usr/bin:/bin',
            XASH3D_BASEDIR: p.base, XASH3D_RODIR: p.root,
            XASH3D_EXTRAS_PAK1: path.join(binDir, 'extras.pk3'),
            MGU_VIDEO_FILE: videoPath,
        }, o.env || {});
        let child;
        try { child = cp.spawn(exe, args, { cwd: binDir, env, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] }); }
        catch (e) { st.error = 'the engine did not start: ' + e.message; log(st.error); return false; }
        const c = { child, done: false, onEnded: [], why: null, timers: [] };
        cur = c;
        Object.assign(st, { state: 'starting', held: false, pid: child.pid, since: now(), stat: null, statAt: now(), error: null });
        log('engine: started (pid ' + child.pid + ', ' + p.width + 'x' + p.height + ', ' + (p.mode || 'menu') + ', data ' + p.root + ', saves ' + p.base + ')');
        child.stdin.on('error', () => { /* it went: its exit says so */ });
        lines(child.stdout, (l) => { l = plain(l); if (l) keep(l); });
        lines(child.stderr, (l) => { l = plain(l); if (l) { keep(l); log('engine: ' + l); } });
        lines(child.stdio[3], (l) => {
            if (l.indexOf('MGU ') !== 0) return;
            let ev;
            try { ev = JSON.parse(l.slice(4)); } catch (e) { return; }
            if (!ev || ev.ev !== 'stat' || cur !== c) return;
            st.stat = ev; st.statAt = now();
            st.held = ev.state === 'held';
            if (st.state === 'starting') { st.state = 'running'; log('engine: running'); }
        });
        child.on('error', (e) => { if (!child.pid) finish(null, null, e.message); });
        child.on('exit', (code, sig) => finish(code, sig));
        function finish(code, sig, err) {
            if (c.done) return;
            c.done = true;
            c.timers.forEach(clearTimeout);
            if (cur === c) cur = null;
            removeVideo();   // (the engine takes it away itself when it quits; after a crash or a kill it is still there)
            st.exits++;
            st.last = { code, signal: sig || null, why: c.why || (err ? 'did not start' : code === 0 ? 'quit' : 'ended by itself'), at: now() };
            if (err) st.error = 'the engine did not start: ' + err;
            else if (!c.why && code !== 0) st.error = 'the engine ended by itself (' + (sig || 'code ' + code) + ')';
            Object.assign(st, { state: 'stopped', held: false, pid: null, stat: null });
            log('engine: ended (' + (sig || 'code ' + code) + (c.why ? ', ' + c.why : '') + ')');
            c.onEnded.forEach((fn) => fn());
        }
        c.finish = finish;
        return true;
    }

    const write = (l) => { if (cur && !cur.done) { try { cur.child.stdin.write(l + '\n'); return true; } catch (e) { /* gone */ } } return false; };

    function hold(on) { return write('mgu_hold ' + (on ? 1 : 0)); }
    /** a gamepad is being read: the engine lays out its buttons (its Xbox preset), once */
    function pad(on) { return write('mgu_pad ' + (on ? 1 : 0)); }

    /** what the app and the pad reader saw, as the engine's own commands. Numbers only: nothing here is typed text */
    function input(events) {
        if (!cur || cur.done || !Array.isArray(events)) return 0;
        let n = 0;
        for (let i = 0; i < events.length && i < 64; i++) {
            const e = events[i];
            if (!Array.isArray(e)) continue;
            let l = null;
            if (e[0] === 'k') { const k = int(e[1], 1, 255); if (k !== null) l = 'mgu_key ' + k + ' ' + (e[2] ? 1 : 0); }
            else if (e[0] === 'a') { const a = int(e[1], 0, 5), v = int(e[2], -32767, 32767); if (a !== null && v !== null) l = 'mgu_axis ' + a + ' ' + v; }
            else if (e[0] === 't') { const ph = int(e[1], 0, 2), x = unit(e[2]), y = unit(e[3]); if (ph !== null && x !== null && y !== null) l = 'mgu_touch ' + ph + ' ' + x + ' ' + y; }
            if (l && write(l)) n++;
        }
        return n;
    }

    /** ends the engine: a save of where the player stands, then quit; signals only when that does not end it */
    function stop(why) {
        const c = cur;
        if (!c || c.done) return Promise.resolve();
        return new Promise((resolve) => {
            c.onEnded.push(resolve);
            if (c.why) return;                       // already ending
            c.why = why || 'stopped';
            st.state = 'stopping';
            log('engine: stopping (' + c.why + ')');
            const inGame = st.stat && (st.stat.state === 'game' || st.stat.state === 'paused' || st.stat.state === 'held') && st.stat.map;
            write('mgu_hold 0');
            if (inGame) write('save ' + SAVE_NAME);
            write('quit');
            const sig = (s, what) => () => { log('engine: ' + what); try { c.child.kill(s); } catch (e) { /* gone */ } };
            c.timers.push(setTimeout(sig('SIGTERM', 'not gone after ' + QUIT_MS / 1000 + ' s: SIGTERM'), QUIT_MS));
            c.timers.push(setTimeout(sig('SIGTERM', 'still there: SIGTERM again (it then leaves at once)'), QUIT_MS + TERM_MS));
            c.timers.push(setTimeout(sig('SIGKILL', 'still there: SIGKILL'), QUIT_MS + TERM_MS + TERM2_MS));
            c.timers.push(setTimeout(() => { if (c.finish) c.finish(null, 'SIGKILL'); }, QUIT_MS + TERM_MS + TERM2_MS + 3000));
        });
    }

    function killSync() {
        if (cur && !cur.done) { try { cur.child.kill('SIGKILL'); } catch (e) { /* gone */ } }
        cur = null;
        removeVideo();
    }

    function state() {
        return { state: st.state, held: st.held, pid: st.pid, since: st.since, stat: st.stat, statAge: st.state === 'stopped' ? null : now() - st.statAt,
            exits: st.exits, last: st.last, error: st.error, videoPath };
    }
    const hasSave = (base) => { try { return fs.statSync(path.join(base, 'valve', 'save', SAVE_NAME + '.sav')).isFile(); } catch (e) { return false; } };

    return { selftest, start, hold, pad, input, stop, killSync, state, log: (n) => ring.slice(-(n || 40)), hasSave, missing, binDir, clearError() { st.error = null; } };
}

module.exports = { createEngine, VIDEO_PATH, ALSA_DEVICE, ALSA_RATE, SAVE_NAME, FILES };
