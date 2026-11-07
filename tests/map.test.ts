import { describe, expect, test } from 'bun:test';
import { fatigue, winningTiers, type LiveRace } from '../src/lib/election';
import { stateSummary } from '../src/lib/map';
import states from '../src/lib/us-states.json';

const race = (status: LiveRace['result']['status'], probability = .8) => ({ probability, result: { status } }) as LiveRace;

describe('Map truthfulness', () => {
  test('leads and ties do not color live states as wins', () => {
    expect(stateSummary([race('leading'), race('trailing'), race('tied')], 'live').tone).toBe('waiting');
  });
  test('partial calls retain uncalled count, corrections remove a call', () => {
    expect(stateSummary([race('won'), race('waiting')], 'live')).toMatchObject({ tone: 'dem', label: '1 D / I wins · 1 uncalled' });
    expect(stateSummary([race('leading'), race('waiting')], 'live').tone).toBe('waiting');
  });
  test('mixed outcomes and unavailable coverage stay distinct', () => {
    expect(stateSummary([race('won'), race('lost')], 'live').tone).toBe('mixed');
    expect(stateSummary([race('unavailable')], 'live').tone).toBe('none');
    expect(stateSummary([], 'forecast').label).toBe('No race this cycle');
  });
  test('forecast colors use every race, not the selected or closest race', () => {
    expect(stateSummary([race('waiting', .9), race('waiting', .1)], 'forecast').tone).toBe('mixed');
    expect(stateSummary([race('waiting', .8), race('waiting', .7)], 'forecast').tone).toBe('dem');
    expect(stateSummary([race('waiting', .3)], 'forecast').tone).toBe('gop');
    expect(stateSummary([race('waiting', .6)], 'forecast').tone).toBe('mixed');
  });
  test('50 unique states include Alaska, Hawaii, and the small states', () => {
    expect(new Set(states.map(s => s.code)).size).toBe(50);
    for (const code of ['AK', 'HI', 'RI', 'DE']) expect(states.some(s => s.code === code && s.path.startsWith('M'))).toBe(true);
  });
});

describe('Winning progression', () => {
  test('winning precedes fatigue and each tier starts at its boundary', () => {
    expect(fatigue(-3).title).toBe('LOW ENERGY.');
    expect(fatigue(4).title).toBe('LOW ENERGY.');
    expect(fatigue(5).title).toBe('WINNING.');
    expect(fatigue(15).title).toBe('BIGLY WINNING.');
    expect(fatigue(30).title).toBe('SO MUCH WINNING.');
    expect(fatigue(45).title).toBe('TIRED OF WINNING.');
    expect(fatigue(60).title).toBe('NO MORE WINNING.');
    for (const tier of winningTiers.slice(1)) expect(fatigue(tier.min - 1).level).toBeLessThan(tier.level);
  });
});
