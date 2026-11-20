'use strict';
/**
 * fullview.js - the game over the whole centre screen. The kit draws the app's page inside the HMI's box, under
 * the HMI's title bar and beside its left strip; the game belongs over all of it. This is a second connection to
 * mgu-render (kit/renderd.js, mgu-render/1), a layer of its own placed over the full 1920 x 720 output, recorded
 * at the page's width (W, 1600: logical px scaled by 1920 / W).
 * (clucraft_plex's fullview.js, from amn_iptv's lib/fullview.js, M850i-amn/idrive7-apps, MIT: see NOTICE.
 * Changed for a game: touch is claimed only when asked for, every finger and every move of the controller goes
 * to one handler, there are no buttons of its own, and the layer being taken away is told.)
 *
 * The controller is grabbed while it shows. HOME leaves the app: the page is no longer shown and neither is this.
 *
 *   const fv = createFullView({ RenderClient, Recorder, appId, log, W, off, touch, onTouch, onCcu, onClosed });
 *   off: no second connection (the kit's emulator keeps one connection per app: the two would close each other)
 *   o.touch()                 true: fingers on the screen are this view's (claimed); false: they stay the HMI's
 *   o.onTouch(phase, x, y)    a finger: 1 down, 2 moved, 3 up, in logical px of W x fv.H
 *   o.onCcu({ turn, press, tilt, hold })   the controller: turned by `turn` clicks, pressed (told when it is let
 *                             go), pushed 'N' 'E' 'S' 'W', or held down for a second (hold: true, and no press)
 *   o.onClosed()              the renderer took the layer away (the HMI was touched beside it)
 *   fv.update(want)           each frame and each second: true while the game should be over the whole screen
 *   fv.draw(fn)               fn(rec, H) records a frame
 *   fv.shown()                true while the layer is up
 *   fv.video(id, file)        names the engine's frame file on this connection (once it exists)
 *
 * Node 8.
 */
const SCREEN_W = 1920, SCREEN_H = 720;
const KEEPALIVE_MS = 800;   // mgu-render hides a layer that sends nothing for 3 s
const HOLD_MS = 1000;       // the controller held down this long: "hold", not a press
// FrontCCU.frontRotaryEncoderDeflection, as kit/runtime/display.js reads it
const TILT = { 1: 'N', 2: 'N', 4: 'E', 5: 'E', 7: 'S', 8: 'S', 10: 'W', 11: 'W' };

function createFullView(o) {
    const log = o.log;
    const scale = SCREEN_W / o.W, H = Math.round(SCREEN_H / scale);
    if (o.off) return { H, scale, off: true, update() {}, shown: () => false, video() {}, draw() {} };
    const gpu = new o.RenderClient(o.appId, log, { native: true });
    const rec = new o.Recorder(o.W, H, { textScale: scale });
    let ready = false, want = false, shown = false, lastFrame = 0, lastCcu = null, claimed = false, holdTimer = null, longPress = false;
    const tell = (c) => { if (!shown) return; try { o.onCcu(c); } catch (e) { log.warn('fullview controller: ' + e.message); } };
    const wantTouch = () => { try { return !!(o.touch && o.touch()); } catch (e) { return false; } };
    function claim() { claimed = wantTouch(); gpu.claim(claimed ? [{ x: 0, y: 0, w: o.W, h: H }] : []); }

    gpu.on('ready', () => {
        ready = !!(gpu.native && gpu.info && gpu.info.video);
        if (!ready) { log.warn('fullview: the renderer does not show video here'); return; }
        gpu.place({ x: 0, y: 0, w: SCREEN_W, h: SCREEN_H, scale, ox: 0, oy: 0 });
        gpu.claimed = null;   // a new connection holds no claim yet (renderd.js skips one it thinks it sent)
        if (shown) { claim(); gpu.show(true); gpu.grab(true); }
    });
    gpu.on('close', () => { ready = false; });
    gpu.on('closed', () => {
        if (shown) log.info('fullview: hidden by the renderer');
        shown = false; gpu.grab(false);
        try { if (o.onClosed) o.onClosed(); } catch (e) { log.warn('fullview closed: ' + e.message); }
    });
    gpu.on('touch', (phase, x, y) => {
        if (!shown || !claimed) return;
        try { if (o.onTouch) o.onTouch(phase, x, y); } catch (e) { log.warn('fullview touch: ' + e.message); }
    });
    gpu.on('ccu', (c) => {
        const k = Number(c.frontRotaryEncoderOperation), pb = Number(c.frontRotaryEncoderPushButton), df = Number(c.frontRotaryEncoderDeflection);
        const L = lastCcu;
        lastCcu = { k, pb, df };
        if (!L || (pb === 15 && df === 15) || !o.onCcu) return;   // the first one only says where the knob stands
        let d = ((k - L.k + 32768) & 0xffff) - 32768;
        if (!isFinite(d) || Math.abs(d) > 64) d = 0;               // a counter reset
        const down = (x) => x === 1 || x === 2;
        const tilt = TILT[df] && TILT[L.df] !== TILT[df] ? TILT[df] : null;
        // a press counts when the knob is let go; held down for a second it is "hold" instead (the way out of a
        // game: the HMI's own BACK leaves the whole app, and nothing else on the screen is this view's)
        let press = false;
        if (down(pb) && !down(L.pb)) {
            longPress = false;
            clearTimeout(holdTimer);
            holdTimer = setTimeout(() => { longPress = true; tell({ turn: 0, press: false, tilt: null, hold: true }); }, HOLD_MS);
        } else if (!down(pb) && down(L.pb)) {
            clearTimeout(holdTimer);
            press = !longPress;
            longPress = false;
        }
        if (d || press || tilt) tell({ turn: d, press, tilt, hold: false });
    });
    gpu.connect();

    function apply(on) {
        if (on === shown) {
            // the setting changed while the game is up
            if (shown && ready && claimed !== wantTouch()) claim();
            return;
        }
        shown = on;
        log.info('fullview: ' + (on ? 'shown' : 'hidden'));
        if (!ready) return;
        if (on) { claim(); gpu.show(true); gpu.grab(true); lastCcu = null; }
        else { clearTimeout(holdTimer); gpu.grab(false); gpu.claim([]); claimed = false; gpu.show(false); }
    }
    return {
        H, scale, off: false,
        update(w) { want = !!w; apply(want && ready); },
        shown: () => shown,
        // the engine's frame file, named on this connection too (renderd.js names it again after a reconnect)
        video(id, file) { return gpu.video(id, file); },
        draw(fn) {
            if (!shown) return;
            const now = Date.now();
            if (gpu.waiting && now - lastFrame < KEEPALIVE_MS) return;
            rec.reset();
            fn(rec, H);
            gpu.frame(rec);
            lastFrame = now;
        },
    };
}

module.exports = { createFullView, SCREEN_W, SCREEN_H };
