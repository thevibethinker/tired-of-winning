import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import baseline from '../data/baseline-20261103/baseline.json';
import governors from '../data/baseline-20261103/governor-addendum-20261104.json';
import { createPartyApp } from '../backend-lib/party';
import { watchlistRaceIds } from '../backend-lib/watchlist';

test('party watchlist covers every race the dashboard shows, including governors', async () => {
  const ids = await watchlistRaceIds();
  for (const race of [...baseline.races, ...governors.races]) expect(ids.has(race.id)).toBe(true);
  expect(ids.size).toBe(baseline.races.length + governors.races.length);
  expect(ids.has('gov-ga')).toBe(true);
});

test('guests can react to and pick a governor race', async () => {
  const db = new Database(':memory:');
  const app = new Hono().route('/api/party', createPartyApp(db, await watchlistRaceIds(), { now: () => Date.parse('2026-11-04T05:00:00Z'), origins: ['https://party.test'] }));
  const post = (action: string, body: unknown, cookie = '') => app.request('https://party.test/api/party/' + action, { method: 'POST', headers: { Origin: 'https://party.test', 'Content-Type': 'application/json', 'X-Party-Request': '1', Cookie: cookie }, body: JSON.stringify(body) });
  const cookie = (await post('session', {})).headers.get('set-cookie')!.split(';')[0];
  const reacted = await post('reaction', { race: 'gov-ga', emoji: '🔥' }, cookie);
  expect(reacted.status).toBe(200);
  expect((await reacted.json()).races['gov-ga'].reactions['🔥']).toBe(1);
  expect((await post('pick', { race: 'gov-ga', choice: 'candidate' }, cookie)).status).toBe(200);
  expect((await post('reaction', { race: 'gov-zz', emoji: '🔥' }, cookie)).status).toBe(400);
  db.close();
});
