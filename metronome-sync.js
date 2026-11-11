'use strict';
// Shared-beat math for "Play together" (metronome rooms).
// The leader's beat is a grid on the sync server's clock: beat k sounds at t0 + k·(60000/bpm) ms, and
// every 4th beat (k % 4 === 0) is the accented first beat. Phones measure their offset to the server
// clock (NTP-style round trips), then play the same grid on their own audio clock.
(function (root) {
  const BEATS_PER_BAR = 4;
  const MIN_BPM = 40, MAX_BPM = 240;
  const OFFSET_LIMIT = 300; // ms, for Bluetooth and other output delays
  const OFFSET_KEY = 'guitar-mate:metronome-offset';
  const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
  const ROOM_CODE = /^[A-HJ-NP-Z2-9]{6}$/;

  const intervalMs = bpm => 60000 / bpm;
  const mod = (n, m) => ((n % m) + m) % m;

  // Index of the first grid beat at or after the time `ms`.
  function nextBeatIndex(grid, ms) {
    return Math.ceil((ms - grid.t0) / intervalMs(grid.bpm) - 1e-9);
  }
  const beatEpoch = (grid, k) => grid.t0 + k * intervalMs(grid.bpm);
  const beatInBar = k => mod(k, BEATS_PER_BAR);

  // New tempo starting at beat `k` of `grid`: that beat keeps its time and its place in the bar.
  function retime(grid, k, bpm) {
    const at = beatEpoch(grid, k);
    return { grid: { bpm, t0: at - beatInBar(k) * intervalMs(bpm) }, from: at };
  }

  const clampOffset = ms => Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, Math.round(Number(ms) || 0)));

  function makeRoomCode(random = Math.random) {
    let code = '';
    for (let i = 0; i < 6; i++) code += ROOM_ALPHABET[Math.floor(random() * ROOM_ALPHABET.length) % ROOM_ALPHABET.length];
    return code;
  }
  // "#room=ABC234" → "ABC234" (or null)
  function parseRoom(hash) {
    const match = /^#?room=([A-Za-z0-9]{6})$/.exec(String(hash || '').trim());
    const code = match && match[1].toUpperCase();
    return code && ROOM_CODE.test(code) ? code : null;
  }

  // Clock offset (server − local, ms) from round trips; the fastest round trip is the most trustworthy.
  // Each sample: {sent, received} local ms and `server` ms.
  function pickOffset(samples) {
    let best = null;
    for (const s of samples) {
      const rtt = s.received - s.sent;
      if (!(rtt >= 0)) continue;
      if (!best || rtt < best.rtt) best = { rtt, offset: s.server - (s.sent + s.received) / 2 };
    }
    return best;
  }

  // Where the sync server lives. Production and branch previews use separate workers;
  // on localhost a ?server=ws://… override is allowed for testing.
  function serverUrl(location, config) {
    const host = location.hostname;
    if (/^(localhost|127\.0\.0\.1)$/.test(host)) {
      const override = new URLSearchParams(location.search).get('server');
      if (override && /^wss?:\/\//.test(override)) return override.replace(/\/$/, '');
    }
    if (!config || !config.subdomain) return null;
    const worker = host === config.productionHost ? config.productionWorker : config.stageWorker;
    return `wss://${worker}.${config.subdomain}.workers.dev`;
  }

  root.metronomeSync = {
    BEATS_PER_BAR, MIN_BPM, MAX_BPM, OFFSET_LIMIT, OFFSET_KEY, ROOM_CODE,
    intervalMs, nextBeatIndex, beatEpoch, beatInBar, retime, clampOffset,
    makeRoomCode, parseRoom, pickOffset, serverUrl,
  };
})(typeof window !== 'undefined' ? window : globalThis);
