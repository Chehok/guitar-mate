// Guitar Mate metronome sync server (Cloudflare Worker + Durable Object).
//
// One Durable Object per room (named by the room code). Phones connect over a WebSocket:
//   wss://<worker>/room/<CODE>
// The object uses the WebSocket Hibernation API and keeps no timers, so it sleeps (and isn't billed
// for duration) between messages. Keep-alive "ping" is answered by setWebSocketAutoResponse without
// waking it. All beat timing happens on the phones; the server only:
//   • answers time requests (NTP-style)       {t:'time', c}            → {t:'time', c, s}
//   • lets one phone lead (token-protected)    {t:'claim', token}       → {t:'leader'} | {t:'error', code:'taken'}
//   • stores and broadcasts the leader's beat  {t:'state', token, state} → everyone {t:'state', state}
//   • tells everyone how many phones are in    → {t:'peers', n}
//   • closes the room for everyone             {t:'close', token}       → everyone {t:'closed'}
//     (a phone that reconnects within CLOSED_MS also hears {t:'closed'}; a new leader's claim reopens it)
import { DurableObject } from 'cloudflare:workers';

const ROOM_CODE = /^\d{4}$/;
const MAX_MESSAGE = 512;
const MAX_PEERS = 32;
const CLOSED_MS = 10 * 60 * 1000;
const CLOSED_CODE = 4001;

function originAllowed(origin, allowed) {
  if (!origin) return true; // non-browser clients; browsers always send Origin on WebSocket upgrades
  const patterns = String(allowed || '').split(',').map(s => s.trim()).filter(Boolean);
  return patterns.some(pattern => {
    if (pattern === '*') return true;
    const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
    return re.test(origin);
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response('guitar-mate sync ok', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    const match = /^\/room\/([^/]+)$/.exec(url.pathname);
    if (!match) return new Response('Not found', { status: 404 });
    const code = match[1].toUpperCase();
    if (!ROOM_CODE.test(code)) return new Response('Bad room code', { status: 400 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    if (!originAllowed(request.headers.get('Origin'), env.ALLOWED_ORIGINS)) return new Response('Forbidden', { status: 403 });
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
  },
};

// Validates the beat a leader publishes.
export function cleanState(state) {
  if (!state || typeof state !== 'object') return null;
  const bpm = Math.round(Number(state.bpm));
  const t0 = Number(state.t0);
  if (!(bpm >= 40 && bpm <= 240) || !Number.isFinite(t0) || t0 < 1e12 || t0 > 1e14) return null;
  const clean = { bpm, t0, playing: state.playing === true };
  // Tempo change while playing: the new grid takes over at this server time (same for every phone).
  const from = Number(state.from);
  if (Number.isFinite(from) && from > 1e12 && from < 1e14) clean.from = from;
  return clean;
}

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Answered by the runtime itself: no wake-up, no duration charge.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch() {
    if (this.ctx.getWebSockets().length >= MAX_PEERS) return new Response('Room is full', { status: 429 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ leader: false });
    const closedAt = await this.ctx.storage.get('closedAt');
    // Recently closed: tell the newcomer (a member reconnecting leaves). A new leader that happens to
    // pick this code ignores it and its claim reopens the room.
    if (closedAt && Date.now() - closedAt < CLOSED_MS) {
      server.send(JSON.stringify({ t: 'closed' }));
      return new Response(null, { status: 101, webSocket: client });
    }
    const state = await this.ctx.storage.get('state');
    if (state) server.send(JSON.stringify({ t: 'state', state }));
    this.broadcastPeers();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return;
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'time') {
      ws.send(JSON.stringify({ t: 'time', c: msg.c, s: Date.now() }));
      return;
    }
    if (msg.t === 'claim') {
      const token = typeof msg.token === 'string' && msg.token.length >= 16 && msg.token.length <= 64 ? msg.token : null;
      if (!token) return;
      const current = await this.ctx.storage.get('leaderToken');
      if (current && current !== token) { ws.send(JSON.stringify({ t: 'error', code: 'taken' })); return; }
      if (!current) { await this.ctx.storage.delete('closedAt'); await this.ctx.storage.put('leaderToken', token); }
      ws.serializeAttachment({ ...(ws.deserializeAttachment() || {}), leader: true });
      ws.send(JSON.stringify({ t: 'leader' }));
      return;
    }
    // A follower starts auto match: everyone else hears about it, so other followers keep quiet
    // (the leader's clicks are what's being measured). Followers only, at most twice a second each.
    if (msg.t === 'measure') {
      const me = ws.deserializeAttachment() || {};
      if (me.leader) return;
      const now = Date.now();
      if (me.measuredAt && now - me.measuredAt < 500) return;
      ws.serializeAttachment({ ...me, measuredAt: now });
      const ms = Math.max(1000, Math.min(20000, Math.round(Number(msg.ms) || 0)));
      const out = JSON.stringify({ t: 'measure', ms });
      for (const peer of this.ctx.getWebSockets()) { if (peer !== ws) { try { peer.send(out); } catch (_) {} } }
      return;
    }
    if (msg.t === 'close') {
      if (await this.isLeader(msg.token)) await this.closeRoom();
      return;
    }
    if (msg.t === 'state') {
      if (!(await this.isLeader(msg.token))) { ws.send(JSON.stringify({ t: 'error', code: 'not-leader' })); return; }
      const state = cleanState(msg.state);
      if (!state) return;
      await this.ctx.storage.put('state', state);
      const out = JSON.stringify({ t: 'state', state });
      for (const peer of this.ctx.getWebSockets()) { try { peer.send(out); } catch (_) {} }
    }
  }

  // The leader closes the room: everyone is told and disconnected, and the room forgets its beat.
  async closeRoom() {
    const out = JSON.stringify({ t: 'closed' });
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.put('closedAt', Date.now());
    for (const peer of this.ctx.getWebSockets()) {
      try { peer.send(out); } catch (_) {}
      try { peer.close(CLOSED_CODE, 'closed'); } catch (_) {}
    }
  }

  async webSocketClose(ws, code) {
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch (_) {}
    await this.afterLeave(ws);
  }

  async webSocketError(ws) {
    await this.afterLeave(ws);
  }

  async afterLeave(ws) {
    const others = this.ctx.getWebSockets().filter(peer => peer !== ws);
    // Empty room: forget everything so the code can be reused and nothing is stored.
    if (others.length === 0) {
      const closedAt = await this.ctx.storage.get('closedAt');
      await this.ctx.storage.deleteAll();
      if (closedAt && Date.now() - closedAt < CLOSED_MS) await this.ctx.storage.put('closedAt', closedAt);
      return;
    }
    this.broadcastPeers(ws);
  }

  async isLeader(token) {
    const current = await this.ctx.storage.get('leaderToken');
    return Boolean(current) && current === token;
  }

  broadcastPeers(leaving) {
    const peers = this.ctx.getWebSockets().filter(peer => peer !== leaving);
    const out = JSON.stringify({ t: 'peers', n: peers.length });
    for (const peer of peers) { try { peer.send(out); } catch (_) {} }
  }
}
