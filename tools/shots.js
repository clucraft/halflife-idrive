'use strict';
/**
 * shots.js - the app's pages as PNGs, drawn on this computer (no car, no game data):
 *
 *   node tools/shots.js [outDir]        default docs/
 *
 * The real store and ui of apps/clucraft_halflife, the real service (native/clucraft-halflife) with the stand-in
 * engine and an invented stick; the kit's software canvas draws them (tools/stage.js). The game's picture is a
 * stand-in: the software path has no video. Pictures of the real game come from tools/run/service.sh.
 */
const fs = require('fs');
const path = require('path');
const { createStage, ROOT } = require('./stage');

const out = path.resolve(process.argv[2] || path.join(ROOT, 'docs'));
const quietLog = console.log;
console.log = (s) => { if (/^shot /.test(String(s))) quietLog(s); };   // (the service's own log lines are not wanted here)

(async () => {
    fs.mkdirSync(out, { recursive: true });
    const save = (st, name) => { st.frame(); fs.writeFileSync(path.join(out, name + '.png'), st.png()); console.log('shot ' + name + '.png  (' + (st.S.view === 'game' ? 'the game view' : st.S.page) + ')'); };

    // no stick yet
    let st = await createStage({ stick: 'none', carPaths: true });
    await st.until(() => st.S.st && st.S.st.selftest, 6000, 'the status');
    save(st, 'app-no-stick');
    await st.close();

    st = await createStage({ carPaths: true, settings: { stats: true }, service: { engine: { env: { FAKE_STAT_MS: '100' } } } });
    const S = st.S;
    await st.until(() => S.st && S.st.selftest, 6000, 'the status');
    save(st, 'app-launcher');

    // not parked: the launcher says so
    st.car.parked = false;
    await st.settle(200);
    st.frame(); await st.tap('new');
    save(st, 'app-not-parked');
    S.toast = null;
    st.car.parked = true;
    await st.settle(200);

    st.frame(); await st.tap('new');
    await st.until(() => S.view === 'game' && S.stat() && S.stat().state === 'game', 6000, 'the game');
    await st.settle(2300);
    save(st, 'app-game');

    // the car moves with the game up
    st.car.parked = false;
    await st.until(() => S.engine().held, 4000, 'the hold');
    save(st, 'app-game-moving');
    st.car.parked = true;
    await st.until(() => !S.engine().held, 4000, 'the game going on');

    S.back();
    await st.until(() => S.engine().held, 4000, 'the hold');
    save(st, 'app-launcher-running');
    S.go('status');
    await st.settle(300);
    save(st, 'app-status');
    S.go('log');
    await st.until(() => S.logs, 3000, 'the log');
    save(st, 'app-log');
    await st.close();
    process.exit(0);
})().catch((e) => { console.error('shots: ' + (e && e.stack || e)); process.exit(1); });
