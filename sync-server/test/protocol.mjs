// Protocol test for the sync server. Needs a running server:
//   cd sync-server && npx wrangler dev --env stage --port 8787
//   SYNC_URL=ws://127.0.0.1:8787 node test/protocol.mjs
// (WS_MODULE can point to the `ws` package if it isn't resolvable from here.)
import assert from 'node:assert/strict';

const { default: WebSocket } = await import(process.env.WS_MODULE || 'ws');
const BASE = process.env.SYNC_URL || 'ws://127.0.0.1:8787';
const HTTP = BASE.replace(/^ws/, 'http');
const code = String(Math.floor(Math.random() * 10000)).padStart(4, '0');

function connect(path = `/room/${code}`, origin = 'http://localhost:8000') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE + path, { headers: origin ? { Origin: origin } : {} });
    ws.inbox = [];
    ws.waiters = [];
    ws.on('message', data => {
      const text = String(data);
      const msg = text === 'pong' ? { t: 'pong' } : JSON.parse(text);
      const i = ws.waiters.findIndex(w => w.match(msg));
      if (i >= 0) ws.waiters.splice(i, 1)[0].resolve(msg); else ws.inbox.push(msg);
    });
    ws.next = (match, ms = 3000) => {
      const i = ws.inbox.findIndex(match);
      if (i >= 0) return Promise.resolve(ws.inbox.splice(i, 1)[0]);
      return new Promise((resolve, rejectWait) => {
        const timer = setTimeout(() => rejectWait(new Error('timeout waiting for message')), ms);
        ws.waiters.push({ match, resolve: m => { clearTimeout(timer); resolve(m); } });
      });
    };
    ws.json = obj => ws.send(JSON.stringify(obj));
    ws.on('open', () => resolve(ws));
    ws.on('unexpected-response', (_, res) => reject(Object.assign(new Error('rejected'), { status: res.statusCode })));
    ws.on('error', reject);
  });
}
const type = t => m => m.t === t;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Health and bad requests
assert.equal(await (await fetch(HTTP + '/health')).text(), 'guitar-mate sync ok');
assert.equal((await fetch(HTTP + '/room/abc')).status, 400, 'bad room code');
assert.equal((await fetch(HTTP + '/room/ABC234')).status, 400, 'old letter codes are no longer valid');
assert.equal((await fetch(HTTP + `/room/${code}`)).status, 426, 'plain HTTP is not a WebSocket');
await assert.rejects(connect(`/room/${code}`, 'https://evil.example'), e => e.status === 403, 'other websites are refused');

// Leader joins and claims the room
const leader = await connect();
assert.equal((await leader.next(type('peers'))).n, 1);
const token = 'leader-token-' + Math.random().toString(36).slice(2, 12);
leader.json({ t: 'claim', token });
await leader.next(type('leader'));

// Time: the server answers with its clock; round trip is small locally
const sent = Date.now();
leader.json({ t: 'time', c: 42 });
const time = await leader.next(type('time'));
assert.equal(time.c, 42);
assert(Math.abs(time.s - sent) < 2000, 'server time is a real wall-clock time');

// Keep-alive ping is answered (by the runtime's auto-response)
leader.send('ping');
await leader.next(type('pong'));

// Leader publishes a beat; invalid states are ignored
const t0 = Date.now() + 500;
leader.json({ t: 'state', token, state: { bpm: 300, t0, playing: true } });
leader.json({ t: 'state', token, state: { bpm: 96, t0, playing: true } });
assert.deepEqual((await leader.next(type('state'))).state, { bpm: 96, t0, playing: true });

// A follower joining later gets the current beat immediately, and the leader sees 2 phones
const follower = await connect();
assert.deepEqual((await follower.next(type('state'))).state, { bpm: 96, t0, playing: true });
assert.equal((await leader.next(m => m.t === 'peers' && m.n === 2)).n, 2);

// Followers can't take over or publish
follower.json({ t: 'claim', token: 'someone-else-token-123' });
assert.equal((await follower.next(type('error'))).code, 'taken');
follower.json({ t: 'state', token: 'someone-else-token-123', state: { bpm: 120, t0, playing: true } });
assert.equal((await follower.next(type('error'))).code, 'not-leader');

