'use strict';
/**
 * Half-Life (clucraft_halflife): the launcher and the screen of Half-Life on the head unit. An unofficial port:
 * not affiliated with or endorsed by Valve or BMW. No game data is in this app or its service.
 *
 * The Half-Life service (native/clucraft-halflife, a tool from the same repository) runs the game's engine as
 * nobody: its picture goes into /dev/shm/mgu-video-clucraft-halflife, its sound into SmartXbar's CarLife input.
 * This app is the rest: it asks the service (svc.js), keeps what it learns (store.js), draws the pages (ui.js),
 * shows the picture over the whole screen through a second renderer connection (fullview.js), routes the sound
 * to the speakers (caraudio.js), passes the controller and the touch screen on (input.js), and tells the service
 * twice a second whether the car is parked (drivegate.js) and the game is on the screen.
 *
 * Parked only. The gate is strict (a fresh speed under 1 km/h and the selector in P; anything unknown is not
 * parked) and has no setting. This app refuses to start a game otherwise and shows no picture; the service holds
 * the game on its own whenever this app does not say "parked", and when it says nothing.
 *
 * Built on the kit and the structure of clucraft_plex (MIT; see NOTICE).
 * Node 8 only: no ?. ?? object spread, class fields or optional catch binding. Every callback goes through guard().
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const FS = require('./kit/fullscreen');
const G = require('./kit/gauges');
const record = require('./kit/record');
const fonts = require('./kit/fonts');
const pack = require('./kit/pack');
const { RenderClient } = require('./kit/renderd');
const svc = require('./svc');
const { createStore } = require('./store');
const { createUi } = require('./ui');
const DG = require('./drivegate');
const IN = require('./input');
const { createCarAudio } = require('./caraudio');
const { createFullView } = require('./fullview');

const VERSION = '0.1.0';
const W = 1600, H = 520;
const VID = 7, VIDEO_FILE = '/dev/shm/mgu-video-clucraft-halflife';
const BEAT_MS = 450;   // the service holds the game after 1.5 s without one

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const guard = (name, fn) => function () {
            try { return fn.apply(this, arguments); } catch (e) { log.error('error in ' + name + ': ' + (e && e.stack || e)); return undefined; }
        };
        try {
            /* ---------- fonts: Inter (OFL), packed with the app ---------- */
            let F_BOLD = 'bold', F_MED = 'label';
            try {
                const dirs = [path.join(__dirname, 'fonts'), path.join(__dirname, 'data', 'fonts')];
                const src = pack.open(fs.existsSync(dirs[0] + '.pack') || fs.existsSync(dirs[0]) ? dirs[0] : dirs[1]);
                if (fonts.register('cl_bold', src.json('cl_bold.json'))) F_BOLD = 'cl_bold';
                if (fonts.register('cl_med', src.json('cl_med.json'))) F_MED = 'cl_med';
            } catch (e) { log.warn('fonts: ' + e.message); }
            const B = { font: F_BOLD, literal: true }, M = { font: F_MED, literal: true };

            /* ---------- what the app knows (store.js), the car (drivegate.js), the speakers (caraudio.js) ---------- */
            const S = createStore({ ask: svc.ask, settings, log });
            const gate = DG.watch(ctx.signals, log, DG.createGate());
            const audio = createCarAudio(ctx.signals, log, path.join(ctx.dataDir, 'audio.json'));
            process.once('exit', () => { try { audio.want(false); } catch (e) { /* ending */ } });
            // the kit's emulator keeps one renderer connection per app and shows no video: the game view is drawn
            // on the page there, with a stand-in for the picture
            const EMU = 'MGU_EMU_CLOSED' in process.env;

            /* ---------- the game over the whole screen (fullview.js): the controller and a finger go to the game ---------- */
            const fv = createFullView({ RenderClient, Recorder: record.Recorder, appId: 'clucraft_halflife', log, W, off: EMU,
                touch: () => settings.get('touch') === true,
                onTouch: guard('touch', (phase, x, y) => { const ev = IN.fromTouch(phase, x, y, W, fv.H); if (ev.length) svc.send({ cmd: 'input', ev }); }),
                // (held down for a second: out of the game, to the launcher. The HMI's BACK leaves the whole app.)
                onCcu: guard('controller', (c) => { if (c.hold) { S.leave(); return; } const ev = IN.fromController(c); if (ev.length) svc.send({ cmd: 'input', ev }); }),
                // (without a claim of its own, a touch on the screen is the HMI's and the renderer takes the layer away)
                onClosed: guard('closed', () => S.leave()) });
            const pageUp = () => ui.isVisible('MAIN') && !ui.isVisible('SETTINGS') && (!ui.hasFocus || ui.hasFocus('MAIN'));
            const gameWanted = () => S.view === 'game' && S.running() && pageUp();
            // "the game is on the screen", as the service is told: the full view is really up
            const shown = () => gameWanted() && (EMU || fv.shown());

            /* ---------- the engine's frame file, named to the renderer ---------- */
            // named once the renderer can show video and the engine has made the file, and again whenever the file
            // is another one: the engine makes a new one at each start, and the renderer keeps the file it opened
            let videoIno = null;
            function videoReady() {
                let ino = null;
                try { ino = fs.statSync(VIDEO_FILE).ino; } catch (e) { /* not made yet, or the game ended */ }
                if (EMU) return S.running() && !!S.stat();
                const g = ctx.display && ctx.display.gpu;
                if (!g || !g.ready || !g.native || !g.info || !g.info.video || ino == null) return false;
                if (ino !== videoIno) {
                    g.video(VID, VIDEO_FILE); fv.video(VID, VIDEO_FILE); videoIno = ino;
                    log.info('video: ' + VIDEO_FILE + ' (inode ' + ino + ') named to the renderer');
                }
                return true;
            }

            /* ---------- the beat: the car and the screen, told to the service twice a second ---------- */
            let lastBeat = 0;
            // (the speakers only for a game that was started with sound: the service says which it is)
            const afterBeat = guard('after beat', () => audio.want(S.running() && S.st.sound !== false && shown() && gate.parked()));
            setInterval(guard('beat', () => {
                const t = Date.now();
                if (t - lastBeat < BEAT_MS) return;
                lastBeat = t;
                S.poll(gate.parked(), shown()).then(afterBeat);
            }), 150);
            S.poll(gate.parked(), false).then(afterBeat);

            // while the full view is up the page's own layer is hidden (as clucraft_plex does, found in the car by
            // IPTV: the page's reconnects put it back over the picture); it is shown again once the full view goes
            let pageHidden = false;
            function syncFull() {
                fv.update(gameWanted());
                const g = ctx.display && ctx.display.gpu;
                if (!g) return;
                const hide = fv.shown();
                if (hide && g.visible) { g.show(false); pageHidden = true; }
                else if (!hide && pageHidden) {
                    pageHidden = false;
                    if (typeof ctx.display._syncVisible === 'function') ctx.display._syncVisible(); else g.show(true);
                }
            }
            ui.onVisible(guard('fullview', syncFull));
            setInterval(guard('fullview', syncFull), 500);

            /* ---------- the pages (ui.js) ---------- */
            const btn = (cv, key, x, y, w, h, fn, r) => FS.button(cv, key, x, y, w, h, guard(key, fn), { r: r != null ? r : 16, slop: 4 });
            const ui2 = createUi({ S, B, M, btn, env: {
                W, VID, version: VERSION, videoReady, noVideo: EMU,
                parked: () => gate.parked(), parkedWhy: () => gate.why(), audio: () => audio.state(),
                stats: () => settings.get('stats') === true,
            } });

            /* ---------- the kit: its bar buttons (where it cannot run the screen), back ---------- */
            FS.setup(ctx);
            const playMode = () => (S.st && S.st.saves && S.st.saves.canContinue ? 'continue' : 'new');
            ui.onClick('BTN_PLAY', guard('play', () => { if (S.running()) S.resume(); else S.play(playMode(), gate.parked()); }));
            ui.onClick('BTN_STOP', guard('stop', () => { if (S.running()) S.stop(); }));
            ui.onClick('BTN_STATUS', guard('status', () => S.go(S.page === 'status' ? 'home' : S.page === 'home' ? 'status' : 'home')));
            if (typeof ctx.onBack === 'function') ctx.onBack(guard('back', () => S.back()));
            settings.onChange(guard('settings', (k) => {
                if (k === 'size' && S.running()) S.say('The new picture size is used from the next start of the game');
                if (k === 'sound' && S.running()) S.say('Sound ' + (settings.get('sound') === false ? 'off' : 'on') + ' from the next start of the game');
            }));

            /* ---------- the frame ---------- */
            ctx.loop('MAIN', 10, guard('draw', async () => {
                const cv = ctx.canvas(W, H), A = FS.area(cv), fullH = H + (cv.extra || 0);
                if (cv.chrome) G.frame(cv, ctx.theme(), ['Half-Life'], 0, []);
                syncFull();
                // under the full view the page draws nothing: its layer stays clear
                if (fv.shown()) fv.draw((rec, FH) => ui2.drawGame(rec, FH));
                else if (EMU && gameWanted()) { ui2.drawGame(cv, fullH); FS.button(cv, 'leave', 0, 0, W, fullH, guard('leave', () => S.leave()), { r: 0, slop: 0 }); }
                else ui2.draw(cv, A, fullH);
                await ui.image('MAIN_GFX', cv);
            }));
            log.info('started ' + VERSION + ', fonts ' + F_BOLD + '/' + F_MED + (EMU ? ', in the emulator' : ''));
        } catch (e) {
            log.error('start: ' + (e && e.stack || e));
        }
    },
});
