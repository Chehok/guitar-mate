'use strict';
// Auto match: from a recording that holds the leader's clicks and my own chirps, recover how much
// to shift my clicks — with noise, room echo, quiet sources, accents and odd latencies.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const context = {};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'metronome-calibrate.js'), 'utf8'), context);
const { analyze } = context.metronomeCalibrate;

let seed = 7;
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());

// Builds a mic recording in which:
//   my chirp scheduled at t is heard at t + loopback,
//   the leader's click for a beat I'd schedule at t is heard at t + loopback + delta.
function record({ bpm = 100, beats = 8, loopback = 0.12, delta = 0.065, rate = 48000, leaderGain = 0.25, chirpGain = 0.6, noise = 0.01, echo = 0.3, start = 12.345 }) {
  const interval = 60 / bpm, first = start + 0.3;
  const duration = 0.3 + beats * interval + 0.8;
  const samples = new Float32Array(Math.ceil(duration * rate));
  const beatTimes = [], ownTimes = [];
  const add = (at, freq, gain, square) => {
    const i0 = Math.round((at - start) * rate);
    for (let n = 0; n < 0.05 * rate && i0 + n < samples.length; n++) {
      if (i0 + n < 0) continue;
      const t = n / rate, env = Math.min(1, t / 0.002) * Math.exp(-t / 0.012);
      const phase = Math.sin(2 * Math.PI * freq * t);
      const v = gain * env * (square ? Math.sign(phase) : phase);
      samples[i0 + n] += v;
      const e = i0 + n + Math.round(0.023 * rate); // a wall echo 23 ms later
      if (e < samples.length) samples[e] += v * echo;
    }
  };
  for (let k = 0; k < beats; k++) {
    const t = first + k * interval;
    beatTimes.push(t);
    add(t + loopback + delta, k % 4 === 0 ? 1320 : 880, leaderGain, true);
    const own = t + interval / 2;
    ownTimes.push(own);
    add(own + loopback, 2000, chirpGain, false);
  }
  for (let i = 0; i < samples.length; i++) samples[i] += noise * gauss();
  return { samples, sampleRate: rate, startTime: start, ownTimes, beatTimes, interval };
}
const close = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: got ${(a * 1000).toFixed(1)} ms, want ${(b * 1000).toFixed(1)} ms`);

const cases = [
  { name: 'typical: I sound 65 ms early', delta: 0.065 },
  { name: 'I sound late', delta: -0.09 },
  { name: 'already matched', delta: 0 },
  { name: 'phone with long latency (Android-like)', loopback: 0.26, delta: 0.04 },
  { name: 'fast tempo', bpm: 200, delta: 0.03, beats: 12 },
  { name: 'slow tempo, big offset', bpm: 60, delta: 0.21 },
  { name: 'leader far away and quiet', leaderGain: 0.04, delta: 0.05 },
  { name: 'noisy room', noise: 0.03, delta: -0.04 },
  { name: '44.1 kHz device', rate: 44100, delta: 0.07 },
  { name: 'leader loud, my speaker quiet', leaderGain: 0.8, chirpGain: 0.08, delta: 0.03 },
  { name: 'large offset', bpm: 100, delta: -0.17 },
  { name: 'loud echo', echo: 0.8, delta: 0.05 },
];
for (const c of cases) {
  const r = analyze(record(c));
  assert(r.ok, `${c.name}: not ok (${r.reason})`);
  close(r.delta, c.delta, 0.003, c.name);
  close(r.loopback, c.loopback ?? 0.12, 0.003, c.name + ' (loopback)');
}

// Failure cases are reported instead of guessed
assert.equal(analyze(record({ chirpGain: 0 })).reason, 'own', 'my chirps not heard (e.g. echo cancellation)');
assert.equal(analyze(record({ leaderGain: 0 })).reason, 'leader', 'leader not heard');
// The leader's click hidden under my own chirp (about half a beat off): reported, never a wrong number.
for (const delta of [-0.24, -0.27]) {
  const r = analyze(record({ bpm: 100, delta }));
  assert(!r.ok || Math.abs(r.delta - delta) < 0.003, `hidden click at ${delta}: ${JSON.stringify(r)}`);
}
const silent = record({}); silent.samples.fill(0);
assert.equal(analyze(silent).ok, false);

// Rooms closer to real phones: speaker roll-off, reverb, other phones clicking nearby, AGC.
{
  const sim = require('./support/room-sim.cjs');
  for (const sc of sim.scenarios) {
    const r = analyze(sim.record(sc));
    assert(r.ok, `${sc.name}: not ok (${r.reason})`);
    close(r.delta, sc.delta, 0.004, `room: ${sc.name}`);
  }
}
console.log(`Metronome auto match: ${cases.length} synthetic rooms within 3 ms; missing sounds reported.`);
