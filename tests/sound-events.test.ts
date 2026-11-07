import { test, expect } from 'bun:test';
import { callSnapshot, detectSoundEvents, memeCaption, pollsEvent, quotes, sadAllowed, SAD_COOLDOWN_MS, type SoundId } from '../src/lib/sound-events';
import type { LiveRace, Result } from '../src/lib/election';

const result = (status: Result['status'], winner: string | null = null): Result => ({ status, margin: null, reporting: null, votes: 0, candidateVotes: null, opponentVotes: null, candidateShare: null, opponentShare: null, winner });
const race = (id: string, over: Partial<LiveRace> = {}): LiveRace => ({ id, key: id, chamber: 'Senate', label: 'Georgia', state: 'GA', candidate: 'Jon Ossoff', opponent: 'Mike Collins', party: 'D', probability: .7, margin: 3, rating: 'Lean D', forecastFlip: false, raceId: 1, market: null, held: 'D', result: result('waiting'), ...over });

test('the first update never makes noise, even if races are already called', () => {
  expect(detectSoundEvents(null, [race('a', { result: result('won', 'Jon Ossoff') })], 51)).toEqual([]);
});

test('classifies wins, upsets, losses and withdrawn calls', () => {
  const before = [race('win'), race('upset', { probability: .3 }), race('loss'), race('back', { result: result('won', 'Jon Ossoff') })];
  const prev = callSnapshot(before, 47);
  const after = [race('win', { result: result('won', 'Jon Ossoff') }), race('upset', { probability: .3, result: result('won', 'Jon Ossoff') }), race('loss', { result: result('lost', 'Mike Collins') }), race('back', { result: result('leading') })];
  const events = detectSoundEvents(prev, after, 47);
  expect(events.map(e => [e.kind, e.sound])).toEqual([['upset', 'youre-fired'], ['win', 'wrong'], ['retraction', 'fake-news'], ['loss', 'sad']]);
  expect(events[1].title).toBe('Ossoff (D) wins Georgia Senate');
  expect(events[3].title).toBe('Collins (R) wins Georgia Senate');
});

test('safe House calls stay silent; contested House calls make noise', () => {
  const house = (id: string, probability: number, status: Result['status'] = 'waiting') => race(id, { chamber: 'House', label: 'NC-01', state: 'NC', probability, result: result(status, status === 'won' ? 'Jon Ossoff' : null) });
  const prev = callSnapshot([house('safe', .99), house('close', .5)], 47);
  const events = detectSoundEvents(prev, [house('safe', .99, 'won'), house('close', .5, 'won')], 47);
  expect(events.map(e => e.raceId)).toEqual(['close']);
  expect(events[0].title).toBe('Ossoff (D) wins NC-01');
});

test('in a blowout, House flips and upsets make noise even in seats the model called safe', () => {
  const house = (id: string, probability: number, held: 'D' | 'R', status: Result['status'] = 'waiting', winner: string | null = null) => race(id, { chamber: 'House', label: 'TX-25', state: 'TX', probability, held, result: result(status, winner) });
  const prev = callSnapshot([house('reach', 0, 'R'), house('safeD', 1, 'D'), house('safeR', 0, 'R'), house('keptD', .99, 'D')], 0);
  const events = detectSoundEvents(prev, [house('reach', 0, 'R', 'won', 'Jon Ossoff'), house('safeD', 1, 'D', 'lost', 'Mike Collins'), house('safeR', 0, 'R', 'lost', 'Mike Collins'), house('keptD', .99, 'D', 'won', 'Jon Ossoff')], 0);
  expect(events.map(e => [e.raceId, e.kind])).toEqual([['reach', 'upset'], ['safeD', 'loss']]);
  const withdrawn = detectSoundEvents(callSnapshot([house('reach', 0, 'R', 'won', 'Jon Ossoff')], 0), [house('reach', 0, 'R', 'leading')], 0);
  expect(withdrawn.map(e => e.kind)).toEqual(['retraction']);
});

test('a reversed call counts as a new call', () => {
  const prev = callSnapshot([race('a', { result: result('won', 'Jon Ossoff') })], 47);
  expect(detectSoundEvents(prev, [race('a', { result: result('lost', 'Mike Collins') })], 47).map(e => e.kind)).toEqual(['loss']);
});

test('unchanged calls stay quiet', () => {
  const races = [race('a', { result: result('won', 'Jon Ossoff') })];
  expect(detectSoundEvents(callSnapshot(races, 51), races, 51)).toEqual([]);
});