// Tempo change and stop reach everyone
leader.json({ t: 'state', token, state: { bpm: 132, t0: t0 + 1000, playing: true } });
assert.equal((await follower.next(type('state'))).state.bpm, 132);
leader.json({ t: 'state', token, state: { bpm: 132, t0: t0 + 1000, playing: false } });
assert.equal((await follower.next(m => m.t === 'state' && !m.state.playing)).state.playing, false);

// The leader can reconnect (same token) and keep leading
leader.close();
assert.equal((await follower.next(m => m.t === 'peers' && m.n === 1)).n, 1);
const leaderAgain = await connect();
leaderAgain.json({ t: 'claim', token });
await leaderAgain.next(type('leader'));
leaderAgain.json({ t: 'state', token, state: { bpm: 100, t0, playing: true } });
assert.equal((await follower.next(type('state'))).state.bpm, 100);

// Garbage is ignored without closing the connection
follower.send('not json');
follower.send('x'.repeat(2000));
follower.json({ t: 'time', c: 7 });
assert.equal((await follower.next(type('time'))).c, 7);

// Everyone leaves: the room forgets its state and leader, so the code is free again
leaderAgain.close();
follower.close();
await sleep(500);
const fresh = await connect();
await fresh.next(type('peers'));
await sleep(300);
assert(!fresh.inbox.some(type('state')), 'an empty room keeps no old beat');
fresh.json({ t: 'claim', token: 'brand-new-leader-token' });
await fresh.next(type('leader'));
fresh.close();

// The leader closes the room: everyone hears 'closed' and is disconnected; a late reconnect hears it too;
// a new leader's claim reopens the code.
{
  const lead = await connect(), member = await connect();
  lead.json({ t: 'claim', token: 'closing-leader-token-1' });
  await lead.next(type('leader'));
  member.json({ t: 'claim', token: 'not-the-leader-token-1' });
  await member.next(type('error'));
  member.json({ t: 'close', token: 'not-the-leader-token-1' });
  member.json({ t: 'time', c: 9 });
  assert.equal((await member.next(type('time'))).c, 9, 'only the leader can close');
  const closedCode = new Promise(resolve => member.on('close', code => resolve(code)));
  lead.json({ t: 'close', token: 'closing-leader-token-1' });
  await member.next(type('closed'));
  assert.equal(await closedCode, 4001);
  await sleep(300);
  const late = await connect();
  await late.next(type('closed'));
  await sleep(200);
  late.close();
  const reopen = await connect();
  await reopen.next(type('closed'));
  reopen.json({ t: 'claim', token: 'reopening-leader-token' });
  await reopen.next(type('leader'));
  const joiner = await connect();
  await sleep(300);
  assert(!joiner.inbox.some(type('closed')), 'a reopened room is open again');
  reopen.close(); joiner.close();
}

// A follower's auto match is announced to everyone else (not back to itself); the leader can't announce,
// and a repeat within a second is dropped.
{
  await sleep(500);
  const lead = await connect(), a = await connect(), b = await connect();
  lead.json({ t: 'claim', token: 'measure-leader-token-1' });
  await lead.next(type('leader'));
  a.json({ t: 'measure', ms: 9000 });
  assert.equal((await b.next(type('measure'))).ms, 9000);
  assert.equal((await lead.next(type('measure'))).ms, 9000);
  a.json({ t: 'measure', ms: 99999 });
  lead.json({ t: 'measure', ms: 5000 });
  await sleep(400);
  assert.equal(b.inbox.filter(type('measure')).length, 0, 'an immediate repeat and the leader are ignored');
  assert(!a.inbox.some(type('measure')), 'not echoed back');
  await sleep(800);
  a.json({ t: 'measure', ms: 99999 });
  assert.equal((await b.next(type('measure'))).ms, 20000, 'capped');
  lead.close(); a.close(); b.close();
}

console.log(`Sync server protocol passed (room ${code}).`);
process.exit(0);
