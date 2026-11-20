'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * service.js - Half-Life on the head unit, for the app "Half-Life" (apps/clucraft_halflife).
 * The unit's /usr/bin/node, as the user nobody (systemd/clucraft-halflife.service): never root.
 * Built the way clucraft-plex's service is (socket activation, one JSON line a question).
 *
 * Started by the app's first connection to /run/clucraft-halflife.sock, never at boot. It ends by itself a minute
 * after the app's last question while no game runs. It starts the engine (engine.js) when the app asks, and ends
 * it when the app goes away.
 *
 * The rules it keeps, whatever the app does:
 *   - a game starts only on a fresh "the car is parked" from the app;
 *   - the game stands still (mgu_hold) whenever the app has not said within 1.5 s that the car is parked and the
 *     game is on the screen. Silence counts as moving;
 *   - 20 s without a word from the app, or 5 minutes standing still: the game is saved and ended;
 *   - an engine that gives no sign of life for a minute is ended.
 *
 * Game data: the owner's own, read from a USB stick (gamedata.js). Nothing of it is ever copied to the head unit.
 * Saves and config: on the stick when it is writable, else in /var/opt/clucraft-halflife/state/base.
 *
 * Control, one JSON object a line, the answer one line:
 *   {"cmd":"status"}                                      -> the status
 *   {"cmd":"beat","parked":true,"shown":true}             the app, twice a second -> the status
 *   {"cmd":"start","size":"1280x480","mode":"menu"}       mode: menu, new, continue -> the status (refused: why not)
 *   {"cmd":"stop"}                                        save and end the game -> the status
 *   {"cmd":"input","ev":[["k",13,1],["t",0,0.5,0.5]]}     keys, pad axes, touch -> { n }
 *   {"cmd":"log"}                                         -> { service: [...], engine: [...] }
 *   {"cmd":"exit"}                                        end the game and the service
 *
 * Plain Node 8.
 */
const fs = require('fs');
const net = require('net');
const path = require('path');
const { createEngine } = require('./engine');
const GD = require('./gamedata');

const VERSION = '0.1.0';
const IDLE_MS = 60 * 1000;
const BEAT_MS = 1500;
const GONE_MS = 20 * 1000;
const HELD_MS = 5 * 60 * 1000;
const HANG_MS = 60 * 1000;
const LOG_LINES = 80;
// the centre screen is 1920 x 720 (8:3); the renderer scales the picture up to it
const SIZES = { '1280x480': [1280, 480], '960x360': [960, 360], '640x240': [640, 240] };
const CLK_TCK = 100, PAGE = 4096;

const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return null; } };
function mkdirp(d) {
    if (fs.existsSync(d)) return;
    mkdirp(path.dirname(d));
    try { fs.mkdirSync(d, 0o700); } catch (e) { if (e.code !== 'EEXIST') throw e; }
}

