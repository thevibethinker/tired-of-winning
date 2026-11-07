import { chance, fatigue, winningTiers, type LiveRace } from './election';

export type SoundId = 'wrong' | 'sad' | 'youre-fired' | 'fake-news' | 'win-so-much' | 'keep-winning' | 'win-more' | 'tired-of-winning' | 'cant-take-it' | 'bell' | 'ping';
export type SoundKind = 'win' | 'upset' | 'loss' | 'retraction' | 'level' | 'polls';
export type SoundEvent = { kind: SoundKind; sound: SoundId; title: string; quote: string; priority: number; raceId?: string };
export type CallSnapshot = { calls: Record<string, string | null>; flips: number };

export const quotes: Record<SoundId, string> = {
  wrong: '“WRONG!”',
  sad: '“Sad.”',
  'youre-fired': '“You’re fired.”',
  'fake-news': '“You are fake news.”',
  'win-so-much': '“We’re going to win so much.”',
  'keep-winning': '“We have to keep winning.”',
  'win-more': '“We have to win more. We’re going to win more.”',
  'tired-of-winning': '“We’re gonna win so much, you may even get tired of winning!”',
  'cant-take-it': '“Please, please, it’s too much winning. We can’t take it anymore.”',
  bell: 'Ding-ding (no Trump)',
  ping: 'Soft pop (no Trump)',
};

export const levelSounds: SoundId[] = ['sad', 'win-so-much', 'keep-winning', 'win-more', 'tired-of-winning', 'cant-take-it'];

const isCalled = (race: LiveRace) => race.result.status === 'won' || race.result.status === 'lost';
const callKey = (race: LiveRace) => isCalled(race) ? `${race.result.status}:${race.result.winner ?? ''}` : null;
const surname = (name: string) => name.split('/')[0].trim().split(' ').filter(w => !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(w)).at(-1) ?? name;
const place = (race: LiveRace) => race.chamber === 'Senate' ? `${race.label} Senate` : race.chamber === 'Governor' ? `${race.label} governor` : race.label;
const tierIndex = (flips: number) => winningTiers.findIndex(t => t.min === fatigue(flips).min);

/** Senate and governor calls always make noise. House calls make noise for contested races (5–95% model win chance)
 *  and for any flip or upset, including a withdrawn one: in a blowout the “safe” seats are the news. */
export function audible(race: LiveRace, before: string | null = null) {
  if (race.chamber !== 'House') return true;
  if (race.probability !== null && race.probability >= .05 && race.probability <= .95) return true;
  const p = chance(race) ?? .5;
  const won = race.result.status === 'won' || (!isCalled(race) && before?.startsWith('won:'));
  const lost = race.result.status === 'lost' || (!isCalled(race) && before?.startsWith('lost:'));
  return Boolean((won && (race.held === 'R' || p < .5)) || (lost && (race.held === 'D' || p > .5)));
}

export function callSnapshot(races: LiveRace[], flips: number): CallSnapshot {
  return { calls: Object.fromEntries(races.map(race => [race.id, callKey(race)])), flips };
}

/** Compares two consecutive results updates and returns the events worth a sound, highest priority first. */
export function detectSoundEvents(previous: CallSnapshot | null, races: LiveRace[], flips: number): SoundEvent[] {
  if (!previous) return [];
  const events: SoundEvent[] = [];
  for (const race of races) {
    const before = previous.calls[race.id] ?? null;
    const now = callKey(race);
    if (now === before || !audible(race, before)) continue;
    const senateBonus = race.chamber === 'House' ? 0 : .5;
    if (!now) {
      events.push({ kind: 'retraction', sound: 'fake-news', title: `Call withdrawn: ${place(race)} is uncalled again`, quote: quotes['fake-news'], priority: 2 + senateBonus, raceId: race.id });
    } else if (race.result.status === 'won') {
      const upset = (chance(race) ?? .5) < .5;
      events.push({ kind: upset ? 'upset' : 'win', sound: upset ? 'youre-fired' : 'wrong', title: `${upset ? 'Upset! ' : ''}${surname(race.candidate)} (${race.party}) wins ${place(race)}`, quote: quotes[upset ? 'youre-fired' : 'wrong'], priority: (upset ? 4 : 3) + senateBonus, raceId: race.id });
    } else {
      const winner = race.result.winner ?? race.opponent;
      events.push({ kind: 'loss', sound: 'sad', title: `${surname(winner)}${winner === race.opponent ? ' (R)' : ''} wins ${place(race)}`, quote: quotes.sad, priority: 1 + senateBonus, raceId: race.id });
    }
  }
  const from = tierIndex(previous.flips), to = tierIndex(flips);
  if (to > from && to > 0) events.push({ kind: 'level', sound: levelSounds[to], title: `New level: ${winningTiers[to].short} (+${flips} net flips)`, quote: quotes[levelSounds[to]], priority: 5 + to / 10 });
  return events.sort((a, b) => b.priority - a.priority);
}

export function pollsEvent(states: string[]): SoundEvent {
  return { kind: 'polls', sound: 'bell', title: `Polls just closed: ${states.join(' · ')}`, quote: quotes.bell, priority: 0 };
}

/** Splits a clip's words into classic meme top/bottom lines (long quotes split at the punctuation nearest the middle). */
export function memeCaption(id: SoundId): { top: string; bottom: string } | null {
  if (id === 'bell' || id === 'ping') return null;
  const text = quotes[id].replace(/^“|”$/g, '').toUpperCase();
  if (text.length <= 22) return { top: '', bottom: text };
  const middle = text.length / 2;
  let split = -1;
  for (const match of text.matchAll(/[,.!?] /g)) {
    const at = match.index + 1;
    if (split < 0 || Math.abs(at - middle) < Math.abs(split - middle)) split = at;
  }
  return split < 0 ? { top: '', bottom: text } : { top: text.slice(0, split).trim(), bottom: text.slice(split).trim() };
}

export type SadTrigger = 'reaction' | 'comment';
export const SAD_COOLDOWN_MS = 2000;
/** “Sad.” after a guest's own emoji reaction or post: only with sound on, never when chat sounds are muted (posts), at most once per cooldown. */
export function sadAllowed(prefs: { effects: boolean; chat: 'auto' | 'on' | 'off' }, trigger: SadTrigger, lastAt: number, now: number) {
  if (!prefs.effects) return false;
  if (trigger === 'comment' && prefs.chat === 'off') return false;
  return now - lastAt >= SAD_COOLDOWN_MS;
}
