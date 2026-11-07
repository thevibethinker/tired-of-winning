import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { appendObservation } from './observations';
import { heldBy, resultFor, scorecard, type Chamber, type Race, type Region } from '../src/lib/election';
import { validateFeed, type Feed } from './source-validation';

const root = new URL('../data/', import.meta.url).pathname;
mkdirSync(root, { recursive: true });
const baseline = await Bun.file(root + 'baseline-20261103/baseline.json').json();
const marketAddendum = await Bun.file(root + 'baseline-20261103/verified-market-addendum.json').json();
const governorAddendum = await Bun.file(root + 'baseline-20261103/governor-addendum-20261104.json').json();
const nameCorrections = await Bun.file(root + 'baseline-20261103/name-corrections-20261104.json').json();
/** Applies the dated name-corrections addendum on top of the frozen baseline (which stays untouched). */
function corrected(race: Race): Race {
  const fixes = nameCorrections.corrections.filter((c: { id: string }) => c.id === race.id) as { field: 'candidate' | 'opponent'; from: string; to: string }[];
  return fixes.reduce((r, fix) => {
    if (r[fix.field] !== fix.from) throw new Error(`Name correction for ${race.id} expected ${fix.field} “${fix.from}”, found “${r[fix.field]}”`);
    return { ...r, [fix.field]: fix.to };
  }, race);
}
const effectiveRaces: Race[] = [...baseline.races.map((race: Race) => ({ ...corrected(race), market: race.market ?? marketAddendum.markets[race.id] ?? null, held: heldBy(race) })), ...governorAddendum.races];
const CHAMBERS: Chamber[] = ['Senate', 'House', 'Governor'];
const remainingGaps = baseline.marketGaps.filter((gap: { id: string }) => !marketAddendum.markets[gap.id]);
const db = new Database(root + 'election.sqlite', { create: true });
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY, chamber TEXT NOT NULL, observed_at TEXT NOT NULL, fetched_at TEXT NOT NULL, hash TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(chamber,hash)); CREATE TABLE IF NOT EXISTS fetch_log (id INTEGER PRIMARY KEY, chamber TEXT NOT NULL, checked_at TEXT NOT NULL, ok INTEGER NOT NULL, detail TEXT);');
db.exec('CREATE TABLE IF NOT EXISTS observations (id INTEGER PRIMARY KEY, chamber TEXT NOT NULL, observed_at TEXT NOT NULL, fetched_at TEXT NOT NULL, hash TEXT NOT NULL, payload TEXT NOT NULL);');
if (!(db.query('SELECT count(*) AS n FROM observations').get() as { n: number }).n) db.exec('INSERT INTO observations SELECT * FROM snapshots;');
const feedIds: Record<Chamber, number> = { Senate: 87528, House: 87524, Governor: 87535 };
const cache: Partial<Record<Chamber, { data: Feed; fetchedAt: string; error: string | null }>> = {};
let pending: Promise<void> | null = null;
let checked = 0;

function record(chamber: Chamber, data: Feed, fetchedAt: string) {
  validateFeed(data, chamber);
  appendObservation(db, chamber, data.last_updated, fetchedAt, data);
  cache[chamber] = { data, fetchedAt, error: null };
}

for (const chamber of CHAMBERS) {
  const saved = db.query('SELECT payload, fetched_at FROM observations WHERE chamber=? ORDER BY id DESC LIMIT 1').get(chamber) as { payload: string; fetched_at: string } | null;
  if (saved) record(chamber, JSON.parse(saved.payload), saved.fetched_at);
  else if (chamber === 'Governor') cache.Governor = { data: { election_name: 'United States Governors', election_date: '2026-11-03', test_data: false, last_updated: new Date(0).toISOString(), candidates: [], region_results: {} }, fetchedAt: new Date(0).toISOString(), error: 'Waiting for the first governors update' };
  else {
    const data = await Bun.file(root + 'baseline-20261103/' + chamber.toLowerCase() + '-initial-results.json').json();
    const meta = await Bun.file(root + 'baseline-20261103/' + chamber.toLowerCase() + '-initial-results.json.meta.json').json();
    record(chamber, data, meta.retrievedAt);
  }
}

const FETCH_BUDGET_MS = 55_000;
const ATTEMPT_TIMEOUT_MS = 45_000;
const MIN_ATTEMPT_MS = 5_000;
const RETRY_DELAY_MS = 10_000;
const PARALLEL_ATTEMPTS = 3;
const MAX_ATTEMPTS_PER_CYCLE = 12;

