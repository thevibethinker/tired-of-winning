import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, ChevronDown, ExternalLink, Flag, Map as MapIcon, RefreshCw, Search, Volume2, X } from 'lucide-react';
import { brier, bucketCompare, chamberNames, chance, expectedFlips, farOff, fatigue, flipTally, groupByBucket, inPlay, isEarly, leadTally, liveBucket, liveBuckets, winningTiers, CONTESTED_BAND, EARLY_REPORTING, LIVE_CLOSE_PTS, type Chamber, type LiveBucket, type LiveRace } from '../lib/election';
import { closeNote, scheduleSource, closeFor } from '../lib/schedule';
import { reactions as reactionEmojis } from '../lib/party';
import { levelSounds } from '../lib/sound-events';
import { play, unlockAudio } from '../lib/sound';
import { EventToast, SoundPin, SoundPromo, Soundboard, TrumpMeme, useSoundEvents } from '../components/sound-ui';
import { startTelemetry, track } from '../lib/telemetry';
import { STATIC, apiUrl } from '../lib/static';
import './election-night.css';
import './election-map.css';

const ElectionMap = lazy(() => import('../components/election-map'));

type ChamberState = { democratic: number; republican: number; independent: number; fetchedAt: string; sourceUpdatedAt: string; stale: boolean; error: string | null };
type FinalInfo = { frozenAt: string; reason: 'all-called' | 'deadline'; uncalled: number; rule: string };
type Data = { races: LiveRace[]; chambers: Record<Chamber, ChamberState>; score: { n: number; forecast: number | null; market: number | null; ids?: string[] }; baseline: { frozenAt: string; cutoff: string; forecastSource: string; forecastUrl: string }; generatedAt: string; final: FinalInfo | null; freezeBy?: string };
type ReactionCounts = Record<string, Record<string, number>>;
type Scope = 'contested' | 'all';
type RaceOrder = 'live' | 'contested' | 'democratic' | 'republican' | 'gap' | 'state';

const raceOrders: { value: RaceOrder; label: string; note: string }[] = [
  { value: 'live', label: 'How it ended', note: `Flips first, then seats we lost, then anything still uncalled. A lead isn’t a call; under ${EARLY_REPORTING}% of the vote in is too early to tell.` },
  { value: 'contested', label: 'Closest odds that morning', note: 'Win chances closest to 50% first (model; market odds for governors).' },
  { value: 'democratic', label: 'Democratic-leaning first', note: 'Highest win chance for the listed Democrat or independent first (model; market odds for governors). No caucus affiliation is assumed.' },
  { value: 'republican', label: 'Republican-leaning first', note: 'Lowest win chance for the listed Democrat or independent first (model; market odds for governors).' },
  { value: 'gap', label: 'Biggest model–market gap', note: 'Largest difference in predicted win chance first; races without market odds go last.' },
  { value: 'state', label: 'State code A–Z', note: 'State abbreviations A–Z, then district number.' },
];

const bucketRank = Object.fromEntries(liveBuckets.map((b, i) => [b.id, i])) as Record<LiveBucket, number>;

function compareRaces(a: LiveRace, b: LiveRace, order: RaceOrder) {
  const stateOrder = a.state.localeCompare(b.state) || a.label.localeCompare(b.label, 'en', { numeric: true }) || a.id.localeCompare(b.id);
  const gap = (r: LiveRace) => r.market && r.probability !== null ? Math.abs(r.probability - r.market.probability) : -1;
  const p = (r: LiveRace, missing: number) => chance(r) ?? missing;
  if (order === 'democratic') return p(b, -1) - p(a, -1) || stateOrder;
  if (order === 'republican') return p(a, 2) - p(b, 2) || stateOrder;
  if (order === 'gap') return gap(b) - gap(a) || stateOrder;
  if (order === 'state') return stateOrder;
  if (order === 'live') {
    const ba = liveBucket(a), bb = liveBucket(b);
    return bucketRank[ba] - bucketRank[bb] || bucketCompare(a, b, ba) || stateOrder;
  }
  return closeness(a, b) || stateOrder;
}

