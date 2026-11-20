'use strict';
/**
 * ui.js - the app's pages and the game view, drawn from the store (store.js) onto the kit's recorder. No head unit
 * in here: main.js gives it the fonts, a way to make a button, and what the car says, so the tests and
 * tools/shots.js can draw everything on a PC.
 *
 *   const ui = createUi({ S, B, M, btn, env });
 *     B, M     text options of the bold and the medium font ({ font, literal: true })
 *     btn(cv, key, x, y, w, h, fn, r)   a touch target (and the controller's) over what was just drawn
 *     env      { W, VID, version, parked(), parkedWhy(), videoReady(), audio(), stats(), noVideo }
 *   ui.draw(cv, A, fullH)     the pages: the launcher, the status, the log
 *   ui.drawGame(cv, H)        the game over a view W x H: the picture, and what is said over it
 *
 * The page is 1600 logical px wide; A (kit/fullscreen.js area) is the part a finger can reach.
 *
 * Node 8 only: no ?. ?? object spread, class fields or optional catch binding.
 */
const C = {
    bg: '#0b0b0e', card: '#17171c', pill: '#25252d', line: '#2c2c35', text: '#ffffff', grey: '#a3a3ad', dim: '#6c6c78',
    accent: '#f28c1e', green: '#34c759', amber: '#ffb020', red: '#ff5247', black: '#000000',
};
const PAGES = [['home', 'Game'], ['status', 'Status'], ['log', 'Log']];
const STATE = { stopped: 'not running', starting: 'starting', running: 'running', stopping: 'saving and ending' };
const IN_GAME = { menu: 'in its menu', loading: 'loading', game: 'in the game', paused: 'its menu over the game', video: 'playing a video', held: 'standing still' };

const A_ = (c, a) => { const s = String(c).replace('#', '').slice(0, 6); return '#' + s + ('0' + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16)).slice(-2); };
// the app's fonts have Latin-1: anything else is left out
const clean = (s) => String(s == null ? '' : s).replace(/[^\x20-\x7e\xa1-\xff]/g, '');

