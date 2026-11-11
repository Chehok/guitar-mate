'use strict';
// Metronome audio on iPhone: playback session (mute switch), silent-audio fallback for older iOS,
// recovering suspended/interrupted contexts, and the clock mapping that replaces getOutputTimestamp.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const code = fs.readFileSync(path.join(__dirname, '..', 'metronome-audio.js'), 'utf8');

function load({ contexts = [], audioSession, AudioElement } = {}) {
  const made = [];
  class Ctx {
    constructor() { const spec = contexts.shift() || {}; this.spec = spec; this.state = spec.initial || 'suspended'; this.currentTime = 0; made.push(this); }
    resume() { if (this.spec.hang) return new Promise(() => {}); if (this.spec.resumeTo) this.state = this.spec.resumeTo; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  const sandbox = {
    AudioContext: Ctx, navigator: audioSession === undefined ? {} : { audioSession },
    Audio: AudioElement, btoa: s => Buffer.from(s, 'binary').toString('base64'),
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)), performance: { now: () => 0 },
    DataView, Uint8Array,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { api: sandbox.metronomeAudio, made, sandbox };
}

(async () => {
  // iOS 17+: the playback session is requested so the mute switch doesn't silence clicks.
  {
    const session = { type: 'auto' };
    const { api, made } = load({ contexts: [{ resumeTo: 'running' }], audioSession: session });
    const ctx = await api.prepare(null);
    assert.equal(ctx.state, 'running');
    assert.equal(session.type, 'playback');
    assert.equal(await api.prepare(ctx), ctx, 'A running context is reused');
    assert.equal(made.length, 1);
  }
  // Older iOS (no audioSession API): a silent <audio> is played once inside the tap instead.
  {
    const played = [];
    class FakeAudio { constructor(src) { this.src = src; } setAttribute(name) { this.attr = name; } play() { played.push(this); return Promise.resolve(); } }
    const { api } = load({ contexts: [{ resumeTo: 'running' }, { resumeTo: 'running' }], AudioElement: FakeAudio });
    await api.prepare(null);
    await api.prepare(null);
    assert.equal(played.length, 1, 'Silent audio plays once per page');
    assert.match(played[0].src, /^data:audio\/wav;base64,/);
    assert.equal(played[0].attr, 'playsinline');
    const wav = Buffer.from(played[0].src.split(',')[1], 'base64');
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt32LE(40), wav.length - 44, 'WAV data size matches');
  }
  {
    let constructed = 0;
    class FakeAudio { constructor() { constructed++; } play() { return Promise.resolve(); } }
    const { api } = load({ contexts: [{ resumeTo: 'running' }], audioSession: { type: 'auto' }, AudioElement: FakeAudio });
    await api.prepare(null);
    assert.equal(constructed, 0, 'With the audioSession API, no silent audio is needed');
  }
  // Interrupted (e.g. after a call or leaving the app) and never resuming: a fresh context replaces it.
  {
    const { api, made } = load({ contexts: [{ resumeTo: 'running' }, { resumeTo: 'running' }], audioSession: { type: 'auto' } });
    const ctx = await api.prepare(null);
    ctx.state = 'interrupted'; ctx.spec.hang = true;
    const again = await api.prepare(ctx);
    assert.notEqual(again, ctx);
    assert.equal(again.state, 'running');
    assert.equal(ctx.state, 'closed', 'The stuck context is closed');
  }
  // Closed context is replaced; never running fails loudly (UI shows an error, not "playing").
  {
    const { api } = load({ contexts: [{ resumeTo: 'running' }, { resumeTo: 'running' }], audioSession: { type: 'auto' } });
    const ctx = await api.prepare(null);
    ctx.state = 'closed';
    assert.notEqual(await api.prepare(ctx), ctx);
  }
  {
    const { api, made } = load({ contexts: [{ hang: true }, { hang: true }], audioSession: { type: 'auto' } });
    await assert.rejects(api.prepare(null), /audio-not-running/);
    assert(made.every(c => c.state === 'closed' || c === made[0]));
  }
  {
    const { sandbox } = load();
    delete sandbox.AudioContext;
    await assert.rejects(sandbox.metronomeAudio.prepare(null), /unsupported/);
  }
  // A throwing audioSession setter doesn't break playback.
  {
    const bad = { get type() { return 'auto'; }, set type(v) { throw Error('nope'); } };
    const { api } = load({ contexts: [{ resumeTo: 'running' }], audioSession: bad });
    assert.equal((await api.prepare(null)).state, 'running');
  }

  // Clock: currentTime moves in 20 ms steps behind a smooth performance clock; the estimate
  // recovers the true offset (perf − audio) within a millisecond.
  {
    const { api } = load();
    let perfMs = 0;
    const ctx = { currentTime: 0, baseLatency: 0.01, outputLatency: 0.03 };
    const trueOffset = 12.345; // s
    const clock = api.createClock(() => ctx, { now: () => perfMs });
    for (let t = 0; t < 3000; t += 7) {
      perfMs = 12345 + t;
      const audio = perfMs / 1000 - trueOffset;
      ctx.currentTime = Math.floor(audio / 0.02) * 0.02; // stepped updates
      clock.sample();
    }
    assert(Math.abs(clock.offset() - trueOffset) < 0.001, `offset ${clock.offset()} ≈ ${trueOffset}`);
    assert(Math.abs(clock.latency() - 0.04) < 1e-9);
    // A click meant to be heard at perf P is scheduled latency earlier on the audio clock.
    const P = perfMs + 500;
    assert(Math.abs(clock.audioTimeFor(P) - (P / 1000 - trueOffset - 0.04)) < 0.001);
    assert(Math.abs(clock.audibleTime() - (perfMs / 1000 - trueOffset - 0.04)) < 0.001);
  }
  // Fast audio clock (Safari + some Bluetooth outputs ran ~9% fast): the sliding window follows it.
  {
    const { api } = load();
    let perfMs = 0;
    const ctx = { currentTime: 0 };
    const clock = api.createClock(() => ctx, { now: () => perfMs, windowSeconds: 0.5 });
    let worst = 0;
    for (let t = 0; t < 20000; t += 10) {
      perfMs = t;
      ctx.currentTime = Math.floor((t / 1000) * 1.09 / 0.01) * 0.01;
      clock.sample();
      if (t > 1000 && t % 500 === 0) {
        const predicted = clock.audioTimeFor(perfMs + 100); // 100 ms ahead, like the scheduler
        const actual = ((perfMs + 100) / 1000) * 1.09;
        worst = Math.max(worst, Math.abs(predicted - actual));
      }
    }
    assert(worst < 0.03, `tracks a fast clock (worst ${worst.toFixed(4)} s)`);
  }

  // Page wiring: no more getOutputTimestamp, scripts load in order and are cached offline.
  const page = fs.readFileSync(path.join(__dirname, '..', 'metronome.html'), 'utf8');
  assert(!page.includes('getOutputTimestamp('), 'metronome no longer relies on getOutputTimestamp');
  assert(page.indexOf('src="./metronome-audio.js"') > 0 && page.indexOf('src="./metronome-audio.js"') < page.indexOf('metronomeAudio.createClock'));
  assert(page.includes('metronomeAudio.prepare(audioContext)'), 'Start prepares audio like chord search (playback session)');
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert(sw.includes("'./metronome-audio.js'"));

  console.log('Metronome audio: playback session, silent-audio fallback, interrupted recovery and clock mapping passed.');
})().catch(error => { console.error(error); process.exit(1); });
