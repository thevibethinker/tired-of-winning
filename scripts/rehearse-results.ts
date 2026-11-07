import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { candidateMatch, fatigue, type Chamber, type Race } from '../src/lib/election';
import type { Feed } from '../backend-lib/source-validation';

const output = process.argv[2];
if (!output || !output.startsWith('/')) throw new Error('Usage: bun scripts/rehearse-results.ts /absolute/new/scratch-directory');
const project = realpathSync(new URL('..', import.meta.url).pathname);
const destination = resolve(output);
if (destination.startsWith('/home/workspace/Sites/') || existsSync(destination)) throw new Error('Output must be a new scratch directory outside Sites');
mkdirSync(destination, { recursive: true });
const runtime = destination + '/isolated-runtime';
const copied = ['backend-lib/election.ts', 'backend-lib/observations.ts', 'backend-lib/source-validation.ts', 'src/lib/election.ts', ...['baseline.json', 'verified-market-addendum.json', 'senate-initial-results.json', 'senate-initial-results.json.meta.json', 'house-initial-results.json', 'house-initial-results.json.meta.json'].map(name => 'data/baseline-20261103/' + name)];
for (const file of copied) {
  mkdirSync(resolve(runtime, file, '..'), { recursive: true });
  copyFileSync(project + '/' + file, runtime + '/' + file);
}
const baseline = JSON.parse(readFileSync(runtime + '/data/baseline-20261103/baseline.json', 'utf8'));
const original = Object.fromEntries((['Senate', 'House'] as Chamber[]).map(chamber => [chamber, JSON.parse(readFileSync(`${runtime}/data/baseline-20261103/${chamber.toLowerCase()}-initial-results.json`, 'utf8'))])) as Record<Chamber, Feed>;
let feeds = structuredClone(original);
let clock = Date.now();
let failure: 'none' | 'http' | 'json' | 'timeout' = 'none';
let delay = 0;
let requests = 0;
const checks: { name: string; pass: boolean }[] = [];
const frames: { label: string; data: unknown }[] = [];
const before = copied.map(file => readFileSync(project + '/' + file));
const realFetch = globalThis.fetch;
const RealDate = Date;
const realEnv = process.env.NODE_ENV;
globalThis.Date = class extends RealDate {
  constructor(value?: string | number | Date) { super(value === undefined ? clock : value instanceof RealDate ? value.valueOf() : value); }
  static now() { return clock; }
} as DateConstructor;
process.env.NODE_ENV = 'test';
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  assert.match(url, /^https:\/\/civicapi\.org\/api\/v2\/race\/(87528|87524)$/);
  requests++;
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  if (url.endsWith('87528')) {
    if (failure === 'http') return new Response('Synthetic outage', { status: 503 });
    if (failure === 'json') return new Response('{broken');
    if (failure === 'timeout') throw new DOMException('Synthetic timeout', 'TimeoutError');
  }
  return Response.json(feeds[url.endsWith('87528') ? 'Senate' : 'House']);
}) as typeof fetch;

function check(name: string, condition: unknown) {
  checks.push({ name, pass: Boolean(condition) });
  assert.ok(condition, name);
}

function setRace(id: string, dVotes: number, rVotes: number, called: 'candidate' | 'opponent' | null = null) {
  const race = baseline.races.find((r: Race) => r.id === id) as Race;
  assert.ok(race, id);
  const feed = feeds[race.chamber];
  const region = feed.region_results[race.key]!;
  const candidate = candidateMatch(race.candidate, region.candidates);
  const opponent = candidateMatch(race.opponent, region.candidates);
  assert.ok(candidate && opponent, 'Fixture candidate identity: ' + id);
  for (const c of region.candidates) { c.votes = 0; c.winner = false; c.percent = 0; }
  candidate.votes = dVotes;
  opponent.votes = rVotes;
  candidate.winner = called === 'candidate';
  opponent.winner = called === 'opponent';
  region.percent_reporting = called ? 90 : dVotes + rVotes ? 35 : 0;
  for (const c of region.candidates) c.percent = dVotes + rVotes ? 100 * c.votes / (dVotes + rVotes) : 0;
  feed.last_updated = new Date(clock).toISOString();
  for (const c of feed.candidates) c.seats = race.chamber === 'Senate' ? c.party === 'Democratic' ? 34 : c.party === 'Republican' ? 31 : 0 : 0;
  for (const r of Object.values(feed.region_results)) {
    const winner = r.candidates.find(c => c.winner);
    if (winner) {
      const total = feed.candidates.find(c => c.party === winner.party);
      assert.ok(total, 'Fixture party aggregate exists');
      total.seats!++;
    }
  }
}

