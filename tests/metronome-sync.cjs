'use strict';
// Metronome sync: link format, shared beat grid math, tempo re-anchoring, offsets, and the QR encoder.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const context = { TextEncoder, URLSearchParams };
vm.createContext(context);
vm.runInContext(read('metronome-sync.js'), context);
vm.runInContext(read('qr.js'), context);
const sync = context.metronomeSync;

// Room codes: 6 characters without look-alikes (0/O, 1/I/L), read from "#room=CODE"
const codes = new Set(Array.from({ length: 200 }, () => sync.makeRoomCode()));
assert(codes.size > 190, 'codes are random');
for (const c of codes) assert(sync.ROOM_CODE.test(c), c);
assert.equal(sync.makeRoomCode(() => 0), 'AAAAAA');
assert.equal(sync.makeRoomCode(() => 0.9999), '999999');
assert.equal(sync.parseRoom('#room=ABC234'), 'ABC234');
assert.equal(sync.parseRoom('room=abc234'), 'ABC234', 'lower case from a typed link still works');
for (const bad of ['', '#room=ABC23', '#room=ABC2345', '#room=ABCO23', '#room=ABC123', '#sync=90.1762870000123'])
  assert.equal(sync.parseRoom(bad), null, `rejects ${bad}`);

// Server clock offset: the fastest round trip wins (least network asymmetry)
const offset = sync.pickOffset([
  { sent: 1000, received: 1300, server: 5150 },   // rtt 300 → offset 4000
  { sent: 2000, received: 2040, server: 6021 },   // rtt 40  → offset 4001
  { sent: 3000, received: 2990, server: 0 },      // impossible, ignored
]);
assert.deepEqual({ ...offset }, { rtt: 40, offset: 4001 });
assert.equal(sync.pickOffset([]), null);

// Server address: production vs branch previews; ?server= override only on localhost
const config = { subdomain: 'acct', productionHost: 'guitar-mate.pages.dev', productionWorker: 'guitar-mate-sync', stageWorker: 'guitar-mate-sync-stage' };
const at = href => { const u = new URL(href); return { hostname: u.hostname, search: u.search }; };
assert.equal(sync.serverUrl(at('https://guitar-mate.pages.dev/metronome'), config), 'wss://guitar-mate-sync.acct.workers.dev');
assert.equal(sync.serverUrl(at('https://stage.guitar-mate.pages.dev/metronome'), config), 'wss://guitar-mate-sync-stage.acct.workers.dev');
assert.equal(sync.serverUrl(at('http://localhost:8000/metronome.html?server=ws://127.0.0.1:8787/'), config), 'ws://127.0.0.1:8787');
assert.equal(sync.serverUrl(at('https://guitar-mate.pages.dev/metronome?server=wss://evil.example'), config), 'wss://guitar-mate-sync.acct.workers.dev', 'no override in production');
assert.equal(sync.serverUrl(at('https://guitar-mate.pages.dev/metronome'), { ...config, subdomain: '' }), null, 'not configured yet');

// Grid: every phone computes the same beat times and the same bar position from the link alone.
const t0 = 1762870000123;
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

// Tempo change: from beat 6 (beat 3 of bar 2, at t0+3000) the new tempo runs, keeping its place in the bar.
const { grid: faster, from } = sync.retime(grid, 6, 150);
assert.equal(from, t0 + 3000);
const k = sync.nextBeatIndex(faster, from - 1);
assert.equal(sync.beatEpoch(faster, k), from);
assert.equal(sync.beatInBar(k), 2);
assert.equal(sync.beatEpoch(faster, k + 1) - from, 400);
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
const order = ['./qr.js', './sync-config.js', './metronome-sync.js', './metronome-audio.js', './metronome-room.js'].map(f => page.indexOf(`src="${f}"`));
assert(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), 'metronome page loads sync scripts in order');
assert(order.at(-1) < page.indexOf("const sync=window.metronomeSync"), 'helpers load before the page script');
assert(!page.includes('getOutputTimestamp('), 'no getOutputTimestamp');
const sw = read('sw.js');
for (const asset of ['./qr.js', './metronome-sync.js', './metronome-room.js', './sync-config.js']) assert(sw.includes(`'${asset}'`), asset + ' is cached for offline use');

console.log('Metronome sync: room codes, server clock offset, server address, shared grid, tempo changes, offsets, QR encoder and wiring passed.');
