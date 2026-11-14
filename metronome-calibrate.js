'use strict';
// "Auto match" for metronome rooms: a follower listens with its microphone and lines its clicks up
// with the leader's, as actually heard in the room.
//
// While calibrating, the follower stays on the leader's beat grid but swaps its own clicks for short
// chirps (2 kHz, or another pitch from CHIRPS) about half a beat later, jittered randomly beat to beat
// so several phones can measure at the same time without mistaking each other's chirps for their own. The leader's clicks are 880/1320 Hz square waves (odd harmonics only:
// 2640, 3960 Hz…), so the two are told apart by pitch as well as by time.
//   R = when my chirp is heard − when I scheduled it      → my own output + input latency
//   D = when the leader's click is heard − when I'd schedule my click for that beat
// My click is heard at (scheduled + output latency); the leader's at (D − input latency + scheduled).
// So shifting my clicks by  δ = D − R  makes them sound together. Input-path delays cancel out because
// both sounds go through the same microphone path, so only consistent timestamps are needed.
(function (root) {
  const CHIRP_HZ = 2000;
  // Chirp pitches a phone can pick: each sits between the leader's click bands (880/1320 Hz and their
  // 2640/3960 Hz harmonics), so it barely shows up in them.
  const CHIRPS = [2000, 3250, 1700];
  // The leader's square-wave clicks; their 3rd harmonics are listened to as well, since small phone
  // speakers barely play 880 Hz but 2640 Hz comes through.
  const LEADER_HZ = [880, 1320];
  // The sounds as the app plays them (metronome.html playClick / playChirp): exponential 2 ms rise to
  // the peak, then an exponential fall to 0.0001.
  const SHAPES = {
    chirp: { hz: CHIRP_HZ, peak: 0.9, fall: 0.038, square: false },
    accent: { hz: 1320, peak: 0.75, fall: 0.043, square: true },
    beat: { hz: 880, peak: 0.6, fall: 0.043, square: true },
  };
  function synth(shape, sampleRate, lead) {
    const n = Math.round((lead + 0.06) * sampleRate), out = new Float32Array(n), i0 = Math.round(lead * sampleRate);
    for (let i = i0; i < n; i++) {
      const t = (i - i0) / sampleRate;
      const env = t < 0.002 ? 1e-4 * Math.pow(shape.peak / 1e-4, t / 0.002) : t < 0.002 + shape.fall ? shape.peak * Math.pow(1e-4 / shape.peak, (t - 0.002) / shape.fall) : 0;
      const wave = Math.sin(2 * Math.PI * shape.hz * t);
      out[i] = env * (shape.square ? Math.sign(wave) : wave);
    }
    return out;
  }

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

  // Amplitude envelope: RMS over the last ~1.5 ms (smooth enough that a filtered 880 Hz tone doesn't
  // ripple, short enough to keep onsets sharp). Its fixed half-window delay is the same for every sound.
  function envelope(signal, sampleRate) {
    const w = Math.max(1, Math.round(0.0015 * sampleRate));
    const out = new Float32Array(signal.length);
    let sum = 0;
    for (let i = 0; i < signal.length; i++) {
      sum += signal[i] * signal[i];
      if (i >= w) sum -= signal[i - w] * signal[i - w];
      out[i] = Math.sqrt(Math.max(0, sum) / w);
    }
    return out;
  }

  const median = values => { const s = [...values].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  // Onset of the loudest sound in [peakFrom, peakTo) (seconds; the whole [from, to) by default): find
  // its peak, walk back down its rising edge to the dip before it, then take where it climbs 30% of the
  // way from that dip to the peak. The noise floor comes from the whole [from, to) window.
  // Anchoring on the loudest sound (the phone right next to the mic) keeps a quieter phone that clicks
  // a little earlier or later from being mistaken for it; the low 30% mark keeps room reverb, which
  // keeps the level rising after the direct sound, from pushing the onset late.
  function onset(env, sampleRate, startTime, from, to, filterDelay, peakFrom = from, peakTo = to) {
    const i0 = Math.max(0, Math.floor((from - startTime) * sampleRate));
    const i1 = Math.min(env.length, Math.ceil((to - startTime) * sampleRate));
    if (i1 - i0 < sampleRate * 0.01) return null;
    const p0 = Math.max(i0, Math.floor((peakFrom - startTime) * sampleRate));
    const p1 = Math.min(i1, Math.ceil((peakTo - startTime) * sampleRate));
    if (p1 <= p0) return null;
    let peak = 0, p = p0;
    for (let i = p0; i < p1; i++) if (env[i] > peak) { peak = env[i]; p = i; }
    // Noise floor: a quiet slice of the window (a loud click's own reverb can fill half of it).
    const levels = Array.from(env.subarray(i0, i1)).filter((_, i) => i % 16 === 0).sort((a, b) => a - b);
    const floor = levels[Math.floor(levels.length * 0.15)] || 0, typical = levels[levels.length >> 1] || 0;
    // A real click stands well clear of the window's typical level (noise alone doesn't).
    if (!(peak > typical * 6 && peak > 2e-5)) return null;
    // Back down the rising edge; small wiggles (under 4% of the peak) don't count as the dip.
    let m = p, low = peak;
    for (let i = p - 1; i >= i0; i--) {
      if (env[i] < low) { low = env[i]; m = i; }
      else if (env[i] > low + peak * 0.04) break;
      if (low <= floor) break;
    }
    const base = Math.max(floor, low), threshold = base + (peak - base) * 0.3;
    for (let i = m; i <= p; i++) {
      if (env[i] >= threshold) {
        const prev = i > m ? env[i - 1] : env[i], frac = env[i] > prev ? (threshold - prev) / (env[i] - prev) : 1;
        return startTime + (i - 1 + frac) / sampleRate - filterDelay;
      }
    }
    return null;
  }

  // The lag at which a sound repeats across all the given times: for each time, the envelope over
  // [time + from, time + to] is scaled so its loudest point is 1, and the slices are summed. My own
  // sounds line up at one lag on every beat; other phones (playing at other moments, or with randomly
  // jittered chirps) spread out, and a single loud knock counts for one beat at most.
  // envFor(k) gives the envelope to use for times[k]. Returns the lag of the summed peak, or null.
  function commonLag(envFor, times, sampleRate, startTime, from, to) {
    const bin = 0.0005, bins = Math.max(1, Math.ceil((to - from) / bin)), score = new Float64Array(bins);
    const per = Math.max(1, Math.round(bin * sampleRate));
    let used = 0;
    times.forEach((t, k) => {
      const env = envFor(k);
      const a = Math.round((t + from - startTime) * sampleRate);
      if (a < 0 || a + bins * per > env.length) return;
      const slice = new Float64Array(bins);
      let top = 0;
      for (let b = 0; b < bins; b++) {
        let m = 0;
        for (let i = a + b * per, e = i + per; i < e; i++) if (env[i] > m) m = env[i];
        slice[b] = m; if (m > top) top = m;
      }
      if (!(top > 0)) return;
      for (let b = 0; b < bins; b++) score[b] += slice[b] / top;
      used++;
    });
    if (!used) return null;
    let best = 0;
    for (let b = 1; b < bins; b++) if (score[b] > score[best]) best = b;
    return from + (best + 0.5) * bin;
  }

  // samples: Float32Array from the mic; startTime: audio time of samples[0].
  // ownTimes: when my chirps were scheduled; beatTimes: when my clicks for the leader's beats would be scheduled.
  // interval: beat length (s). Returns {ok, delta, loopback, spread, heard, reason}.
  // chirpHz: the pitch of my chirps (each phone picks one of CHIRPS, so phones measuring together are
  // told apart by pitch as well as by their randomly jittered timing).
  function analyze({ samples, sampleRate, startTime, ownTimes, beatTimes, beatKinds, interval, chirpHz = CHIRP_HZ }) {
    const Q = 10;
    const chirpShape = { ...SHAPES.chirp, hz: chirpHz };
    const chirpPath = signal => envelope(bandpass(signal, sampleRate, chirpHz, Q), sampleRate);
    // Each kind of click is looked for in its own bands (accent: 1320 + 3960 Hz, other beats: 880 +
    // 2640 Hz). Wider than the chirp's band, so they ring up fast and agree on timing.
    const leaderPath = (signal, accent) => {
      const raw = (accent ? [1320, 3960] : [880, 2640]).map(f => envelope(bandpass(signal, sampleRate, f, 4), sampleRate));
      const out = new Float32Array(signal.length);
      for (let i = 0; i < signal.length; i++) { let m = 0; for (const band of raw) if (band[i] > m) m = band[i]; out[i] = m; }
      return out;
    };
    // How late each kind of sound reads after going through its filter and envelope, measured on a
    // clean copy of the sound itself, so the chirp and the leader's clicks are timed the same way.
    const lead = 0.12; // mostly silence, so the noise floor reads as silence
    const pathDelay = (shape, path) => {
      const clean = synth(shape, sampleRate, lead);
      for (let i = 0; i < clean.length; i++) clean[i] += 1e-6 * Math.sin(i * 0.37); // a whisper of floor
      const at = onset(path(clean), sampleRate, 0, 0, clean.length / sampleRate, 0);
      return at === null ? 0 : at - lead;
    };
    const chirpEnv = chirpPath(samples), leaderEnvs = [leaderPath(samples, true), leaderPath(samples, false)];
    const delayChirp = pathDelay(chirpShape, chirpPath);
    const delayLeader = [pathDelay(SHAPES.accent, s => leaderPath(s, true)), pathDelay(SHAPES.beat, s => leaderPath(s, false))];

    // Where my chirps repeat (other phones' chirps don't line up with my timing), then each chirp's
    // onset close to that lag.
    const ownSpan = Math.min(0.4, interval * 0.65);
    const ownLag = commonLag(() => chirpEnv, ownTimes, sampleRate, startTime, 0, ownSpan);
    const loop = [];
    if (ownLag !== null) for (const t of ownTimes) {
      const heard = onset(chirpEnv, sampleRate, startTime, t, t + ownSpan, delayChirp, t + ownLag - 0.012, t + ownLag + 0.012);
      if (heard !== null) loop.push(heard - t);
    }
    const total = ownTimes.length;
    if (loop.length < 3) return { ok: false, reason: 'own', ownHeard: loop.length, total };
    const loopback = median(loop);
    // My chirps are loud and close; blank them (and their echo) out before looking for the leader.
    const blankEnds = [];
    for (const t of ownTimes) {
      const i0 = Math.max(0, Math.floor((t + loopback - 0.005 - startTime) * sampleRate));
      const i1 = Math.min(samples.length, Math.ceil((t + loopback + 0.11 - startTime) * sampleRate));
      if (i1 > i0) { for (const env of leaderEnvs) env.fill(0, i0, i1); blankEnds.push(startTime + i1 / sampleRate); }
    }
    // A leader click hidden under my chirp would show up as a rise right where the blank ends: not trusted.
    const atBlankEdge = heard => blankEnds.some(end => heard + delayLeader[1] - end >= -0.001 && heard + delayLeader[1] - end < 0.004);

    // The leader's clicks: where they repeat beat after beat, then each one's onset near that lag.
    const isAccent = k => (beatKinds ? beatKinds[k] === 0 : false);
    const span = interval * 0.45;
    const leaderLag = commonLag(k => leaderEnvs[isAccent(k) ? 0 : 1], beatTimes, sampleRate, startTime, loopback - span, loopback + span);
    const offsets = [];
    if (leaderLag !== null) beatTimes.forEach((t, k) => {
      const centre = t + loopback, accent = isAccent(k);
      const heard = onset(leaderEnvs[accent ? 0 : 1], sampleRate, startTime, centre - span, centre + span, delayLeader[accent ? 0 : 1], t + leaderLag - 0.015, t + leaderLag + 0.015);
      if (heard !== null && !atBlankEdge(heard)) offsets.push(heard - t);
    });
    if (offsets.length < 3) return { ok: false, reason: 'leader', loopback, ownHeard: loop.length, leaderHeard: offsets.length, total };
    // Median first, then the mean of the beats that agree with it (a stray knock or a missed beat
    // is dropped instead of dragging the answer).
    const d0 = median(offsets);
    const spread = median(offsets.map(v => Math.abs(v - d0)));
    if (spread > 0.015) return { ok: false, reason: 'noisy', loopback, spread, ownHeard: loop.length, leaderHeard: offsets.length, total };
    const keep = offsets.filter(v => Math.abs(v - d0) <= Math.max(0.002, spread * 3));
    if (keep.length < 3) return { ok: false, reason: 'noisy', loopback, spread, ownHeard: loop.length, leaderHeard: keep.length, total };
    const d = keep.reduce((a, b) => a + b, 0) / keep.length;
    return { ok: true, delta: d - loopback, loopback, spread, heard: keep.length, ownHeard: loop.length, leaderHeard: keep.length, total };
  }

  // ---- Browser side: record the microphone with sample-accurate audio-clock timestamps ----

  // iOS Safari: recording needs the play-and-record audio session before getUserMedia, and an
  // AudioWorklet module from a blob: URL can fail to load — so the worklet comes from a real file, and
  // if it still won't load, a ScriptProcessor records instead. Either way each chunk carries a
  // context-clock time; any fixed offset in that time cancels out (own and leader sounds share it).
  async function openMic(context) {
    if (root.metronomeAudio?.setAudioSession) root.metronomeAudio.setAudioSession('play-and-record');
    const stream = await root.navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    if (context.state !== 'running') { try { await context.resume(); } catch (_) {} }
    const source = context.createMediaStreamSource(stream);
    const sink = context.createGain();
    sink.gain.value = 0;
    sink.connect(context.destination);
    const chunks = [];
    let node = null;
    if (root.AudioWorkletNode && context.audioWorklet) {
      try {
        if (!context.__gmRecorderLoaded) {
          await context.audioWorklet.addModule('./metronome-recorder.js');
          context.__gmRecorderLoaded = true;
        }
        node = new root.AudioWorkletNode(context, 'gm-recorder');
        node.port.onmessage = event => chunks.push(event.data);
      } catch (_) { node = null; }
    }
    if (!node) {
      node = context.createScriptProcessor(2048, 1, 1);
      node.onaudioprocess = event => chunks.push({ t: event.playbackTime || context.currentTime, d: event.inputBuffer.getChannelData(0).slice(0) });
    }
    source.connect(node); node.connect(sink);
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

  root.metronomeCalibrate = { analyze, openMic, envelope, CHIRP_HZ, CHIRPS, SHAPES };
})(typeof window !== 'undefined' ? window : globalThis);

