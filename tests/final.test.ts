import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { FREEZE_BY, freezeReason, loadFinal, pendingRaces, writeFinal } from '../backend-lib/final';
import type { LiveRace, Result } from '../src/lib/election';

const result = (status: Result['status']): Result => ({ status, margin: null, reporting: null, votes: 0, candidateVotes: null, opponentVotes: null, candidateShare: null, opponentShare: null, winner: null });
const race = (id: string, status: Result['status']) => ({ id, result: result(status) }) as LiveRace;
const before = Date.parse(FREEZE_BY) - 1;
const dir = () => mkdtempSync(tmpdir() + '/tow-final-') + '/';

describe('When the count locks', () => {
  test('stays open while any race with live data is uncalled', () => {
    expect(freezeReason([race('a', 'won'), race('b', 'leading')], before)).toBeNull();
    expect(freezeReason([race('a', 'won'), race('b', 'trailing')], before)).toBeNull();
    expect(freezeReason([race('a', 'tied')], before)).toBeNull();
  });
  test('locks early once every race with data is called; no-data seats do not hold it open', () => {
    expect(freezeReason([race('a', 'won'), race('b', 'lost'), race('c', 'unavailable')], before)).toBe('all-called');
  });
  test('an empty race list never locks early', () => expect(freezeReason([], before)).toBeNull());
  test('locks at the deadline even with races uncalled', () => {
    expect(freezeReason([race('a', 'leading')], Date.parse(FREEZE_BY))).toBe('deadline');
    expect(FREEZE_BY).toBe('2026-11-21T05:00:00.000Z');
  });
  test('uncalled count excludes called and no-data races', () => expect(pendingRaces([race('a', 'won'), race('b', 'leading'), race('c', 'unavailable'), race('d', 'waiting')]).map(r => r.id)).toEqual(['b', 'd']));
});

describe('The locked record', () => {
  test('round-trips and records the uncalled count', async () => {
    const d = dir();
    expect(await loadFinal(d)).toBeNull();
    const { record, path } = writeFinal(d, { races: [race('a', 'won'), race('b', 'leading')] }, 'deadline', '2026-11-21T05:30:00.000Z');
    expect(path.endsWith('final-results-20261121.json')).toBe(true);
    expect(record.final).toMatchObject({ reason: 'deadline', uncalled: 1 });
    expect(await loadFinal(d)).toEqual(record);
  });
  test('names the file by the Eastern date of the lock', () => {
    expect(writeFinal(dir(), { races: [] }, 'all-called', '2026-11-12T03:00:00.000Z').path.endsWith('final-results-20261111.json')).toBe(true);
  });
  test('never overwrites an existing lock', () => {
    const d = dir();
    writeFinal(d, { races: [] }, 'all-called', '2026-11-12T15:00:00.000Z');
    expect(() => writeFinal(d, { races: [race('a', 'won')] }, 'deadline', '2026-11-12T16:00:00.000Z')).toThrow('Refusing to overwrite');
  });
  test('loads the newest lock', async () => {
    const d = dir();
    writeFinal(d, { races: [] }, 'all-called', '2026-11-10T15:00:00.000Z');
    writeFinal(d, { races: [race('z', 'won')] }, 'deadline', '2026-11-21T06:00:00.000Z');
    expect((await loadFinal(d))!.dashboard.races.map(r => r.id)).toEqual(['z']);
  });
  test('a malformed record stops startup instead of reopening the count', async () => {
    const d = dir();
    writeFileSync(d + 'final-results-20261121.json', JSON.stringify({ schema: 'something-else' }));
    expect(loadFinal(d)).rejects.toThrow('not a valid tow-final-v1 record');
  });
});
