import { describe, expect, test } from 'bun:test';
import baseline from '../data/baseline-20261103/baseline.json';
import { closeFor, closeNote, countdown, etTime, groupByClose, nextClose, relative, stateCloses } from '../src/lib/schedule';

const races = (baseline as { races: { id: string; chamber: string; state: string }[] }).races;
const senate = [...new Set(races.filter(r => r.chamber === 'Senate').map(r => r.state))];
const at = (iso: string) => Date.parse(iso);

describe('Poll-closing schedule', () => {
  test('every Senate and House state has a closing time', () => {
    expect(senate.length).toBe(35);
    expect(races.filter(r => !closeFor(r.state)).map(r => r.state)).toEqual([]);
    expect(Object.keys(stateCloses).length).toBe(51);
  });
  test('times render in Eastern time, including after midnight', () => {
    expect(etTime(stateCloses.KY.at)).toBe('6:00 p.m. ET');
    expect(etTime(stateCloses.NC.at)).toBe('7:30 p.m. ET');
    expect(etTime(stateCloses.AK.at)).toBe('12:00 a.m. ET');
    expect(etTime(stateCloses.AK.rest!)).toBe('1:00 a.m. ET');
  });
  test('first close is Kentucky at 6 p.m. ET', () => {
    expect(nextClose(at('2026-11-03T18:30:00Z'), senate)).toEqual({ at: '2026-11-03T23:00:00Z', states: ['KY'], first: true });
  });
  test('a close time is not "next" at its exact instant', () => {
    const next = nextClose(at('2026-11-04T00:00:00Z'), senate)!;
    expect(next.at).toBe('2026-11-04T00:30:00Z');
    expect(next.states).toEqual(['NC', 'OH', 'WV']);
    expect(next.first).toBe(false);
  });
  test('Alaska is next after 11 p.m., then nothing remains', () => {
    expect(nextClose(at('2026-11-04T04:30:00Z'), senate)?.states).toEqual(['AK']);
    expect(nextClose(at('2026-11-04T05:00:01Z'), senate)).toBeNull();
  });
  test('groups sort chronologically across midnight and hold all 35 Senate states', () => {
    const groups = groupByClose(senate.map(state => ({ state })));
    expect(groups.map(g => etTime(g.at))).toEqual(['6:00 p.m. ET', '7:00 p.m. ET', '7:30 p.m. ET', '8:00 p.m. ET', '8:30 p.m. ET', '9:00 p.m. ET', '10:00 p.m. ET', '11:00 p.m. ET', '12:00 a.m. ET']);
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(35);
  });
  test('split states explain the later closing', () => {
    expect(closeNote('FL')).toBe('Most polls close 7:00 p.m. ET; the rest by 8:00 p.m. ET.');
    expect(closeNote('OR')).toBe('A few polls close 10:00 p.m. ET; most at 11:00 p.m. ET.');
    expect(closeNote('ZZ')).toBe('Poll-closing time unavailable.');
  });
  test('countdown and relative labels', () => {
    expect(countdown(4 * 3600e3 + 5 * 60e3 + 9e3)).toBe('4:05:09');
    expect(countdown(-5)).toBe('0:00:00');
    expect(relative(30e3)).toBe('in 1 min');
    expect(relative(90 * 60e3)).toBe('in 1h 30m');
    expect(relative(0)).toBe('closed');
  });
});
