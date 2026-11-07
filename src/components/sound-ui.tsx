import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bell, BellOff, BellRing, Play, Volume2, VolumeX, X } from 'lucide-react';
import { winningTiers, type LiveRace } from '../lib/election';
import { nextClose } from '../lib/schedule';
import { callSnapshot, detectSoundEvents, levelSounds, memeCaption, pollsEvent, quotes, type CallSnapshot, type SoundEvent, type SoundId } from '../lib/sound-events';
import { onClip, play, preload, setChatPings, setEffects, unlockAudio, useSoundPrefs, type Clip as PlayedClip } from '../lib/sound';
import { track } from '../lib/telemetry';
import './sound-ui.css';

type Toast = { event: SoundEvent; more: number; heard: boolean; locked: boolean; id: number };
const kindLabel: Record<SoundEvent['kind'], string> = { win: 'Race called · source call', upset: 'Upset · source call', loss: 'Race called · source call', retraction: 'Call withdrawn by the source', level: 'New winning level', polls: 'Polls closed' };
const eventSounds: SoundId[] = ['wrong', 'youre-fired', 'sad', 'fake-news', ...levelSounds.slice(1)];

export function turnSoundOn(sample: SoundId = 'wrong') {
  setEffects(true);
  track('sound_on');
  preload(eventSounds);
  void play(sample);
}

/** Watches results updates and the poll-closing clock; plays one sound per update and shows what happened. */
export function useSoundEvents(races: LiveRace[] | null, flips: number | null, senateStates: string[]) {
  const prefs = useSoundPrefs();
  const previous = useRef<CallSnapshot | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const counter = useRef(0);
  const effects = useRef(prefs);
  effects.current = prefs;
  useEffect(() => { if (prefs.effects && prefs.armed) preload(eventSounds); }, [prefs.effects, prefs.armed]);
  function announce(events: SoundEvent[]) {
    if (!events.length) return;
    const heard = effects.current.effects && effects.current.armed;
    if (effects.current.effects) void play(events[0].sound);
    setToast({ event: events[0], more: events.length - 1, heard, locked: effects.current.effects && !effects.current.armed, id: ++counter.current });
  }
  useEffect(() => {
    if (!races || flips === null) return;
    announce(detectSoundEvents(previous.current, races, flips));
    previous.current = callSnapshot(races, flips);
  }, [races, flips]);
  useEffect(() => {
    if (!senateStates.length) return;
    let upcoming = nextClose(Date.now(), senateStates);
    const timer = setInterval(() => {
      if (!upcoming || Date.now() < Date.parse(upcoming.at)) return;
      if (Date.now() - Date.parse(upcoming.at) < 120_000) announce([pollsEvent(upcoming.states)]);
      upcoming = nextClose(Date.now(), senateStates);
    }, 1000);
    return () => clearInterval(timer);
  }, [senateStates.join()]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 9000);
    return () => clearTimeout(timer);
  }, [toast?.id]);
  return { toast, dismiss: () => setToast(null), replay: () => { if (toast) { turnSoundOn(toast.event.sound); setToast({ ...toast, heard: true }); } } };
}

export function EventToast({ toast, onClose, onReplay }: { toast: Toast | null; onClose: () => void; onReplay: () => void }) {
  return <div className="event-toast-region" role="status" aria-live="polite">{toast && <div className={`event-toast is-${toast.event.kind}`} key={toast.id}>
    <p className="event-toast-kind">{kindLabel[toast.event.kind]}{toast.more > 0 && <span> · +{toast.more} more</span>}</p>
    <p className="event-toast-title">{toast.event.title}</p>
    {toast.heard ? <p className="event-toast-quote"><Volume2 size={15} aria-hidden="true"/> {toast.event.kind === 'polls' ? 'Ding-ding.' : <>Trump: {toast.event.quote}</>}</p>
      : <button className="event-toast-cta" data-sound-toggle onClick={onReplay}><Volume2 size={15} aria-hidden="true"/> {toast.event.kind === 'polls' ? (toast.locked ? 'Tap to start sound for the calls' : 'Turn on sound for the calls') : <>{toast.locked ? 'Tap to hear Trump react' : 'Hear Trump react'}: {toast.event.quote}</>}</button>}
    <button className="event-toast-close" onClick={onClose} aria-label="Dismiss"><X size={16}/></button>
  </div>}</div>;
}