function createService(opts) {
    const env = process.env;
    const o = Object.assign({
        stateDir: env.HLD_STATE || '/var/opt/clucraft-halflife/state',
        mounts: env.HLD_MOUNTS || '/proc/mounts',
        roots: (env.HLD_MEDIA || '/media').split(':'),
        dataRoot: env.HLD_DATA || null,          // a folder holding valve/ (a test's): no stick is looked for
        sound: env.HLD_SOUND !== '0',
        alsa: env.HLD_ALSA || undefined,
        alsaRate: Number(env.HLD_ALSA_RATE) || undefined,
        dev: env.HLD_DEV === '1',
        fps: Number(env.HLD_FPS) || 30,
        thermal: env.HLD_THERMAL || '/sys/class/thermal',
        now: Date.now,
        idleMs: IDLE_MS, beatMs: BEAT_MS, goneMs: GONE_MS, heldMs: HELD_MS, hangMs: HANG_MS,
        engine: {},
    }, opts || {});
    const now = o.now;
    const lines = [];
    function log(s) {
        lines.push(new Date(now()).toISOString().slice(11, 19) + ' ' + s);
        if (lines.length > LOG_LINES) lines.shift();
        console.log(s);
    }

    const eng = createEngine(Object.assign({ log, now }, o.engine));
    let selftest = null;                       // { ok, lines } once known
    let gate = { parked: false, shown: false, at: 0 };
    let lastReq = now(), timer = null, stopping = false;
    let holdSent = null, heldSince = 0, want = null, refused = null;
    let sys = null, cpuLast = null, sysAt = 0, perfAt = 0;

    /* ---------- the game data and the place for saves ---------- */
    let found = null, foundAt = 0, base = null;
    function data() {
        if (found && now() - foundAt < 3000) return found;
        if (o.dataRoot) {
            const missing = GD.MARKS.filter((m) => GD.resolve(o.dataRoot, m) === null).map((m) => m.join('/'));
            found = missing.length ? { found: false, root: o.dataRoot, sticks: [], why: 'The copy in ' + o.dataRoot + ' is not complete: ' + missing.join(', ') + ' missing.' }
                : { found: true, root: o.dataRoot, mount: null, sticks: [] };
        } else found = GD.find({ mounts: o.mounts, roots: o.roots });
        foundAt = now();
        // where saves go follows the stick: looked at again whenever the data is
        try { base = GD.pickBase(found.found ? found.mount : null, o.stateDir); } catch (e) { base = null; log('saves: ' + e.message); }
        return found;
    }

    /* ---------- the app's word on the car ---------- */
    const fresh = () => now() - gate.at <= o.beatMs;
    const mayRun = () => fresh() && gate.parked === true && gate.shown === true;
    function beat(m) { gate = { parked: m.parked === true, shown: m.shown === true, at: now() }; }

    /* ---------- the engine's load on the head unit, for the status page and the log ---------- */
    function sample() {
        const st = eng.state();
        const s = { cpu: null, rssMb: null, tempC: null, load: null, memAvailMb: null };
        const ps = st.pid ? readText('/proc/' + st.pid + '/stat') : null;
        if (ps) {
            const f = ps.slice(ps.lastIndexOf(')') + 2).split(' ');   // from field 3 on
            const ticks = Number(f[11]) + Number(f[12]), t = now();
            if (cpuLast && cpuLast.pid === st.pid && t > cpuLast.t) s.cpu = Math.round((ticks - cpuLast.ticks) / CLK_TCK / ((t - cpuLast.t) / 1000) * 100);
            cpuLast = { pid: st.pid, ticks, t };
            s.rssMb = Math.round(Number(f[21]) * PAGE / 1048576);
        } else cpuLast = null;
        try {
            const temps = fs.readdirSync(o.thermal).filter((n) => /^thermal_zone\d+$/.test(n))
                .map((n) => Number(readText(path.join(o.thermal, n, 'temp')))).filter((v) => isFinite(v) && v > 0);
            if (temps.length) s.tempC = Math.round(Math.max.apply(null, temps) / 1000);
        } catch (e) { /* no thermal zones here */ }
        const la = readText('/proc/loadavg');
        if (la) s.load = Number(la.split(' ')[0]);
        const mi = readText('/proc/meminfo'), ma = mi && /MemAvailable:\s+(\d+) kB/.exec(mi);
        if (ma) s.memAvailMb = Math.round(Number(ma[1]) / 1024);
        sys = s; sysAt = now();
        return s;
    }

    /* ---------- control ---------- */
    function start(m) {
        refused = null;
        const st = eng.state();
        const size = SIZES[String(m.size)] || SIZES['1280x480'];
        const d = data();
        if (st.state !== 'stopped') refused = 'A game is running already.';
        else if (selftest && !selftest.ok) refused = 'The engine does not load on this head unit: ' + (selftest.lines.filter((l) => /FAILED|missing/.test(l))[0] || 'see the log');
        else if (!d.found) refused = d.why;
        else if (!base) refused = 'No place for saves.';
        else if (!(fresh() && gate.parked === true)) refused = 'The car is not parked.';
        if (refused) { log('start refused: ' + refused); return; }
        eng.clearError();
        let mode = m.mode === 'new' || m.mode === 'continue' ? m.mode : 'menu';
        if (mode === 'continue' && !eng.hasSave(base.dir)) mode = 'menu';
        want = { size: size[0] + 'x' + size[1], mode };
        holdSent = null; heldSince = 0; perfAt = now();
        if (!eng.start({ root: d.root, base: base.dir, width: size[0], height: size[1], mode, sound: o.sound, alsa: o.alsa, alsaRate: o.alsaRate, fps: o.fps, dev: o.dev }))
            refused = eng.state().error || 'The engine did not start.';
    }

    function status() {
        const d = data(), st = eng.state();
        if (st.state !== 'stopped' && now() - sysAt > 2000) sample();
        return {
            version: VERSION, now: now(), refused,
            selftest: selftest ? { ok: selftest.ok, line: selftest.lines[selftest.lines.length - 1] || null } : null,
            data: { found: d.found, root: d.root || null, why: d.why || null, sticks: d.sticks || [], ro: d.mount ? d.mount.ro : null, type: d.mount ? d.mount.type : null },
            saves: base ? { where: base.where, dir: base.dir, why: base.why, canContinue: eng.hasSave(base.dir) } : null,
            engine: { state: st.state, held: st.held, since: st.since || null, stat: st.stat, statAge: st.statAge, exits: st.exits, last: st.last, error: st.error, want },
            gate: { parked: gate.parked, shown: gate.shown, age: gate.at ? now() - gate.at : null, fresh: fresh() },
            video: { file: st.videoPath },
            sound: o.sound,
            sys: st.state !== 'stopped' ? sys : null,
            sizes: Object.keys(SIZES),
            last: lines[lines.length - 1] || null,
        };
    }

    async function command(m) {
        lastReq = now();
        const cmd = m && m.cmd;
        if (cmd === 'beat') beat(m);
        else if (cmd === 'input') return { n: mayRun() ? eng.input(m.ev) : 0 };
        else if (cmd === 'start') start(m);
        else if (cmd === 'stop') { refused = null; await eng.stop('the app asked'); }
        else if (cmd === 'log') return { service: lines.slice(-40), engine: eng.log(60) };
        else if (cmd === 'exit') setTimeout(() => stop(0), 50);
        return status();
    }

    function serve(server) {
        server.on('connection', (c) => {
            let buf = '';
            c.setEncoding('utf8');
            c.on('error', () => {});
            c.on('data', (d) => {
                buf += d;
                let i;
                while ((i = buf.indexOf('\n')) >= 0) {
                    const line = buf.slice(0, i); buf = buf.slice(i + 1);
                    let m = null;
                    try { m = JSON.parse(line); } catch (e) { m = { cmd: 'status' }; }
                    command(m).then((s) => { try { c.write(JSON.stringify(s) + '\n'); } catch (e) { /* gone */ } })
                        .catch((e) => { try { c.write(JSON.stringify({ version: VERSION, error: e.message }) + '\n'); } catch (x) { /* gone */ } });
                }
                if (buf.length > 65536) c.destroy();
            });
        });
    }

    /* ---------- the watch, four times a second ---------- */
    function tick() {
        const st = eng.state(), t = now();
        if (st.state === 'running' || st.state === 'starting') {
            if (st.statAge > o.hangMs) { eng.stop('no sign of life for ' + Math.round(o.hangMs / 1000) + ' s'); return; }
            if (t - gate.at > o.goneMs) { eng.stop('the app went away'); return; }
            const hold = !mayRun();
            if (hold !== holdSent && st.state === 'running') {
                holdSent = hold; heldSince = hold ? t : 0;
                eng.hold(hold);
                log(hold ? 'game held: ' + (!fresh() ? 'no word from the app' : !gate.parked ? 'the car is not parked' : 'the app is not on the screen') : 'game goes on');
            }
            if (holdSent && t - heldSince > o.heldMs) { eng.stop('stood still for ' + Math.round(o.heldMs / 60000) + ' minutes'); return; }
            if (st.state === 'running' && !st.held && t - perfAt > 15000) {
                perfAt = t;
                const s = sample();
                log('game: ' + (st.stat ? st.stat.state + (st.stat.map ? ' ' + st.stat.map : '') + ', ' + st.stat.fps + ' fps' : '?') + ', cpu ' + (s.cpu === null ? '?' : s.cpu + '%')
                    + ', ' + (s.rssMb === null ? '?' : s.rssMb) + ' MB' + (s.tempC === null ? '' : ', ' + s.tempC + ' C') + (s.load === null ? '' : ', load ' + s.load));
            }
        } else if (st.state === 'stopped' && !stopping && t - lastReq > o.idleMs) {
            log('idle: ending');
            stop(0);
        }
    }

    function start0() {
        log('clucraft-halflife ' + VERSION + ' (uid ' + (process.getuid ? process.getuid() : '?') + ')');
        try { mkdirp(o.stateDir); } catch (e) { log('state folder: ' + e.message); }
        data();
        eng.selftest().then((r) => {
            selftest = r;
            r.lines.forEach((l) => log(l));
            if (!r.ok) log('the engine does not load on this head unit: no game can start');
        });
        timer = setInterval(() => { try { tick(); } catch (e) { log('watch: ' + e.message); } }, 250);
    }

    function stop(code) {
        if (stopping) return Promise.resolve();
        stopping = true;
        clearInterval(timer);
        const done = () => { eng.killSync(); if (o.exit !== false) process.exit(code || 0); };
        // (the engine's own ending takes 14 s at the very most: engine.js)
        const t = setTimeout(done, 12000);
        return eng.stop('the service is ending').then(() => { clearTimeout(t); done(); });
    }

    return { start: start0, stop, serve, command, status, engine: eng, tick };
}

if (require.main === module) {
    const svc = createService();
    const server = net.createServer();
    svc.serve(server);
    // systemd passes the socket as fd 3 (LISTEN_FDS); outside it, HLD_SOCK: a path, or a local TCP port
    if (process.env.LISTEN_FDS && Number(process.env.LISTEN_FDS) >= 1) server.listen({ fd: 3 });
    else {
        const p = process.env.HLD_SOCK || '/run/clucraft-halflife.sock';
        if (/^\d+$/.test(p)) server.listen(Number(p), '127.0.0.1');
        else { try { fs.unlinkSync(p); } catch (e) { /* none */ } server.listen(p); }
    }
    svc.start();
    process.on('SIGTERM', () => svc.stop(0));
    process.on('SIGINT', () => svc.stop(0));
}

module.exports = { createService, VERSION, SIZES };