const percent = (p: number | null) => p === null ? '—' : `${Math.round(p * 100)}%`;
const margin = (n: number, party = 'D') => n === 0 ? 'Even' : `${n > 0 ? party : 'R'}+${Math.abs(n).toFixed(1)}`;
const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
const clock = (s: string) => new Date(s).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/, '');
const time = (s: string) => new Date(s).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET';
const LIST_LIMIT = 60;
const day = (s: string) => new Date(s).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
const contested = inPlay;
const closeness = (a: LiveRace, b: LiveRace) => Math.abs((chance(a) ?? .5) - .5) - Math.abs((chance(b) ?? .5) - .5);
const signedInt = (n: number) => n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0';
const who = (name: string, fallback: string) => name === 'Not Contested' ? fallback : name;
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const surname = (name: string) => name.split('/')[0].trim().split(' ').filter(w => !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(w)).at(-1) ?? name;
function statusText(race: LiveRace, pollsOpen: boolean) {
  const r = race.result;
  if (pollsOpen) return 'Polls open';
  if (r.status === 'won') return `Called for ${surname(r.winner ?? race.candidate)}${(chance(race) ?? 1) < .5 ? ' · upset' : ''}`;
  if (r.status === 'lost') return `Called for ${surname(r.winner ?? race.opponent)}`;
  const reporting = r.reporting !== null && r.votes > 0 ? ` · ${Math.round(r.reporting)}% in${isEarly(race) ? ', early' : farOff(race) ? ', far off the forecast' : ''}` : '';
  if (r.status === 'leading') return `Leads, not called${reporting}`;
  if (r.status === 'trailing') return `Trails, not called${reporting}`;
  if (r.status === 'tied') return `Tied${reporting}`;
  if (r.status === 'waiting') return 'Polls closed · no votes yet';
  return 'No live data';
}

function useNow(interval: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), interval); return () => clearInterval(timer); }, [interval]);
  return now;
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return <div className="segmented" role="group" aria-label={label}>{options.map(([id, text]) => <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)}>{text}</button>)}</div>;
}

