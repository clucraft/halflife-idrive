'use strict';
/**
 * store.js - what the app knows and does, without a screen: the service's last status, which page is up, whether
 * the game view is wanted, and the few things a button can ask for. main.js feeds it the car (parked, shown);
 * ui.js draws from it; the tests drive it with a stand-in for the service.
 *
 *   const S = createStore({ ask, settings, log, now });
 *   S.poll(parked, shown)     the app's beat to the service (twice a second) -> Promise; fills S.st / S.err
 *   S.play(mode, parked)      'continue' | 'new' | 'menu': start a game and show it
 *   S.resume()  S.leave()     the game view up again / back to the pages (the game then stands still)
 *   S.stop()                  save and end the game
 *   S.page                    'home' | 'status' | 'log';  S.view  'pages' | 'game'
 *   S.say(text)               a line shown on the page for a few seconds
 *
 * Node 8.
 */
const TOAST_MS = 6000;

function createStore(o) {
    const now = o.now || Date.now;
    const log = o.log || { info() {}, warn() {} };
    const S = {
        st: null,          // the service's status, as it last answered
        err: null,         // { code, message } while it does not answer
        at: 0,
        page: 'home',
        view: 'pages',
        toast: null,
        logs: null,        // { service, engine, at }
        busy: null,        // 'start' | 'stop' while one is asked for
    };
    let wasRunning = false, polling = false;
    let seen = null, copying = false;   // the service's and the engine's lines already in this app's log

    S.say = (text) => { S.toast = { text: String(text), until: now() + TOAST_MS }; };
    S.toastText = () => (S.toast && S.toast.until > now() ? S.toast.text : null);
    S.engine = () => (S.st && S.st.engine) || { state: 'stopped' };
    S.running = () => S.engine().state !== 'stopped';
    S.stat = () => S.engine().stat || null;
    S.ready = () => !!(S.st && !S.err);
    /** why no game can start right now, or null */
    S.blocked = (parked) => {
        if (S.err) return S.err.message;
        if (!S.st) return 'Asking the service';
        if (S.st.selftest && !S.st.selftest.ok) return 'The engine does not load on this head unit';
        if (!S.st.data.found) return S.st.data.why || 'No game data';
        if (!parked) return 'Park the car first (selector in P)';
        return null;
    };

    function took(s) {
        S.st = s; S.err = null; S.at = now();
        const running = S.running();
        // the game ended while it was up (its own Quit, a crash, the service's rules): back to the pages, saying why
        if (wasRunning && !running) {
            if (S.view === 'game') S.view = 'pages';
            const e = S.engine();
            if (e.error) S.say(e.error);
            else if (e.last && e.last.why && e.last.why !== 'the app asked' && e.last.why !== 'quit') S.say('The game ended: ' + e.last.why);
        }
        if (!running && S.view === 'game' && !S.busy) S.view = 'pages';
        wasRunning = running;
        return s;
    }
    // The service's log is in the head unit's memory and the engine's in the service's: both are gone with them.
    // This app's log is a file on the unit, so what they say is copied there, each line once: the frame rate, the
    // load and the temperature of a game, why one stood still or ended, what the engine said of the sound.
    function copyLog(s) {
        const no = s && s.log;
        if (!no || copying || (seen && seen.service === no.service && seen.engine === no.engine)) return;
        copying = true;
        o.ask({ cmd: 'log' }, 4000).then((l) => {
            copying = false;
            if (!l || !l.no) return;
            // (a service that started anew counts from nothing again)
            const had = seen && seen.service <= l.no.service && seen.engine <= l.no.engine ? seen : { service: 0, engine: 0 };
            const fresh = (arr, last, before) => (arr || []).filter((x, i) => last - (arr.length - 1 - i) > before);
            // (what the engine says on stderr is in both: taken from the engine's)
            fresh(l.service, l.no.service, had.service).filter((x) => !/^[0-9:]+ engine says: /.test(x)).forEach((x) => log.info('service: ' + x));
            fresh(l.engine, l.no.engine, had.engine).forEach((x) => log.info('engine: ' + x));
            seen = { service: l.no.service, engine: l.no.engine };
        }, () => { copying = false; });
    }

    function failed(e) {
        S.err = { code: e.code || 'ERR', message: e.message || String(e) };
        S.st = null;
        if (S.view === 'game') S.view = 'pages';
        wasRunning = false;
        return null;
    }

    S.poll = (parked, shown) => {
        if (polling) return Promise.resolve(S.st);
        polling = true;
        return o.ask({ cmd: 'beat', parked: parked === true, shown: shown === true }, 4000)
            .then(took, failed).then((v) => { polling = false; copyLog(v); return v; });
    };

    S.play = (mode, parked) => {
        if (S.busy) return Promise.resolve(false);
        const why = S.blocked(parked);
        if (why) { S.say(why); return Promise.resolve(false); }
        if (S.running()) { S.view = 'game'; return Promise.resolve(true); }
        S.busy = 'start';
        const size = String((o.settings && o.settings.get('size')) || '1280x480');
        // (a first run on a car is easier to read one thing at a time: the picture without the sound)
        const sound = !(o.settings && o.settings.get('sound') === false);
        log.info('start: ' + mode + ', ' + size + (sound ? '' : ', without sound'));
        // the service wants a fresh "parked" before it starts anything: said first, in the same breath
        return o.ask({ cmd: 'beat', parked: true, shown: false }, 4000)
            .then(() => o.ask({ cmd: 'start', mode, size, sound }, 8000))
            .then((s) => {
                S.busy = null;
                took(s);
                if (s.refused) { S.say(s.refused); return false; }
                S.view = 'game';
                return true;
            }, (e) => { S.busy = null; failed(e); S.say(S.err.message); return false; });
    };
    S.resume = () => { if (S.running()) S.view = 'game'; };
    S.leave = () => { S.view = 'pages'; };
    S.stop = () => {
        if (S.busy) return Promise.resolve(false);
        S.busy = 'stop';
        S.view = 'pages';
        return o.ask({ cmd: 'stop' }, 20000).then((s) => { S.busy = null; took(s); return true; }, (e) => { S.busy = null; failed(e); return false; });
    };
    S.loadLog = () => o.ask({ cmd: 'log' }, 4000).then((l) => { S.logs = { service: l.service || [], engine: l.engine || [], at: now() }; }, () => {});
    S.go = (page) => { S.page = page; if (page === 'log') S.loadLog(); };
    /** BACK: out of the game view, else to the first page; false when there is nothing to go back to */
    S.back = () => {
        if (S.view === 'game') { S.leave(); return true; }
        if (S.page !== 'home') { S.page = 'home'; return true; }
        return false;
    };
    return S;
}

module.exports = { createStore, TOAST_MS };
