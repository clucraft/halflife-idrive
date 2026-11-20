'use strict';
/**
 * input.js - what the iDrive controller and a finger mean to the game, as the service's input events
 * ([['k', key, down], ['t', phase, x, y]]: native/clucraft-halflife/service.js). No head unit in here.
 *
 * The controller is for the game's menus, where it does what arrow keys and Enter do:
 *   turned, a click at a time     down (clockwise) or up
 *   pressed                       Enter
 *   pushed up, down, right        the arrow keys
 *   pushed left                   Escape: back one menu, or the game's menu over the game
 *   held down for a second        not for the game: main.js leaves the game view (fullview.js tells it "hold")
 * In the game itself that is not enough to play with. A gamepad is (the service reads it, not this app).
 *
 * A finger (only with the setting "Touch in the game's menus") is the mouse pointer of the game's menus.
 *
 * Node 8.
 */
// the engine's key numbers (xash3d-fwgs engine/keydefs.h)
const KEY = { ENTER: 13, ESCAPE: 27, UP: 128, DOWN: 129, LEFT: 130, RIGHT: 131 };
const MAX_CLICKS = 8;   // a spin of the knob is not that many presses of a key
const TILT = { N: KEY.UP, S: KEY.DOWN, E: KEY.RIGHT, W: KEY.ESCAPE };

const tap = (key) => [['k', key, 1], ['k', key, 0]];

/** c: fullview.js's { turn, press, tilt } */
function fromController(c) {
    let ev = [];
    if (!c) return ev;
    const n = Math.max(-MAX_CLICKS, Math.min(MAX_CLICKS, Math.round(Number(c.turn) || 0)));
    for (let i = 0; i < Math.abs(n); i++) ev = ev.concat(tap(n > 0 ? KEY.DOWN : KEY.UP));
    if (c.press) ev = ev.concat(tap(KEY.ENTER));
    if (c.tilt && TILT[c.tilt]) ev = ev.concat(tap(TILT[c.tilt]));
    return ev;
}

/** phase 1 down, 2 moved, 3 up (the renderer's), at x, y of a view w wide and h high -> the engine's 0 down, 2 moved, 1 up */
function fromTouch(phase, x, y, w, h) {
    const p = phase === 1 ? 0 : phase === 2 ? 2 : phase === 3 ? 1 : -1;
    if (p < 0 || !(w > 0 && h > 0)) return [];
    const u = (v) => Math.round(Math.max(0, Math.min(1, v)) * 10000) / 10000;
    return [['t', p, u(x / w), u(y / h)]];
}

module.exports = { fromController, fromTouch, KEY, MAX_CLICKS };
