import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { BarChart3, Check, ChevronRight, Pause, Play, Search, Send, ShieldCheck, Trash2, X } from 'lucide-react';
import { chatContributed, play, sadFor, soundPrefs, unlockAudio } from '../lib/sound';
import { ChatPingRow } from './sound-ui';
import { emptyPartyRace, reactions, type PartyComment, type PartyState, type Pick } from '../lib/party';
import type { LiveRace } from '../lib/election';

type PartyContext = { data: PartyState | null; connectionError: string; send: (action: string, body: object) => Promise<void>; reconnect: () => Promise<void>; removedId: number | null; draft: string; setDraft: (text: string) => void; receipt: React.MutableRefObject<string> };
const Context = createContext<PartyContext | null>(null);
const useParty = () => useContext(Context)!;

export function PartyProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<PartyState | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const [removedId, setRemovedId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const receipt = useRef('');
  const pending = useRef(0);
  const generation = useRef(0);
  const reading = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const newest = useRef<number | null>(null);
  const lastPing = useRef(0);
  const rejoinTried = useRef(false);
  async function request(action = '', body?: object) {
    const response = await fetch('/api/party' + (action ? '/' + action : ''), { method: action ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', ...(action ? { 'Content-Type': 'application/json', 'X-Party-Request': '1' } : {}) }, body: action ? JSON.stringify(body ?? {}) : undefined, signal: AbortSignal.timeout(10_000) });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || 'The party room could not be reached. Try again.');
    if (!Array.isArray(json.comments) || !json.races || !Number.isFinite(json.closesAt)) throw new Error('The party room sent an unreadable update.');
    return json as PartyState;
  }
  function accept(next: PartyState) {
    const top = next.comments.reduce((max, c) => Math.max(max, c.id), 0);
    const seen = newest.current;
    if (seen !== null && top > seen && next.comments.some(c => c.id > seen && !c.mine) && soundPrefs().chat === 'on' && Date.now() - lastPing.current > 2500) {
      lastPing.current = Date.now();
      void play('ping');
    }
    if (seen === null || top > seen) newest.current = top;
    setData(next); setConnectionError('');
  }
  async function reconnect() {
    if (reading.current || pending.current) return;
    reading.current = true;
    const version = generation.current;
    try {
      let next = await request();
      if (!next.me && !next.closed) {
        await request('session', {});
        next = await request();
        if (!next.me) throw new Error('Enable cookies for this site to keep your handle, then reconnect.');
      }
      if (!pending.current && version === generation.current) accept(next);
    } catch (e) { setConnectionError(e instanceof Error ? e.message : 'Connection lost. Reconnect to the party.'); }
    finally { reading.current = false; }
  }
  async function poll() {
    if (reading.current || pending.current || document.visibilityState !== 'visible') return;
    reading.current = true;
    const version = generation.current;
    let rejoin = false;
    try {
      const next = await request();
      if (!pending.current && version === generation.current) accept(next);
      if (next.me) rejoinTried.current = false;
      else if (!next.closed && !rejoinTried.current) rejoin = rejoinTried.current = true;
    }
    catch { setConnectionError('Party updates paused. Showing the last update; reconnecting every 5 seconds.'); }
    finally { reading.current = false; }
    if (rejoin) void reconnect();
  }
  function send(action: string, body: object) {
    pending.current++; generation.current++;
    const job = queue.current.then(async () => {
      try {
        accept(await request(action, body));
        if (action === 'moderate-comment') { const change = body as { id: number; removed: boolean }; setRemovedId(change.removed ? change.id : null); }
        if (action === 'host-logout') setRemovedId(null);
      }
      catch (e) { throw new Error(e instanceof Error ? e.message : 'That did not go through. Try again.'); }
      finally { pending.current--; }
    });
    queue.current = job.catch(() => {});
    return job;
  }
  useEffect(() => {
    void reconnect();
    const timer = setInterval(() => { void poll(); }, 5000);
    const visible = () => { if (document.visibilityState === 'visible') void poll(); };
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, []);
  return <Context.Provider value={{ data, connectionError, send, reconnect, removedId, draft, setDraft, receipt }}>{children}</Context.Provider>;
}

export function PartyBanner({ onOpen }: { onOpen: (id?: number) => void }) {
  const { data, connectionError, send, removedId } = useParty();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [held, setHeld] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const comments = data?.comments.slice(0, 20) ?? [];
  const current = comments[index % Math.max(1, comments.length)];
  useEffect(() => {
    if (paused || held || connectionError || comments.length < 2) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') setIndex(i => i + 1); }, 8000);
    return () => clearInterval(timer);
  }, [paused, held, connectionError, comments.length]);
  async function moderate(id: number, removed: boolean) {
    setBusy(true); setError('');
    try { await send('moderate-comment', { id, removed }); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="party-banner" aria-label="From the group chat" onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)} onFocusCapture={() => setHeld(true)} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget)) setHeld(false); }}>
    <button className="party-banner-message" onClick={() => onOpen(connectionError ? undefined : current?.id)} aria-label={connectionError ? 'Chat reconnecting. Open the room.' : current ? `Open comment by @${current.handle}: ${current.body}` : 'Open the group chat'}>
      <span className="party-banner-label">Group chat</span>
      <span className="party-banner-copy">{connectionError ? <span>Reconnecting to the room…</span> : current ? <><b>@{current.handle}</b><span>{current.body}</span></> : <span>{data?.closed ? 'The room is read-only. Take a look.' : 'Say hi. Unlike Truth Social, people read this →'}</span>}</span>
    </button>
    {comments.length > 1 && !connectionError && <><button className="party-banner-control" aria-label={paused ? 'Resume comment rotation' : 'Pause comment rotation'} aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? <Play size={15}/> : <Pause size={15}/>}</button><button className="party-banner-control" aria-label="Next comment" onClick={() => setIndex(i => i + 1)}><ChevronRight size={18}/></button></>}
    {data?.isHost && current && !connectionError && <button className="party-banner-control" disabled={busy} aria-label="Remove displayed comment" onClick={() => void moderate(current.id, true)}><Trash2 size={16}/></button>}
    {data?.isHost && removedId && <button className="party-banner-undo" disabled={busy} onClick={() => void moderate(removedId, false)}>Undo removal</button>}
    {error && <p className="party-banner-error" role="alert">{error}</p>}
  </section>;
}

