'use strict';
// Metronome sync: link format, shared beat grid math, tempo re-anchoring, offsets, and the QR encoder.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const context = { TextEncoder };
vm.createContext(context);
vm.runInContext(read('metronome-sync.js'), context);
vm.runInContext(read('qr.js'), context);
const sync = context.metronomeSync;

// Link format
const t0 = 1762870000123;
assert.equal(sync.formatSync({ bpm: 90, t0 }), 'sync=90.1762870000123');
assert.deepEqual({ ...sync.parseSync('#sync=90.1762870000123') }, { bpm: 90, t0 });
assert.deepEqual({ ...sync.parseSync('sync=240.1762870000123') }, { bpm: 240, t0 });
for (const bad of ['', '#', '#sync=30.1762870000123', '#sync=241.1762870000123', '#sync=90', '#sync=90.abc', '#other=1', '#sync=90.17628700001234567'])
  assert.equal(sync.parseSync(bad), null, `rejects ${bad}`);

// Grid: every phone computes the same beat times and the same bar position from the link alone.
const grid = { bpm: 120, t0 }; // 500 ms per beat
assert.equal(sync.intervalMs(120), 500);
assert.equal(sync.nextBeatIndex(grid, t0), 0);
assert.equal(sync.nextBeatIndex(grid, t0 + 1), 1);
assert.equal(sync.nextBeatIndex(grid, t0 + 500), 1);
assert.equal(sync.nextBeatIndex(grid, t0 + 1999), 4);
assert.equal(sync.nextBeatIndex(grid, t0 - 600), -1, 'Joining before t0 still lands on the grid');
assert.equal(sync.beatEpoch(grid, 7), t0 + 3500);
assert.deepEqual([0, 1, 4, 7, -1, -4].map(sync.beatInBar), [0, 1, 0, 3, 3, 0]);
// Two phones joining at different moments agree on which beat is the accented first beat.
for (const joinA of [t0 + 10, t0 + 777, t0 + 123456]) {
  const k = sync.nextBeatIndex(grid, joinA);
  assert.equal((sync.beatEpoch(grid, k) - t0) % 2000 === 0, sync.beatInBar(k) === 0);
}

// Leader taking over a running beat: the current beat keeps its time and bar position.
const running = sync.gridFromBeat(100, t0 + 5000, 2);
assert.equal(running.t0, t0 + 5000 - 2 * 600);
assert.equal(sync.beatEpoch(running, 2), t0 + 5000);

// Tempo change: the next beat stays put and keeps its place in the bar.
const { grid: faster, k } = sync.retime(grid, 6, 150); // beat 6 = beat 3 of bar 2 at t0+3000
assert.equal(k, 2);
assert.equal(sync.beatEpoch(faster, k), t0 + 3000);
assert.equal(sync.beatEpoch(faster, k + 1) - sync.beatEpoch(faster, k), 400);
assert.equal(sync.beatInBar(k + 2), 0, 'Bar continues: two more beats to the next first beat');

// Per-device timing offset
assert.equal(sync.clampOffset('25'), 25);
assert.equal(sync.clampOffset(-999), -300);
assert.equal(sync.clampOffset(999), 300);
assert.equal(sync.clampOffset('x'), 0);

// QR encoder: correct size per version and well-formed finder patterns. (Decoding is checked separately with a real decoder.)
const link = 'https://guitar-mate.pages.dev/metronome#sync=90.1762870000123';
const m = context.gmQr.matrix(link);
assert.equal(m.length, 33, 'A sync link fits in version 4 (33×33)');
for (const [x, y] of [[0, 0], [m.length - 7, 0], [0, m.length - 7]]) {
  for (let i = 0; i < 7; i++) {
    assert(m[y][x + i] && m[y + 6][x + i] && m[y + i][x] && m[y + i][x + 6], 'finder outline');
    assert(m[y + 3][x + 3], 'finder center');
  }
}
assert.equal(context.gmQr.matrix('A').length, 21);
assert.throws(() => context.gmQr.matrix('x'.repeat(300)), /too long/);
assert.match(context.gmQr.svg(link), /^<svg [^>]*viewBox="0 0 41 41"/);

// Page wiring
const page = read('metronome.html');
assert(page.indexOf('src="./qr.js"') > 0 && page.indexOf('src="./metronome-sync.js"') > 0, 'metronome page loads sync scripts');
assert(page.indexOf('src="./metronome-sync.js"') < page.indexOf("const sync=window.metronomeSync"), 'sync helpers load before the page script');
const sw = read('sw.js');
for (const asset of ['./qr.js', './metronome-sync.js']) assert(sw.includes(`'${asset}'`), asset + ' is cached for offline use');

console.log('Metronome sync: link format, shared grid, tempo re-anchoring, offsets, QR encoder and wiring passed.');
