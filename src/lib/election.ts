export type Chamber = 'Senate' | 'House' | 'Governor';
export type Party = 'D' | 'R';
export type Market = { probability: number; observedAt: string; retrievedAt: string; source: string; url: string; question: string; marketId: string };
export type Race = { id: string; key: string; chamber: Chamber; label: string; state: string; candidate: string; opponent: string; party: string; probability: number | null; margin: number | null; rating: string; forecastFlip: boolean; raceId: number | null; market: Market | null; held: Party };
export type Candidate = { name: string; party: string; votes: number; percent: number; winner: boolean; seats?: number };
export type Region = { name: string; election_id: number; percent_reporting: number; candidates: Candidate[] };
export type Result = { status: 'waiting' | 'leading' | 'trailing' | 'tied' | 'won' | 'lost' | 'unavailable'; margin: number | null; reporting: number | null; votes: number; candidateVotes: number | null; opponentVotes: number | null; candidateShare: number | null; opponentShare: number | null; winner: string | null; reason?: string };
export type LiveRace = Race & { result: Result };

export function normalizedName(name: string) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\(ind\)/g, '').replace(/\b(jr|iii|ii|iv|sr)\b/g, '').replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

export function candidateMatch(name: string, candidates: Candidate[]) {
  const normalized = normalizedName(name);
  const exact = candidates.filter(c => normalizedName(c.name) === normalized);
  if (exact.length === 1) return exact[0];
  const surname = normalized.split(' ').at(-1);
  const matches = candidates.filter(c => normalizedName(c.name).split(' ').at(-1) === surname);
  return matches.length === 1 ? matches[0] : null;
}

export function resultFor(race: Race, region?: Region): Result {
  const unavailable: Result = { status: 'unavailable', margin: null, reporting: null, votes: 0, candidateVotes: null, opponentVotes: null, candidateShare: null, opponentShare: null, winner: null };
  if (!region || !Array.isArray(region.candidates)) return { ...unavailable, reason: 'Race not present in the latest feed' };
  if (race.candidate === 'Not Contested') return { ...unavailable, reason: 'No Democrat or independent on this ballot' };
  if (race.candidate === 'Eventual Nominee') return { ...unavailable, reason: 'Multi-candidate ballot with several candidates from each party, so there is no single matchup to compare' };
  if (race.opponent === 'Not Contested' || race.candidate.includes('/')) return unopposedResult(race, region);
  const candidate = candidateMatch(race.candidate, region.candidates);
  const opponent = candidateMatch(race.opponent, region.candidates);
  if (!candidate || !opponent) return { ...unavailable, reason: 'Candidate identity could not be matched safely' };
  const votes = region.candidates.reduce((s, c) => s + c.votes, 0);
  const winner = region.candidates.find(c => c.winner === true);
  const candidateShare = votes ? candidate.votes / votes * 100 : null;
  const opponentShare = votes ? opponent.votes / votes * 100 : null;
  const margin = candidateShare === null || opponentShare === null ? null : candidateShare - opponentShare;
  return { status: winner ? (winner === candidate ? 'won' : 'lost') : !votes ? 'waiting' : candidate.votes === Math.max(...region.candidates.map(c => c.votes)) ? region.candidates.filter(c => c.votes === candidate.votes).length > 1 ? 'tied' : 'leading' : 'trailing',
    margin, reporting: region.percent_reporting, votes, candidateVotes: candidate.votes, opponentVotes: opponent.votes, candidateShare, opponentShare, winner: winner?.name ?? null };
}

/** Seats with no Republican listed (uncontested, or two Democrats in a top-two race): the Democratic side together
 *  against the strongest non-Democrat, if any. A Democrat-vs-Democrat result keeps the seat Democratic, so it is never a loss. */
