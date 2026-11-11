'use strict';
// Audio plumbing for the metronome, written around iPhone Safari quirks.
// 1. Sound with the mute switch on: Web Audio is "ambient" by default on iOS, so the ring/silent
//    switch mutes it. Ask for the "playback" audio session (iOS 17+) — the same thing chord search
//    does — or, on older iOS, play a short silent <audio> inside the tap, which has the same effect.
// 2. Clock mapping: Safari's getOutputTimestamp() reports contextTime on the wrong scale
//    (WebKit bug 264247), and its audio clock can run fast with some Bluetooth outputs. So instead
//    of trusting it, the offset between performance.now() and AudioContext.currentTime is measured
//    continuously; the smallest recent value is taken because currentTime only moves in steps.
(function (root) {
  function setAudioSession(type) {
    try { if (root.navigator?.audioSession && root.navigator.audioSession.type !== type) root.navigator.audioSession.type = type; } catch (_) {}
  }

  function silentWavUrl() {
    const rate = 8000, samples = 800; // 0.1 s of 8-bit mono silence
    const bytes = new Uint8Array(44 + samples);
    const view = new DataView(bytes.buffer);
    const text = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, 36 + samples, true); text(8, 'WAVE');
    text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
    text(36, 'data'); view.setUint32(40, samples, true);
    bytes.fill(128, 44);
    let binary = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    return 'data:audio/wav;base64,' + root.btoa(binary);
  }

  let mediaUnlocked = false;
  function unlockMediaPlayback() {
    if (mediaUnlocked || root.navigator?.audioSession || typeof root.Audio !== 'function') return;
    mediaUnlocked = true;
    try {
      const element = new root.Audio(silentWavUrl());
      element.setAttribute?.('playsinline', '');
      const played = element.play?.();
      if (played && played.catch) played.catch(() => { mediaUnlocked = false; });
    } catch (_) { mediaUnlocked = false; }
  }

  async function resume(context, timeoutMs = 1500) {
    if (context.state === 'running') return true;
    try { await Promise.race([context.resume(), new Promise(done => root.setTimeout(done, timeoutMs))]); } catch (_) {}
    return context.state === 'running';
  }

  // Call directly from the tap handler: the session switch and silent play must happen inside the gesture.
  // Returns a running context (the given one, or a fresh one if it stays suspended/interrupted).
  async function prepare(context) {
    const Context = root.AudioContext || root.webkitAudioContext;
    if (!Context) throw Error('unsupported');
    setAudioSession('playback');
    unlockMediaPlayback();
    if (context && context.state === 'closed') context = null;
    if (!context) context = new Context();
    if (await resume(context)) return context;
    const stale = context;
    context = new Context();
    try { stale.close(); } catch (_) {}
    if (await resume(context)) return context;
    try { context.close(); } catch (_) {}
    throw Error('audio-not-running');
  }

  // performance.now() (s) − AudioContext.currentTime, tracked over a sliding window.
  function createClock(getContext, { windowSeconds = 2, now = () => root.performance.now() } = {}) {
    const samples = [];
    function sample() {
      const context = getContext();
      if (!context) return;
      const perf = now() / 1000;
      samples.push([perf, perf - context.currentTime]);
      while (samples.length > 1 && samples[0][0] < perf - windowSeconds) samples.shift();
    }
    function offset() {
      sample();
      let best = Infinity;
      for (const [, value] of samples) if (value < best) best = value;
      return best;
    }
    const latency = () => { const c = getContext(); return (c?.baseLatency || 0) + (c?.outputLatency || 0); };
    return {
      sample,
      offset,
      latency,
      reset() { samples.length = 0; },
      // Audio time that is being heard right now.
      audibleTime() { return now() / 1000 - offset() - latency(); },
      // Audio time to schedule so that a click is heard at performance time `perfMs`.
      audioTimeFor(perfMs) { return perfMs / 1000 - offset() - latency(); },
    };
  }

  root.metronomeAudio = { setAudioSession, unlockMediaPlayback, silentWavUrl, resume, prepare, createClock };
})(typeof window !== 'undefined' ? window : globalThis);
