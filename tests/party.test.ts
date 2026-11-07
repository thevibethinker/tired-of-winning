import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { createPartyApp } from '../backend-lib/party';

function setup() {
  let at = Date.parse('2026-11-03T18:00:00Z');
  const db = new Database(':memory:');
  const make = () => new Hono().route('/api/party', createPartyApp(db, new Set(['senate-tx', 'house-nc-1']), { now: () => at, origins: ['https://party.test'], hostKey: 'test-only-private-host-key' }));
  let app = make();
  async function post(action: string, body: unknown = {}, cookie = '', extra: Record<string, string> = {}) {
    return app.request('https://party.test/api/party/' + action, { method: 'POST', headers: { Origin: 'https://party.test', 'Content-Type': 'application/json', 'X-Party-Request': '1', Cookie: cookie, ...extra }, body: JSON.stringify(body) });
  }
  async function join() { const response = await post('session'); return { cookie: response.headers.get('set-cookie')!.split(';')[0], data: await response.json(), response }; }
  const read = async (cookie = '') => (await app.request('https://party.test/api/party', { headers: { Cookie: cookie } })).json();
  const search = (cookie = '', query = '') => app.request('https://party.test/api/party/host-comments' + query, { headers: { Cookie: cookie } });
  return { db, post, join, read, search, advance: (ms: number) => { at += ms; }, restart: () => { app = make(); } };
}

test('host access cannot be claimed by handle or forged guest fields', async () => {
  const s = setup(); const guest = await s.join();
  await s.post('handle', { handle: 'V', isHost: true }, guest.cookie);
  expect((await s.read(guest.cookie)).isHost).toBe(false);
  expect((await s.post('moderate-comment', { id: 1, removed: true, isHost: true }, guest.cookie)).status).toBe(403);
  expect((await s.search(guest.cookie)).status).toBe(403);
  expect((await s.post('host-login', { key: 'wrong' }, guest.cookie)).status).toBe(403);
  expect((await s.post('host-login', { key: 'test-only-private-host-key' }, guest.cookie, { Origin: 'https://evil.test' })).status).toBe(403);
  const response = await s.post('host-login', { key: 'test-only-private-host-key' }, guest.cookie);
  expect(response.status).toBe(200);
  expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  expect(response.headers.get('set-cookie')).toContain('SameSite=Strict');
  expect(response.headers.get('set-cookie')).toContain('Secure');
  expect((await response.json()).isHost).toBe(true);
  expect(JSON.stringify(await s.read())).not.toContain('private-host-key');
  s.db.close();
});

test('host removes and restores any comment, with idempotent moderation history', async () => {
  const s = setup(); const guest = await s.join();
  await s.post('comment', { body: 'A guest comment', requestId: 'moderation_comment_01' }, guest.cookie);
  const id = (await s.read()).comments[0].id;
  const login = await s.post('host-login', { key: 'test-only-private-host-key' });
  const host = login.headers.get('set-cookie')!.split(';')[0];
  expect((await s.read(host)).isHost).toBe(true);
  for (let i = 0; i < 2; i++) expect((await s.post('moderate-comment', { id, removed: true }, host)).status).toBe(200);
  expect((await s.read(guest.cookie)).comments).toHaveLength(0);
  expect((await s.search(host)).status).toBe(200);
  expect((await (await s.search(host)).json()).comments).toHaveLength(0);
  expect(s.db.query('SELECT count(*) AS n FROM moderation').get()).toEqual({ n: 1 });
  expect((await s.post('moderate-comment', { id, removed: false }, guest.cookie)).status).toBe(403);
  expect((await s.post('moderate-comment', { id, removed: false }, host)).status).toBe(200);
  expect((await s.read()).comments).toHaveLength(1);
  expect((await s.post('moderate-comment', { id: 999, removed: true }, host)).status).toBe(404);
  expect((await s.post('moderate-comment', { id, removed: 'true' }, host)).status).toBe(400);
  s.restart(); expect((await s.read(host)).isHost).toBe(true);
  s.advance(12 * 60 * 60 * 1000);
  expect((await s.read()).closed).toBe(true);
  expect((await s.post('moderate-comment', { id, removed: true }, host)).status).toBe(200);
  expect((await s.read()).comments).toHaveLength(0);
  expect((await s.post('comment', { body: 'late post', requestId: 'moderation_comment_02' }, guest.cookie)).status).toBe(410);
  s.db.close();
});