export function usePartySummary() {
  const { data, connectionError } = useParty();
  return { messages: data?.comments.length ?? 0, online: data?.online ?? 0, closed: Boolean(data?.closed), paused: Boolean(connectionError), latest: data?.comments[0] ?? null };
}

function useRaceActions(race: LiveRace) {
  const { data, connectionError, send, reconnect } = useParty();
  const stats = data?.races[race.id] ?? emptyPartyRace();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const disabled = pending || !data?.me || data.closed || Boolean(connectionError);
  async function act(action: string, body: object, onSuccess?: () => void) {
    setPending(true); setError('');
    try { await send(action, { race: race.id, ...body }); onSuccess?.(); }
    catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  }
  return { data, stats, disabled, error, act, connectionError, reconnect };
}

export function RaceReactions({ race }: { race: LiveRace }) {
  const { data, stats, disabled, error, act, connectionError, reconnect } = useRaceActions(race);
  return <div className="race-social" aria-label={`Room reactions for ${race.label}`}>
    <div className="reaction-row">{reactions.map(r => <button key={r.emoji} disabled={disabled} aria-label={`${r.label} for ${race.label}`} aria-pressed={stats.myReaction === r.emoji} title={r.label} onClick={() => { const adding = stats.myReaction !== r.emoji; if (adding && soundPrefs().effects) unlockAudio(); void act('reaction', { emoji: adding ? r.emoji : null }, adding ? () => sadFor('reaction') : undefined); }}><span aria-hidden="true">{r.emoji}</span><b>{stats.reactions[r.emoji] ?? 0}</b></button>)}</div>
    {data?.closed && <p className="party-inline-note">The room is read-only now.</p>}
    {connectionError && <p className="party-inline-error">Reactions paused. <button onClick={() => void reconnect()}>Reconnect</button></p>}
    {error && <p className="party-inline-error" role="alert">{error}</p>}
  </div>;
}

