import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import { appendObservation } from '../backend-lib/observations';
import { brier, candidateMatch, expectedFlips, farOff, fatigue, flipTally, groupByBucket, heldBy, inPlay, leadTally, liveBucket, resultFor, scenarioCount, scenarioFlips, scorecard, type LiveRace, type Race, type Region } from '../src/lib/election';
import { validateFeed } from '../backend-lib/source-validation';

const base = await Bun.file(new URL('../data/baseline-20261103/baseline.json', import.meta.url)).json();
const addendum = await Bun.file(new URL('../data/baseline-20261103/verified-market-addendum.json', import.meta.url)).json();
const senateFeed = await Bun.file(new URL('../data/baseline-20261103/senate-initial-results.json', import.meta.url)).json();
const race = base.races.find((r: Race) => r.id === 'senate-tx') as Race;
const region = (d: number, r: number, winner: boolean | 'opponent' = false): Region => ({name:'Texas',election_id:87438,percent_reporting:50,candidates:[{name:race.candidate,party:'Democratic',votes:d,percent:0,winner:winner===true},{name:race.opponent,party:'Republican',votes:r,percent:0,winner:winner==='opponent'}]});

describe('Result semantics', () => {
  test('zero votes are waiting, not a tie or a loss', () => expect(resultFor(race,region(0,0))).toMatchObject({status:'waiting',margin:null}));
  test('a lead is never a call, even with a large margin', () => expect(resultFor(race,region(900,100)).status).toBe('leading'));
  test('source calls determine outcomes and can be withdrawn', () => {
    expect(resultFor(race,region(900,100,'opponent')).status).toBe('lost');
    expect(resultFor(race,region(900,100,true)).status).toBe('won');
    expect(resultFor(race,region(900,100)).status).toBe('leading');
  });
  test('margin includes other-party votes in the denominator', () => {
    const data=region(50,30);data.candidates.push({name:'Other',party:'Other',votes:20,percent:0,winner:false});
    expect(resultFor(race,data).margin).toBe(20);
  });
  test('an independent lead can keep a Democrat in trailing status', () => {
    const data=region(30,20);data.candidates.push({name:'Other',party:'Independent',votes:50,percent:0,winner:false});
    expect(resultFor(race,data).status).toBe('trailing');
  });
  test('ambiguous surnames are not silently matched', () => expect(candidateMatch('Jane Smith',[{name:'John Smith'},{name:'Mary Smith'}] as never)).toBeNull());
  test('all 35 Senate candidates match the actual source', () => { for(const r of base.races.filter((r:Race)=>r.chamber==='Senate')) expect(resultFor(r,senateFeed.region_results[r.key]).status).not.toBe('unavailable'); });
});

describe('Scoring and frozen evidence', () => {
  test('the verification addendum completes all 35 Senate markets without overwriting the freeze',()=>{const races=base.races.filter((r:Race)=>r.chamber==='Senate');expect(races.filter((r:Race)=>r.market??addendum.markets[r.id])).toHaveLength(35);for(const market of Object.values(addendum.markets) as {observedAt:string;identityEvidence:string}[]){expect(Date.parse(market.observedAt)).toBeLessThanOrEqual(Date.parse(base.cutoff));expect(Date.parse(market.observedAt)).toBeGreaterThanOrEqual(Date.parse(base.cutoff)-900000);expect(market.identityEvidence).toContain('Only');}expect(base.marketGaps).toHaveLength(4);});
  test('Brier score punishes confidence in wrong outcomes', () => {expect(brier(.9,true)).toBeCloseTo(.01);expect(brier(.9,false)).toBeCloseTo(.81);expect(()=>brier(2,true)).toThrow();});
  test('no resolved matched races means unknown, not a zero score', () => expect(scorecard([{...race,result:resultFor(race,region(900,100))}])).toMatchObject({n:0,forecast:null,market:null}));
  test('both sources score exactly the same cohort', () => {
    const result=resultFor(race,region(900,100,true));
    const score=scorecard([{...race,probability:.8,market:{...race.market!,probability:.6},result},{...race,id:'missing-market',market:null,result}]);
    expect(score).toMatchObject({n:1,ids:[race.id]});expect(score.forecast).toBeCloseTo(.04);expect(score.market).toBeCloseTo(.16);
  });
  test('all market samples precede the cutoff and are recent', () => {const cutoff=Date.parse(base.cutoff);for(const r of base.races.filter((r:Race)=>r.market)){const t=Date.parse(r.market.observedAt);expect(t).toBeLessThanOrEqual(cutoff);expect(t).toBeGreaterThanOrEqual(cutoff-900000);expect(r.market.probability).toBeGreaterThanOrEqual(0);expect(r.market.probability).toBeLessThanOrEqual(1);}});
  test('470 unique races, no skipped forecast rows', () => {expect(base.races.length).toBe(470);expect(new Set(base.races.map((r:Race)=>r.id)).size).toBe(470);});
  test('raw forecast files still match their frozen hashes', async()=>{for(const chamber of ['Senate','House']){const bytes=await Bun.file(new URL(`../data/baseline-20261103/${chamber.toLowerCase()}-forecast.csv`,import.meta.url)).arrayBuffer();expect(createHash('sha256').update(new Uint8Array(bytes)).digest('hex')).toBe(base.sources[chamber].sha256);}});
});