async function refreshChamber(chamber: Chamber, deadline: number) {
  let message = 'Source unavailable';
  let attempts = 0;
  while (attempts < MAX_ATTEMPTS_PER_CYCLE && deadline - Date.now() >= MIN_ATTEMPT_MS) {
    const wave = new AbortController();
    const size = Math.min(PARALLEL_ATTEMPTS, MAX_ATTEMPTS_PER_CYCLE - attempts);
    attempts += size;
    const tries = Array.from({ length: size }, async () => {
      const time = new Date().toISOString();
      try {
        const response = await fetch('https://civicapi.org/api/v2/race/' + feedIds[chamber], { headers: { Accept: 'application/json' }, signal: AbortSignal.any([wave.signal, AbortSignal.timeout(Math.min(ATTEMPT_TIMEOUT_MS, deadline - Date.now()))]) });
        if (!response.ok) throw new Error('Source returned HTTP ' + response.status);
        const data = await response.json() as Feed;
        validateFeed(data, chamber);
        return { data, time };
      } catch (error) {
        if (!wave.signal.aborted) {
          message = error instanceof Error ? error.message : 'Source unavailable';
          db.query('INSERT INTO fetch_log(chamber,checked_at,ok,detail) VALUES(?,?,0,?)').run(chamber, time, message);
        }
        throw error;
      }
    });
    try {
      const { data, time } = await Promise.any(tries);
      wave.abort();
      record(chamber, data, time);
      db.query('INSERT INTO fetch_log(chamber,checked_at,ok,detail) VALUES(?,?,1,NULL)').run(chamber, time);
      return;
    } catch {}
    if (deadline - Date.now() < RETRY_DELAY_MS + MIN_ATTEMPT_MS) break;
    await Bun.sleep(RETRY_DELAY_MS);
  }
  if (cache[chamber]) cache[chamber]!.error = message;
}

export async function refresh() {
  if (pending) return pending;
  if (Date.now() - checked < 60_000) return;
  checked = Date.now();
  const deadline = checked + FETCH_BUDGET_MS;
  pending = Promise.all(CHAMBERS.map(chamber => refreshChamber(chamber, deadline))).then(() => { pending = null; });
  return pending;
}

const VIEWER_WAIT_MS = 3_000;

async function freshEnough() {
  const update = refresh();
  if (!update) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([update, new Promise<void>(resolve => { timer = setTimeout(resolve, VIEWER_WAIT_MS); })]);
  clearTimeout(timer);
}

const knownRepublicans = new Map<string, Set<string>>();
/** Leading Republican by votes. Remembers names seen under the Republican label, so a later party relabel in the feed
 *  (civicAPI relabeled New Mexico candidates “Nonpartisan” at 03:30Z) doesn't break the matchup. */
function topRepublican(id: string, region?: Region) {
  const seen = knownRepublicans.get(id) ?? new Set<string>();
  knownRepublicans.set(id, seen);
  const candidates = region?.candidates ?? [];
  candidates.filter(c => c.party === 'Republican').forEach(c => seen.add(c.name));
  return [...candidates].filter(c => c.party === 'Republican' || seen.has(c.name)).sort((a, b) => b.votes - a.votes)[0]?.name ?? 'Republican';
}

export async function dashboard() {
  await freshEnough();
  const races = effectiveRaces.map(r => {
    const region = cache[r.chamber]?.data.region_results[r.key];
    if (r.opponent && !(r.opponent === 'Eventual Nominee' && r.candidate !== 'Eventual Nominee')) return { ...r, result: resultFor(r, region) };
    return { ...r, opponent: 'Leading Republican', result: resultFor({ ...r, opponent: topRepublican(r.id, region) }, region) };
  });
  const chambers = Object.fromEntries(CHAMBERS.map(chamber => {
    const source = cache[chamber]!;
    const candidates = source.data.candidates;
    const seats = (match: (party: string) => boolean) => candidates.filter(c => match(c.party)).reduce((s, c) => s + (c.seats ?? 0), 0);
    const empty = !candidates.length && chamber === 'Governor';
    return [chamber, { democratic: empty ? governorAddendum.notUp.democratic : seats(p => p === 'Democratic'), republican: empty ? governorAddendum.notUp.republican : seats(p => p === 'Republican'), independent: seats(p => !['Democratic', 'Republican'].includes(p)), fetchedAt: source.fetchedAt, sourceUpdatedAt: source.data.last_updated, error: source.error, stale: Date.now() - Date.parse(source.fetchedAt) > 180_000 }];
  }));
  return { races, chambers, score: scorecard(races), baseline: { frozenAt: baseline.frozenAt, cutoff: baseline.cutoff, forecastSource: baseline.forecastSource, forecastUrl: baseline.forecastUrl, sources: baseline.sources, scope: baseline.scope, marketGaps: remainingGaps }, log: { snapshots: (db.query('SELECT count(*) AS n FROM observations').get() as {n: number}).n, attempts: (db.query('SELECT count(*) AS n FROM fetch_log').get() as {n: number}).n }, generatedAt: new Date().toISOString() };
}

export function auditExport() {
  return { baseline, marketAddendum, governorAddendum, nameCorrections, snapshots: db.query('SELECT * FROM observations ORDER BY id').all(), fetches: db.query('SELECT * FROM fetch_log ORDER BY id').all(), exportedAt: new Date().toISOString(), note: 'Locally recorded source observations, not an independently timestamped audit. Source race calls are provisional, not certification.' };
}

const globalState = globalThis as typeof globalThis & { electionTimer?: ReturnType<typeof setInterval> };
if (globalState.electionTimer) clearInterval(globalState.electionTimer);
if (process.env.NODE_ENV === 'production') {
  const timer = setInterval(() => {
    if (new Date().toISOString() < '2026-11-06T12:00:00.000Z') void refresh();
  }, 60_000);
  timer.unref();
  globalState.electionTimer = timer;
}
