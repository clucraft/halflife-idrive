'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * gamedata.js - where the owner's Half-Life data is, and where saves and config go.
 *
 * The game data is never part of this project: the owner copies the "valve" folder of their own copy of
 * Half-Life to a USB stick. The head unit mounts sticks under /media, read-only. This module looks at what is
 * mounted there (it mounts and changes nothing) for a folder that holds valve/, at the stick's top or in a folder
 * named Half-Life, halflife or hl. Names are matched without regard to case, as FAT keeps them.
 *
 * Saves and config: on the stick, in its folder halflife-idrive, when the stick is mounted writable and a file
 * can really be made there; otherwise in the service's own state folder on the head unit. The engine reads the
 * game data through its read-only root (-rodir) and writes only to that other folder.
 *
 *   find({ mounts, roots })  -> { found, root, mount: { dir, dev, type, ro }, sticks, why, missing }
 *   pickBase(mount, stateDir) -> { dir, where: 'stick' | 'unit', why }
 *
 * Plain Node 8.
 */
const fs = require('fs');
const path = require('path');

/** what a usable copy has at least (the first chapter: the tram ride is c0a0) */
const MARKS = [['valve', 'liblist.gam'], ['valve', 'halflife.wad'], ['valve', 'maps', 'c0a0.bsp']];
const FOLDERS = [null, 'half-life', 'halflife', 'hl'];
const SAVE_FOLDER = 'halflife-idrive';

/** /proc/mounts escapes space, tab, newline and backslash as \ooo */
const unescape = (s) => s.replace(/\\([0-7]{3})/g, (m, o) => String.fromCharCode(parseInt(o, 8)));

/** the mounts under one of `roots`: [{ dir, dev, type, ro }] */
function mountsUnder(file, roots) {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return []; }
    const out = [];
    text.split('\n').forEach((line) => {
        const f = line.split(' ');
        if (f.length < 4) return;
        const dir = unescape(f[1]);
        // (path.sep too: the tests run this on any computer, with an invented stick in a temporary folder)
        if (!roots.some((r) => { const b = r.replace(/[\\/]+$/, ''); return dir.indexOf(b + '/') === 0 || dir.indexOf(b + path.sep) === 0; })) return;
        out.push({ dir, dev: unescape(f[0]), type: f[2], ro: f[3].split(',').indexOf('ro') >= 0 });
    });
    return out;
}

/** the entry of `dir` named `name` whatever its case, or null */
function entry(dir, name) {
    let list;
    try { list = fs.readdirSync(dir); } catch (e) { return null; }
    if (list.indexOf(name) >= 0) return name;
    const want = name.toLowerCase();
    for (let i = 0; i < list.length; i++) if (list[i].toLowerCase() === want) return list[i];
    return null;
}

/** dir/a/b/c with each part matched without regard to case, or null */
function resolve(dir, parts) {
    let p = dir;
    for (let i = 0; i < parts.length; i++) {
        const e = entry(p, parts[i]);
        if (e === null) return null;
        p = path.join(p, e);
    }
    return p;
}

/** the marks `root` lacks, as paths */
function missingIn(root) {
    return MARKS.filter((m) => resolve(root, m) === null).map((m) => m.join('/'));
}

function find(o) {
    const opts = o || {};
    const list = mountsUnder(opts.mounts || '/proc/mounts', opts.roots || ['/media']);
    if (!list.length) return { found: false, sticks: [], why: 'No USB stick is mounted.' };
    let partial = null;
    for (let i = 0; i < list.length; i++) {
        for (let j = 0; j < FOLDERS.length; j++) {
            const root = FOLDERS[j] === null ? list[i].dir : resolve(list[i].dir, [FOLDERS[j]]);
            if (root === null || resolve(root, ['valve']) === null) continue;
            const missing = missingIn(root);
            if (!missing.length) return { found: true, root, mount: list[i], sticks: list.map((m) => m.dir) };
            if (!partial) partial = { root, missing };
        }
    }
    const sticks = list.map((m) => m.dir);
    if (partial) return { found: false, sticks, root: partial.root, missing: partial.missing, why: 'The copy in ' + partial.root + ' is not complete: ' + partial.missing.join(', ') + ' missing.' };
    return { found: false, sticks, why: 'No valve folder on ' + sticks.join(', ') + '. Copy the valve folder of your Half-Life to the stick\'s top or into a folder named Half-Life.' };
}

/** can a file really be made in `dir`? (a mount may say rw and still refuse) */
function writable(dir) {
    const probe = path.join(dir, '.write-test-' + process.pid);
    try {
        try { fs.mkdirSync(dir, 0o755); } catch (e) { if (e.code !== 'EEXIST') throw e; }
        fs.writeFileSync(probe, 'x');
        fs.unlinkSync(probe);
        return true;
    } catch (e) {
        try { fs.unlinkSync(probe); } catch (x) { /* never made */ }
        return false;
    }
}

function pickBase(mount, stateDir) {
    if (mount && !mount.ro) {
        const dir = path.join(mount.dir, SAVE_FOLDER);
        if (writable(dir)) return { dir, where: 'stick', why: 'the stick is writable' };
    }
    const dir = path.join(stateDir, 'base');
    try { fs.mkdirSync(dir, 0o700); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    return { dir, where: 'unit', why: mount ? (mount.ro ? 'the stick is mounted read-only' : 'the stick refused a file') : 'no stick' };
}

/** bytes under `dir` (saves and config are small; a guard against something growing unseen) */
function bytesUnder(dir, depth) {
    let n = 0, list;
    try { list = fs.readdirSync(dir); } catch (e) { return 0; }
    for (let i = 0; i < list.length; i++) {
        let s;
        try { s = fs.lstatSync(path.join(dir, list[i])); } catch (e) { continue; }
        if (s.isDirectory()) { if ((depth || 0) < 6) n += bytesUnder(path.join(dir, list[i]), (depth || 0) + 1); } else if (s.isFile()) n += s.size;
    }
    return n;
}

module.exports = { find, pickBase, mountsUnder, resolve, bytesUnder, MARKS, SAVE_FOLDER };