test('host search finds old comments, paginates, and treats query syntax literally', async () => {
  const s = setup();
  const insert = s.db.query('INSERT INTO comments(guest,request_id,handle,body,at) VALUES(?,?,?,?,?)');
  for (let i = 1; i <= 205; i++) insert.run('guest', 'test_' + i, i === 1 ? 'UniqueHandle' : 'someone', i === 1 ? 'needle % underscore_ SQL' : 'other message', i);
  const login = await s.post('host-login', { key: 'test-only-private-host-key' });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const newest = await (await s.search(cookie)).json();
  expect(newest.comments).toHaveLength(200); expect(newest.hasOlder).toBe(true);
  const old = await (await s.search(cookie, '?before=6')).json(); expect(old.comments).toHaveLength(5);
  for (const q of ['uniquehandle', 'NEEDLE', '%', 'underscore_']) expect((await (await s.search(cookie, '?q=' + encodeURIComponent(q))).json()).comments[0].id).toBe(1);
  expect((await (await s.search(cookie, '?q=' + encodeURIComponent("' OR 1=1 --"))).json()).comments).toHaveLength(0);
  s.db.close();
});

test('host sessions expire and logout revokes the actual token', async () => {
  const s = setup();
  const login = await s.post('host-login', { key: 'test-only-private-host-key' });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  expect((await s.post('host-logout', {}, cookie)).status).toBe(200);
  expect((await s.read(cookie)).isHost).toBe(false);
  expect((await s.search(cookie)).status).toBe(403);
  const second = await s.post('host-login', { key: 'test-only-private-host-key' });
  const expired = second.headers.get('set-cookie')!.split(';')[0];
  s.advance(24 * 60 * 60 * 1000);
  expect((await s.read(expired)).isHost).toBe(false);
  expect((await s.post('moderate-comment', { id: 1, removed: true }, expired)).status).toBe(403);
  expect((await s.post('host-login', { key: 'test-only-private-host-key' })).status).toBe(200);
  s.db.close();
});

test('host login rate limits guessing and absent keys fail closed', async () => {
  const s = setup();
  for (let i = 0; i < 5; i++) expect((await s.post('host-login', { key: 'nope' })).status).toBe(403);
  expect((await s.post('host-login', { key: 'test-only-private-host-key' })).status).toBe(429);
  s.advance(60001); expect((await s.post('host-login', { key: 'test-only-private-host-key' })).status).toBe(200);
  s.db.close();
  const db = new Database(':memory:'); const app = createPartyApp(db, new Set(), { origins: ['https://party.test'] });
  const r = await app.request('https://party.test/host-login', { method: 'POST', headers: { Origin: 'https://party.test', 'Content-Type': 'application/json', 'X-Party-Request': '1' }, body: JSON.stringify({ key: '' }) });
  expect(r.status).toBe(403); db.close();
});