test('a new winning level outranks calls and uses the next line of the speech', () => {
  const prev = callSnapshot([race('a')], 44);
  const events = detectSoundEvents(prev, [race('a', { result: result('won', 'Jon Ossoff') })], 45);
  expect(events[0]).toMatchObject({ kind: 'level', sound: 'tired-of-winning', title: 'New level: Tired of winning (+45 net flips)' });
  expect(detectSoundEvents(callSnapshot([], 59), [], 60)[0].sound).toBe('cant-take-it');
  expect(detectSoundEvents(callSnapshot([], 4), [], 5)[0].sound).toBe('win-so-much');
  expect(detectSoundEvents(callSnapshot([], 5), [], 4)).toEqual([]);
  expect(detectSoundEvents(callSnapshot([], 16), [], 29)).toEqual([]);
});

test('independent winners keep their party label', () => {
  const prev = callSnapshot([race('ne', { party: 'I', candidate: 'Dan Osborn', label: 'Nebraska', state: 'NE' })], 47);
  const events = detectSoundEvents(prev, [race('ne', { party: 'I', candidate: 'Dan Osborn', label: 'Nebraska', state: 'NE', result: result('won', 'Dan Osborn') })], 47);
  expect(events[0].title).toBe('Osborn (I) wins Nebraska Senate');
});

test('poll closings use the bell, not a Trump clip', () => {
  expect(pollsEvent(['GA', 'NC'])).toMatchObject({ kind: 'polls', sound: 'bell', title: 'Polls just closed: GA · NC' });
});

test('meme captions use the clip’s exact words, split top/bottom only when long', () => {
  expect(memeCaption('sad')).toEqual({ top: '', bottom: 'SAD.' });
  expect(memeCaption('wrong')).toEqual({ top: '', bottom: 'WRONG!' });
  expect(memeCaption('tired-of-winning')).toEqual({ top: 'WE’RE GONNA WIN SO MUCH,', bottom: 'YOU MAY EVEN GET TIRED OF WINNING!' });
  expect(memeCaption('cant-take-it')).toEqual({ top: 'PLEASE, PLEASE, IT’S TOO MUCH WINNING.', bottom: 'WE CAN’T TAKE IT ANYMORE.' });
  expect(memeCaption('win-so-much')).toEqual({ top: '', bottom: 'WE’RE GOING TO WIN SO MUCH.' });
  expect(memeCaption('bell')).toBeNull();
  expect(memeCaption('ping')).toBeNull();
  for (const id of Object.keys(quotes) as SoundId[]) {
    const caption = memeCaption(id);
    if (caption) expect(`${caption.top} ${caption.bottom}`.trim()).toBe(quotes[id].replace(/^“|”$/g, '').toUpperCase());
  }
});

test('“Sad.” plays for a guest’s own reaction or post only with sound on, respects the chat mute and a cooldown', () => {
  const on = { effects: true, chat: 'auto' as const };
  expect(sadAllowed(on, 'reaction', 0, 10_000)).toBe(true);
  expect(sadAllowed(on, 'comment', 0, 10_000)).toBe(true);
  expect(sadAllowed({ effects: false, chat: 'on' }, 'comment', 0, 10_000)).toBe(false);
  expect(sadAllowed({ effects: false, chat: 'on' }, 'reaction', 0, 10_000)).toBe(false);
  expect(sadAllowed({ effects: true, chat: 'off' }, 'comment', 0, 10_000)).toBe(false);
  expect(sadAllowed({ effects: true, chat: 'off' }, 'reaction', 0, 10_000)).toBe(true);
  expect(sadAllowed(on, 'reaction', 10_000, 10_000 + SAD_COOLDOWN_MS - 1)).toBe(false);
  expect(sadAllowed(on, 'reaction', 10_000, 10_000 + SAD_COOLDOWN_MS)).toBe(true);
});

test('governor calls use the same clips, always audible, labeled as governor races', () => {
  const gov = (status: Result['status'], winner: string, probability: number | null, market: number) => race('gov-ga', { chamber: 'Governor', candidate: 'Keisha Lance Bottoms', opponent: 'Rick Jackson', probability, margin: null, held: 'R', market: { probability: market, observedAt: '', retrievedAt: '', source: 'Polymarket', url: '', question: '', marketId: '' }, result: result(status, winner) });
  const prev = callSnapshot([gov('waiting', '', null, .7)], 0);
  expect(detectSoundEvents(prev, [gov('won', 'Keisha Lance Bottoms', null, .7)], 0)[0]).toMatchObject({ kind: 'win', sound: 'wrong', title: 'Bottoms (D) wins Georgia governor' });
  expect(detectSoundEvents(prev, [gov('won', 'Keisha Lance Bottoms', null, .3)], 0)[0]).toMatchObject({ kind: 'upset', sound: 'youre-fired' });
  expect(detectSoundEvents(prev, [gov('lost', 'Rick Jackson', null, .7)], 0)[0]).toMatchObject({ kind: 'loss', sound: 'sad' });
});
