import { useSyncExternalStore } from 'react';
import { sadAllowed, type SadTrigger, type SoundId } from './sound-events';
import { track } from './telemetry';
import { STATIC } from './static';

/** effects: race-call and level sounds, on by default (V, Nov 3 ~10:30 PM); an explicit “off” persists per browser.
 *  chat: 'auto' until the guest posts, then 'on'; 'off' once muted in the chat.
 *  armed: audio is actually running. Browsers keep it locked until the first tap or key press on each visit. */
export type SoundPrefs = { effects: boolean; chat: 'auto' | 'on' | 'off'; armed: boolean };

const KEY = 'tow_sound_v2';
const listeners = new Set<() => void>();
let ctx: AudioContext | null = null;
let prefs: SoundPrefs = { effects: true, chat: 'auto', armed: false };
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null') ?? JSON.parse(localStorage.getItem('tow_sound_v1') || '{}');
  // v1 stored effects:false for everyone who never opted in, so only a v2 “off” counts as a choice.
  const off = localStorage.getItem(KEY) !== null && saved.effects === false;
  prefs = { effects: !off, chat: ['on', 'off'].includes(saved.chat) ? saved.chat : 'auto', armed: false };
} catch { /* private mode: defaults apply */ }

const log: { id: SoundId; at: number }[] = [];
(window as unknown as { __towSounds: typeof log }).__towSounds = log;

function update(next: Partial<SoundPrefs>) {
  prefs = { ...prefs, ...next };
  try { localStorage.setItem(KEY, JSON.stringify({ effects: prefs.effects, chat: prefs.chat })); } catch { /* not persisted */ }
  listeners.forEach(fn => fn());
}

let armedOnce = false;
function markRunning() {
  if (ctx?.state !== 'running') return;
  disarmGestures();
  if (!prefs.armed) {
    prefs = { ...prefs, armed: true };
    listeners.forEach(fn => fn());
  }
  if (!armedOnce && prefs.effects) { armedOnce = true; track('sound_on'); }
}

/** Must run inside a tap or key press: browsers only allow audio after a user gesture. */
export function unlockAudio() {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    if (!ctx) {
      ctx = new Ctor();
      // iOS suspends audio when the tab is backgrounded or a call comes in: show “Tap” again and re-arm.
      ctx.onstatechange = () => {
        if (ctx?.state === 'running') markRunning();
        else if (prefs.armed) { prefs = { ...prefs, armed: false }; listeners.forEach(fn => fn()); armGestures(); }
      };
    }
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'playback';
    void ctx.resume().then(markRunning, () => {});
    const silent = ctx.createBufferSource();
    silent.buffer = ctx.createBuffer(1, 1, 22050);
    silent.connect(ctx.destination);
    silent.start(0);
    markRunning();
    return true;
  } catch { return false; }
}

// Touch screens grant audio permission on pointerup/touchend/click, not pointerdown, so listen for all of them
// and keep listening until audio is actually running (a scroll is not a tap).
const gestureEvents = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;
function onGesture(event: Event) {
  if (!event.isTrusted) return;
  if ((event.target as Element | null)?.closest?.('[data-sound-toggle]')) return;
  if (prefs.effects || prefs.chat === 'on') unlockAudio();
}
let gesturesArmed = false;
function armGestures() {
  if (STATIC || gesturesArmed) return;
  gesturesArmed = true;
  gestureEvents.forEach(e => window.addEventListener(e, onGesture, { capture: true, passive: true }));
}
function disarmGestures() {
  if (!gesturesArmed) return;
  gesturesArmed = false;
  gestureEvents.forEach(e => window.removeEventListener(e, onGesture, { capture: true }));
}
armGestures();

export function setEffects(on: boolean) { if (on) unlockAudio(); update({ effects: on }); }
export function setChatPings(on: boolean) { if (on) unlockAudio(); update({ chat: on ? 'on' : 'off' }); }
/** Called when a guest posts: pings switch on automatically unless they muted them. */
export function chatContributed() { if (prefs.chat === 'auto') update({ chat: 'on' }); }

export function useSoundPrefs() {
  return useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => prefs);
}
export const soundPrefs = () => prefs;

const buffers = new Map<SoundId, Promise<AudioBuffer | null>>();
function buffer(id: SoundId) {
  if (!buffers.has(id)) buffers.set(id, fetch(`/sounds/${id}.mp3`).then(r => { if (!r.ok) throw new Error(); return r.arrayBuffer(); }).then(data => ctx!.decodeAudioData(data)).catch(() => { buffers.delete(id); return null; }));
  return buffers.get(id)!;
}

function tone(frequencies: number[], length: number, volume: number) {
  const start = ctx!.currentTime;
  frequencies.forEach((frequency, i) => {
    const osc = ctx!.createOscillator(), gain = ctx!.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, start + i * length * .45);
    gain.gain.setValueAtTime(0.0001, start + i * length * .45);
    gain.gain.exponentialRampToValueAtTime(volume, start + i * length * .45 + .01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + i * length * .45 + length);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(start + i * length * .45);
    osc.stop(start + i * length * .45 + length + .05);
  });
}

export type Clip = { id: SoundId; key: number };
const clipListeners = new Set<(clip: Clip) => void>();
let clips = 0;
/** Notifies the meme layer each time a Trump clip actually starts. */
export function onClip(fn: (clip: Clip) => void) { clipListeners.add(fn); return () => { clipListeners.delete(fn); }; }

let current: AudioBufferSourceNode | null = null;
/** Plays one sound, cutting off any clip still playing so calls never pile up.
 *  interrupt: false skips the sound instead when a clip is still playing (guest-action sounds never cut off a call). */
export async function play(id: SoundId, { interrupt = true }: { interrupt?: boolean } = {}) {
  if (STATIC || !ctx) return false;
  if (ctx.state !== 'running') await ctx.resume().catch(() => {});
  if (ctx.state !== 'running') return false;
  if (!interrupt && current) return false;
  log.push({ id, at: Date.now() });
  if (id === 'bell') { tone([988, 1319], .7, .25); return true; }
  if (id === 'ping') { tone([740, 988], .16, .12); return true; }
  const data = await buffer(id);
  if (!data) return false;
  try { current?.stop(); } catch { /* already ended */ }
  const source = ctx.createBufferSource(), gain = ctx.createGain();
  gain.gain.value = .9;
  source.buffer = data;
  source.connect(gain).connect(ctx.destination);
  source.onended = () => { if (current === source) current = null; };
  source.start();
  current = source;
  const clip = { id, key: ++clips };
  clipListeners.forEach(fn => fn(clip));
  return true;
}

let lastSad = 0;
/** “Sad.” after the guest's own emoji reaction or post, when sound is on (see sadAllowed). */
export function sadFor(trigger: SadTrigger) {
  const now = Date.now();
  if (!sadAllowed(prefs, trigger, lastSad, now)) return;
  lastSad = now;
  void play('sad', { interrupt: false });
}

export function preload(ids: SoundId[]) { if (ctx) ids.forEach(id => { if (id !== 'bell' && id !== 'ping') void buffer(id); }); }