describe('Guardrails and scenarios', () => {
  test('rejects test feeds, another election, missing coverage, and impossible seats', () => {
    expect(()=>validateFeed(senateFeed,'Senate')).not.toThrow();
    for(const patch of [{test_data:true},{election_date:'2024-11-05'},{region_results:{}},{candidates:[{seats:101}]}])expect(()=>validateFeed({...senateFeed,...patch},'Senate')).toThrow();
  });
  test('rejects negative votes and two simultaneous winners', () => {
    const data=structuredClone(senateFeed);const r=Object.values(data.region_results)[0] as Region;r.candidates[0].votes=-1;
    expect(()=>validateFeed(data,'Senate')).toThrow();r.candidates[0].votes=0;r.candidates[0].winner=true;r.candidates[1].winner=true;expect(()=>validateFeed(data,'Senate')).toThrow();
  });
  test('independents are opt-in in coalition scenarios', () => {const races=[{...race,party:'I',margin:2}];expect(scenarioCount(races,'Senate',0,{},false)).toBe(34);expect(scenarioCount(races,'Senate',0,{},true)).toBe(35);});
  test('59-seat preset counts exactly 59 without changing the baseline',()=>{const before=JSON.stringify(base);const ranked=base.races.filter((r:Race)=>r.chamber==='Senate'&&r.party==='D').sort((a:Race,b:Race)=>(b.margin??0)-(a.margin??0));const overrides=Object.fromEntries(ranked.map((r:Race,i:number)=>[r.id,i<25]));expect(scenarioCount(base.races,'Senate',0,overrides,false)).toBe(59);expect(JSON.stringify(base)).toBe(before);});
});


describe('Observation history', () => {
  test('suppresses unchanged reads but preserves corrections back to a previous state', () => {
    const db=new Database(':memory:');
    db.exec('CREATE TABLE observations (id INTEGER PRIMARY KEY, chamber TEXT, observed_at TEXT, fetched_at TEXT, hash TEXT, payload TEXT)');
    const record=(chamber: string, votes: number)=>appendObservation(db,chamber,'source-time','fetch-time',{votes});
    expect(record('Senate',10)).toBe(true);
    expect(record('Senate',10)).toBe(false);
    expect(record('Senate',20)).toBe(true);
    expect(record('Senate',10)).toBe(true);
    expect(record('House',10)).toBe(true);
    const rows=db.query('SELECT chamber,payload FROM observations ORDER BY id').all() as {chamber: string;payload: string}[];
    expect(rows.map(r=>JSON.parse(r.payload).votes)).toEqual([10,20,10,10]);
    expect(rows.map(r=>r.chamber)).toEqual(['Senate','Senate','Senate','House']);
    db.close();
  });
});

const governors = await Bun.file(new URL('../data/baseline-20261103/governor-addendum-20261104.json', import.meta.url)).json();
const govFeed = await Bun.file(new URL('../data/baseline-20261103/governors/civicapi-87535-20261104T031351Z.json', import.meta.url)).json();
const live = (r: Race, status: LiveRace['result']['status'], margin: number | null = null, votes = 0): LiveRace => ({ ...r, result: { status, margin, reporting: null, votes, candidateVotes: null, opponentVotes: null, candidateShare: null, opponentShare: null, winner: null } });