const MEME_SRC = '/images/trump-meme.webp';
const MEME_MS = 3600;
type MemeLayer = HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void };

/** Every Trump clip that plays sends his official portrait up the screen with the clip's words as a meme caption.
 *  A manual popover so it also rises above the open chat or soundboard sheet; decorative only (the toast or the guest's own tap carries the meaning). */
export function TrumpMeme() {
  const { effects } = useSoundPrefs();
  const [meme, setMeme] = useState<PlayedClip | null>(null);
  const layer = useRef<MemeLayer>(null);
  useEffect(() => onClip(clip => { if (memeCaption(clip.id)) setMeme(clip); }), []);
  useEffect(() => { if (effects) new Image().src = MEME_SRC; }, [effects]);
  useEffect(() => {
    const el = layer.current;
    if (el?.showPopover) {
      try {
        if (el.matches(':popover-open')) el.hidePopover?.();
        if (meme) el.showPopover();
      } catch { /* falls back to a fixed layer */ }
    }
    if (!meme) return;
    const timer = setTimeout(() => setMeme(null), MEME_MS);
    return () => clearTimeout(timer);
  }, [meme?.key]);
  const caption = meme ? memeCaption(meme.id) : null;
  const long = caption ? Math.max(caption.top.length, caption.bottom.length) > 16 : false;
  return <div ref={layer} popover="manual" className="trump-meme-layer" aria-hidden="true">
    {meme && caption && <figure key={meme.key} className={`trump-meme ${meme.key % 2 ? 'is-right' : 'is-left'}${long ? ' is-long' : ''}`} data-clip={meme.id}>
      <img src={MEME_SRC} alt="" width={196} height={196} decoding="async"/>
      <figcaption>{caption.top && <span>{caption.top}</span>}<span>{caption.bottom}</span></figcaption>
    </figure>}
  </div>;
}

export function SoundPin() {
  const { effects, armed } = useSoundPrefs();
  const waiting = effects && !armed;
  return <button type="button" data-sound-toggle className={`sound-pin${effects ? ' is-on' : ''}${waiting ? ' is-waiting' : ''}`} aria-pressed={effects && !waiting}
    aria-label={waiting ? 'Sound is on. Tap to start audio on this visit.' : effects ? 'Sound effects on. Turn off.' : 'Sound effects off. Turn on: race calls play Trump clips.'}
    onClick={() => { if (waiting) { unlockAudio(); return; } if (effects) { setEffects(false); track('sound_off'); } else turnSoundOn(); }}>
    {effects ? <Volume2 size={16} aria-hidden="true"/> : <VolumeX size={16} aria-hidden="true"/>}
    <small aria-hidden="true">Sound</small><b aria-hidden="true">{waiting ? 'Tap' : effects ? 'On' : 'Off'}</b>
  </button>;
}

/** Sound is on by default, but browsers hold audio until the first tap on each visit. A small fixed sticker above the
 *  action bar while it's locked (no layout shift when it goes); any tap anywhere unlocks it. Hidden while a call pop-up
 *  shows (that has its own tap-to-hear button). Guests who chose “off” never see it. */
export function SoundPromo({ hidden = false, onGo, cta }: { hidden?: boolean; onGo?: () => void; cta?: ReactNode }) {
  const { effects, armed } = useSoundPrefs();
  if (!effects || armed || hidden) return null;
  return <aside className="sound-sticker" aria-label="Sound is on; tap once to start it">
    <button className="sound-sticker-go" data-sound-toggle onClick={() => { unlockAudio(); if (onGo) onGo(); else void play('wrong'); }}>
      <Volume2 size={18} aria-hidden="true"/><span>{cta ?? <><b>Sound’s on.</b> Tap anywhere and he can hear you.</>}</span>
    </button>
    <button className="sound-sticker-quiet" data-sound-toggle onClick={() => { setEffects(false); track('sound_off'); }}>Keep it quiet</button>
  </aside>;
}