function Sheet({ open, onClose, label, wide = false, children }: { open: boolean; onClose: () => void; label: string; wide?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  return <dialog ref={ref} className={`sheet${wide ? ' sheet-wide' : ''}`} aria-label={label} onClose={onClose} onClick={e => { if (e.target === ref.current) onClose(); }}>{open && <div className="sheet-body">{children}</div>}</dialog>;
}

/** Replaces election night's countdown: says whether the count is still open or locked, and how many races never got a call. */
function StatusStrip({ final, freezeBy, uncalled }: { final: FinalInfo | null; freezeBy?: string; uncalled: number }) {
  if (final) return <div className="ticker is-final" role="status"><span className="ticker-label">Final score</span><span className="ticker-what">Locked {day(final.frozenAt)} · {final.uncalled ? `${final.uncalled} ${final.uncalled === 1 ? 'race' : 'races'} never called` : 'every race called'}</span></div>;
  const lockDay = freezeBy ? day(new Date(Date.parse(freezeBy) - 1).toISOString()) : null;
  return <div className="ticker" role="status"><span className="ticker-label">Still counting</span><span className="ticker-what">{uncalled} uncalled · locks {lockDay ? `${lockDay} at midnight` : 'soon'}, or when all are called</span></div>;
}

/** Final emoji counts from the party room (closed Nov 5, 00:00 ET). Display only. */
function FinalReactions({ counts, label }: { counts?: Record<string, number>; label: string }) {
  const shown = reactionEmojis.filter(r => counts?.[r.emoji]);
  if (!shown.length) return null;
  return <p className="race-reactions"><span className="sr-only">The room’s reactions for {label}: {shown.map(r => `${counts![r.emoji]} ${r.label.toLowerCase()}`).join(', ')}.</span>{shown.map(r => <span key={r.emoji} aria-hidden="true">{r.emoji}<b>{counts![r.emoji]}</b></span>)}</p>;
}

const chipLabels = ['Low', 'Win', 'Bigly', 'So much', 'Tired', 'No more'];
const chipRanges = ['<5', '5–14', '15–29', '30–44', '45–59', '60+'];
const chipTilt = [-3, 2, -2, 3, -2, 2];

function LevelSticker({ flips, caption, final = false }: { flips: number; caption: string; final?: boolean }) {
  const tier = fatigue(flips);
  const index = winningTiers.findIndex(t => t.min === tier.min);
  const next = winningTiers[index + 1];
  return <div className="meter level-sticker" data-pulse={index % 2}>
    <p className="meter-caption">{caption}</p>
    <p className="meter-title" aria-live="polite">{tier.title}</p>
    <p className="meter-line">{tier.line}</p>
    <p className="meter-next">{!next ? 'Tell Mar-a-Lago we said thanks.' : final ? `${next.min - flips} ${next.min - flips === 1 ? 'flip' : 'flips'} short of ${next.short}. Sad!` : `Next: ${next.short} · ${next.min - flips} more ${next.min - flips === 1 ? 'flip' : 'flips'}.`}</p>
  </div>;
}

function Ladder({ flips }: { flips: number }) {
  const index = winningTiers.findIndex(t => t.min === fatigue(flips).min);
  return <ol className="ladder" aria-label="Six stages of winning, by net flips across the Senate, House and governors">{winningTiers.map((t, i) => {
    const body = <><span className="sr-only">{t.short}, {t.range} net flips</span><b aria-hidden="true">{chipLabels[i]}</b><small aria-hidden="true">{chipRanges[i]}</small></>;
    const state = i < index ? 'is-past' : i === index ? 'is-current' : 'is-ahead';
    return <li key={t.short} className={state} style={{ '--tilt': `${chipTilt[i]}deg` } as CSSProperties} aria-current={i === index ? 'step' : undefined}><span className="ladder-chip">{body}</span></li>;
  })}</ol>;
}

function SeatStrip({ blue, red, total, threshold, expected, expectedLabel = 'Model' }: { blue: number; red: number; total: number; threshold: number; expected?: number; expectedLabel?: string }) {
  const at = (n: number) => `${Math.min(100, Math.max(0, n / total * 100))}%`;
  return <div className="seat-strip-wrap">
    <span className="strip-label strip-label-top" style={{ left: at(threshold) }} aria-hidden="true">{threshold} for control</span>
    <div className="seat-strip" role="img" aria-label={`${blue} Democratic, ${red} Republican, ${total - blue - red} uncalled or other; ${threshold} needed for control${expected !== undefined ? `; the ${expectedLabel.toLowerCase()} expected ${expected.toFixed(1)} Democratic` : ''}`}>
      <div className="blue-seats" style={{ width: at(blue) }}/><div className="red-seats" style={{ width: at(red) }}/><span className="majority-tick" style={{ left: at(threshold) }}/>
      {expected !== undefined && <span className="expected-tick" style={{ left: at(expected) }}/>}
    </div>
    {expected !== undefined && <span className="strip-label strip-label-bottom" style={{ left: at(expected) }} aria-hidden="true">{expectedLabel} {expected.toFixed(1)}</span>}
  </div>;
}

type CardSpec = { chamber: Chamber; total: number; threshold: number; thresholdLabel: string; expected: number; expectedLabel: string; note: string };

function ChamberCard({ spec, c, flips }: { spec: CardSpec; c: ChamberState; flips: ReturnType<typeof flipTally> }) {
  const uncalled = spec.total - c.democratic - c.republican - c.independent;
  const name = chamberNames[spec.chamber];
  return <div className={`chamber chamber-card chamber-${spec.chamber.toLowerCase()}`} role="group" aria-label={`${name}: net flips ${signedInt(flips.net)} (${flips.gained} taken from the GOP, ${flips.lost} lost). ${c.democratic} Democratic, ${c.republican} Republican, ${uncalled} uncalled.`}>
    <div className="chamber-head"><h2>{name}</h2><span className={`flip-net${flips.net > 0 ? ' is-up' : flips.net < 0 ? ' is-down' : ''}`} data-pulse={Math.abs(flips.net) % 2} aria-hidden="true"><b>{signedInt(flips.net)}</b><small>net flips</small></span></div>
    <p className="flip-split" aria-hidden="true"><span className="is-up">{flips.gained} from GOP</span> · <span className="is-down">{flips.lost} lost</span></p>
    <div className="chamber-nums" aria-hidden="true"><span className="num-d"><b>{c.democratic}</b> Dem</span><span className="num-u"><b>{uncalled}</b> uncalled</span><span className="num-r"><b>{c.republican}</b> GOP</span></div>
    <SeatStrip blue={c.democratic} red={c.republican} total={spec.total} threshold={spec.threshold} expected={spec.expected} expectedLabel={spec.expectedLabel}/>
    <p className="chamber-note">{spec.thresholdLabel} {spec.note}{c.independent ? ` Independents: ${c.independent}.` : ''}</p>
  </div>;
}

function RaceRow({ race, open, onToggle, now, forecastUrl, fresh, reactions }: { race: LiveRace; open: boolean; onToggle: () => void; now: number; forecastUrl: string; fresh: boolean; reactions?: Record<string, number> }) {
  const r = race.result;
  const close = closeFor(race.state);
  const pollsOpen = r.status === 'waiting' && close && now < Date.parse(close.at);
  const delta = r.margin === null || race.margin === null ? null : r.margin - race.margin;
  const code = race.chamber === 'House' ? race.label : race.state;
  const called = r.status === 'won' || r.status === 'lost';
  return <article id={`race-${race.id}`} className={`race-row${open ? ' is-open' : ''}${r.status === 'won' ? ' is-won' : r.status === 'lost' ? ' is-lost' : ''} bucket-${liveBucket(race)}${farOff(race) ? ' is-far-off' : ''}`}>
    <span className={`race-code${code.length > 2 ? ' is-long' : ''}`} aria-hidden="true" onClick={onToggle}><span>{code}</span></span>
    {called && <span className={`call-star is-${r.status}${fresh ? ' is-fresh' : ''}`} aria-hidden="true"><i>Called</i></span>}
    <button className="race-head" onClick={onToggle} aria-expanded={open} aria-controls={`more-${race.id}`}>
      <span className="sr-only">{code}: </span>
      <span className="race-who"><b>{who(race.candidate, 'No Democrat on ballot')} <i className={`party-tag party-${race.party}`}>{race.party}</i></b><small>vs. {who(race.opponent, 'no Republican')}</small></span>
      <ChevronDown size={18} className="race-chevron" aria-hidden="true"/>
    </button>
    <dl className="race-nums">
      <div><dt><span>Model</span> win %</dt><dd aria-label={race.probability === null ? 'No model forecast for this race' : `${percent(race.probability)} model chance of winning for ${race.candidate}`}>{percent(race.probability)}</dd></div>
      <div><dt><span>Market</span> win %</dt><dd aria-label={race.market ? `${percent(race.market.probability)} market chance of winning for ${race.candidate}, frozen at 8 a.m. Eastern` : 'Market win probability unavailable'}>{race.market ? percent(race.market.probability) : '—'}</dd></div>
    </dl>
    <dl className={`race-live status-${pollsOpen ? 'open' : r.status}`}>
      <div><dt>Count</dt>{r.margin !== null && <dd className="race-margin">{margin(r.margin, race.party)}</dd>}<dd className={`race-status${r.margin === null ? ' is-only' : ''}`}>{r.status === 'won' && <Check size={12} aria-hidden="true"/>}{statusText(race, Boolean(pollsOpen))}</dd></div>
    </dl>
    <FinalReactions counts={reactions} label={race.label}/>
    {open && <div className="race-more" id={`more-${race.id}`}>
      {r.reason && <p className="notice">{r.reason}. The forecast stays visible; live numbers are withheld.</p>}
      {r.votes > 0 && <div className="votes"><div><span>{race.candidate}</span><b>{r.candidateVotes?.toLocaleString() ?? '—'}</b></div><div><span>{race.opponent}</span><b>{r.opponentVotes?.toLocaleString() ?? '—'}</b></div>{r.candidateShare !== null && <div className="vote-bars" aria-hidden="true"><span style={{ width: `${r.candidateShare}%` }}/><i style={{ width: `${r.opponentShare}%` }}/></div>}</div>}
      <ul className="race-facts">
        <li>{closeNote(race.state)}</li>
        {race.margin !== null ? <li>The model expected a <b>{margin(race.margin, race.party)}</b> finish.{delta !== null && <> {called ? <> The count finished <b className={delta >= 0 ? 'positive' : 'negative'}>{signed(delta)} pts</b> against that.</> : <> The count so far is running <b className={delta >= 0 ? 'positive' : 'negative'}>{signed(delta)} pts</b> against that.</>}</>}</li> : <li>No model covers governor races; the market odds are the only pre-election number here.</li>}
        <li>{race.held === 'R' ? 'Republican-held going in, so a win here is a flip.' : 'Democratic-held going in, so a loss here is a flip the wrong way.'}</li>
        {r.winner && <li>civicAPI called this race for <b>{r.winner}</b>. That’s a source call, not certification.</li>}
        {race.market && <li>Market odds: Polymarket’s last price at or before 8 a.m. ET ({new Date(race.market.observedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })}). Not a live quote.</li>}
      </ul>
      <div className="source-links">{race.probability !== null && <a href={forecastUrl} target="_blank" rel="noreferrer">Forecast <ExternalLink size={12}/></a>}{race.raceId && <a href={`https://civicapi.org/results/elections/${race.raceId}`} target="_blank" rel="noreferrer">Live count <ExternalLink size={12}/></a>}{race.market && <a href={race.market.url} target="_blank" rel="noreferrer">Market <ExternalLink size={12}/></a>}</div>
    </div>}
  </article>;
}

