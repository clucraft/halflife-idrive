'use strict';
/**
 * Builds native/clucraft-halflife/bin/clucraft-hl-pad, the program that passes a USB gamepad's packets to the
 * service (native/clucraft-halflife/pad.js says what it is for), and writes bin/PAD.json beside it:
 *
 *   node tools/build/build-pad.js
 *
 * The source is port/usbpipe/main.go: nes-idrive's nes-usbpipe, unchanged (github.com/clucraft/nes-idrive,
 * GPL-2.0-or-later). It ships here under a file name of this tool's own, because the head unit's crash handler
 * knows programs by file name and two tools should not share one.
 *
 * It needs Go (https://go.dev), 1.21 or later, and nothing else, on any computer: the result is a Linux program
 * for the head unit's processor (x86-64) with no library it depends on. The same source and the same Go give
 * the same file; PAD.json records both, and whether the file is byte for byte the one in nes-idrive.
 * (After nes-idrive's tools/build-usbpipe.js, with the same flags.)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'port', 'usbpipe');
const BIN = path.join(ROOT, 'native', 'clucraft-halflife', 'bin');
const NAME = 'clucraft-hl-pad';
// where the source was taken from, and the file its own repository commits there
const ORIGIN = {
    repository: 'https://github.com/clucraft/nes-idrive', branch: 'mgu-store', commit: 'f80c7be750b5973b2c2a4a15ffc264d132d93b31',
    source: 'loader/src/nes-usbpipe/main.go', program: 'loader/nes-usbpipe',
    programSha256: 'abb9d033d4e2b65507ed3f1684ece3c90c419c6f99b3a3af01f31401ece995fe',
};
const FLAGS = ['-trimpath', '-ldflags', '-s -w -buildid='];
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');

try {
    const env = Object.assign({}, process.env, { GOOS: 'linux', GOARCH: 'amd64', CGO_ENABLED: '0', GOFLAGS: '-buildvcs=false' });
    const go = String(execFileSync('go', ['env', 'GOVERSION'], { env })).trim();
    execFileSync('go', ['vet', '.'], { cwd: SRC, env, stdio: 'inherit' });
    fs.mkdirSync(BIN, { recursive: true });
    // (no paths of this computer and no build id in it)
    execFileSync('go', ['build'].concat(FLAGS, ['-o', path.join(BIN, NAME), '.']), { cwd: SRC, env, stdio: 'inherit' });
    const file = fs.readFileSync(path.join(BIN, NAME));
    const manifest = {
        origin: ORIGIN,
        source: { path: 'port/usbpipe/main.go', sha256: sha(fs.readFileSync(path.join(SRC, 'main.go'), 'utf8').replace(/\r\n/g, '\n')) },
        built: { go, flags: 'GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build ' + FLAGS.join(' ') },
        file: { name: NAME, size: file.length, sha256: sha(file) },
        sameAsOrigin: sha(file) === ORIGIN.programSha256,
    };
    fs.writeFileSync(path.join(BIN, 'PAD.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log('build-pad: bin/' + NAME + ' (' + Math.round(file.length / 1024) + ' KiB, sha256 ' + manifest.file.sha256.slice(0, 16) + '...), '
        + (manifest.sameAsOrigin ? 'byte for byte nes-idrive\'s nes-usbpipe' : 'NOT the same bytes as nes-idrive\'s nes-usbpipe (another Go version?)') + ', with ' + go);
} catch (e) {
    console.error('build-pad: ' + (e.code === 'ENOENT' ? 'Go is not installed (https://go.dev)' : e.message));
    process.exit(1);
}