function Clip({ id, label, sub }: { id: SoundId; label: string; sub?: string }) {
  const [played, setPlayed] = useState(false);
  return <li className="board-row">
    <div className="board-event"><b>{label}</b>{sub && <small>{sub}</small>}</div>
    <button className="board-play" data-sound-toggle aria-label={`Play: ${quotes[id]}`} onClick={() => { unlockAudio(); void play(id); setPlayed(true); }}>
      <Play size={14} aria-hidden="true"/><span>{quotes[id]}</span>{played && <i className="sr-only">Played</i>}
    </button>
  </li>;
}

export function Soundboard({ onClose, locked = false }: { onClose: () => void; locked?: boolean }) {
  const { effects } = useSoundPrefs();
  return <section className="soundboard" aria-labelledby="soundboard-title">
    <header className="sheet-head"><div><h2 id="soundboard-title">The soundboard</h2><p>Every clip the page played on election night. Tap one to hear it.</p></div><button className="sheet-close" onClick={onClose} aria-label="Close the soundboard"><X size={20}/></button></header>
    <div className={`board-switch${effects ? ' is-on' : ''}`}>
      <div><b>{effects ? 'Sound effects are on' : 'Sound effects are off'}</b><small>{locked ? (effects ? 'The count is locked, so nothing plays on its own anymore. The buttons below still work.' : 'You turned it off. The buttons below still play.') : effects ? 'A late call still plays its clip until the page locks. Tap once per visit if your browser asks.' : 'You turned it off. Turn on to hear Trump react to late calls.'}</small></div>
      <button className={effects ? 'text-button' : 'primary-button'} data-sound-toggle onClick={() => { if (effects) { setEffects(false); track('sound_off'); } else turnSoundOn(); }}>{effects ? 'Turn off' : <><Volume2 size={16} aria-hidden="true"/> Turn on</>}</button>
    </div>
    <h3 className="board-heading">What made noise · tap to play</h3>
    <ol className="board-list">
      <Clip id="wrong" label="A Democrat or independent wins" sub="Senate and governor calls, contested House calls, and every House flip"/>
      <Clip id="youre-fired" label="Upset: our underdog wins" sub="Election-morning odds gave them under 50%"/>
      <Clip id="sad" label="A Republican wins"/>
      <Clip id="fake-news" label="The source withdraws a call"/>
      <Clip id="bell" label="Polls close somewhere"/>
      <Clip id="sad" label="A guest reacted or posted in the chat" sub="Only while their sound was on. Their fun made him sad."/>
    </ol>
    <h3 className="board-heading">Each new winning level (net flips, all offices)</h3>
    <ol className="board-list">{winningTiers.slice(1).map((tier, i) => <Clip key={tier.min} id={levelSounds[i + 1]} label={tier.short} sub={tier.range}/>)}</ol>
    <p className="board-fine">Calls came from civicAPI’s desk, checked every minute on election night; a lead never made noise. When several things happened in one update, you heard the biggest one and the pop-up said how many more. The clips are Trump’s own words, from his 2016 “tired of winning” campaign speech and other public remarks, via Myinstants, used here for parody. Each clip sends his official White House portrait (public domain) up the screen with the quote. Still quiet? Check your volume and silent switch.</p>
  </section>;
}

export function ChatPingRow() {
  const { chat } = useSoundPrefs();
  return <div className={`chat-ping-row is-${chat}`}>
    {chat === 'on' ? <BellRing size={16} aria-hidden="true"/> : chat === 'off' ? <BellOff size={16} aria-hidden="true"/> : <Bell size={16} aria-hidden="true"/>}
    <span>{chat === 'on' ? 'Chat pings on: a soft pop when someone else posts.' : chat === 'off' ? 'Chat pings muted.' : 'Post once and we’ll ping you when others reply.'}</span>
    <button data-sound-toggle onClick={() => setChatPings(chat !== 'on')}>{chat === 'on' ? 'Mute' : chat === 'off' ? 'Unmute' : 'Turn on now'}</button>
  </div>;
}
