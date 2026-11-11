'use strict';
// Shared-beat sync for the metronome (no server).
// A leader's beat grid is fixed to wall-clock time: beat k sounds at t0 + k·(60000/bpm) ms,
// and every 4th beat (k % 4 === 0) is the accented first beat. The grid travels in a link
// (…/metronome#sync=<bpm>.<t0>) that followers open by scanning a QR code; each phone then
// plays the same grid using its own clock, plus a per-device timing offset.
(function (root) {
  const BEATS_PER_BAR = 4;
  const MIN_BPM = 40, MAX_BPM = 240;
  const OFFSET_LIMIT = 300; // ms, for Bluetooth and other output delays
  const OFFSET_KEY = 'guitar-mate:metronome-offset';

  const intervalMs = bpm => 60000 / bpm;
  const mod = (n, m) => ((n % m) + m) % m;

  function formatSync({ bpm, t0 }) {
    return `sync=${Math.round(bpm)}.${Math.round(t0)}`;
  }

  // Accepts "#sync=90.1762870000000" (or without "#"). Returns {bpm, t0} or null.
  function parseSync(hash) {
    const match = /^#?sync=(\d{2,3})\.(\d{12,14})$/.exec(String(hash || '').trim());
    if (!match) return null;
    const bpm = Number(match[1]), t0 = Number(match[2]);
    if (bpm < MIN_BPM || bpm > MAX_BPM || !Number.isFinite(t0)) return null;
    return { bpm, t0 };
  }

  // Index of the first grid beat at or after the wall-clock time `epochMs`.
  function nextBeatIndex(grid, epochMs) {
    return Math.ceil((epochMs - grid.t0) / intervalMs(grid.bpm) - 1e-9);
  }

  const beatEpoch = (grid, k) => grid.t0 + k * intervalMs(grid.bpm);
  const beatInBar = k => mod(k, BEATS_PER_BAR);

  // Re-anchor so beat `k` keeps its wall-clock time and position in the bar while the tempo changes.
  function retime(grid, k, bpm) {
    const at = beatEpoch(grid, k);
    const t0 = at - beatInBar(k) * intervalMs(bpm);
    return { grid: { bpm, t0 }, k: beatInBar(k) };
  }

  // Grid from an already-running beat: the beat at `epochMs` is beat `beat` (0–3) of its bar.
  function gridFromBeat(bpm, epochMs, beat) {
    return { bpm, t0: epochMs - beatInBar(beat) * intervalMs(bpm) };
  }

  const clampOffset = ms => Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, Math.round(Number(ms) || 0)));

  root.metronomeSync = {
    BEATS_PER_BAR, MIN_BPM, MAX_BPM, OFFSET_LIMIT, OFFSET_KEY,
    intervalMs, formatSync, parseSync, nextBeatIndex, beatEpoch, beatInBar, retime, gridFromBeat, clampOffset,
  };
})(typeof window !== 'undefined' ? window : globalThis);
