import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, ChevronDown, ExternalLink, Flag, Map as MapIcon, MessageCircle, RefreshCw, Search, SlidersHorizontal, Star, X } from 'lucide-react';
import { bucketCompare, chamberNames, chance, expectedFlips, farOff, fatigue, flipTally, groupByBucket, inPlay, isEarly, leadTally, liveBucket, liveBuckets, scenarioCount, scenarioFlips, winningTiers, CONTESTED_BAND, EARLY_REPORTING, LIVE_CLOSE_PTS, type Chamber, type LiveBucket, type LiveRace } from '../lib/election';
import { closeNote, countdown, etTime, groupByClose, lastClose, nextClose, relative, scheduleSource, closeFor } from '../lib/schedule';
import { PartyBanner, PartyProvider, PartyRoom, RacePicks, RaceReactions, usePartySummary } from '../components/party-room';
import { EventToast, SoundPin, SoundPromo, Soundboard, TrumpMeme, useSoundEvents } from '../components/sound-ui';
import { startTelemetry, track } from '../lib/telemetry';
import './election-night.css';
import './election-map.css';
import '../components/party-room.css';

const ElectionMap = lazy(() => import('../components/election-map'));

type ChamberState = { democratic: number; republican: number; independent: number; fetchedAt: string; sourceUpdatedAt: string; stale: boolean; error: string | null };
type Data = { races: LiveRace[]; chambers: Record<Chamber, ChamberState>; score: { n: number; forecast: number | null; market: number | null }; baseline: { frozenAt: string; cutoff: string; forecastSource: string; forecastUrl: string }; generatedAt: string };
type Scope = 'contested' | 'all';
type RaceOrder = 'live' | 'closing' | 'contested' | 'democratic' | 'republican' | 'gap' | 'state';

const raceOrders: { value: RaceOrder; label: string; note: string }[] = [
  { value: 'live', label: 'What’s happening now', note: `Called flips first, then uncalled races worth watching. A lead isn’t a call; under ${EARLY_REPORTING}% of the vote in is too early to tell.` },
  { value: 'closing', label: 'Poll-closing time', note: 'Earliest polls first; closest model races within each time group.' },
  { value: 'contested', label: 'Closest odds this morning', note: 'Win chances closest to 50% first (model; market odds for governors).' },
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
  const closeOrder = (closeFor(a.state)?.at ?? 'unknown').localeCompare(closeFor(b.state)?.at ?? 'unknown');
  return (order === 'closing' ? closeOrder : 0) || closeness(a, b) || stateOrder;
}

const percent = (p: number | null) => p === null ? '—' : `${Math.round(p * 100)}%`;
const margin = (n: number, party = 'D') => n === 0 ? 'Even' : `${n > 0 ? party : 'R'}+${Math.abs(n).toFixed(1)}`;
const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
const clock = (s: string) => new Date(s).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/, '');
const time = (s: string) => new Date(s).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET';
const LIST_LIMIT = 60;
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

function Ticker({ states, onJump }: { states: string[]; onJump: (at: string) => void }) {
  const now = useNow(1000);
  const next = nextClose(now, states);
  if (!next) return <div className="ticker" role="status"><span className="ticker-label">{now < Date.parse(lastClose) ? 'Most polls are closed' : 'Every poll is closed'}</span><span className="ticker-what">{now < Date.parse(lastClose) ? `Alaska’s last polls close ${etTime(lastClose)}` : 'Keep counting. Every vote. Sorry, sir.'}</span></div>;
  return <button className="ticker" onClick={() => onJump(next.at)} aria-label={`${next.first ? 'First' : 'Next'} polls close at ${etTime(next.at)} in ${next.states.join(', ')}. Countdown ${countdown(Date.parse(next.at) - now)}. Jump to these races.`}>
    <span className="ticker-label">{next.first ? 'First polls close in' : 'Next polls close in'}</span>
    <span className="ticker-clock" aria-hidden="true">{countdown(Date.parse(next.at) - now)}</span>
    <span className="ticker-what" aria-hidden="true">{etTime(next.at)} · {next.states.join(' · ')}</span>
  </button>;
}

