'use strict';
// "Auto match" for metronome rooms: a follower listens with its microphone and lines its clicks up
// with the leader's, as actually heard in the room.
//
// While calibrating, the follower stays on the leader's beat grid but swaps its own clicks for short
// 2 kHz chirps half a beat later. The leader's clicks are 880/1320 Hz square waves (odd harmonics only:
// 2640, 3960 Hz…), so the two are told apart by pitch as well as by time.
//   R = when my chirp is heard − when I scheduled it      → my own output + input latency
//   D = when the leader's click is heard − when I'd schedule my click for that beat
// My click is heard at (scheduled + output latency); the leader's at (D − input latency + scheduled).
// So shifting my clicks by  δ = D − R  makes them sound together. Input-path delays cancel out because
// both sounds go through the same microphone path, so only consistent timestamps are needed.
(function (root) {
  const CHIRP_HZ = 2000;
  const LEADER_HZ = [880, 1320];

  // RBJ band-pass biquad (constant 0 dB peak gain).
  function bandpass(signal, sampleRate, freq, q) {
    const w0 = 2 * Math.PI * freq / sampleRate, alpha = Math.sin(w0) / (2 * q), cos = Math.cos(w0);
    const a0 = 1 + alpha;
    const b0 = alpha / a0, b2 = -alpha / a0, a1 = -2 * cos / a0, a2 = (1 - alpha) / a0;
    const out = new Float32Array(signal.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < signal.length; i++) {
      const x = signal[i], y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
      out[i] = y; x2 = x1; x1 = x; y2 = y1; y1 = y;
    }
    return out;
  }

  // Amplitude envelope: rectify, then a fast-attack / slower-release follower (~0.3 ms / 5 ms).
  function envelope(signal, sampleRate) {
    const attack = 1 - Math.exp(-1 / (0.0003 * sampleRate)), release = 1 - Math.exp(-1 / (0.005 * sampleRate));
    const out = new Float32Array(signal.length);
    let level = 0;
    for (let i = 0; i < signal.length; i++) {
      const v = Math.abs(signal[i]);
      level += (v - level) * (v > level ? attack : release);
      out[i] = level;
    }
    return out;
  }

  const median = values => { const s = [...values].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  // First time in [from, to) (seconds) where the envelope rises past half of the window's peak,
  // provided the peak clearly stands out from the window's typical level.
  function onset(env, sampleRate, startTime, from, to, filterDelay) {
    const i0 = Math.max(0, Math.floor((from - startTime) * sampleRate));
    const i1 = Math.min(env.length, Math.ceil((to - startTime) * sampleRate));
    if (i1 - i0 < sampleRate * 0.01) return null;
    let peak = 0;
    for (let i = i0; i < i1; i++) if (env[i] > peak) peak = env[i];
    const floor = median(Array.from(env.subarray(i0, i1)).filter((_, i) => i % 16 === 0));
    if (!(peak > floor * 6 && peak > 1e-4)) return null;
    const threshold = floor + (peak - floor) * 0.5;
    for (let i = i0; i < i1; i++) if (env[i] >= threshold) return startTime + i / sampleRate - filterDelay;
    return null;
  }

  // samples: Float32Array from the mic; startTime: audio time of samples[0].
  // ownTimes: when my chirps were scheduled; beatTimes: when my clicks for the leader's beats would be scheduled.
  // interval: beat length (s). Returns {ok, delta, loopback, spread, heard, reason}.
  function analyze({ samples, sampleRate, startTime, ownTimes, beatTimes, interval }) {
    // Both filters ring up in a similar time; subtracting a nominal delay keeps the numbers readable.
    const Q = 10;
    const chirpEnv = envelope(bandpass(samples, sampleRate, CHIRP_HZ, Q), sampleRate);
    const leaderRaw = LEADER_HZ.map(f => envelope(bandpass(samples, sampleRate, f, Q), sampleRate));
    const leaderEnv = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) leaderEnv[i] = Math.max(leaderRaw[0][i], leaderRaw[1][i]);
    const delayChirp = Q / (Math.PI * CHIRP_HZ), delayLeader = Q / (Math.PI * 880);

    const loop = [];
    for (const t of ownTimes) {
      const heard = onset(chirpEnv, sampleRate, startTime, t, t + Math.min(0.4, interval * 0.9), delayChirp);
      if (heard !== null) loop.push(heard - t);
    }
    if (loop.length < 3) return { ok: false, reason: 'own' };
    const loopback = median(loop);
    // My chirps are loud and close; blank them (and their echo) out before looking for the leader.
    const blankEnds = [];
    for (const t of ownTimes) {
      const i0 = Math.max(0, Math.floor((t + loopback - 0.005 - startTime) * sampleRate));
      const i1 = Math.min(leaderEnv.length, Math.ceil((t + loopback + 0.11 - startTime) * sampleRate));
      if (i1 > i0) { leaderEnv.fill(0, i0, i1); blankEnds.push(startTime + i1 / sampleRate); }
    }
    // A leader click hidden under my chirp would show up as a rise right where the blank ends: not trusted.
    const atBlankEdge = heard => blankEnds.some(end => heard + delayLeader - end >= -0.001 && heard + delayLeader - end < 0.004);

    const offsets = [];
    for (const t of beatTimes) {
      const centre = t + loopback;
      const heard = onset(leaderEnv, sampleRate, startTime, centre - interval * 0.45, centre + interval * 0.45, delayLeader);
      if (heard !== null && !atBlankEdge(heard)) offsets.push(heard - t);
    }
    if (offsets.length < 3) return { ok: false, reason: 'leader', loopback };
    const d = median(offsets);
    const spread = median(offsets.map(v => Math.abs(v - d)));
    if (spread > 0.02) return { ok: false, reason: 'noisy', loopback, spread };
    return { ok: true, delta: d - loopback, loopback, spread, heard: offsets.length };
  }

  // ---- Browser side: record the microphone with sample-accurate audio-clock timestamps ----
  const WORKLET = `class GmRecorder extends AudioWorkletProcessor{process(inputs){const c=inputs[0]&&inputs[0][0];if(c&&c.length)this.port.postMessage({t:currentTime,d:c.slice(0)});return true;}}registerProcessor('gm-recorder',GmRecorder);`;

  async function openMic(context) {
    const stream = await root.navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    if (!context.__gmRecorderLoaded) {
      const url = root.URL.createObjectURL(new root.Blob([WORKLET], { type: 'application/javascript' }));
      await context.audioWorklet.addModule(url);
      context.__gmRecorderLoaded = true;
    }
    const source = context.createMediaStreamSource(stream);
    const node = new root.AudioWorkletNode(context, 'gm-recorder');
    const sink = context.createGain();
    sink.gain.value = 0;
    source.connect(node); node.connect(sink); sink.connect(context.destination);
    const chunks = [];
    node.port.onmessage = event => chunks.push(event.data);
    return {
      // Joins the recorded chunks into one buffer (gaps, if any, are filled with silence).
      take() {
        if (!chunks.length) return null;
        const rate = context.sampleRate, start = chunks[0].t;
        const end = chunks[chunks.length - 1].t + chunks[chunks.length - 1].d.length / rate;
        const samples = new Float32Array(Math.ceil((end - start) * rate) + 1);
        for (const c of chunks) samples.set(c.d, Math.max(0, Math.round((c.t - start) * rate)));
        return { samples, startTime: start, sampleRate: rate };
      },
      close() {
        try { source.disconnect(); node.disconnect(); sink.disconnect(); } catch (_) {}
        stream.getTracks().forEach(track => track.stop());
      },
    };
  }

  root.metronomeCalibrate = { analyze, openMic, bandpass, envelope, CHIRP_HZ, LEADER_HZ };
})(typeof window !== 'undefined' ? window : globalThis);

