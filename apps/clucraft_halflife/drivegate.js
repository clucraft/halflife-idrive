'use strict';
/**
 * drivegate.js - is the car parked? The game is for a parked car only, so the answer is strict:
 *
 *   parked     all of: a speed the car sent in the last 10 s, under 1 km/h, and the selector in P (a car that
 *              only tells "N or P" counts as P, with the same speed rule)
 *   otherwise  not parked: no speed yet, no selector signal, a speed that stopped arriving, an error
 *
 * There is no test switch, no setting and no "assume parked" in here. The app tells the service what this says
 * twice a second; the service holds the game whenever the app does not say "parked", and when it says nothing.
 *
 * (clucraft_plex's drivegate.js, clucraft/plex-idrive, MIT, without its passenger setting: see NOTICE.)
 *
 *   const gate = createGate({ now });            the parked check alone (the tests feed it)
 *   gate.speed(v)  gate.stage(s)  gate.parked()  gate.why()
 *   watch(signals, log, gate)                    feeds a gate from the vehicle signals (speed polled every 2 s)
 *
 * Node 8.
 */
const MAX_KMH = 1;
const STALE_MS = 10000;

// selector position: statusGearboxDrive.statusActualStageDrive (P = 1 or 'P') and
// DataPowerTrain2.statusGearSelectionDrive (P = 3 or 'P'; 4 = 'NP': N or P, not told apart)
function stageFromGearbox(v) {
    const x = v && v.statusActualStageDrive;
    if (x == null) return undefined;
    return x === 1 || x === 'P' ? 'P' : String(x);
}
function stageFromSelection(v) {
    const x = v && v.statusGearSelectionDrive;
    if (x == null) return undefined;
    return x === 3 || x === 'P' ? 'P' : x === 4 || x === 'NP' || x === 'N_OR_P' ? 'NP' : String(x);
}

function createGate(o) {
    const now = (o && o.now) || Date.now;
    const st = { speed: null, speedT: 0, stage: undefined, stageT: 0 };
    return {
        st,
        /** Vehicle2.statusCarSpeed2: speedVehicleCentreOfGravity, 1/64 km/h a step, 65535 = no value */
        speed(v) {
            const k = v && v.speedVehicleCentreOfGravity;
            if (typeof k === 'number' && k >= 0 && k !== 65535) { st.speed = k * 0.015625; st.speedT = now(); }
        },
        stage(s) { if (s !== undefined) { st.stage = s; st.stageT = now(); } },
        parked() {
            const n = now();
            return st.speed !== null && n - st.speedT < STALE_MS && st.speed < MAX_KMH && (st.stage === 'P' || st.stage === 'NP');
        },
        why() {
            const n = now();
            const sp = st.speed === null ? 'speed unknown' : 'speed ' + st.speed.toFixed(1) + ' km/h' + (n - st.speedT >= STALE_MS ? ' (old)' : '');
            const sg = st.stage === undefined ? 'selector unknown' : 'selector ' + st.stage;
            return sp + ', ' + sg;
        },
    };
}

/** feeds gate g from the vehicle signals; never throws (a gate nothing feeds is never parked) */
function watch(signals, log, g) {
    try {
        if (!signals || typeof signals.watch !== 'function') throw new Error('no vehicle signals');
        const said = (what) => (s) => log && log.info('drive gate: ' + what + ' ' + (s && s.error ? 'error: ' + s.error : 'subscribed'));
        const failed = (what) => (e) => log && log.warn('drive gate: ' + what + ' error: ' + ((e && e.message) || e));
        signals.watch('de.bmw.infotainment.vehicle.Vehicle2', '1', { statusCarSpeed2: (v) => g.speed(v) }, log, { pollMs: 2000 })
            .then(said('speed'), failed('speed'));
        signals.watch('de.bmw.infrastructure.VehicleInformation', '1', {
            statusGearboxDrive: (v) => g.stage(stageFromGearbox(v)),
            DataPowerTrain2: (v) => g.stage(stageFromSelection(v)),
        }, log, { pollMs: 2000 }).then(said('selector'), failed('selector'));
    } catch (e) {
        if (log) log.warn('drive gate: ' + ((e && e.message) || e) + ' - never parked');
    }
    return g;
}

module.exports = { createGate, watch, stageFromGearbox, stageFromSelection, MAX_KMH, STALE_MS };