const chipLabels = ['Low', 'Win', 'Bigly', 'So much', 'Tired', 'No more'];
const chipRanges = ['<5', '5–14', '15–29', '30–44', '45–59', '60+'];
const chipTilt = [-3, 2, -2, 3, -2, 2];

function LevelSticker({ flips, caption }: { flips: number; caption: string }) {
  const tier = fatigue(flips);
  const index = winningTiers.findIndex(t => t.min === tier.min);
  const next = winningTiers[index + 1];
  return <div className="meter level-sticker" data-pulse={index % 2}>
    <p className="meter-caption">{caption}</p>
    <p className="meter-title" aria-live="polite">{tier.title}</p>
    <p className="meter-line">{tier.line}</p>
    <p className="meter-next">{next ? `Next: ${next.short} · ${next.min - flips} more ${next.min - flips === 1 ? 'flip' : 'flips'}.` : 'Tell Mar-a-Lago we said thanks.'}</p>
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

function RaceRow({ race, open, onToggle, now, forecastUrl, fresh }: { race: LiveRace; open: boolean; onToggle: () => void; now: number; forecastUrl: string; fresh: boolean }) {
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
      <div><dt>Live count</dt>{r.margin !== null && <dd className="race-margin">{margin(r.margin, race.party)}</dd>}<dd className={`race-status${r.margin === null ? ' is-only' : ''}`}>{r.status === 'won' && <Check size={12} aria-hidden="true"/>}{statusText(race, Boolean(pollsOpen))}</dd></div>
    </dl>
    <RaceReactions race={race}/>
    {open && <div className="race-more" id={`more-${race.id}`}>
      {r.reason && <p className="notice">{r.reason}. The forecast stays visible; live numbers are withheld.</p>}
      {r.votes > 0 && <div className="votes"><div><span>{race.candidate}</span><b>{r.candidateVotes?.toLocaleString() ?? '—'}</b></div><div><span>{race.opponent}</span><b>{r.opponentVotes?.toLocaleString() ?? '—'}</b></div>{r.candidateShare !== null && <div className="vote-bars" aria-hidden="true"><span style={{ width: `${r.candidateShare}%` }}/><i style={{ width: `${r.opponentShare}%` }}/></div>}</div>}
      <ul className="race-facts">
        <li>{closeNote(race.state)}</li>
        {race.margin !== null ? <li>The model expected a <b>{margin(race.margin, race.party)}</b> finish.{delta !== null && <> The live count is running <b className={delta >= 0 ? 'positive' : 'negative'}>{signed(delta)} pts</b> against that so far; early counts swing as different areas report.</>}</li> : <li>No model covers governor races; the market odds are the only pre-election number here.</li>}
        <li>{race.held === 'R' ? 'Republican-held going in, so a win here is a flip.' : 'Democratic-held going in, so a loss here is a flip the wrong way.'}</li>
        {r.winner && <li>civicAPI called this race for <b>{r.winner}</b>. That’s a source call, not certification.</li>}
        {race.market && <li>Market odds: Polymarket’s last price at or before 8 a.m. ET ({new Date(race.market.observedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })}). Not a live quote.</li>}
      </ul>
      <RacePicks race={race}/>
      <div className="source-links">{race.probability !== null && <a href={forecastUrl} target="_blank" rel="noreferrer">Forecast <ExternalLink size={12}/></a>}{race.raceId && <a href={`https://civicapi.org/results/elections/${race.raceId}`} target="_blank" rel="noreferrer">Live count <ExternalLink size={12}/></a>}{race.market && <a href={race.market.url} target="_blank" rel="noreferrer">Market <ExternalLink size={12}/></a>}</div>
    </div>}
  </article>;
}

export default function ElectionNight() {
  return <PartyProvider><ElectionDashboard/></PartyProvider>;
}