function unopposedResult(race: Race, region: Region): Result {
  const listed = race.candidate.split('/').map(n => normalizedName(n));
  const ours = region.candidates.filter(c => c.party === 'Democratic' || listed.includes(normalizedName(c.name)) || (listed.length === 1 && candidateMatch(race.candidate, [c])));
  if (!ours.length) return { status: 'unavailable', margin: null, reporting: null, votes: 0, candidateVotes: null, opponentVotes: null, candidateShare: null, opponentShare: null, winner: null, reason: 'Candidate identity could not be matched safely' };
  const rival = region.candidates.filter(c => !ours.includes(c)).sort((a, b) => b.votes - a.votes)[0];
  const votes = region.candidates.reduce((s, c) => s + c.votes, 0);
  const ourVotes = ours.reduce((s, c) => s + c.votes, 0), rivalVotes = rival?.votes ?? 0;
  const winner = region.candidates.find(c => c.winner === true);
  const candidateShare = votes ? ourVotes / votes * 100 : null, opponentShare = votes ? rivalVotes / votes * 100 : null;
  return { status: winner ? (ours.includes(winner) ? 'won' : 'lost') : !votes ? 'waiting' : ourVotes > rivalVotes ? 'leading' : ourVotes === rivalVotes ? 'tied' : 'trailing',
    margin: candidateShare === null || opponentShare === null ? null : candidateShare - opponentShare, reporting: region.percent_reporting, votes, candidateVotes: ourVotes, opponentVotes: rivalVotes, candidateShare, opponentShare, winner: winner?.name ?? null };
}

export function brier(probability: number, won: boolean) {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error('Invalid probability');
  return (probability - (won ? 1 : 0)) ** 2;
}

export function scorecard(races: LiveRace[]) {
  const matched = races.filter(r => r.market && r.probability !== null && ['won', 'lost'].includes(r.result.status));
  const n = matched.length;
  return { n, forecast: n ? matched.reduce((s, r) => s + brier(r.probability!, r.result.status === 'won'), 0) / n : null,
    market: n ? matched.reduce((s, r) => s + brier(r.market!.probability, r.result.status === 'won'), 0) / n : null,
    ids: matched.map(r => r.id) };
}

/** Pre-election holder for each seat: Senate/House from Split Ticket's own predicted winner + flip flag; governors from the addendum. */
export function heldBy(race: Pick<Race, 'margin' | 'probability' | 'forecastFlip'>): Party {
  const favored = race.margin !== null && race.margin !== 0 ? race.margin > 0 : (race.probability ?? 0) > .5;
  return favored !== race.forecastFlip ? 'D' : 'R';
}

/** Best available pre-election win chance for the listed D/I candidate: the model, else the frozen market. */
export const chance = (r: Race) => r.probability ?? r.market?.probability ?? null;

export const chamberNames: Record<Chamber, string> = { Senate: 'Senate', House: 'House', Governor: 'Governors' };

/** Called seats only. A gain is a GOP-held seat our listed D/I candidate won; a loss is a D-held seat they lost. */
export function flipTally(races: LiveRace[], chamber?: Chamber) {
  const scoped = chamber ? races.filter(r => r.chamber === chamber) : races;
  const gained = scoped.filter(r => r.held === 'R' && r.result.status === 'won');
  const lost = scoped.filter(r => r.held === 'D' && r.result.status === 'lost');
  return { gained: gained.length, lost: lost.length, net: gained.length - lost.length, gainedIds: gained.map(r => r.id), lostIds: lost.map(r => r.id) };
}

/** Net flips this morning's odds implied (model where it exists, else market). Races with neither are skipped. */
export function expectedFlips(races: Race[], chamber?: Chamber) {
  return races.filter(r => !chamber || r.chamber === chamber).reduce((s, r) => {
    const p = chance(r);
    if (p === null) return s;
    return s + (r.held === 'R' ? p : -(1 - p));
  }, 0);
}