function createUi(o) {
    const S = o.S, B = o.B, M = o.M, env = o.env, W = env.W || 1600;
    const btn = o.btn;
    const center = (opt) => Object.assign({ align: 'center' }, opt);
    const right = (opt) => Object.assign({ align: 'right' }, opt);

    const fits = {};
    function fit(cv, s, size, w, opt) {
        s = clean(s);
        const k = s + '|' + size + '|' + Math.round(w) + '|' + (opt || M).font;
        if (fits[k] !== undefined) return fits[k];
        let out = s;
        if (cv.textWidth(s, size, opt || M) > w) {
            let lo = 0, hi = s.length;
            while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cv.textWidth(s.slice(0, mid) + '...', size, opt || M) <= w) lo = mid; else hi = mid - 1; }
            out = s.slice(0, lo).replace(/\s+$/, '') + '...';
        }
        if (Object.keys(fits).length > 800) Object.keys(fits).slice(0, 400).forEach((x) => { delete fits[x]; });
        fits[k] = out;
        return out;
    }
    function pill(cv, key, x, y, w, h, label, fn, p) {
        p = p || {};
        cv.roundRect(x, y, w, h, h / 2, p.fill || (p.on ? C.accent : C.pill));
        cv.text(fit(cv, label, p.size || 22, w - 28, B), x + w / 2, y + h / 2 + (p.size || 22) * 0.36, p.size || 22, p.color || (p.on ? C.black : C.text), center(B));
        if (fn) btn(cv, key, x, y, w, h, fn, h / 2);
    }

    /* ---------- the launcher ---------- */
    /** the gamepad, as the service sees it. None is no fault (amber): the game starts, and its menus work without */
    function padRow(p) {
        if (!p) return [C.amber, 'Gamepad', 'this service reads none'];
        if (p.program && !p.program.ok) return [C.red, 'Gamepad', 'its reader does not run on this head unit'];
        if (p.reading) return [C.green, 'Gamepad', (p.name || 'a pad') + ', in use'];
        if (p.error) return [C.amber, 'Gamepad', p.error];
        if (p.found) return [C.green, 'Gamepad', (p.name || 'a pad') + ', plugged in'];
        return [C.amber, 'Gamepad', 'none found: plug in an Xbox One or Series pad on a cable'];
    }
    /** what a game needs, each: [colour, name, what is known] */
    function checks() {
        const st = S.st, parked = env.parked();
        const rows = [];
        if (S.err) rows.push([C.red, 'Service', S.err.message]);
        else if (!st) rows.push([C.amber, 'Service', 'asking']);
        else rows.push([C.green, 'Service', 'version ' + st.version]);
        if (st) {
            const t = st.selftest;
            rows.push(!t ? [C.amber, 'Engine', 'being checked'] : t.ok ? [C.green, 'Engine', 'loads on this head unit'] : [C.red, 'Engine', t.line || 'does not load on this head unit']);
            const d = st.data;
            rows.push(d.found ? [C.green, 'Game data', d.root] : [d.sticks && d.sticks.length ? C.red : C.amber, 'Game data', d.why || 'not found']);
            const sv = st.saves;
            if (sv) rows.push([C.green, 'Saves', (sv.where === 'stick' ? 'on the stick' : 'on the head unit (' + sv.why + ')') + (sv.canContinue ? ', a saved game is there' : '')]);
            rows.push(padRow(st.pad));
        }
        rows.push(parked ? [C.green, 'Car', 'parked'] : [C.amber, 'Car', 'not parked: ' + env.parkedWhy()]);
        return rows;
    }
    function drawHome(cv, A, y0) {
        const colW = Math.min(900, A.w - 560);
        checks().forEach((r, i) => {
            const y = y0 + i * 52;
            cv.circle(A.x + 12, y + 20, 9, r[0]);
            cv.text(r[1], A.x + 36, y + 28, 23, C.text, B);
            cv.text(fit(cv, r[2], 20, colW - 200, M), A.x + 190, y + 28, 20, r[0] === C.green ? C.grey : r[0], M);
        });

        const bx = A.x + colW + 40, bw = A.right - bx, bh = 66;
        const e = S.engine(), parked = env.parked();
        let by = y0;
        const action = (key, label, fn, on) => { pill(cv, key, bx, by, bw, bh, label, fn, { on, size: 24 }); by += bh + 16; };
        if (S.busy) {
            pill(cv, 'busy', bx, by, bw, bh, S.busy === 'start' ? 'Starting' : 'Saving and ending', null, { size: 24, color: C.grey });
        } else if (S.running()) {
            action('resume', 'Back to the game', () => S.resume(), true);
            action('stop', 'Save and end the game', () => S.stop());
            cv.text(fit(cv, 'The game ' + (IN_GAME[(e.stat && e.stat.state) || ''] || STATE[e.state] || e.state) + (e.stat && e.stat.map ? ', map ' + e.stat.map : ''), 19, bw, M), bx + bw / 2, by + 20, 19, C.grey, center(M));
        } else {
            const can = S.st && S.st.saves && S.st.saves.canContinue;
            if (can) action('continue', 'Continue', () => S.play('continue', env.parked()), true);
            action('new', 'New game', () => S.play('new', env.parked()), !can);
            action('menu', 'The game\'s own menu', () => S.play('menu', env.parked()));
            const why = S.blocked(parked);
            if (why) cv.text(fit(cv, why, 19, bw, M), bx + bw / 2, by + 20, 19, C.amber, center(M));
        }
    }

    /* ---------- the status ---------- */
    function drawStatus(cv, A, y0) {
        const st = S.st, e = S.engine(), s = e.stat, sys = st && st.sys;
        const na = '-';
        const cols = [
            ['The game', [
                ['Engine', STATE[e.state] || e.state],
                ['Now', s ? (IN_GAME[s.state] || s.state) + (s.map ? ', map ' + s.map : '') : na],
                ['Frames a second', s ? s.fps.toFixed(1) : na],
                ['Picture', s && s.w ? s.w + ' x ' + s.h : na],
                ['Sound', !st ? na : !st.sound ? 'off' : !s ? na : s.sound ? 'on' + (s.underruns || s.stands ? ' (ran dry ' + s.underruns + ', stood ' + s.stands + ')' : '') : 'no device'],
                ['Speakers', (() => { const a = env.audio(); return a.error ? a.error : a.connected ? 'connected' : a.on ? 'connecting' : 'not asked for'; })()],
                ['Gamepad', padRow(st && st.pad)[2]],
            ]],
            ['The head unit', [
                ['Engine, CPU', sys && sys.cpu !== null ? sys.cpu + ' % of one core' : na],
                ['Engine, memory', sys && sys.rssMb !== null ? sys.rssMb + ' MB' : na],
                ['Temperature', sys && sys.tempC !== null ? sys.tempC + ' C' : na],
                ['Load', sys && sys.load !== null ? String(sys.load) : na],
                ['Memory free', sys && sys.memAvailMb !== null ? sys.memAvailMb + ' MB' : na],
                ['Car', env.parked() ? 'parked' : env.parkedWhy()],
                ['Saves', st && st.saves ? (st.saves.where === 'stick' ? 'on the stick' : 'on the head unit') : na],
            ]],
        ];
        const cw = (A.w - 40) / 2, rows = 7, pitch = 38, cardH = rows * pitch + 56;
        cols.forEach((col, ci) => {
            const x = A.x + ci * (cw + 40);
            cv.roundRect(x, y0, cw, cardH, 14, C.card);
            cv.text(col[0], x + 22, y0 + 34, 22, C.accent, B);
            col[1].forEach((r, i) => {
                const y = y0 + 72 + i * pitch;
                cv.text(r[0], x + 22, y, 19, C.grey, M);
                cv.text(fit(cv, r[1], 19, cw - 230, B), x + cw - 22, y, 19, C.text, right(B));
            });
        });
        const y = y0 + cardH + 30;
        const last = e.error || (e.last ? 'Last ended: ' + e.last.why + (e.last.code ? ' (code ' + e.last.code + ')' : '') : '');
        if (last) cv.text(fit(cv, last, 19, A.w, M), A.x, y, 19, e.error ? C.amber : C.dim, M);
        cv.text(fit(cv, 'App ' + env.version + (st ? ', service ' + st.version + (st.selftest ? ', ' + st.selftest.line : '') : ''), 17, A.w, M), A.x, y + 26, 17, C.dim, M);
    }

    /* ---------- the log ---------- */
    function drawLog(cv, A, y0) {
        const l = S.logs;
        if (!l) { cv.text('Asking the service', A.x, y0 + 30, 20, C.grey, M); return; }
        const rows = Math.max(4, Math.floor((A.bottom - y0 - 40) / 24));
        const half = Math.floor(rows / 2);
        const part = (title, lines, y, n) => {
            cv.text(title, A.x, y + 20, 19, C.accent, B);
            lines.slice(-n).forEach((s, i) => cv.text(fit(cv, s, 17, A.w, M), A.x, y + 46 + i * 24, 17, C.grey, M));
        };
        part('Service', l.service, y0, half - 1);
        part('Engine', l.engine, y0 + half * 24 + 20, rows - half - 1);
        pill(cv, 'reload', A.right - 150, y0 - 6, 150, 40, 'Read again', () => S.loadLog(), { size: 18 });
    }

    function draw(cv, A, fullH) {
        cv.fillRect(0, 0, W, fullH, C.bg);
        cv.text('Half-Life', A.x, A.y + 44, 44, C.text, B);
        cv.text('on Xash3D FWGS, with your own game data', A.x + 250, A.y + 44, 19, C.dim, M);
        let x = A.right;
        PAGES.slice().reverse().forEach((p) => {
            x -= 130;
            pill(cv, 'page_' + p[0], x, A.y + 6, 120, 46, p[1], () => S.go(p[0]), { on: S.page === p[0], size: 20 });
        });
        const y0 = A.y + 84;
        if (S.page === 'status') drawStatus(cv, A, y0);
        else if (S.page === 'log') drawLog(cv, A, y0);
        else drawHome(cv, A, y0);
        const t = S.toastText();
        if (t) {
            const tw = Math.min(A.w, cv.textWidth(clean(t), 21, B) + 56);
            cv.roundRect(A.x + (A.w - tw) / 2, A.bottom - 52, tw, 46, 23, C.amber);
            cv.text(fit(cv, t, 21, tw - 40, B), A.x + A.w / 2, A.bottom - 21, 21, C.black, center(B));
        } else if (S.page === 'home') {
            cv.text('The game takes the whole screen. Hold the controller down for a second to return here; the game then stands still.', A.x, A.bottom - 14, 18, C.dim, M);
        }
    }

    /* ---------- the game ---------- */
    function drawGame(cv, H) {
        const e = S.engine(), s = e.stat;
        const say = (a, b, col) => {
            cv.text(fit(cv, a, 34, W - 200, B), W / 2, H / 2 - 4, 34, col || C.text, center(B));
            if (b) cv.text(fit(cv, b, 21, W - 200, M), W / 2, H / 2 + 38, 21, C.grey, center(M));
        };
        cv.fillRect(0, 0, W, H, C.black);
        if (!env.parked()) {
            // not parked: no moving picture on a screen the driver sees, whatever the engine is doing
            say('The game stands still while the car is not parked', env.parkedWhy(), C.amber);
            return;
        }
        if (e.state === 'stopping') { say('Saving and ending'); return; }
        const pic = env.videoReady();
        if (pic && typeof cv.video === 'function' && !env.noVideo) cv.video(env.VID, 0, 0, W, H);
        else if (pic && env.noVideo) {
            cv.gradientRect(0, 0, W, H, [[0, '#1c1206'], [0.6, '#3a2408'], [1, '#0b0b0e']]);
            say('The game\'s picture', 'This screen shows no video; on the head unit the picture is here.', C.accent);
        } else say(e.state === 'starting' || (s && s.state === 'loading') ? 'Loading' : 'Waiting for the picture', s ? IN_GAME[s.state] || '' : '');
        if (env.stats() && s) {
            const sys = S.st && S.st.sys;
            const line = s.fps.toFixed(1) + ' fps' + (sys && sys.cpu !== null ? '   cpu ' + sys.cpu + ' %' : '') + (sys && sys.tempC !== null ? '   ' + sys.tempC + ' C' : '') + '   ' + s.w + ' x ' + s.h;
            const lw = cv.textWidth(line, 18, M) + 28;
            cv.roundRect(W - lw - 16, 14, lw, 34, 10, A_(C.black, 0.6));
            cv.text(line, W - 30, 37, 18, C.text, right(M));
        }
        if (s && s.state === 'held') {
            cv.roundRect(W / 2 - 150, 16, 300, 40, 20, A_(C.black, 0.7));
            cv.text('standing still', W / 2, 43, 20, C.amber, center(B));
        }
        const t = S.toastText();
        if (t) {
            const tw = Math.min(W - 200, cv.textWidth(clean(t), 21, B) + 56);
            cv.roundRect((W - tw) / 2, H - 70, tw, 46, 23, C.amber);
            cv.text(fit(cv, t, 21, tw - 40, B), W / 2, H - 39, 21, C.black, center(B));
        }
    }

    return { draw, drawGame, checks, C };
}

module.exports = { createUi, PAGES };