export function RacePicks({ race }: { race: LiveRace }) {
  const { stats, disabled, error, act } = useRaceActions(race);
  const options: [Pick, string][] = [['candidate', race.candidate], ['opponent', race.opponent], ['other', 'Someone else']];
  return <div className="crowd-picks"><h4>Who’s your pick? <span>{stats.totalPicks} {stats.totalPicks === 1 ? 'vote' : 'votes'}</span></h4><p>One pick per browser. Tap again to clear it, or choose someone else. The room’s mood, not a forecast.</p>{options.filter(([, name]) => name !== 'Not Contested').map(([choice, name]) => <button key={choice} disabled={disabled} aria-pressed={stats.myPick === choice} onClick={() => void act('pick', { choice: stats.myPick === choice ? null : choice })}><span className="crowd-fill" style={{ width: `${stats.totalPicks ? stats.picks[choice] / stats.totalPicks * 100 : 0}%` }}/><span className="crowd-choice">{stats.myPick === choice && <Check size={14}/>} {name}</span><b>{stats.totalPicks ? Math.round(stats.picks[choice] / stats.totalPicks * 100) + '%' : '—'}<small>{stats.picks[choice]} {stats.picks[choice] === 1 ? 'pick' : 'picks'}</small></b></button>)}{error && <p className="party-inline-error" role="alert">{error}</p>}</div>;
}

