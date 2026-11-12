'use strict';
// WebSocket client for a metronome room on the sync server.
// Keeps the connection alive (cheap "ping" answered by the server runtime), reconnects after drops,
// measures the server clock offset with short bursts of round trips, and reports the leader's beat.
(function (root) {
  const KEEPALIVE_MS = 25000;
  // Time is re-measured a little every minute; the best round trips of the last 10 minutes are used.
  const RESYNC_MS = 60 * 1000, RESYNC_COUNT = 3, SAMPLE_WINDOW_MS = 10 * 60 * 1000;
  const BURST = 12, BURST_GAP_MS = 150;
  const RETRY_MS = [1000, 2000, 4000, 8000, 15000];

  function createRoom({ url, code, token = null, WebSocketImpl = root.WebSocket, now = () => root.performance.now(),
    setTimer = (fn, ms) => root.setTimeout(fn, ms), clearTimer = id => root.clearTimeout(id),
    onState = () => {}, onPeers = () => {}, onStatus = () => {}, onLeader = () => {}, onError = () => {} } = {}) {
    const pickOffset = root.metronomeSync.pickOffset;
    let ws = null, closed = false, attempts = 0;
    let samples = [], best = null, pending = new Map(), seq = 0;
    let keepalive = null, resync = null, retry = null, bursting = false;

    const send = obj => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

    function burst(count = BURST) {
      if (bursting) return;
      bursting = true;
      let sent = 0;
      const tick = () => {
        if (closed || !ws || ws.readyState !== 1) { bursting = false; return; }
        const id = ++seq;
        pending.set(id, now());
        send({ t: 'time', c: id });
        if (++sent < count) setTimer(tick, BURST_GAP_MS); else bursting = false;
      };
      tick();
    }

    function onMessage(raw) {
      if (raw === 'pong') return;
      let msg;
      try { msg = JSON.parse(raw); } catch (_) { return; }
      if (msg.t === 'time') {
        const sent = pending.get(msg.c);
        if (sent === undefined) return;
        pending.delete(msg.c);
        const received = now();
        samples.push({ sent, received, server: msg.s });
        samples = samples.filter(s => s.received > received - SAMPLE_WINDOW_MS).slice(-120);
        const wasSynced = Boolean(best);
        best = pickOffset(samples);
        if (!wasSynced && best) onStatus('synced');
      } else if (msg.t === 'state') onState(msg.state);
      else if (msg.t === 'peers') onPeers(msg.n);
      else if (msg.t === 'leader') onLeader();
      else if (msg.t === 'error') onError(msg.code);
    }

    function open() {
      if (closed) return;
      onStatus(attempts ? 'reconnecting' : 'connecting');
      let socket;
      try { socket = new WebSocketImpl(`${url}/room/${code}`); } catch (_) { scheduleRetry(); return; }
      ws = socket;
      socket.onopen = () => {
        attempts = 0;
        onStatus('connected');
        if (token) send({ t: 'claim', token });
        burst();
        keepalive = setInterval(() => { if (socket.readyState === 1) socket.send('ping'); }, KEEPALIVE_MS);
        resync = setInterval(() => burst(RESYNC_COUNT), RESYNC_MS);
      };
      socket.onmessage = event => onMessage(typeof event.data === 'string' ? event.data : String(event.data));
      socket.onclose = () => {
        clearInterval(keepalive); clearInterval(resync);
        if (ws === socket) ws = null;
        if (!closed) scheduleRetry();
      };
      socket.onerror = () => {};
    }
    const setInterval = (fn, ms) => { let id; const loop = () => { fn(); id = setTimer(loop, ms); }; id = setTimer(loop, ms); return { stop: () => clearTimer(id), get id() { return id; } }; };
    const clearInterval = handle => { if (handle) handle.stop(); };

    function scheduleRetry() {
      if (closed) return;
      onStatus('reconnecting');
      const wait = RETRY_MS[Math.min(attempts, RETRY_MS.length - 1)];
      attempts++;
      retry = setTimer(open, wait);
    }

    open();
    return {
      code,
      get synced() { return Boolean(best); },
      get rtt() { return best ? best.rtt : null; },
      // Server clock in ms (null until the first round trip).
      serverNow() { return best ? now() + best.offset : null; },
      offset() { return best ? best.offset : null; },
      publish(state) { if (token) send({ t: 'state', token, state }); },
      resync() { burst(RESYNC_COUNT + 3); },
      reconnectNow() { if (!closed && (!ws || ws.readyState > 1)) { clearTimer(retry); attempts = 0; open(); } },
      get connected() { return Boolean(ws && ws.readyState === 1); },
      close() {
        closed = true;
        clearTimer(retry);
        clearInterval(keepalive); clearInterval(resync);
        try { ws && ws.close(1000, 'leave'); } catch (_) {}
        ws = null;
      },
    };
  }

  function makeToken(cryptoImpl = root.crypto) {
    const bytes = new Uint8Array(16);
    cryptoImpl.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  root.metronomeRoom = { createRoom, makeToken };
})(typeof window !== 'undefined' ? window : globalThis);
