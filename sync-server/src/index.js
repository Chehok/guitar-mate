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
import { DurableObject } from 'cloudflare:workers';

const ROOM_CODE = /^\d{4}$/;
const MAX_MESSAGE = 512;
const MAX_PEERS = 32;

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
      if (!current) await this.ctx.storage.put('leaderToken', token);
      ws.serializeAttachment({ leader: true });
      ws.send(JSON.stringify({ t: 'leader' }));
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
    if (others.length === 0) { await this.ctx.storage.deleteAll(); return; }
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