export const CONTESTED_BAND = .02;
export const LIVE_CLOSE_PTS = 10;
/** Election-night “contested”: any pre-election odds between 2% and 98%, an uncalled count within 10 points, or an upset in progress. */
export function inPlay(r: LiveRace) {
  const odds = [r.probability, r.market?.probability].filter((p): p is number => p !== null && p !== undefined);
  if (!odds.length) return true;
  if ((r.held === 'R' && r.result.status === 'won') || (r.held === 'D' && r.result.status === 'lost')) return true;
  if (odds.some(p => p >= CONTESTED_BAND && p <= 1 - CONTESTED_BAND)) return true;
  const { status, margin, votes } = r.result;
  if (['leading', 'trailing', 'tied'].includes(status) && votes > 0 && margin !== null && Math.abs(margin) <= LIVE_CLOSE_PTS) return true;
  const p = chance(r)!;
  return (p < .5 && ['leading', 'tied', 'won'].includes(status)) || (p > .5 && ['trailing', 'lost'].includes(status));
}

export const winningTiers = [
  { min: -Infinity, title: 'LOW ENERGY.', short: 'Low energy', line: 'Sad! Fewer than 5 net flips. Very low energy, folks.', level: 0, range: 'Under 5' },
  { min: 5, title: 'WINNING.', short: 'Winning', line: 'GOP seats are changing hands. Somewhere, a man is typing in all caps.', level: 22, range: '5–14' },
  { min: 15, title: 'BIGLY WINNING.', short: 'Bigly winning', line: 'Big, strong men are coming up to us with tears in their eyes.', level: 40, range: '15–29' },
  { min: 30, title: 'SO MUCH WINNING.', short: 'So much winning', line: 'Somewhere in Palm Beach, a man is yelling “STOP THE COUNT.”', level: 60, range: '30–44' },
  { min: 45, title: 'TIRED OF WINNING.', short: 'Tired of winning', line: 'He promised we’d get tired of winning. Finally, a promise kept.', level: 80, range: '45–59' },
  { min: 60, title: 'NO MORE WINNING.', short: 'No more winning', line: '“Please, sir, we can’t take any more.” (Okay, one more.)', level: 100, range: '60+' },
] as const;

/** Level for a net-flip count across the Senate, House and governors combined. */
export function fatigue(flips: number) {
  return [...winningTiers].reverse().find(t => flips >= t.min) ?? winningTiers[0];
}

const scenarioWin = (r: Race, swing: number, overrides: Record<string, boolean>, includeIndependent: boolean) => (r.party === 'D' || includeIndependent) && (overrides[r.id] ?? (r.margin ?? -Infinity) + swing > 0);

export function scenarioCount(races: Race[], chamber: Chamber, swing: number, overrides: Record<string, boolean>, includeIndependent: boolean) {
  return (chamber === 'Senate' ? 34 : 0) + races.filter(r => r.chamber === chamber && scenarioWin(r, swing, overrides, includeIndependent)).length;
}

export function scenarioFlips(races: Race[], chamber: Chamber, swing: number, overrides: Record<string, boolean>, includeIndependent: boolean) {
  return races.filter(r => r.chamber === chamber).reduce((s, r) => {
    const win = scenarioWin(r, swing, overrides, includeIndependent);
    return s + (r.held === 'R' && win ? 1 : r.held === 'D' && !win ? -1 : 0);
  }, 0);
}

/** Below this share of the expected vote, a count is labeled early: who leads says little yet. */
export const EARLY_REPORTING = 25;
export const NAIL_BITER_PTS = 3;
export const isEarly = (r: LiveRace) => r.result.votes > 0 && r.result.reporting !== null && r.result.reporting < EARLY_REPORTING;