describe('Flips and governors', () => {
  test('Senate prior holders match the 13 D / 22 R seats up tonight', () => {
    const senate = base.races.filter((r: Race) => r.chamber === 'Senate');
    expect(senate.filter((r: Race) => heldBy(r) === 'D').map((r: Race) => r.state).sort()).toEqual(['CO','DE','GA','IL','MA','MI','MN','NH','NJ','NM','OR','RI','VA']);
    expect(senate.filter((r: Race) => heldBy(r) === 'R').length).toBe(22);
  });
  test('governor addendum: 36 races, 18 D / 18 R held, market odds frozen at or before 8 a.m. ET, no model', () => {
    expect(governors.races.length).toBe(36);
    expect(governors.races.filter((r: Race) => r.held === 'D').length).toBe(18);
    for (const r of governors.races) { expect(r.probability).toBeNull(); expect(r.market.observedAt <= '2026-11-03T13:00:00Z').toBe(true); expect(r.market.probability).toBeGreaterThan(0); expect(r.market.probability).toBeLessThan(1); }
  });
  test('governor feed snapshot passes validation and every listed candidate matches', () => {
    expect(() => validateFeed(govFeed, 'Governor')).not.toThrow();
    for (const r of governors.races) { const region = govFeed.region_results[r.key]; const top = region.candidates.filter((c: {party: string}) => c.party === 'Republican').sort((a: {votes: number}, b: {votes: number}) => b.votes - a.votes)[0].name; expect(resultFor(r.opponent ? r : { ...r, opponent: top }, region).status).not.toBe('unavailable'); }
  });
  test('net flips count called seats only: gains from GOP minus losses', () => {
    const [heldR, heldD] = [governors.races.find((r: Race) => r.held === 'R'), governors.races.find((r: Race) => r.held === 'D')];
    expect(flipTally([live(heldR, 'leading', 20, 100), live(heldD, 'trailing', -20, 100)]).net).toBe(0);
    expect(flipTally([live(heldR, 'won'), live(heldD, 'won')])).toMatchObject({ gained: 1, lost: 0, net: 1 });
    expect(flipTally([live(heldR, 'lost'), live(heldD, 'lost')])).toMatchObject({ gained: 0, lost: 1, net: -1 });
  });
  test('expected net flips: model where it exists, otherwise market', () => {
    const r = { ...governors.races[0], held: 'R', market: { ...governors.races[0].market, probability: .4 } };
    expect(expectedFlips([r])).toBeCloseTo(.4);
    expect(expectedFlips([{ ...r, held: 'D' }])).toBeCloseTo(-.6);
  });
  test('contested widens to 2–98% odds, close live counts and upsets in progress', () => {
    const safe = { ...race, probability: .01, market: null };
    expect(inPlay(live(safe, 'waiting'))).toBe(false);
    expect(inPlay(live({ ...safe, probability: .03 }, 'waiting'))).toBe(true);
    expect(inPlay(live(safe, 'trailing', -9, 1000))).toBe(true);
    expect(inPlay(live(safe, 'trailing', -30, 1000))).toBe(false);
    expect(inPlay(live(safe, 'leading', 25, 1000))).toBe(true);
    expect(inPlay(live({ ...safe, probability: .99 }, 'trailing', -25, 1000))).toBe(true);
  });
  test('live status groups: calls by source only, early counts kept apart from upsets', () => {
    const at = (r: Race, status: LiveRace['result']['status'], margin: number | null, reporting: number | null, votes = 1000): LiveRace => ({ ...live(r, status, margin, votes), result: { ...live(r, status, margin, votes).result, reporting } });
    const reachR = { ...race, probability: .01, market: null, held: 'R' as const }, favD = { ...race, probability: .9, market: null, held: 'D' as const };
    expect(liveBucket(at(reachR, 'won', 5, 90))).toBe('flipped');
    expect(liveBucket(at(favD, 'won', 5, 90))).toBe('held');
    expect(liveBucket(at(favD, 'lost', -5, 90))).toBe('lost');
    expect(liveBucket(at(reachR, 'lost', -5, 90))).toBe('held');
    expect(liveBucket(at(reachR, 'leading', 28, 48))).toBe('longshot');
    expect(liveBucket(at(reachR, 'leading', 28, 6))).toBe('early');
    expect(liveBucket(at(favD, 'trailing', -14, 5))).toBe('early');
    expect(liveBucket(at(favD, 'trailing', -1, 60))).toBe('trouble');
    expect(liveBucket(at(favD, 'leading', 2, 60))).toBe('close');
    expect(liveBucket(at(favD, 'leading', 12, 60))).toBe('counting');
    expect(liveBucket(at(reachR, 'trailing', -20, 60))).toBe('counting');
    expect(liveBucket(at(favD, 'waiting', null, null, 0))).toBe('waiting');
    expect(liveBucket(at(favD, 'leading', 3, null))).toBe('close');
    const groups = groupByBucket([at({ ...reachR, margin: -15 }, 'leading', 28, 50), at({ ...reachR, id: 'x', probability: .2, margin: -2 }, 'leading', 3, 40), at({ ...reachR, id: 'y', probability: .3, margin: -2 }, 'leading', 3, 60), at(reachR, 'won', 5, 90), at(favD, 'lost', -5, 90)]);
    expect(groups.map(g => g.id)).toEqual(['flipped', 'lost', 'longshot']);
    expect(groups[2].items.map(r => r.probability)).toEqual([.3, .2, .01]);
    expect(farOff(groups[2].items[2])).toBe(true);
    expect(inPlay(at({ ...reachR, probability: 0, market: null }, 'won', 5, 90))).toBe(true);
    expect(inPlay(at({ ...favD, probability: 1, market: null }, 'lost', -5, 90))).toBe(true);
  });
  test('uncontested and Democrat-vs-Democrat seats: our side together vs the strongest non-Democrat; never a loss', () => {
    const solo = { ...race, id: 'house-ma-01', candidate: 'Richard Neal', opponent: 'Not Contested' } as Race;
    const reg = (cands: { name: string; party: string; votes: number; winner?: boolean }[]): Region => ({ name: 'X', election_id: 1, percent_reporting: 30, candidates: cands.map(c => ({ percent: 0, winner: false, ...c })) });
    expect(resultFor(solo, reg([{ name: 'Richard E. Neal', party: 'Democratic', votes: 600, winner: true }, { name: 'Nadia Milleron', party: 'Independent', votes: 400 }]))).toMatchObject({ status: 'won', candidateVotes: 600, opponentVotes: 400, winner: 'Richard E. Neal' });
    expect(resultFor(solo, reg([{ name: 'Maxwell Frost', party: 'Democratic', votes: 0, winner: true }])).status).toBe('won');
    const pair = { ...race, id: 'house-ca-11', candidate: 'Scott Wiener/Connie Chan', opponent: 'Not Contested' } as Race;
    expect(resultFor(pair, reg([{ name: 'Connie Chan', party: 'Democratic', votes: 10, winner: true }, { name: 'Scott Wiener', party: 'Democratic', votes: 5 }]))).toMatchObject({ status: 'won', winner: 'Connie Chan' });
    expect(resultFor(pair, reg([{ name: 'Connie Chan', party: 'Democratic', votes: 10 }, { name: 'Scott Wiener', party: 'Democratic', votes: 5 }])).status).toBe('leading');
    expect(resultFor({ ...race, candidate: 'Not Contested', opponent: 'Young Kim/Ken Calvert' } as Race, reg([{ name: 'Ken Calvert', party: 'Republican', votes: 0 }])).status).toBe('unavailable');
    expect(resultFor({ ...race, candidate: 'Eventual Nominee', opponent: 'Clay Higgins' } as Race, reg([{ name: 'Clay Higgins', party: 'Republican', votes: 9 }])).reason).toContain('Multi-candidate');
  });
  test('lead tally: uncalled, non-early counts that would flip a seat; never calls', () => {
    const r = { ...race, held: 'R' as const }, d = { ...race, held: 'D' as const };
    const withReporting = (x: LiveRace, reporting: number) => ({ ...x, result: { ...x.result, reporting } });
    expect(leadTally([withReporting(live(r, 'leading', 5, 100), 50), withReporting(live(r, 'leading', 5, 100), 10), live(r, 'won', 5, 100), withReporting(live(d, 'trailing', -2, 100), 40), withReporting(live(d, 'leading', 2, 100), 40)])).toEqual({ ahead: 1, behind: 1, net: 0 });
  });
  test('scenario flips: Senate baseline without overrides matches the model favorites', () => {
    const senate = base.races.filter((r: Race) => r.chamber === 'Senate').map((r: Race) => ({ ...r, held: heldBy(r) }));
    const expected = senate.filter((r: Race) => r.party === 'D' && r.held === 'R' && r.margin! > 0).length - senate.filter((r: Race) => r.held === 'D' && !(r.party === 'D' && r.margin! > 0)).length;
    expect(scenarioFlips(senate, 'Senate', 0, {}, false)).toBe(expected);
  });
});