function ElectionDashboard() {
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
  const [chatOpen, setChatOpen] = useState(() => window.location.hash === '#party');
  const [focusCommentId, setFocusCommentId] = useState<number | undefined>();
  const [swing, setSwing] = useState(0);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [includeI, setIncludeI] = useState(false);
  const [flipScope, setFlipScope] = useState<Scope>('contested');
  const [limit, setLimit] = useState(LIST_LIMIT);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const party = usePartySummary();
  const now = useNow(30_000);

  const busy = useRef(false);
  const seenCalls = useRef<Set<string> | null>(null);
  const [freshCalls, setFreshCalls] = useState<Set<string>>(() => new Set());
  async function refresh() {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const response = await fetch('/api/election', { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error('The results desk is temporarily unavailable.');
      const body = await response.json();
      if (!body.races || !body.chambers) throw new Error('The results desk sent an unreadable update.');
      setData(body); setError('');
    } catch (e) { setError(e instanceof Error && !['TimeoutError', 'AbortError', 'TypeError', 'SyntaxError'].includes(e.name) ? e.message : 'The results desk didn’t answer.'); }
    finally { busy.current = false; setLoading(false); }
  }
  useEffect(() => { void refresh(); const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 30_000); return () => clearInterval(timer); }, []);
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
  useEffect(() => { history.replaceState(null, '', chatOpen ? '#party' : location.pathname + location.search); if (chatOpen) track('chat_open'); }, [chatOpen]);
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
  const order: RaceOrder = chosenOrder ?? (votesIn ? 'live' : 'closing');
  const leads = leadTally(data.races);
  const ifLeadsHeld = flips.net + leads.net;
  const inChamber = data.races.filter(r => r.chamber === chamber);
  const contestedCount = inChamber.filter(contested).length;
  const q = query.trim().toLowerCase();
  const shown = inChamber.filter(r => q ? `${r.candidate} ${r.opponent} ${r.label} ${r.state}`.toLowerCase().includes(q) : scope === 'all' || contested(r)).sort((a, b) => compareRaces(a, b, order));
  const visible = shown.slice(0, limit);
  const groups = groupByClose(visible);
  const bucketGroups = groupByBucket(shown);
  const groupCap = window.innerWidth < 720 ? 6 : 10;
  const bucketCounts = bucketGroups.filter(g => ['flipped', 'lost', 'close', 'longshot', 'trouble', 'early'].includes(g.id));
  const activeOrder = raceOrders.find(o => o.value === order)!;
  const nextAt = nextClose(now, inChamber.map(r => r.state))?.at;
  const stale = senate.stale || house.stale || governors.stale;
  const checkedAt = [senate, house, governors].map(c => c.fetchedAt).sort()[0];
  const receivedTimes = `Senate ${time(senate.fetchedAt)}; House ${time(house.fetchedAt)}; Governors ${Date.parse(governors.fetchedAt) ? time(governors.fetchedAt) : 'not yet'}`;
  const hypSenate = scenarioCount(data.races, 'Senate', swing, overrides, includeI);
  const hypHouse = scenarioCount(data.races, 'House', swing, overrides, includeI);
  const flipRaces = data.races.filter(r => r.chamber === 'Senate' && (flipScope === 'all' || contested(r))).sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0));
  const hypFlips = { Senate: scenarioFlips(data.races, 'Senate', swing, overrides, includeI), House: scenarioFlips(data.races, 'House', swing, overrides, includeI) };
  const scoreLine = !data.score.n ? 'Who saw it coming: the nerds or the crypto bros?'
    : data.score.market! < data.score.forecast! ? 'So far, the crypto bros (market) are beating the nerds (model).' : data.score.forecast! < data.score.market! ? 'So far, the nerds (model) are beating the crypto bros (market).' : 'So far, the nerds (model) and the crypto bros (market) are dead even.';

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
  function jumpToClose(at: string) {
    setChamber('Senate'); setQuery(''); setScope('all'); setOrder('closing'); setLimit(Infinity); goTo(`close-${Date.parse(at)}`);
  }
  function previewSeats(seats: number) {
    const ranked = data!.races.filter(r => r.chamber === 'Senate' && r.party === 'D').sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0));
    setSwing(0); setIncludeI(false); setFlipScope('all');
    setOverrides(Object.fromEntries(ranked.map((r, i) => [r.id, i < seats - 34])));
  }

  return <div className="election-app">
    <a className="skip-link" href="#races">Skip to the races</a>
    <div className="live-banner"><Ticker states={senateStates} onJump={jumpToClose}/><PartyBanner onOpen={id => { setFocusCommentId(id); setChatOpen(true); }}/></div>
    <header className="masthead">
      <button className="wordmark" aria-label="Back to the top" onClick={() => window.scrollTo({ top: 0, behavior: reduceMotion() ? 'instant' : 'smooth' })}>TOW<span>★</span></button>
      <div className="masthead-title">Tired of Winning?<span>Midterms · Nov 3, 2026</span></div>
      <SoundPin/>
      <button className={`live-pin${stale || error ? ' warning' : ''}`} onClick={refresh} aria-busy={loading} aria-label={`${stale || error ? 'Feed delayed. ' : ''}Last received: ${receivedTimes}. Refresh results`} title={`Last received: ${receivedTimes}. Source updated: Senate ${time(senate.sourceUpdatedAt)}; House ${time(house.sourceUpdatedAt)}.`}>
        <small>{stale || error ? 'Feed' : 'As of'}</small><b>{stale || error ? 'Delayed' : clock(checkedAt)}</b><RefreshCw size={12} className={loading ? 'spinning' : ''} aria-hidden="true"/>
      </button>
    </header>

    <main id="main">
      {(error || stale) && <div className="error-banner" role="status"><span>{error || 'A results source is delayed.'} Last received: {receivedTimes}. Retrying automatically.</span><button onClick={refresh}>Retry</button></div>}

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-stickers">
          <div className="bumper">
            <h1 id="hero-title">Tired of <em>winning?</em></h1>
            <p className="bumper-tag"><span aria-hidden="true">★★★</span> Make winning exhausting again</p>
          </div>
          <LevelSticker flips={flips.net} caption="Tonight · net flips, all offices"/>
        </div>
        <div className="hero-board">
          <div className="flip-total" role="img" aria-label={`Net flips so far across the Senate, House and governors: ${signedInt(flips.net)}. ${flips.gained} taken from the GOP, ${flips.lost} lost. This morning's odds implied about ${signedInt(Math.round(expectedNet))}.`}>
            <b aria-hidden="true">{signedInt(flips.net)}</b>
            <span aria-hidden="true"><strong>Net flips so far</strong><small>{flips.gained} taken from the GOP · {flips.lost} lost · this morning’s odds implied ≈ {signedInt(Math.round(expectedNet))}</small></span>
          </div>
          {votesIn && <p className="flip-pipeline"><b>Not called yet:</b> ahead in {leads.ahead} more GOP {leads.ahead === 1 ? 'seat' : 'seats'}, behind in {leads.behind} of ours. If every lead held: <b>{signedInt(ifLeadsHeld)}</b>, {fatigue(ifLeadsHeld).short.toLowerCase()}. Leads aren’t calls.</p>}
          <Ladder flips={flips.net}/>
          <div className="chamber-trio">{cards.map(spec => <ChamberCard key={spec.chamber} spec={spec} c={data.chambers[spec.chamber]} flips={tallies[spec.chamber]}/>)}</div>
          <p className="hero-sub">{calls.length ? `${calls.length} races called so far (${senateCalls} Senate). A flip counts only once it’s called.` : 'No calls yet. Hydrate, pace yourself, and don’t declare victory at 2 a.m.'} Flips = GOP-held seats our side takes, minus our seats lost.</p>
          {!votesIn && <p className="hero-todo">While we wait: <button onClick={() => goTo('races')}>make your picks</button>, <button onClick={() => goTo('whatif')}>rig a hypothetical (legally)</button>, or <button onClick={() => setChatOpen(true)}>say hi in the chat</button>.</p>}
        </div>
      </section>


      <section className="board" aria-label="Model versus market scorecard">
        <div className="scorecard">
          <p className="eyebrow">Model vs. market</p>
          <p className="scorecard-line">{scoreLine}</p>
          <p className="scorecard-detail">{data.score.n ? <>Average error, lower is better: model <b>{data.score.forecast!.toFixed(3)}</b> · market <b>{data.score.market!.toFixed(3)}</b>, across {data.score.n} called Senate {data.score.n === 1 ? 'race' : 'races'}.</> : 'As races are called, we score this morning’s model (Split Ticket) against the market (Polymarket).'}</p>
          {calls.length > 0 && <p className="scorecard-detail">Our side has won <b>{wins.length}</b> of {calls.length} called races; this morning’s odds expected <b>{calls.reduce((s, r) => s + (chance(r) ?? 0), 0).toFixed(1)}</b>.</p>}
        </div>
      </section>

      <section className="races" id="races" aria-labelledby="races-title">
        <div className="section-head">
          <p className="eyebrow">{order === 'closing' ? 'In poll-closing order · Eastern time' : order === 'live' ? 'What’s happening now · live count' : activeOrder.label}</p>
          <h2 id="races-title">{order === 'closing' ? 'When to panic, in order.' : order === 'live' ? 'Where it’s getting weird.' : 'Races to obsess over.'}</h2>
        </div>
        <div className="race-controls" id="race-controls">
          <Segmented label="Chamber" value={chamber} options={[['Senate', 'Senate'], ['House', 'House'], ['Governor', 'Gov']]} onChange={c => { setChamber(c); setOpenId(null); setLimit(LIST_LIMIT); }}/>
          <Segmented label="Which races" value={scope} options={[['contested', `Contested · ${contestedCount}`], ['all', `All ${inChamber.length}`]]} onChange={v => { setScope(v); setLimit(LIST_LIMIT); }}/>
          <label className="race-sort"><span>Sort by</span><select aria-label="Sort races" aria-describedby="race-order-note" value={order} onChange={e => { setOrder(e.target.value as RaceOrder); setLimit(LIST_LIMIT); }}>{raceOrders.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
          <label className="search-field"><Search size={16} aria-hidden="true"/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a candidate, state, or district" aria-label="Search races"/>{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={15}/></button>}</label>
        </div>
        {votesIn && bucketCounts.length > 0 && <div className="bucket-chips" role="group" aria-label="Jump to a live status group">{bucketCounts.map(g => <button key={g.id} type="button" className={`bucket-chip chip-${g.id}`} onClick={() => { setOrder('live'); goTo(`bucket-${g.id}`); }}><b>{g.items.length}</b> {(g.items.length === 1 ? g.one : g.title).toLowerCase()}</button>)}</div>}
        <details className="read-me"><summary>How to read this</summary>
        <p className="legend"><b>Win % = chance of winning, not vote share.</b> Both are for the listed Democrat or independent. <b>Model:</b> Split Ticket (no governor model). <b>Market:</b> Polymarket, frozen at 8 a.m. ET. <b>Live count:</b> vote margin so far.</p>
        <p className="sort-note" id="race-order-note" role="status">{activeOrder.note}{q ? ' Search covers every race.' : scope === 'contested' ? ` Contested: ${CONTESTED_BAND * 100}–${100 - CONTESTED_BAND * 100}% odds, within ${LIVE_CLOSE_PTS} points, or an upset in progress.` : ''}{order === 'gap' && !shown.some(r => r.market) && ' No market odds are available for these races.'}</p>
        </details>
        {order === 'live' ? bucketGroups.map(g => {
          const expanded = openGroups.has(`${chamber}:${g.id}`) || g.items.some(r => r.id === openId);
          const items = expanded ? g.items : g.items.slice(0, groupCap);
          return <div className={`close-group bucket-group group-${g.id}`} id={`bucket-${g.id}`} key={g.id}>
          <div className="close-head"><h3>{g.items.length === 1 ? g.one : g.title}</h3><span className="close-status">{g.note}</span><span className="close-count">{g.items.length} {g.items.length === 1 ? 'race' : 'races'}</span></div>
          <div className="race-list">{items.map(r => <RaceRow key={r.id} race={r} open={openId === r.id} onToggle={() => toggle(r.id)} now={now} forecastUrl={data.baseline.forecastUrl} fresh={freshCalls.has(r.id)}/>)}</div>
          {items.length < g.items.length && <button className="show-all group-more" onClick={() => setOpenGroups(new Set(openGroups).add(`${chamber}:${g.id}`))}>Show all {g.items.length} · {g.title.toLowerCase()}</button>}
        </div>; }) : order !== 'closing' ? <div className="race-list">{visible.map(r => <RaceRow key={r.id} race={r} open={openId === r.id} onToggle={() => toggle(r.id)} now={now} forecastUrl={data.baseline.forecastUrl} fresh={freshCalls.has(r.id)}/>)}</div> : groups.map(g => {
          const at = Date.parse(g.at);
          const closed = g.at !== 'unknown' && now >= at;
          const restOpen = closed && g.items.some(r => { const rest = closeFor(r.state)?.rest; return rest && now < Date.parse(rest); });
          return <div className={`close-group${g.at === nextAt ? ' is-next' : ''}${closed ? ' is-closed' : ''}`} id={`close-${at}`} key={g.at}>
            <div className="close-head"><h3>{g.at === 'unknown' ? 'Time unavailable' : etTime(g.at)}</h3><span className="close-status">{g.at === 'unknown' ? '' : closed ? (restOpen ? 'Most polls closed' : 'Polls closed') : g.at === nextAt ? `Next up · polls close ${relative(at - now)}` : `Polls close ${relative(at - now)}`}</span><span className="close-count">{g.items.length} {g.items.length === 1 ? 'race' : 'races'}</span></div>
            <div className="race-list">{g.items.map(r => <RaceRow key={r.id} race={r} open={openId === r.id} onToggle={() => toggle(r.id)} now={now} forecastUrl={data.baseline.forecastUrl} fresh={freshCalls.has(r.id)}/>)}</div>
          </div>;
        })}
        {!shown.length && <div className="empty-state"><Flag size={24} aria-hidden="true"/><h3>No matching races.</h3><p>Try a surname, a state like “Ohio,” or a district like “CA-22.”</p><button className="text-button" onClick={() => setQuery('')}>Clear the search</button></div>}
        {order !== 'live' && shown.length > visible.length && <button className="show-all" onClick={() => setLimit(Infinity)}>Show {shown.length - visible.length} more {chamber === 'Governor' ? 'governor' : chamber} races</button>}
        {scope === 'contested' && !q && <button className="show-all" onClick={() => { setScope('all'); setLimit(LIST_LIMIT); }}>Show all {inChamber.length} {chamber === 'Governor' ? 'governor' : chamber} races, safe seats included</button>}
      </section>

      <section className="whatif" id="whatif" aria-labelledby="whatif-title">
        <div className="section-head">
          <p className="eyebrow scenario-flag"><SlidersHorizontal size={13} aria-hidden="true"/> Scenario mode · your assumptions, not results</p>
          <h2 id="whatif-title">What if?</h2>
          <p className="section-sub">Go ahead, find yourself 11,780 votes. Shift every race or flip a few; it’s arithmetic on this morning’s model, not a prediction.</p>
        </div>
        <div className="whatif-grid">
          <div className="whatif-result">
            <div className="whatif-seats"><strong aria-live="polite">{hypSenate}</strong><span>{includeI ? 'Democratic + independent' : 'Democratic-caucus'} Senate seats</span></div>
            <p className="whatif-flips" aria-live="polite">Net flips in this scenario: Senate <b>{signedInt(hypFlips.Senate)}</b> · House <b>{signedInt(hypFlips.House)}</b></p>
            <p className="whatif-house">House in this scenario: <b>{hypHouse} {includeI ? 'D + I' : 'D'}</b> (218 for control). Governors stay out of the what-if: there’s no model to shift.</p>
          </div>
          <div className="whatif-controls">
            <div className="slider-label"><label htmlFor="swing">Move every race</label><b>{swing === 0 ? 'No shift' : `${Math.abs(swing).toFixed(1)} pts toward ${swing > 0 ? 'D / I' : 'R'}`}</b></div>
            <input id="swing" type="range" min="-6" max="6" step=".5" value={swing} onChange={e => { setSwing(Number(e.target.value)); setOverrides({}); }}/>
            <div className="range-labels" aria-hidden="true"><span>R +6</span><span>D / I +6</span></div>
            <div className="scenario-actions"><button className="primary-button" onClick={() => previewSeats(59)}>Find me 59 seats <Star size={15}/></button><button className="text-button" onClick={() => { setSwing(0); setOverrides({}); setIncludeI(false); }}>Reset</button></div>
            <label className="checkbox-label"><input type="checkbox" checked={includeI} onChange={e => setIncludeI(e.target.checked)}/> Count independent challengers too <small>(no caucus assumed)</small></label>
            <div className="flip-head"><h3>Flip a race</h3><Segmented label="Races to flip" value={flipScope} options={[['contested', 'Contested'], ['all', 'All 35']]} onChange={setFlipScope}/></div>
            <div className="flip-list">{flipRaces.map(r => { const won = overrides[r.id] ?? (r.margin ?? -Infinity) + swing > 0; return <button key={r.id} aria-pressed={won} onClick={() => { if (r.party === 'I') setIncludeI(true); setOverrides({ ...overrides, [r.id]: !won }); }} aria-label={`${r.label}: ${r.candidate} ${won ? 'wins' : 'loses'} in this scenario`}><span className="flip-code">{r.state}</span><span className="flip-name">{r.candidate.split(' ').at(-1)}{r.party === 'I' && <small> (I)</small>}</span><span className={won ? 'flip-mark is-on' : 'flip-mark'}>{won ? <Check size={14}/> : <X size={14}/>}</span></button>; })}</div>
          </div>
        </div>
      </section>
    </main>

    <footer>
      <span className="footer-wordmark">Tired of Winning?<span>★</span></span>
      <p>Strong feelings, real sources, zero alternative facts. Forecast frozen this morning; live count checked every minute.</p>
      <p>We count visits anonymously to see how big the party got: a random browser ID, device type and the site that sent you. Counting uses no names, IP addresses or ad trackers, and Global Privacy Control turns it off. <button className="text-button" onClick={() => setBoardOpen(true)}>Open the soundboard</button></p>
      <div><a href={data.baseline.forecastUrl} target="_blank" rel="noreferrer">Split Ticket</a><a href="https://civicapi.org" target="_blank" rel="noreferrer">civicAPI</a><a href="https://polymarket.com" target="_blank" rel="noreferrer">Polymarket</a><a href={scheduleSource} target="_blank" rel="noreferrer">Poll times: The Hill</a><a href="https://zo.computer" target="_blank" rel="noreferrer">Built on Zo</a></div>
    </footer>

    <nav className="action-bar" aria-label="Quick actions">
      <button onClick={() => goTo('race-controls')}><Flag size={18} aria-hidden="true"/><span>Races</span></button>
      <button onClick={() => goTo('whatif')}><SlidersHorizontal size={18} aria-hidden="true"/><span>What if?</span></button>
      <button onClick={() => setMapOpen(true)} aria-haspopup="dialog"><MapIcon size={18} aria-hidden="true"/><span>Map</span></button>
      <button className="chat-button" onClick={() => { setFocusCommentId(undefined); setChatOpen(true); }} aria-haspopup="dialog"><MessageCircle size={18} aria-hidden="true"/><span>Chat</span>{party.messages > 0 && <b aria-label={`${party.messages} messages`}>{party.messages > 99 ? '99+' : party.messages}</b>}</button>
    </nav>

    <Sheet open={mapOpen} onClose={() => setMapOpen(false)} label="Election map" wide>
      <header className="sheet-head"><div><h2>The map</h2><p>Tap a state to jump to its races. No Sharpie edits.</p></div><button className="sheet-close" onClick={() => setMapOpen(false)} aria-label="Close the map"><X size={20}/></button></header>
      <Suspense fallback={<p className="sheet-loading">Unfolding the map…</p>}><ElectionMap races={data.races} onOpenState={openState}/></Suspense>
    </Sheet>
    <Sheet open={boardOpen} onClose={() => setBoardOpen(false)} label="The soundboard">
      <Soundboard onClose={() => setBoardOpen(false)}/>
    </Sheet>
    <SoundPromo hidden={Boolean(sound.toast)}/>
    <EventToast toast={sound.toast} onClose={sound.dismiss} onReplay={sound.replay}/>
    <TrumpMeme/>
    <Sheet open={chatOpen} onClose={() => setChatOpen(false)} label="The room: party chat">
      <PartyRoom onClose={() => { setChatOpen(false); setFocusCommentId(undefined); }} focusCommentId={focusCommentId}/>
    </Sheet>
  </div>;
}
