import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { createTelemetry } from '../backend-lib/telemetry';
import { createPartyApp } from '../backend-lib/party';

function setup() {
  let at = Date.parse('2026-11-03T23:00:00Z');
  const db = new Database(':memory:'), partyDb = new Database(':memory:');
  const telemetry = createTelemetry(db, { now: () => at, origins: ['https://party.test'], maxRows: 60 });
  const app = new Hono().route('/api/t', telemetry.app).route('/api/party', createPartyApp(partyDb, new Set(['senate-tx']), { now: () => at, origins: ['https://party.test'], hostKey: 'test-only-private-host-key', stats: telemetry.stats }));
  const send = (body: unknown, origin = 'https://party.test') => app.request('https://party.test/api/t', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const visitor = (n: number) => n.toString(16).padStart(32, 'a');
  const event = (n: number, kind = 'view', extra: Record<string, unknown> = {}) => ({ visitor: visitor(n), kind, device: 'phone', via: '(direct)', ...extra });
  const party = (action: string, body: unknown, cookie = '') => app.request('https://party.test/api/party/' + action, { method: 'POST', headers: { Origin: 'https://party.test', 'Content-Type': 'application/json', 'X-Party-Request': '1', Cookie: cookie }, body: JSON.stringify(body) });
  return { db, telemetry, send, event, party, app, advance: (ms: number) => { at += ms; }, now: () => at };
}

test('accepts anonymous events and stores only the allowed fields', async () => {
  const s = setup();
  expect((await s.send(s.event(1, 'view', { via: 'instagram.com', handle: 'V', url: 'https://secret' }))).status).toBe(204);
  const rows = s.db.query('SELECT * FROM events').all() as Record<string, unknown>[];
  expect(rows).toHaveLength(1);
  expect(Object.keys(rows[0]).sort()).toEqual(['at', 'device', 'id', 'kind', 'via', 'visitor']);
  expect(rows[0].via).toBe('instagram.com');
  expect(JSON.stringify(rows)).not.toContain('secret');
});

test('rejects foreign origins, malformed events and unknown kinds', async () => {
  const s = setup();
  expect((await s.send(s.event(1), 'https://evil.test')).status).toBe(403);
  expect((await s.send('not json')).status).toBe(400);
  expect((await s.send({ ...s.event(1), visitor: 'short' })).status).toBe(400);
  expect((await s.send(s.event(1, 'purchase'))).status).toBe(400);
  expect((await s.send({ ...s.event(1), device: 'fridge' })).status).toBe(400);
  expect((await s.send({ ...s.event(1), via: 'https://evil.test/<script>' })).status).toBe(204);
  expect((s.db.query('SELECT via FROM events').get() as { via: string }).via).toBe('(other)');
  expect((await s.send(JSON.stringify({ ...s.event(1), pad: 'x'.repeat(2000) }))).status).toBe(413);
});

test('rate-limits a single browser and caps total rows', async () => {
  const s = setup();
  for (let i = 0; i < 20; i++) expect((await s.send(s.event(1, 'ping'))).status).toBe(204);
  expect((await s.send(s.event(1, 'ping'))).status).toBe(429);
  s.advance(61_000);
  expect((await s.send(s.event(1, 'ping'))).status).toBe(204);
  for (let i = 2; i < 41; i++) await s.send(s.event(i));
  expect((s.db.query('SELECT count(*) AS n FROM events').get() as { n: number }).n).toBe(60);
  expect((await s.send(s.event(99))).status).toBe(503);
});

test('stats count unique browsers, live now, peak and sources', async () => {
  const s = setup();
  await s.send(s.event(1, 'view', { via: 'via:qr' }));
  await s.send(s.event(2, 'view', { via: 'instagram.com', device: 'desktop' }));
  await s.send(s.event(2, 'view', { via: 'instagram.com', device: 'desktop' }));
  await s.send(s.event(3, 'view'));
  await s.send(s.event(1, 'sound_on'));
  await s.send(s.event(3, 'chat_open'));
  s.advance(10 * 60_000);
  await s.send(s.event(1, 'ping'));
  const stats = s.telemetry.stats();
  expect(stats.visitors).toBe(3);
  expect(stats.views).toBe(4);
  expect(stats.liveNow).toBe(1);
  expect(stats.peak.visitors).toBe(3);
  expect(stats.peak.at).toBe(Math.floor(Date.parse('2026-11-03T23:00:00Z') / 120_000) * 120_000);
  expect(stats.soundOn).toBe(1);
  expect(stats.chatOpens).toBe(1);
  expect(stats.devices).toEqual({ phone: 2, desktop: 1 });
  expect(stats.sources.map(r => r.via).sort()).toEqual(['(direct)', 'instagram.com', 'via:qr']);
  expect(stats.since).toBe(Date.parse('2026-11-03T23:00:00Z'));
});

test('stats are host-only and include room totals', async () => {
  const s = setup();
  await s.send(s.event(1));
  const join = await s.party('session', {});
  const cookie = join.headers.get('set-cookie')!.split(';')[0];
  expect((await s.app.request('https://party.test/api/party/host-stats', { headers: { Cookie: cookie } })).status).toBe(403);
  await s.party('handle', { handle: 'named_guest' }, cookie);
  await s.party('comment', { body: 'hello', requestId: 'stats_comment_000001' }, cookie);
  const login = await s.party('host-login', { key: 'test-only-private-host-key' }, cookie);
  const both = cookie + '; ' + login.headers.get('set-cookie')!.split(';')[0];
  const response = await s.app.request('https://party.test/api/party/host-stats', { headers: { Cookie: both } });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.traffic.visitors).toBe(1);
  expect(body.room).toMatchObject({ guests: 1, named: 1, commenters: 1, comments: 1, removed: 0 });
});

test('empty database reports zeros, not errors', () => {
  const s = setup();
  expect(s.telemetry.stats()).toMatchObject({ visitors: 0, views: 0, liveNow: 0, peak: { visitors: 0, at: null }, hours: [], sources: [], since: null });
});