export default function ElectionNight() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [chamber, setChamber] = useState<Chamber>('Senate');
  const [scope, setScope] = useState<Scope>('contested');
  const [chosenOrder, setOrder] = useState<RaceOrder | null>(null);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [jump, setJump] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [limit, setLimit] = useState(LIST_LIMIT);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const [reactions, setReactions] = useState<ReactionCounts>({});
  const now = useNow(30_000);
  const locked = useRef(false);

  const busy = useRef(false);
  const seenCalls = useRef<Set<string> | null>(null);
  const [freshCalls, setFreshCalls] = useState<Set<string>>(() => new Set());
  async function refresh() {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const response = await fetch(apiUrl('election'), { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error('The results desk is temporarily unavailable.');
      const body = await response.json();
      if (!body.races || !body.chambers) throw new Error('The results desk sent an unreadable update.');
      setData(body); setError(''); locked.current = Boolean(body.final);
    } catch (e) { setError(e instanceof Error && !['TimeoutError', 'AbortError', 'TypeError', 'SyntaxError'].includes(e.name) ? e.message : 'The results desk didn’t answer.'); }
    finally { busy.current = false; setLoading(false); }
  }
  useEffect(() => { void refresh(); const timer = setInterval(() => { if (!locked.current && document.visibilityState === 'visible') void refresh(); }, 120_000); return () => clearInterval(timer); }, []);
  useEffect(() => { fetch(apiUrl('reactions'), { headers: { Accept: 'application/json' } }).then(r => r.ok ? r.json() : null).then(body => { if (body?.counts) setReactions(body.counts); }).catch(() => {}); }, []);
  useEffect(() => {
    if (!data) return;
    const called = data.races.filter(r => r.result.status === 'won' || r.result.status === 'lost').map(r => r.id);
    if (!seenCalls.current) { seenCalls.current = new Set(called); return; }
    const fresh = called.filter(id => !seenCalls.current!.has(id));
    if (!fresh.length) return;
    fresh.forEach(id => seenCalls.current!.add(id));
    setFreshCalls(new Set(fresh));
    const timer = setTimeout(() => setFreshCalls(new Set()), 4000);
    return () => clearTimeout(timer);
  }, [data]);
  useEffect(() => { if (mapOpen) track('map_open'); }, [mapOpen]);
  useEffect(() => { if (boardOpen) track('soundboard_open'); }, [boardOpen]);
  useEffect(() => { startTelemetry(); }, []);
  useEffect(() => {
    if (!jump) return;
    document.getElementById(jump)?.scrollIntoView({ behavior: reduceMotion() ? 'instant' : 'smooth', block: 'start' });
    setJump(null);
  }, [jump]);

  const senateStates = useMemo(() => data ? [...new Set(data.races.filter(r => r.chamber !== 'House').map(r => r.state))] : [], [data]);
  const sound = useSoundEvents(data?.races ?? null, data ? flipTally(data.races).net : null, senateStates);
  if (!data) return <main className="election-app loading-page"><span className="wordmark">TOW<span>★</span></span><h1>Opening the<br/>results desk.</h1><p>{error || 'Getting the forecast, the morning odds, and the latest count.'}</p>{error && <button className="primary-button" onClick={refresh}>Try again</button>}</main>;

  const senate = data.chambers.Senate, house = data.chambers.House, governors = data.chambers.Governor;
  const calls = data.races.filter(r => r.result.status === 'won' || r.result.status === 'lost');
  const wins = calls.filter(r => r.result.status === 'won');
  const senateCalls = calls.filter(r => r.chamber === 'Senate').length;
  const flips = flipTally(data.races);
  const tallies = { Senate: flipTally(data.races, 'Senate'), House: flipTally(data.races, 'House'), Governor: flipTally(data.races, 'Governor') };
  const expectedNet = expectedFlips(data.races);
  const votesIn = data.races.some(r => r.result.votes > 0);
  const expectedD = (c: Chamber) => data.races.filter(r => r.chamber === c && r.party === 'D').reduce((s, r) => s + (chance(r) ?? 0), 0);
  const cards: CardSpec[] = [
    { chamber: 'Senate', total: 100, threshold: 51, thresholdLabel: '51 for control.', expected: 34 + expectedD('Senate'), expectedLabel: 'Model', note: 'Includes 65 seats not up (34 D, 31 R).' },
    { chamber: 'House', total: 435, threshold: 218, thresholdLabel: '218 for control.', expected: expectedD('House'), expectedLabel: 'Model', note: 'Called seats only; a lead is not a call.' },
    { chamber: 'Governor', total: 50, threshold: 26, thresholdLabel: '26 = most states.', expected: 6 + expectedD('Governor'), expectedLabel: 'Market', note: 'Includes 14 not up (6 D, 8 R). Market odds only.' },
  ];
  const order: RaceOrder = chosenOrder ?? 'live';
  const final = data.final;
  const uncalled = data.races.filter(r => !['won', 'lost', 'unavailable'].includes(r.result.status)).length;
  const scored = data.races.filter(r => data.score.ids?.includes(r.id));
  const miss = (pick: (r: LiveRace) => number) => scored.map(r => ({ r, p: pick(r), err: brier(pick(r), r.result.status === 'won') })).sort((a, b) => b.err - a.err)[0];
  const modelMiss = scored.length ? miss(r => r.probability!) : null;
  const marketMiss = scored.length ? miss(r => r.market!.probability) : null;
  const missLine = (m: NonNullable<typeof modelMiss>) => `${m.r.label}: ${percent(m.p)} for ${surname(m.r.candidate)}, who ${m.r.result.status === 'won' ? 'won' : 'lost'}`;
  const leads = leadTally(data.races);
  const ifLeadsHeld = flips.net + leads.net;
  const inChamber = data.races.filter(r => r.chamber === chamber);
  const contestedCount = inChamber.filter(contested).length;
  const q = query.trim().toLowerCase();
  const shown = inChamber.filter(r => q ? `${r.candidate} ${r.opponent} ${r.label} ${r.state}`.toLowerCase().includes(q) : scope === 'all' || contested(r)).sort((a, b) => compareRaces(a, b, order));
  const visible = shown.slice(0, limit);
  const bucketGroups = groupByBucket(shown);
  const groupCap = window.innerWidth < 720 ? 6 : 10;
  const bucketCounts = bucketGroups.filter(g => ['flipped', 'lost', 'close', 'longshot', 'trouble', 'early'].includes(g.id));
  const activeOrder = raceOrders.find(o => o.value === order)!;
  const stale = !final && (senate.stale || house.stale || governors.stale);
  const checkedAt = [senate, house, governors].map(c => c.fetchedAt).sort()[0];
  const receivedTimes = `Senate ${time(senate.fetchedAt)}; House ${time(house.fetchedAt)}; Governors ${Date.parse(governors.fetchedAt) ? time(governors.fetchedAt) : 'not yet'}`;
  const modelWon = data.score.forecast! < data.score.market!, marketWon = data.score.market! < data.score.forecast!;
  const scoreLine = !data.score.n ? 'Nothing to score yet: no Senate race with both a model and a market number has been called.'
    : modelWon ? `The nerds (model) beat the crypto bros (market)${final ? '' : ', so far'}.` : marketWon ? `The crypto bros (market) beat the nerds (model)${final ? '' : ', so far'}.` : `The nerds (model) and the crypto bros (market) finished dead even${final ? '' : ', so far'}.`;

  function toggle(id: string) { setOpenId(openId === id ? null : id); }
  function goTo(id: string) { setJump(id); }
  function openState(state: string, nextChamber: Chamber) {
    const local = data!.races.filter(r => r.state === state && r.chamber === nextChamber).sort(closeness);
    setMapOpen(false);
    if (!local.length) return;
    setChamber(nextChamber); setQuery(''); setLimit(Infinity);
    if (!contested(local[0])) setScope('all');
    setOpenId(local[0].id); goTo(`race-${local[0].id}`);
  }
  function playFinale() { unlockAudio(); void play(levelSounds[winningTiers.findIndex(t => t.min === fatigue(flips.net).min)]); }

  return <div className="election-app">
    <a className="skip-link" href="#races">Skip to the races</a>
    <div className="live-banner"><StatusStrip final={final} freezeBy={data.freezeBy} uncalled={uncalled}/></div>
    <header className="masthead">
      <button className="wordmark" aria-label="Back to the top" onClick={() => window.scrollTo({ top: 0, behavior: reduceMotion() ? 'instant' : 'smooth' })}>TOW<span>★</span></button>
      <div className="masthead-title">Tired of Winning?<span>Midterms · Nov 3, 2026 · {final ? 'final' : 'still counting'}</span></div>
      {!STATIC && <SoundPin/>}
      {final ? <span className="live-pin is-final" title={`Locked ${day(final.frozenAt)}, 2026. ${final.rule}`}><small>Locked</small><b>{day(final.frozenAt)}</b></span> : <button className={`live-pin${stale || error ? ' warning' : ''}`} onClick={refresh} aria-busy={loading} aria-label={`${stale || error ? 'Feed delayed. ' : ''}Last received: ${receivedTimes}. Refresh results`} title={`Last received: ${receivedTimes}. Source updated: Senate ${time(senate.sourceUpdatedAt)}; House ${time(house.sourceUpdatedAt)}.`}>
        <small>{stale || error ? 'Feed' : 'As of'}</small><b>{stale || error ? 'Delayed' : clock(checkedAt)}</b><RefreshCw size={12} className={loading ? 'spinning' : ''} aria-hidden="true"/>
      </button>}
    </header>

    <main id="main">
      {!final && (error || stale) && <div className="error-banner" role="status"><span>{error || 'A results source is delayed.'} Last received: {receivedTimes}. Retrying automatically.</span><button onClick={refresh}>Retry</button></div>}

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-stickers">
          <div className="bumper">
            <h1 id="hero-title">Tired of <em>winning?</em></h1>
            <p className="bumper-tag"><span aria-hidden="true">★★★</span> Make winning exhausting again</p>
          </div>
          <LevelSticker flips={flips.net} caption={final ? 'Final · net flips, all offices' : 'Still counting · net flips, all offices'} final={Boolean(final)}/>
        </div>
        <div className="hero-board">
          <div className="flip-total" role="img" aria-label={`Net flips across the Senate, House and governors: ${signedInt(flips.net)}. ${flips.gained} taken from the GOP, ${flips.lost} lost. Election-morning odds implied about ${signedInt(Math.round(expectedNet))}.`}>
            <b aria-hidden="true">{signedInt(flips.net)}</b>
            <span aria-hidden="true"><strong>{final ? 'Net flips, final' : 'Net flips so far'}</strong><small>{flips.gained} taken from the GOP · {flips.lost} lost · election-morning odds implied ≈ {signedInt(Math.round(expectedNet))}</small></span>
          </div>
          {!final && votesIn && <p className="flip-pipeline"><b>Not called yet:</b> ahead in {leads.ahead} more GOP {leads.ahead === 1 ? 'seat' : 'seats'}, behind in {leads.behind} of ours. If every lead held: <b>{signedInt(ifLeadsHeld)}</b>, {fatigue(ifLeadsHeld).short.toLowerCase()}. Leads aren’t calls.</p>}
          <Ladder flips={flips.net}/>
          <div className="chamber-trio">{cards.map(spec => <ChamberCard key={spec.chamber} spec={spec} c={data.chambers[spec.chamber]} flips={tallies[spec.chamber]}/>)}</div>
          <p className="hero-sub">{calls.length} races called{final ? '' : ' so far'} ({senateCalls} Senate). {final && final.uncalled ? `${final.uncalled} never got a call before the lock and don’t count. ` : ''}Flips = GOP-held seats our side took, minus our seats lost. A lead never counts.</p>
        </div>
      </section>


      <section className="board" aria-labelledby="verdict-title">
        <div className="scorecard">
          <p className="eyebrow">Model vs. market · who called it?</p>
          <h2 className="scorecard-line" id="verdict-title">{scoreLine}</h2>
          <p className="scorecard-detail">{data.score.n ? <>Average error, lower is better: model <b>{data.score.forecast!.toFixed(3)}</b> · market <b>{data.score.market!.toFixed(3)}</b>, across the {data.score.n} called Senate {data.score.n === 1 ? 'race' : 'races'} that had both numbers. Model: Split Ticket. Market: Polymarket. Both frozen the morning of Nov 3.</> : 'Each called Senate race scores the morning’s model (Split Ticket) against the morning’s market (Polymarket).'}</p>
          {modelMiss && marketMiss && <p className="scorecard-detail">{modelMiss.r.id === marketMiss.r.id
            ? <>Worst miss for both: <b>{modelMiss.r.label}</b>, where {surname(modelMiss.r.candidate)} {modelMiss.r.result.status === 'won' ? 'won' : 'lost'} after the model gave {percent(modelMiss.p)} and the market {percent(marketMiss.p)}.</>
            : <>Worst miss · model: {missLine(modelMiss)}. Market: {missLine(marketMiss)}.</>}</p>}
          {calls.length > 0 && <p className="scorecard-detail">Our side won <b>{wins.length}</b> of {calls.length} called races; election-morning odds expected <b>{calls.reduce((s, r) => s + (chance(r) ?? 0), 0).toFixed(1)}</b>.</p>}
        </div>
      </section>

      <section className="races" id="races" aria-labelledby="races-title">
        <div className="section-head">
          <p className="eyebrow">{order === 'live' ? 'How it ended · source calls' : activeOrder.label}</p>
          <h2 id="races-title">{order === 'live' ? 'Where it got weird.' : 'Every race, sorted.'}</h2>
        </div>
        <div className="race-controls" id="race-controls">
          <Segmented label="Chamber" value={chamber} options={[['Senate', 'Senate'], ['House', 'House'], ['Governor', 'Gov']]} onChange={c => { setChamber(c); setOpenId(null); setLimit(LIST_LIMIT); }}/>
          <Segmented label="Which races" value={scope} options={[['contested', `Contested · ${contestedCount}`], ['all', `All ${inChamber.length}`]]} onChange={v => { setScope(v); setLimit(LIST_LIMIT); }}/>
          <label className="race-sort"><span>Sort by</span><select aria-label="Sort races" aria-describedby="race-order-note" value={order} onChange={e => { setOrder(e.target.value as RaceOrder); setLimit(LIST_LIMIT); }}>{raceOrders.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
          <label className="search-field"><Search size={16} aria-hidden="true"/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a candidate, state, or district" aria-label="Search races"/>{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={15}/></button>}</label>
        </div>
        {votesIn && bucketCounts.length > 0 && <div className="bucket-chips" role="group" aria-label="Jump to a live status group">{bucketCounts.map(g => <button key={g.id} type="button" className={`bucket-chip chip-${g.id}`} onClick={() => { setOrder('live'); goTo(`bucket-${g.id}`); }}><b>{g.items.length}</b> {(g.items.length === 1 ? g.one : g.title).toLowerCase()}</button>)}</div>}
        <details className="read-me"><summary>How to read this</summary>
        <p className="legend"><b>Win % = chance of winning, not vote share.</b> Both are for the listed Democrat or independent. <b>Model:</b> Split Ticket (no governor model). <b>Market:</b> Polymarket, frozen at 8 a.m. ET on Nov 3. <b>Count:</b> vote margin as civicAPI reported it. Emoji: the watch-party room’s reactions.</p>
        <p className="sort-note" id="race-order-note" role="status">{activeOrder.note}{q ? ' Search covers every race.' : scope === 'contested' ? ` Contested: ${CONTESTED_BAND * 100}–${100 - CONTESTED_BAND * 100}% odds, within ${LIVE_CLOSE_PTS} points, or an upset in progress.` : ''}{order === 'gap' && !shown.some(r => r.market) && ' No market odds are available for these races.'}</p>
        </details>
        {order === 'live' ? bucketGroups.map(g => {
          const expanded = openGroups.has(`${chamber}:${g.id}`) || g.items.some(r => r.id === openId);
          const items = expanded ? g.items : g.items.slice(0, groupCap);
          return <div className={`close-group bucket-group group-${g.id}`} id={`bucket-${g.id}`} key={g.id}>
          <div className="close-head"><h3>{g.items.length === 1 ? g.one : g.title}</h3><span className="close-status">{g.note}</span><span className="close-count">{g.items.length} {g.items.length === 1 ? 'race' : 'races'}</span></div>
          <div className="race-list">{items.map(r => <RaceRow key={r.id} race={r} open={openId === r.id} onToggle={() => toggle(r.id)} now={now} forecastUrl={data.baseline.forecastUrl} fresh={freshCalls.has(r.id)} reactions={reactions[r.id]}/>)}</div>
          {items.length < g.items.length && <button className="show-all group-more" onClick={() => setOpenGroups(new Set(openGroups).add(`${chamber}:${g.id}`))}>Show all {g.items.length} · {g.title.toLowerCase()}</button>}
        </div>; }) : <div className="race-list">{visible.map(r => <RaceRow key={r.id} race={r} open={openId === r.id} onToggle={() => toggle(r.id)} now={now} forecastUrl={data.baseline.forecastUrl} fresh={freshCalls.has(r.id)} reactions={reactions[r.id]}/>)}</div>}
        {!shown.length && <div className="empty-state"><Flag size={24} aria-hidden="true"/><h3>No matching races.</h3><p>Try a surname, a state like “Ohio,” or a district like “CA-22.”</p><button className="text-button" onClick={() => setQuery('')}>Clear the search</button></div>}
        {order !== 'live' && shown.length > visible.length && <button className="show-all" onClick={() => setLimit(Infinity)}>Show {shown.length - visible.length} more {chamber === 'Governor' ? 'governor' : chamber} races</button>}
        {scope === 'contested' && !q && <button className="show-all" onClick={() => { setScope('all'); setLimit(LIST_LIMIT); }}>Show all {inChamber.length} {chamber === 'Governor' ? 'governor' : chamber} races, safe seats included</button>}
      </section>

    </main>

    <footer>
      <span className="footer-wordmark">Tired of Winning?<span>★</span></span>
      <p>Strong feelings, real sources, zero alternative facts. Forecast and odds frozen the morning of Nov 3, 2026. {final ? `Results as civicAPI reported them when the page locked on ${day(final.frozenAt)}: source calls, not certification.` : 'Results from civicAPI, checked hourly and on each visit until the page locks: source calls, not certification.'}</p>
      <p>Built for one watch party. The chat closed at midnight on Nov 4; only its emoji counts are kept here. {STATIC ? <>This is the static archive: no visit counting, no trackers, and the night’s Trump clips are left out. Code and data: <a href="https://github.com/thevibethinker/tired-of-winning" target="_blank" rel="noreferrer">GitHub</a>.</> : <>We count visits anonymously: a random browser ID, device type and the site that sent you. No names, IP addresses or ad trackers; Global Privacy Control turns it off. <button className="text-button" onClick={() => setBoardOpen(true)}>Open the soundboard</button></>}</p>
      <div><a href={data.baseline.forecastUrl} target="_blank" rel="noreferrer">Split Ticket</a><a href="https://civicapi.org" target="_blank" rel="noreferrer">civicAPI</a><a href="https://polymarket.com" target="_blank" rel="noreferrer">Polymarket</a><a href={scheduleSource} target="_blank" rel="noreferrer">Poll times: The Hill</a><a href="https://zo.computer" target="_blank" rel="noreferrer">Built on Zo</a></div>
    </footer>

    <nav className="action-bar" aria-label="Quick actions">
      <button onClick={() => goTo('race-controls')}><Flag size={18} aria-hidden="true"/><span>Races</span></button>
      <button onClick={() => setMapOpen(true)} aria-haspopup="dialog"><MapIcon size={18} aria-hidden="true"/><span>Map</span></button>
      {!STATIC && <button className="accent-button" onClick={() => setBoardOpen(true)} aria-haspopup="dialog"><Volume2 size={18} aria-hidden="true"/><span>Sounds</span></button>}
    </nav>

    <Sheet open={mapOpen} onClose={() => setMapOpen(false)} label="Election map" wide>
      <header className="sheet-head"><div><h2>The map</h2><p>Tap a state to jump to its races. No Sharpie edits.</p></div><button className="sheet-close" onClick={() => setMapOpen(false)} aria-label="Close the map"><X size={20}/></button></header>
      <Suspense fallback={<p className="sheet-loading">Unfolding the map…</p>}><ElectionMap races={data.races} onOpenState={openState}/></Suspense>
    </Sheet>
    {!STATIC && <>
    <Sheet open={boardOpen} onClose={() => setBoardOpen(false)} label="The soundboard">
      <Soundboard onClose={() => setBoardOpen(false)} locked={Boolean(final)}/>
    </Sheet>
    <SoundPromo hidden={Boolean(sound.toast)} onGo={playFinale} cta={<><b>Sound’s on.</b> Tap to hear how it ended.</>}/>
    <EventToast toast={sound.toast} onClose={sound.dismiss} onReplay={sound.replay}/>
    <TrumpMeme/>
    </>}
  </div>;
}
