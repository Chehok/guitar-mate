'use strict';
// Room client: claims leadership, measures the server clock offset, relays state/peers,
// keeps the connection alive cheaply, and reconnects after drops.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// Fake timers and clock
let nowMs = 0;
let timers = [];
const setTimer = (fn, ms) => { const t = { fn, at: nowMs + ms, id: Symbol() }; timers.push(t); return t.id; };
const clearTimer = id => { timers = timers.filter(t => t.id !== id); };
function advance(ms) {
  const end = nowMs + ms;
  for (;;) {
    timers.sort((a, b) => a.at - b.at);
    const t = timers[0];
    if (!t || t.at > end) break;
    timers.shift();
    nowMs = t.at;
    t.fn();
  }
  nowMs = end;
}

// Fake server: its clock runs `serverAhead` ms ahead; replies arrive after `oneWay` ms.
const sockets = [];
let serverAhead = 123456, oneWay = 20;
class FakeSocket {
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); setTimer(() => { this.readyState = 1; this.onopen(); }, 5); }
  send(data) {
    this.sent.push(data);
    if (data === 'ping') return;
    const msg = JSON.parse(data);
    if (msg.t === 'time') {
      const serverAtArrival = nowMs + oneWay + serverAhead;
      setTimer(() => this.deliver({ t: 'time', c: msg.c, s: serverAtArrival }), oneWay * 2);
    }
    if (msg.t === 'claim') setTimer(() => this.deliver({ t: 'leader' }), oneWay * 2);
  }
  deliver(obj) { if (this.readyState === 1) this.onmessage({ data: JSON.stringify(obj) }); }
  drop() { this.readyState = 3; this.onclose(); }
  close() { this.readyState = 3; }
}

const context = { performance: { now: () => nowMs }, crypto: { getRandomValues: a => { a.forEach((_, i) => { a[i] = i * 17; }); return a; } } };
context.window = context;
vm.createContext(context);
vm.runInContext(read('metronome-sync.js'), context);
vm.runInContext(read('metronome-room.js'), context);
const { createRoom, makeToken } = context.metronomeRoom;

assert.match(makeToken(context.crypto), /^[0-9a-f]{32}$/);

const events = { states: [], peers: [], status: [], leader: 0, errors: [] };
const room = createRoom({
  url: 'wss://sync.example', code: 'ABC234', token: 'tok-0123456789abcdef', WebSocketImpl: FakeSocket,
  now: () => nowMs, setTimer, clearTimer,
  onState: s => events.states.push(s), onPeers: n => events.peers.push(n), onStatus: s => events.status.push(s),
  onLeader: () => { events.leader++; }, onError: c => events.errors.push(c),
});
assert.equal(sockets[0].url, 'wss://sync.example/room/ABC234');
assert.equal(room.serverNow(), null, 'no server time before measuring');

advance(2000);
const first = sockets[0];
assert.deepEqual(JSON.parse(first.sent[0]), { t: 'claim', token: 'tok-0123456789abcdef' }, 'leader claims on connect');
assert.equal(events.leader, 1);
const timeRequests = first.sent.filter(m => m !== 'ping' && JSON.parse(m).t === 'time');
assert.equal(timeRequests.length, 8, 'a burst of 8 round trips');
assert(room.synced);
assert.equal(room.rtt, 40);
assert(Math.abs(room.serverNow() - (nowMs + serverAhead)) < 1, `server clock estimate ${room.serverNow() - nowMs} ≈ ${serverAhead}`);
assert.deepEqual(events.status.slice(0, 3), ['connecting', 'connected', 'synced']);

// State and peers are relayed; publish carries the leader token
first.deliver({ t: 'peers', n: 3 });
first.deliver({ t: 'state', state: { bpm: 96, t0: 1, playing: true } });
assert.deepEqual(events.peers, [3]);
assert.equal(events.states[0].bpm, 96);
room.publish({ bpm: 100, t0: 2, playing: true });
assert.deepEqual(JSON.parse(first.sent.at(-1)), { t: 'state', token: 'tok-0123456789abcdef', state: { bpm: 100, t0: 2, playing: true } });

// Keep-alive: a plain "ping" every 25 s (answered by the server runtime, no billing); re-measure every 5 min
const pingsBefore = first.sent.filter(m => m === 'ping').length;
advance(60000);
assert.equal(first.sent.filter(m => m === 'ping').length - pingsBefore, 2);
const timesBefore = first.sent.filter(m => m !== 'ping' && JSON.parse(m).t === 'time').length;
advance(5 * 60 * 1000);
assert.equal(first.sent.filter(m => m !== 'ping' && JSON.parse(m).t === 'time').length - timesBefore, 4, 'a short re-measure burst');

// Asymmetric network: a slower reply doesn't override the better (faster) sample
oneWay = 300;
room.resync();
advance(5000);
assert(Math.abs(room.serverNow() - (nowMs + serverAhead)) < 1, 'still accurate after slow samples');
oneWay = 20;

// Drop → reconnect with backoff, claim again, re-measure
first.drop();
assert.equal(events.status.at(-1), 'reconnecting');
advance(900);
assert.equal(sockets.length, 1, 'waits before reconnecting');
advance(2000);
assert.equal(sockets.length, 2);
assert.deepEqual(JSON.parse(sockets[1].sent[0]).t, 'claim');
assert.equal(events.leader, 2);

// Errors are reported; leaving stops everything (no more reconnects)
sockets[1].deliver({ t: 'error', code: 'taken' });
assert.deepEqual(events.errors, ['taken']);
room.close();
sockets[1].drop();
advance(60000);
assert.equal(sockets.length, 2, 'no reconnect after leaving');

// A follower (no token) never claims or publishes
const follower = createRoom({ url: 'wss://sync.example', code: 'XYZ789', WebSocketImpl: FakeSocket, now: () => nowMs, setTimer, clearTimer });
advance(2000);
const fs3 = sockets[2];
assert(!fs3.sent.some(m => m !== 'ping' && JSON.parse(m).t === 'claim'));
follower.publish({ bpm: 120, t0: 1, playing: true });
assert(!fs3.sent.some(m => m !== 'ping' && JSON.parse(m).t === 'state'));
assert(follower.synced);
follower.close();

console.log('Metronome room client: claim, clock offset, relay, keep-alive, re-measure and reconnect passed.');
