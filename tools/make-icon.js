'use strict';
/**
 * make-icon.js - draws the app's tile icon, apps/clucraft_halflife/icon.png (140 x 140, transparent): a gamepad
 * in a frame the shape of the car's wide screen. The project's own mark, drawn here with the kit's canvas; no
 * third-party artwork and nobody's logo (in particular not the game's).
 * (After clucraft/plex-idrive's tools/make-icon.js, MIT: see NOTICE.)
 *
 *   node tools/make-icon.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { Canvas } = require(path.join(ROOT, 'kit', 'runtime', 'canvas'));

const S = 4, N = 140;                      // drawn four times the size, then averaged down: smooth edges
const big = new Canvas(N * S, N * S);
big.clear([0, 0, 0, 0]);
const k = (v) => v * S;
const WHITE = '#ffffff', ORANGE = '#f28c1e', DARK = '#101014';
// the screen: 8:3, a white frame
big.roundRect(k(8), k(40), k(124), k(60), k(11), WHITE);
big.roundRect(k(14), k(46), k(112), k(48), k(6), DARK);
// the gamepad on it: a body, two grips, a cross and two buttons
big.roundRect(k(40), k(56), k(60), k(22), k(11), ORANGE);
big.roundRect(k(38), k(64), k(18), k(22), k(8), ORANGE);
big.roundRect(k(84), k(64), k(18), k(22), k(8), ORANGE);
big.fillRect(k(50), k(61), k(4), k(12), DARK);
big.fillRect(k(46), k(65), k(12), k(4), DARK);
big.roundRect(k(80), k(60), k(6), k(6), k(3), DARK);
big.roundRect(k(88), k(66), k(6), k(6), k(3), DARK);
// its stand
big.fillRect(k(64), k(100), k(12), k(8), WHITE);
big.roundRect(k(46), k(107), k(48), k(6), k(3), WHITE);

const out = new Canvas(N, N);
for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) {
            const i = ((y * S + yy) * N * S + x * S + xx) * 4, al = big.d[i + 3];
            r += big.d[i] * al; g += big.d[i + 1] * al; b += big.d[i + 2] * al; a += al;
        }
        const o = (y * N + x) * 4;
        if (a) { out.d[o] = Math.round(r / a); out.d[o + 1] = Math.round(g / a); out.d[o + 2] = Math.round(b / a); out.d[o + 3] = Math.round(a / (S * S)); }
    }
}
const file = path.join(ROOT, 'apps', 'clucraft_halflife', 'icon.png');
fs.writeFileSync(file, Buffer.from(out.png()));
console.log('icon: ' + path.relative(ROOT, file) + ' (' + fs.statSync(file).size + ' bytes)');