export function PartyRoom({ onClose, focusCommentId }: { onClose: () => void; focusCommentId?: number }) {
  const { data, connectionError, send, reconnect, removedId, draft, setDraft, receipt } = useParty();
  const [handle, setHandle] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [errorAction, setErrorAction] = useState('');
  const [busy, setBusy] = useState(false);
  const [hostKey, setHostKey] = useState('');
  const [search, setSearch] = useState('');
  const [before, setBefore] = useState<number | null>(null);
  const [found, setFound] = useState<{ comments: PartyComment[]; hasOlder: boolean } | null>(null);
  const [searchError, setSearchError] = useState('');
  const [searching, setSearching] = useState(false);
  useEffect(() => { if (data?.me) setHandle(data.me.handle); }, [data?.me?.handle]);
  useEffect(() => {
    if (!focusCommentId) return;
    const timer = setTimeout(() => document.getElementById(`comment-${focusCommentId}`)?.scrollIntoView({ block: 'center' }), 100);
    return () => clearTimeout(timer);
  }, [focusCommentId, Boolean(data)]);
  const hostSearch = Boolean(data?.isHost && (search.trim() || before));
  useEffect(() => {
    if (!hostSearch) { setFound(null); setSearching(false); return; }
    const controller = new AbortController();
    setSearching(true); setSearchError('');
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: search.trim().replace(/^@/, '') });
        if (before) params.set('before', String(before));
        const r = await fetch('/api/party/host-comments?' + params, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || 'Comment search is unavailable.');
        if (!controller.signal.aborted) setFound(body);
      } catch (e) { if (!controller.signal.aborted) setSearchError((e as Error).message); }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [hostSearch, search, before, data?.serverTime]);
  const disabled = busy || !data?.me || data.closed || Boolean(connectionError);
  async function act(action: string, body: object, onSuccess?: () => void) {
    setBusy(true); setError(''); setNotice(''); setErrorAction(action);
    try { await send(action, body); onSuccess?.(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const isGuest = Boolean(data?.me?.handle.startsWith('guest_'));
  const closing = data ? new Date(data.closesAt).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' }) + ' ET' : '';
  const comments = hostSearch ? found?.comments ?? [] : data?.comments ?? [];
  const hasOlder = hostSearch ? found?.hasOlder : data?.hasOlder;
  const identity = <div className={`party-identity${isGuest ? ' is-guest' : ''}`}><form onSubmit={e => { e.preventDefault(); void act('handle', { handle }, () => setNotice('Handle saved. You’re on the guest list.')); }}><label htmlFor="party-handle">Your handle</label>{isGuest && <p className="party-hint">He nicknames everyone. Tonight, you pick your own.</p>}<div className="handle-field"><span>@</span><input id="party-handle" autoComplete="nickname" spellCheck={false} maxLength={24} value={handle} onChange={e => setHandle(e.target.value)} disabled={disabled} placeholder="your_handle"/><button disabled={disabled || handle === data?.me?.handle} type="submit">Save</button></div></form>{error && errorAction === 'handle' && <p className="party-inline-error" role="alert">{error}</p>}<p className="party-identity-note">No account needed. This browser is your name tag. Posts are public and may appear in the top banner.{data?.closed ? ' Posting has closed.' : closing ? ` Posting closes ${closing}.` : ''}</p></div>;
  return <section className="party-page" aria-labelledby="party-title">
    <header className="sheet-head"><div><h2 id="party-title">The group chat</h2><p><i className={connectionError || data?.closed ? 'is-paused' : ''}/>{data?.closed ? 'Read-only · the takes live on' : connectionError ? 'Reconnecting…' : data ? `${data.online} browsers here · updates every 5s` : 'Opening the room…'}</p></div><button className="sheet-close" onClick={onClose} aria-label="Close the room"><X size={20}/></button></header>
    {(connectionError || !data) && <div className="party-connection" role="status"><p>{connectionError || 'Finding your seat…'}</p>{connectionError && <button onClick={() => void reconnect()}>Reconnect</button>}</div>}
    {isGuest && identity}
    <form className="party-composer" onSubmit={e => { e.preventDefault(); if (soundPrefs().chat !== 'off') unlockAudio(); if (!receipt.current) receipt.current = crypto.randomUUID(); void act('comment', { body: draft, requestId: receipt.current }, () => { setDraft(''); receipt.current = ''; chatContributed(); sadFor('comment'); setNotice('Posted.'); }); }}><label htmlFor="party-message">What’s the room saying?</label><textarea id="party-message" rows={2} maxLength={500} placeholder="A measured take, or ALL CAPS about Ohio. Covfefe welcome." value={draft} disabled={disabled} onChange={e => { setDraft(e.target.value); receipt.current = ''; }}/><div className="party-compose-foot"><span>{draft.length}/500 · public</span><button type="submit" className="primary-button" disabled={disabled || !draft.trim()}>{busy && errorAction === 'comment' ? 'Sending…' : 'Post to the room'}<Send size={15}/></button></div></form>
    {error && errorAction !== 'handle' && <p className="party-inline-error" role="alert">{error}</p>}<p className="party-feedback" role="status">{notice}</p>
    <ChatPingRow/>
    {!isGuest && identity}
    <details className="host-controls" open={data?.isHost || undefined}>
      <summary><ShieldCheck size={16}/>{data?.isHost ? 'Host controls unlocked' : 'Host controls'}</summary>
      {data?.isHost ? <div className="host-tools"><HostStats/><p>Remove a comment here or from the banner. It disappears for connected guests on their next refresh, within 5 seconds.</p><button disabled={busy} onClick={() => void act('host-logout', {}, () => { setSearch(''); setBefore(null); setNotice('Host controls locked.'); })}>Lock host controls</button></div> : <form onSubmit={e => { e.preventDefault(); void act('host-login', { key: hostKey }, () => { setHostKey(''); setNotice('Host controls unlocked on this browser.'); }); }}><label htmlFor="host-key">Private host key</label><div className="handle-field"><input id="host-key" type="password" autoComplete="current-password" value={hostKey} onChange={e => setHostKey(e.target.value)} disabled={busy}/><button type="submit" disabled={busy || !hostKey.trim()}>Unlock</button></div><p>For the party host. Guests don’t need a key.</p></form>}
    </details>
    {data?.isHost && <><label className="search-field host-search"><Search size={16}/><input aria-label="Find a comment or handle" value={search} onChange={e => { setSearch(e.target.value); setBefore(null); setFound(null); }} placeholder="Find a comment or @handle"/>{(search || before) && <button aria-label="Clear comment search" onClick={() => { setSearch(''); setBefore(null); }}><X size={16}/></button>}</label>{removedId && <div className="host-undo" role="status"><span>Comment removed from the room and banner.</span><button disabled={busy} onClick={() => void act('moderate-comment', { id: removedId, removed: false }, () => setNotice('Comment restored.'))}>Undo removal</button></div>}</>}
    <div className="party-message-heading"><span>{hostSearch ? 'Search results' : 'Latest'}</span><span>{searching ? 'Searching…' : `${comments.length} messages${hasOlder ? ' · more available' : ''}`}</span></div>
    {searchError && <p className="party-inline-error" role="alert">{searchError}</p>}
    {!comments.length ? <div className="party-empty"><h3>{hostSearch ? 'No matching comments.' : 'The group chat is suspiciously quiet.'}</h3><p>{hostSearch ? 'Try a handle or a few words from the comment.' : data?.closed ? 'This room closed without any messages.' : 'Someone has to overanalyze the first precinct. Many people are saying it should be you.'}</p></div> : <ol className="party-messages">{comments.map(comment => <li key={comment.id} id={`comment-${comment.id}`} className={focusCommentId === comment.id ? 'is-highlighted' : ''}><div className="party-avatar" aria-hidden="true">{comment.handle.slice(0, 1).toUpperCase()}</div><div className="party-message-content"><div className="party-message-meta"><b>@{comment.handle}</b>{comment.mine && <span>YOU</span>}<time dateTime={new Date(comment.at).toISOString()}>{new Date(comment.at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })}</time>{(comment.mine || data?.isHost) && <button disabled={busy || Boolean(connectionError) || searching} aria-label={data?.isHost ? `Remove comment by @${comment.handle}: ${comment.body.slice(0, 30)}` : `Remove your message: ${comment.body.slice(0, 30)}`} onClick={() => void act(data?.isHost ? 'moderate-comment' : 'remove-comment', data?.isHost ? { id: comment.id, removed: true } : { id: comment.id }, () => { setFound(f => f ? { ...f, comments: f.comments.filter(c => c.id !== comment.id) } : null); setNotice('Comment removed from the room and banner.'); })}><Trash2 size={16}/></button>}</div><p>{comment.body}</p></div></li>)}</ol>}
    {data?.isHost && hasOlder && comments.length > 0 && <button className="show-all" disabled={searching} onClick={() => setBefore(comments.at(-1)!.id)}>Older comments</button>}
  </section>;
}

type Stats = { traffic: { visitors: number; views: number; liveNow: number; peak: { visitors: number; at: number | null }; hours: { at: number; visitors: number }[]; devices: Record<string, number>; sources: { via: string; visitors: number }[]; soundOn: number; chatOpens: number; since: number | null } | null; room: { guests: number; named: number; commenters: number; comments: number; removed: number; reactions: number; picks: number } };
const etClock = (at: number) => new Date(at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
const sourceName = (via: string) => via === '(direct)' ? 'Direct or text link' : via.startsWith('via:') ? `Link tagged “${via.slice(4)}”` : via;

function HostStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const r = await fetch('/api/party/host-stats', { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || 'Stats are unavailable.');
        if (live) { setStats(body); setError(''); }
      } catch (e) { if (live) setError((e as Error).message); }
    }
    void load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  if (error) return <p className="party-inline-error" role="alert">{error}</p>;
  if (!stats) return <p className="host-stats-loading">Counting heads…</p>;
  const t = stats.traffic, room = stats.room;
  const maxHour = Math.max(1, ...(t?.hours.map(h => h.visitors) ?? [1]));
  return <div className="host-stats" aria-label="Tonight’s crowd, visible only to hosts">
    <h3><BarChart3 size={16} aria-hidden="true"/> Tonight’s crowd</h3>
    {t ? <>
      <dl className="host-stat-grid">
        <div><dt>Browsers</dt><dd>{t.visitors.toLocaleString()}</dd></div>
        <div><dt>Here now</dt><dd>{t.liveNow.toLocaleString()}</dd></div>
        <div><dt>Peak at once</dt><dd>{t.peak.visitors.toLocaleString()}{t.peak.at && <small>{etClock(t.peak.at)}</small>}</dd></div>
        <div><dt>Page loads</dt><dd>{t.views.toLocaleString()}</dd></div>
      </dl>
      {t.hours.length > 0 && <ol className="host-hours" aria-label="Browsers by hour, Eastern time">{t.hours.map(h => <li key={h.at}><span>{etClock(h.at)}</span><i style={{ width: `${h.visitors / maxHour * 100}%` }}/><b>{h.visitors}</b></li>)}</ol>}
      <p className="host-stat-line"><b>Devices:</b> {Object.entries(t.devices).map(([d, n]) => `${n} ${d}`).join(' · ') || 'none yet'}</p>
      <p className="host-stat-line"><b>Came from:</b> {t.sources.map(s => `${sourceName(s.via)} ${s.visitors}`).join(' · ') || 'none yet'}</p>
      <p className="host-stat-line"><b>Turned sound on:</b> {t.soundOn} · <b>Opened chat:</b> {t.chatOpens}</p>
    </> : <p className="host-stat-line">Visit counting is unavailable on this server.</p>}
    <p className="host-stat-line"><b>Room:</b> {room.named} named guests of {room.guests} · {room.commenters} posted · {room.comments} comments{room.removed ? ` (${room.removed} removed)` : ''} · {room.reactions} reactions · {room.picks} picks</p>
    <p className="host-stat-note">Unique browsers, not verified people. One person on two devices counts twice. Counting started {t?.since ? etClock(t.since) + ' ET' : 'with this release'}; updates every 30 seconds.</p>
  </div>;
}