export type LiveBucket = 'flipped' | 'longshot' | 'close' | 'trouble' | 'lost' | 'early' | 'counting' | 'held' | 'waiting';
/** Election-night status groups, most newsworthy first. Called groups use source calls only; uncalled groups use leads, never as calls. */
export const liveBuckets: { id: LiveBucket; title: string; one: string; note: string }[] = [
  { id: 'flipped', title: 'Flipped', one: 'Flipped', note: 'Called · GOP seats our side took' },
  { id: 'lost', title: 'Seats we lost', one: 'Seat we lost', note: 'Called · our seats the GOP took' },
  { id: 'close', title: 'Nail-biters', one: 'Nail-biter', note: `Not called · within ${NAIL_BITER_PTS} points` },
  { id: 'longshot', title: 'Long shots ahead', one: 'Long shot ahead', note: 'Not called · our underdog leads' },
  { id: 'trouble', title: 'Favorites behind', one: 'Favorite behind', note: 'Not called · our favorite trails' },
  { id: 'early', title: 'Too early to tell', one: 'Too early to tell', note: `Not called · under ${EARLY_REPORTING}% of the vote in` },
  { id: 'counting', title: 'Counting, as expected', one: 'Counting, as expected', note: 'Not called · the favorite leads' },
  { id: 'held', title: 'Called, no flip', one: 'Called, no flip', note: 'Called · the seat stays with its party' },
  { id: 'waiting', title: 'No votes yet', one: 'No votes yet', note: 'Polls open, or closed with nothing counted' },
];

/** A count 20+ points away from the model's margin with under 75% in: often which areas reported first, not a trend. */
export const FAR_OFF_PTS = 20;
export const farOff = (r: LiveRace) => r.margin !== null && r.result.margin !== null && r.result.reporting !== null && r.result.reporting < 75
  && !['won', 'lost'].includes(r.result.status) && Math.abs(r.result.margin - r.margin) >= FAR_OFF_PTS;

export function liveBucket(r: LiveRace): LiveBucket {
  const { status, votes, margin } = r.result;
  if (status === 'won') return r.held === 'R' ? 'flipped' : 'held';
  if (status === 'lost') return r.held === 'D' ? 'lost' : 'held';
  if (status === 'waiting' || status === 'unavailable' || votes <= 0) return 'waiting';
  if (isEarly(r)) return 'early';
  const p = chance(r) ?? .5;
  const ahead = status === 'leading' || status === 'tied';
  if (p < .5 && ahead) return 'longshot';
  if (p >= .5 && status === 'trailing') return 'trouble';
  if (margin !== null && Math.abs(margin) <= NAIL_BITER_PTS) return 'close';
  return 'counting';
}

/** Order within a status group: biggest surprises first, closest counts first, most-counted early returns first. */
export function bucketCompare(a: LiveRace, b: LiveRace, bucket: LiveBucket) {
  const p = (r: LiveRace) => chance(r) ?? .5;
  const m = (r: LiveRace) => Math.abs(r.result.margin ?? Infinity);
  if (bucket === 'flipped') return p(a) - p(b);
  if (bucket === 'longshot') return Number(farOff(a)) - Number(farOff(b)) || (b.result.reporting ?? 0) - (a.result.reporting ?? 0) || p(b) - p(a);
  if (bucket === 'trouble' || bucket === 'lost') return p(b) - p(a);
  if (bucket === 'early') return (b.result.reporting ?? 0) - (a.result.reporting ?? 0);
  if (bucket === 'close' || bucket === 'counting') return m(a) - m(b);
  return 0;
}

export function groupByBucket(races: LiveRace[]) {
  return liveBuckets.map(b => ({ ...b, items: races.filter(r => liveBucket(r) === b.id).sort((x, y) => bucketCompare(x, y, b.id)) })).filter(g => g.items.length);
}

/** Uncalled seats where the current count (not early) would flip a seat: the night's possible next flips. Leads are not calls. */
export function leadTally(races: LiveRace[]) {
  const live = races.filter(r => !['won', 'lost', 'waiting', 'unavailable'].includes(r.result.status) && r.result.votes > 0 && !isEarly(r));
  const ahead = live.filter(r => r.held === 'R' && (r.result.status === 'leading' || r.result.status === 'tied')).length;
  const behind = live.filter(r => r.held === 'D' && r.result.status === 'trailing').length;
  return { ahead, behind, net: ahead - behind };
}
