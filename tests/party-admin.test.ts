import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { createPartyApp } from '../backend-lib/party';
import { extendRoom } from '../backend-lib/party-admin';

const hour = 60 * 60 * 1000;
function setup() {
  let at = Date.parse('2026-11-03T18:21:39Z');
  const db = new Database(':memory:');
  const make = () => new Hono().route('/api/party', createPartyApp(db, new Set(['senate-tx', 'gov-ga']), { now: () => at, origins: ['https://party.test'] }));
  let app = make();
  const post = (action: string, body: unknown = {}, cookie = '') => app.request('https://party.test/api/party/' + action, { method: 'POST', headers: { Origin: 'https://party.test', 'Content-Type': 'application/json', 'X-Party-Request': '1', Cookie: cookie }, body: JSON.stringify(body) });
  const read = async (cookie = '') => (await app.request('https://party.test/api/party', { headers: { Cookie: cookie } })).json();
  const join = async () => { const r = await post('session'); return { cookie: r.headers.get('set-cookie')!.split(';')[0], header: r.headers.get('set-cookie')! }; };
  return { db, post, read, join, now: () => at, advance: (ms: number) => { at += ms; }, restart: () => { app = make(); } };
}

test('name tags outlive the posting window so later extensions keep guests', async () => {
  const s = setup(); const guest = await s.join();
  const maxAge = Number(/Max-Age=(\d+)/.exec(guest.header)![1]);
  expect(maxAge).toBeGreaterThan(12 * 3600 + 2 * 24 * 3600);
});

test('dry run writes nothing; apply extends the close, logs it, and reopens the room after restart', async () => {
  const s = setup(); const guest = await s.join();
  const opened = (await s.read()).closesAt - 12 * hour;
  s.advance(13 * hour);
  expect((await s.post('comment', { body: 'too late', requestId: 'admin_test_comment_1' }, guest.cookie)).status).toBe(410);
  const until = opened + 34 * hour + 38 * 60 * 1000;
  const dry = extendRoom(s.db, until, { now: s.now(), apply: false });
  expect(dry.applied).toBe(false);
  expect((s.db.query('SELECT closes FROM room').get() as { closes: number }).closes).toBe(opened + 12 * hour);
  expect(s.db.query("SELECT name FROM sqlite_master WHERE name='room_log'").get()).toBeNull();
  const done = extendRoom(s.db, until, { now: s.now(), apply: true, note: 'V asked' });
  expect(done.applied).toBe(true);
  expect((s.db.query("SELECT count(*) AS n FROM room_log WHERE action='extend-close'").get() as { n: number }).n).toBe(1);
  s.restart();
  const state = await s.read();
  expect(state.closed).toBe(false); expect(state.closesAt).toBe(until);
  const fresh = await s.join();
  expect((await s.post('reaction', { race: 'gov-ga', emoji: '🔥' }, fresh.cookie)).status).toBe(200);
  expect(() => extendRoom(s.db, until - hour, { now: s.now(), apply: true })).toThrow('later than the current close');
  expect(() => extendRoom(s.db, s.now() - 1, { now: s.now(), apply: true })).toThrow('in the future');
  s.db.close();
});

test('legacy handles are released only after the original close, and only once', async () => {
  const s = setup(); const a = await s.join(); const b = await s.join();
  await s.post('handle', { handle: 'Vattawar' }, a.cookie);
  await s.post('comment', { body: 'Let us go', requestId: 'admin_test_comment_2' }, a.cookie);
  const anon = (await s.read(b.cookie)).me.handle;
  const opened = (await s.read()).closesAt - 12 * hour;
  expect(() => extendRoom(s.db, opened + 30 * hour, { now: s.now(), apply: true, releaseLegacyHandles: true })).toThrow('after it has passed');
  s.advance(12 * hour + 5000);
  const plan = extendRoom(s.db, opened + 30 * hour, { now: s.now(), apply: true, releaseLegacyHandles: true });
  expect(plan.releases.map(r => r.from)).toEqual(['Vattawar']);
  expect((s.db.query('SELECT handle FROM guests WHERE handle=?').get(anon) as { handle: string }).handle).toBe(anon);
  s.restart();
  const returning = await s.join();
  expect((await s.post('handle', { handle: 'Vattawar' }, returning.cookie)).status).toBe(200);
  const comments = (await s.read(returning.cookie)).comments;
  expect(comments[0].handle).toBe('Vattawar'); expect(comments[0].mine).toBe(false);
  expect(() => extendRoom(s.db, opened + 40 * hour, { now: s.now(), apply: true, releaseLegacyHandles: true })).toThrow('original 12-hour room');
  s.db.close();
});
