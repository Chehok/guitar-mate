'use strict';
// Shared-beat math for "Metronome sync" (metronome rooms).
// The leader's beat is a grid on the sync server's clock: beat k sounds at t0 + k·(60000/bpm) ms, and
// every 4th beat (k % 4 === 0) is the accented first beat. Phones measure their offset to the server
// clock (NTP-style round trips), then play the same grid on their own audio clock.
(function (root) {
  const BEATS_PER_BAR = 4;
  const OFFSET_LIMIT = 300; // ms, for Bluetooth and other output delays
  const OFFSET_KEY = 'guitar-mate:metronome-offset';
  const ROOM_CODE = /^\d{4}$/; // 4 digits: easy to read out and type on a phone keypad

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
    return String(Math.min(9999, Math.floor(random() * 10000))).padStart(4, '0');
  }
  // A typed code: digits only (spaces, dashes and full-width digits are tolerated). → "0427" or null
  function normalizeCode(input) {
    const digits = String(input || '').replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xFEE0)).replace(/\D/g, '');
    return ROOM_CODE.test(digits) ? digits : null;
  }
  // "#room=0427" → "0427" (or null)
  function parseRoom(hash) {
    const match = /^#?room=(\d{4})$/.exec(String(hash || '').trim());
    return match ? match[1] : null;
  }

  // Clock offset (server − local, ms) from round trips. Extra delay (queues, Wi-Fi/LTE bursts) almost
  // always hits one direction, so only the fastest round trips are trusted: those within FAST_MS of the
  // fastest one are averaged. Each sample: {sent, received} local ms and `server` ms.
  const FAST_MS = 8;
  function pickOffset(samples) {
    const valid = samples.map(s => ({ rtt: s.received - s.sent, offset: s.server - (s.sent + s.received) / 2 })).filter(s => s.rtt >= 0);
    if (!valid.length) return null;
    const fastest = Math.min(...valid.map(s => s.rtt));
    const fast = valid.filter(s => s.rtt <= fastest + FAST_MS);
    return { rtt: fastest, offset: fast.reduce((sum, s) => sum + s.offset, 0) / fast.length, samples: fast.length };
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
    const production = config.productionHosts || [config.productionHost];
    const worker = production.includes(host) ? config.productionWorker : config.stageWorker;
    return `wss://${worker}.${config.subdomain}.workers.dev`;
  }

  root.metronomeSync = {
    OFFSET_LIMIT, OFFSET_KEY, ROOM_CODE,
    intervalMs, nextBeatIndex, beatEpoch, beatInBar, retime, clampOffset,
    makeRoomCode, normalizeCode, parseRoom, pickOffset, serverUrl,
  };
})(typeof window !== 'undefined' ? window : globalThis);
