'use strict';
// Tap to match: the person's own early-tapping habit and the screen's touch delay cancel out.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const context = {};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'metronome-calibrate.js'), 'utf8'), context);
const { analyzeTaps, TAP_COUNT } = context.metronomeCalibrate;

let seed = 11;
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const jitter = sd => sd * Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());

// The leader's click is heard `delta` ms after mine. The person taps `habit` ms off (early < 0) with
// `sd` ms of wobble, and the screen reports taps `touch` ms late.
function session({ delta, habit = -30, touch = 45, sd = 15, bpm = 100, taps = TAP_COUNT, start = 1000 }) {
  const intervalMs = 60000 / bpm;
  const ownBeats = Array.from({ length: taps + 4 }, (_, i) => start + i * intervalMs);
  const leaderBeats = ownBeats.map(b => b + (taps + 4) * intervalMs);
  const tap = beat => beat + habit + touch + jitter(sd);
  return {
    intervalMs,
    ownBeats, ownTaps: ownBeats.slice(1, taps + 1).map(b => tap(b)),
    leaderBeats, leaderTaps: leaderBeats.slice(1, taps + 1).map(b => tap(b + delta)),
  };
}

for (const [delta, opts] of [[60, {}], [-80, {}], [0, {}], [120, { bpm: 72 }], [-40, { bpm: 160, habit: -60, touch: 20 }], [35, { sd: 8, habit: 10, touch: 70 }]]) {
  const r = analyzeTaps(session({ delta, ...opts }));
  assert(r.ok, `delta ${delta}: ${r.reason}`);
  assert(Math.abs(r.delta - delta) < 25, `delta ${delta}: got ${r.delta.toFixed(1)}`);
}
// Large habit/touch bias without the own phase would be off by habit+touch; with it, it's gone.
const biased = analyzeTaps(session({ delta: 0, habit: -70, touch: 90, sd: 5 }));
assert(biased.ok && Math.abs(biased.delta) < 8, `bias cancels: ${biased.delta}`);
// Wild tapping is refused, not averaged into a wrong number
assert.equal(analyzeTaps(session({ delta: 50, sd: 120 })).reason, 'uneven');
// Too few taps
const few = session({ delta: 20 });
assert.equal(analyzeTaps({ ...few, ownTaps: few.ownTaps.slice(0, 4) }).reason, 'own');
assert.equal(analyzeTaps({ ...few, leaderTaps: [] }).reason, 'leader');
// Taps far from any beat (half a beat off) are ignored, not matched to the wrong beat
const off = session({ delta: 20, sd: 3 });
off.leaderTaps.push(off.leaderBeats[3] + off.intervalMs / 2, off.leaderBeats[5] + off.intervalMs / 2);
const r = analyzeTaps(off);
assert(r.ok && Math.abs(r.delta - 20) < 6, `stray taps ignored: ${JSON.stringify(r)}`);

console.log('Tap to match: tapping habit and touch delay cancel; uneven or too few taps are refused.');