try {
  const app = await import(pathToFileURL(runtime + '/backend-lib/election.ts').href) as typeof import('../backend-lib/election');
  async function next(label: string, advance = 61_000) {
    clock += advance;
    const data = await app.dashboard();
    frames.push({ label, data });
    return data;
  }
  const status = (data: Awaited<ReturnType<typeof app.dashboard>>, id = 'senate-tx') => data.races.find((r: Race) => r.id === id)!.result.status;
  let data = await next('Waiting: zero reported votes');
  check('waiting is not a tie, loss or score', status(data) === 'waiting' && data.score.n === 0 && data.score.market === null);
  const initialRequests = requests;
  await Promise.all([app.dashboard(), app.dashboard(), app.dashboard()]);
  check('repeated viewers do not trigger upstream requests inside 60 seconds', requests === initialRequests);
  clock += 61_000;
  await Promise.all([app.dashboard(), app.dashboard(), app.dashboard()]);
  check('concurrent viewers share one refresh for both chambers', requests === initialRequests + 2);
  setRace('senate-tx', 60_000, 40_000);
  setRace('house-tx-07', 6_000, 4_000);
  data = await next('First batch: Democratic leads, no calls');
  check('Senate and House leads stay uncalled', status(data) === 'leading' && status(data, 'house-tx-07') === 'leading' && data.score.n === 0);
  check('leads do not increase secured seats', data.chambers.Senate.democratic === 34 && data.chambers.House.democratic === 0);
  setRace('senate-tx', 70_000, 90_000);
  data = await next('Second batch: Texas lead reverses');
  check('a later batch can reverse the lead', status(data) === 'trailing');
  setRace('senate-tx', 120_000, 110_000, 'candidate');
  setRace('house-tx-07', 12_000, 11_000, 'candidate');
  data = await next('First calls: Texas Senate and one House seat');
  check('calls update chamber totals and matched market scoring', status(data) === 'won' && data.chambers.Senate.democratic === 35 && data.chambers.House.democratic === 1 && data.score.n === 1);
  const frozenFields = JSON.stringify(data.races.map((r: Race) => [r.id, r.probability, r.margin, r.market]));
  const callFrame = structuredClone(data);
  const beforeRepeat = data.log.snapshots;
  data = await next('Repeated batch: no duplicate observation');
  check('identical upstream payloads are not recorded twice', data.log.snapshots === beforeRepeat);
  setRace('senate-tx', 120_000, 110_000);
  data = await next('Retraction: Texas Senate returns to uncalled');
  check('withdrawn call removes the seat and provisional score', status(data) === 'leading' && data.chambers.Senate.democratic === 34 && data.score.n === 0 && data.score.market === null);
  setRace('senate-tx', 120_000, 130_000, 'opponent');
  data = await next('Correction: Texas Senate called Republican');
  check('corrected winner updates score and opposite party total', status(data) === 'lost' && data.chambers.Senate.republican === 32 && data.score.n === 1 && data.score.market !== callFrame.score.market);
  setRace('senate-ne', 52_000, 48_000, 'candidate');
  data = await next('Independent win: separate from Democratic control');
  check('independent call is tracked without assuming a caucus', status(data, 'senate-ne') === 'won' && data.chambers.Senate.independent === 1 && data.chambers.Senate.democratic === 34 && data.score.n === 2);
  const goodVotes = data.races.find((r: Race) => r.id === 'senate-tx')!.result.votes;
  for (const mode of ['http', 'json', 'timeout'] as const) {
    failure = mode;
    data = await next('Feed failure: ' + mode, 181_000);
    check(mode + ' failure preserves last good results and warns', Boolean(data.chambers.Senate.error) && data.chambers.Senate.stale && data.races.find((r: Race) => r.id === 'senate-tx')!.result.votes === goodVotes);
    check(mode + ' failure does not stop House updates', data.chambers.House.error === null && data.chambers.House.stale === false);
  }
  failure = 'none';
  const validFeeds = structuredClone(feeds);
  for (const kind of ['test', 'wrong-election', 'negative-votes', 'missing-races', 'two-winners'] as const) {
    feeds = structuredClone(validFeeds);
    if (kind === 'test') feeds.Senate.test_data = true;
    if (kind === 'wrong-election') feeds.Senate.election_date = '2024-11-05';
    if (kind === 'negative-votes') feeds.Senate.region_results.tx.candidates[0].votes = -1;
    if (kind === 'missing-races') feeds.Senate.region_results = {};
    if (kind === 'two-winners') { feeds.Senate.region_results.tx.candidates[0].winner = true; feeds.Senate.region_results.tx.candidates[1].winner = true; }
    const observations = app.auditExport().snapshots.length;
    data = await next('Rejected input: ' + kind);
    check(kind + ' rejected without changing saved results', Boolean(data.chambers.Senate.error) && data.races.find((r: Race) => r.id === 'senate-tx')!.result.votes === goodVotes && app.auditExport().snapshots.length === observations);
  }
  feeds = structuredClone(validFeeds);
  data = await next('Recovery: valid feed resumes');
  check('valid recovery clears warning and staleness', data.chambers.Senate.error === null && !data.chambers.Senate.stale);
  delay = 6_000;
  setRace('senate-tx', 125_000, 135_000, 'opponent');
  const slowStart = performance.now();
  data = await next('Slow source: viewers get last good results within 3 seconds');
  const slowWait = performance.now() - slowStart;
  check('slow source does not hold viewer responses past 3.5 seconds', slowWait < 3_500 && data.races.find((r: Race) => r.id === 'senate-tx')!.result.votes === goodVotes && data.chambers.Senate.error === null);
  await new Promise(resolve => setTimeout(resolve, 3_500));
  data = await next('Slow source arrives: next viewer request has it', 0);
  check('slow source update reaches the next viewer request', data.races.find((r: Race) => r.id === 'senate-tx')!.result.votes !== goodVotes && !data.chambers.Senate.stale);
  delay = 0;
  for (const [seats, title] of [[51, 'WINNING.'], [52, 'BIGLY WINNING.'], [54, 'SO MUCH WINNING.'], [56, 'TIRED OF WINNING.'], [59, 'NO MORE WINNING.']] as const) {
    feeds = structuredClone(original);
    const democrats = baseline.races.filter((r: Race) => r.chamber === 'Senate' && r.party === 'D') as Race[];
    for (const race of democrats.slice(0, seats - 34)) setRace(race.id, 60_000, 40_000, 'candidate');
    data = await next('Synthetic calls: ' + seats + ' D-caucus seats');
    check(seats + ' called seats produces ' + title, data.chambers.Senate.democratic === seats && fatigue(data.chambers.Senate.democratic).title === title && data.score.n === seats - 34);
  }
  check('frozen forecast and market probabilities survive every stage', frames.every(frame => JSON.stringify((frame.data as typeof data).races.map((r: Race) => [r.id, r.probability, r.margin, r.market])) === frozenFields));
  check('original server code and source evidence unchanged', copied.every((file, index) => before[index].equals(readFileSync(project + '/' + file))));
  const audit = app.auditExport();
  check('all simulated failures are logged', audit.fetches.filter((row: any) => row.ok === 0).length === 8);
  const txHistory = audit.snapshots.filter((row: any) => row.chamber === 'Senate').map((row: any) => JSON.parse(row.payload).region_results.tx.candidates.filter((c: any) => c.winner).map((c: any) => c.name));
  check('audit keeps both the original call and its retraction', txHistory.some((winners: string[], index: number) => winners.length > 0 && txHistory[index + 1]?.length === 0));
  writeFileSync(destination + '/synthetic-replay.json', JSON.stringify({ synthetic: true, warning: 'REHEARSAL ONLY. NOT ELECTION RESULTS. Do not import into production.', frames }));
  writeFileSync(destination + '/synthetic-audit.json', JSON.stringify({ synthetic: true, ...audit }));
} finally {
  globalThis.fetch = realFetch;
  globalThis.Date = RealDate;
  if (realEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = realEnv;
  writeFileSync(destination + '/backend-checks.json', JSON.stringify({ synthetic: true, checks, frames: frames.length, interceptedRequests: requests, runtime, at: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ passed: checks.filter(c => c.pass).length, total: checks.length, stages: frames.length, output: destination }));
}