test('separate browsers get separate identities and a secure private cookie', async () => {
  const s = setup(); const a = await s.join(); const b = await s.join();
  expect(a.cookie).not.toBe(b.cookie); expect(a.data.me.handle).not.toBe(b.data.me.handle);
  expect(a.response.headers.get('set-cookie')).toContain('HttpOnly'); expect(a.response.headers.get('set-cookie')).toContain('Secure');
  expect(a.response.headers.get('set-cookie')).toContain('SameSite=Lax');
  expect((await s.read(a.cookie)).me.handle).toBe(a.data.me.handle);
  expect((await s.post('session', {}, a.cookie)).headers.get('set-cookie')).toBeNull();
  s.db.close();
});
test('public board exposes handles and messages, never credentials', async () => {
  const s = setup(); const a = await s.join(); await s.post('handle', { handle: 'V_party' }, a.cookie);
  await s.post('comment', { body: '<script>alert(1)</script> 💙', requestId: 'message_request_001' }, a.cookie);
  const publicView = await s.read(); expect(publicView.me).toBeNull(); expect(publicView.comments[0].handle).toBe('V_party');
  expect(publicView.comments[0].mine).toBe(false); expect(publicView.comments[0].body).toContain('<script>');
  expect(JSON.stringify(publicView)).not.toContain(a.cookie.split('=')[1]);
  expect(Object.keys(publicView.comments[0]).sort()).toEqual(['at', 'body', 'handle', 'id', 'mine']); s.db.close();
});
test('handles are validated and unique ignoring case', async () => {
  const s = setup(); const a = await s.join(); const b = await s.join();
  expect((await s.post('handle', { handle: '@Party_V' }, a.cookie)).status).toBe(200);
  expect((await s.post('handle', { handle: 'party_v' }, b.cookie)).status).toBe(409);
  expect((await s.post('handle', { handle: '<b>V</b>' }, a.cookie)).status).toBe(400);
  expect((await s.read(a.cookie)).me.handle).toBe('Party_V'); s.db.close();
});
test('duplicate message retries are idempotent, modified retries fail', async () => {
  const s = setup(); const a = await s.join(); const body = { body: 'Come on Texas!', requestId: 'message_request_002' };
  expect((await s.post('comment', body, a.cookie)).status).toBe(200); expect((await s.post('comment', body, a.cookie)).status).toBe(200);
  expect((await s.read()).comments).toHaveLength(1);
  expect((await s.post('comment', { ...body, body: 'Different' }, a.cookie)).status).toBe(409); s.db.close();
});
test('comments enforce size, content, authentication and pace', async () => {
  const s = setup(); const a = await s.join();
  expect((await s.post('comment', { body: 'Hi', requestId: 'message_request_003' })).status).toBe(401);
  for (const body of ['', ' '.repeat(10), 'a'.repeat(501), 'hi\u0000']) expect((await s.post('comment', { body, requestId: 'message_request_003' }, a.cookie)).status).toBe(400);
  expect((await s.post('comment', { body: 'a'.repeat(5000), requestId: 'message_request_003' }, a.cookie)).status).toBe(413);
  expect((await s.post('comment', { body: 'hello', requestId: 'message_request_003' }, a.cookie)).status).toBe(200);
  expect((await s.post('comment', { body: 'again', requestId: 'message_request_004' }, a.cookie)).status).toBe(429);
  s.advance(3100); expect((await s.post('comment', { body: 'again', requestId: 'message_request_004' }, a.cookie)).status).toBe(200); s.db.close();
});
test('only the author can remove a message', async () => {
  const s = setup(); const a = await s.join(); const b = await s.join();
  await s.post('comment', { body: 'Temporary message', requestId: 'message_request_005' }, a.cookie);
  const id = (await s.read()).comments[0].id;
  expect((await s.post('remove-comment', { id }, b.cookie)).status).toBe(403);
  expect((await s.post('remove-comment', { id }, a.cookie)).status).toBe(200);
  expect((await s.read()).comments).toHaveLength(0); s.db.close();
});
test('one reaction per browser per race; repeated requests do not inflate it', async () => {
  const s = setup(); const a = await s.join(); const b = await s.join();
  for (const cookie of [a.cookie, a.cookie, b.cookie]) await s.post('reaction', { race: 'senate-tx', emoji: '🔥' }, cookie);
  expect((await s.read()).races['senate-tx'].reactions['🔥']).toBe(2);
  await s.post('reaction', { race: 'senate-tx', emoji: '💙' }, a.cookie);
  expect((await s.read()).races['senate-tx'].reactions).toEqual({ '🔥': 1, '💙': 1 });
  expect((await s.read(a.cookie)).races['senate-tx'].myReaction).toBe('💙');
  expect((await s.read(b.cookie)).races['senate-tx'].myReaction).toBe('🔥');
  await s.post('reaction', { race: 'senate-tx', emoji: null }, a.cookie);
  expect((await s.read()).races['senate-tx'].reactions).toEqual({ '🔥': 1 }); s.db.close();
});
test('one changeable pick per browser per race and no inflated totals', async () => {
  const s = setup(); const a = await s.join(); const b = await s.join();
  for (const cookie of [a.cookie, a.cookie, b.cookie]) await s.post('pick', { race: 'senate-tx', choice: 'candidate' }, cookie);
  await s.post('pick', { race: 'senate-tx', choice: 'opponent' }, a.cookie);
  let race = (await s.read(a.cookie)).races['senate-tx']; expect(race.totalPicks).toBe(2); expect(race.picks).toEqual({ candidate: 1, opponent: 1, other: 0 }); expect(race.myPick).toBe('opponent');
  await s.post('pick', { race: 'senate-tx', choice: null }, a.cookie);
  race = (await s.read()).races['senate-tx']; expect(race.totalPicks).toBe(1); expect(race.picks.opponent).toBe(0); s.db.close();
});
test('race and choice allowlists reject unknown input', async () => {
  const s = setup(); const a = await s.join();
  expect((await s.post('pick', { race: 'not-a-race', choice: 'candidate' }, a.cookie)).status).toBe(400);
  expect((await s.post('pick', { race: 'senate-tx', choice: 'invalid' }, a.cookie)).status).toBe(400);
  expect((await s.post('reaction', { race: 'senate-tx', emoji: 'invalid' }, a.cookie)).status).toBe(400); s.db.close();
});
test('cross-origin requests and missing request headers cannot write', async () => {
  const s = setup(); const a = await s.join();
  expect((await s.post('handle', { handle: 'hijacked' }, a.cookie, { Origin: 'https://evil.test' })).status).toBe(403);
  expect((await s.post('handle', { handle: 'hijacked' }, a.cookie, { 'X-Party-Request': '' })).status).toBe(403);
  expect((await s.post('handle', { handle: 'hijacked' }, a.cookie, { 'Content-Type': 'text/plain' })).status).toBe(415);
  expect((await s.read(a.cookie)).me.handle).toBe(a.data.me.handle); s.db.close();
});
test('room cutoff and guest state survive restarting the app', async () => {
  const s = setup(); const a = await s.join(); await s.post('pick', { race: 'senate-tx', choice: 'other' }, a.cookie);
  s.advance(11 * 60 * 60 * 1000); s.restart();
  expect((await s.read(a.cookie)).closesAt).toBe(a.data.closesAt);
  expect((await s.read(a.cookie)).races['senate-tx'].myPick).toBe('other');
  s.advance(60 * 60 * 1000);
  expect((await s.post('pick', { race: 'senate-tx', choice: 'candidate' }, a.cookie)).status).toBe(410);
  expect((await s.post('session')).status).toBe(410); expect((await s.read()).closed).toBe(true); s.db.close();
});
test('active browser counts expire and never imply verified humans', async () => {
  const s = setup(); const a = await s.join(); await s.join(); expect((await s.read()).online).toBe(2);
  s.advance(91_000); expect((await s.read()).online).toBe(0); expect((await s.read(a.cookie)).online).toBe(1); s.db.close();
});
test('read endpoints are not publicly cacheable and do not set cookies', async () => {
  const db = new Database(':memory:'); const app = createPartyApp(db, new Set());
  const response = await app.request('http://localhost/'); expect(response.headers.get('Cache-Control')).toBe('no-store'); expect(response.headers.get('Vary')).toBe('Cookie'); expect(response.headers.get('Set-Cookie')).toBeNull(); db.close();
});
