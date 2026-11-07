// Staging-only check of event sounds, chat pings, visit counting and host stats.
// Results are intercepted synthetic copies of the real /api/election response; nothing is written to election.sqlite.
// Four clearly labeled REHEARSAL comments are posted to the staging party room; test reactions are cleared again.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '/root/agent-browser/node_modules/playwright-core/index.mjs';

const output = process.argv[2];
const base = 'http://localhost:51754';
if (!output?.startsWith('/')) throw new Error('Supply an absolute scratch evidence directory. Staging only.');
mkdirSync(output, { recursive: true });
const { key } = JSON.parse(readFileSync(new URL('../data/party-host-key.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--autoplay-policy=user-gesture-required'] });
const checks = [], errors = [], beacons = [];
const check = (name, pass) => { checks.push({ name, pass: Boolean(pass) }); assert.ok(pass, name); };
let stage = 'baseline';
// Real results now exist, so every live call is cleared first; stages then add synthetic calls. Levels count net flips (5 = Winning).
function mutate(body) {
  for (const r of body.races) r.result = { ...r.result, status: r.result.status === 'unavailable' ? 'unavailable' : 'waiting', winner: null, votes: 0, margin: null };
  const ga = body.races.find(r => r.chamber === 'Senate' && r.state === 'GA');
  const nc = body.races.find(r => r.chamber === 'Senate' && r.state === 'NC');
  const pickups = body.races.filter(r => r.chamber === 'Senate' && r.held === 'R' && r !== nc && r.result.status === 'waiting').slice(0, 4);
  const win = r => { r.result = { ...r.result, status: 'won', winner: r.candidate, votes: 100, margin: 4 }; };
  if (['call', 'level', 'loss'].includes(stage)) win(ga);
  if (['level', 'loss'].includes(stage)) pickups.forEach(win);
  if (stage === 'level') win(nc);
  if (stage === 'loss') nc.result = { ...nc.result, status: 'lost', winner: nc.opponent, votes: 100, margin: -2 };
  return body;
}
async function page(width, height, reducedMotion = 'no-preference') {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion });
  const p = await context.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.route('**/api/election', async route => { const response = await route.fetch(); route.fulfill({ response, json: mutate(await response.json()) }); });
  await p.route('**/api/t', async route => { beacons.push(JSON.parse(route.request().postData())); await route.fulfill({ status: 204 }); });
  return p;
}
const sounds = p => p.evaluate(() => window.__towSounds.map(s => s.id));
const refresh = async p => { await p.locator('.live-pin').click(); await p.waitForFunction(() => !document.querySelector('.live-pin[aria-busy=true]')); };
const toastText = p => p.locator('.event-toast').textContent();
const tag = String(Date.now()).slice(-8);
const meme = p => p.evaluate(() => { const layer = document.querySelector('.trump-meme-layer'); const card = layer?.querySelector('.trump-meme'); return { open: Boolean(layer?.matches(':popover-open')), clip: card?.dataset.clip ?? null, caption: card?.querySelector('figcaption')?.textContent ?? '', animation: card ? getComputedStyle(card).animationName : '' }; });
const sadCount = async p => (await sounds(p)).filter(id => id === 'sad').length;

try {
  const a = await page(390, 844);
  await a.goto(base + '/?via=qr');
  await a.waitForSelector('.hero');
  check('sound starts on, waiting for a first tap', (await a.locator('.sound-pin').getAttribute('aria-pressed')) === 'false' && (await a.locator('.sound-pin b').textContent()) === 'Tap');
  check('tap-to-start sticker is visible while audio is locked', await a.locator('.sound-sticker').isVisible() && (await a.locator('.sound-sticker').textContent()).includes('Tap anywhere'));
  await a.waitForTimeout(400);
  check('page load counted with QR tag, no handle', beacons.some(b => b.kind === 'view' && b.via === 'via:qr' && /^[a-f0-9]{32}$/.test(b.visitor) && Object.keys(b).length === 4));
  await a.screenshot({ path: output + '/390-sound-offer.png', fullPage: false });
  await a.locator('.sound-sticker').scrollIntoViewIfNeeded();
  await a.screenshot({ path: output + '/390-sound-offer-card.png' });

  stage = 'call';
  // A script click is not a user gesture, so audio stays locked: the toast must offer the tap.
  await a.evaluate(() => document.querySelector('.live-pin').click());
  await a.waitForFunction(() => !document.querySelector('.live-pin[aria-busy=true]'));
  await a.locator('.event-toast').waitFor();
  check('call toast appears while audio is still locked', (await toastText(a)).includes('Ossoff (D) wins Georgia Senate'));
  check('locked toast invites a tap to hear it', await a.locator('.event-toast-cta').isVisible() && (await a.locator('.event-toast-cta').textContent()).includes('Tap to hear Trump react'));
  check('no audio played before a tap', (await sounds(a)).length === 0);
  await a.screenshot({ path: output + '/390-toast-sound-off.png' });
  await a.locator('.event-toast-cta').click();
  await a.waitForFunction(() => window.__towSounds.length > 0);
  check('toast tap starts audio and plays the event clip', (await sounds(a)).at(-1) === 'wrong' && (await a.locator('.sound-pin b').textContent()) === 'On');
  check('sound_on counted', beacons.some(b => b.kind === 'sound_on'));
  check('tap-to-start sticker disappears once audio runs', !(await a.locator('.sound-sticker').count()));

  stage = 'level'; await refresh(a);
  await a.waitForFunction(() => window.__towSounds.at(-1)?.id === 'win-so-much');
  check('crossing 5 net flips plays the first line of the speech', (await toastText(a)).includes('New level: Winning'));
  check('toast names Trump’s quote when heard', (await toastText(a)).includes('We’re going to win so much'));
  await a.screenshot({ path: output + '/390-toast-level.png' });

  stage = 'loss'; await refresh(a);
  await a.waitForFunction(() => window.__towSounds.at(-1)?.id === 'sad');
  check('Republican call plays “Sad.”', (await toastText(a)).includes('wins North Carolina Senate'));
  const before = (await sounds(a)).length;
  await refresh(a);
  check('an unchanged update stays quiet', (await sounds(a)).length === before);

  await a.locator('.sound-pin').click();
  check('pin turns sound off', (await a.locator('.sound-pin b').textContent()) === 'Off');
  await a.reload(); await a.waitForSelector('.hero');
  check('off survives a reload', (await a.locator('.sound-pin b').textContent()) === 'Off');
  check('a guest who chose off sees no sound sticker', !(await a.locator('.sound-sticker').count()));
  await a.getByRole('button', { name: 'Open the soundboard' }).click();
  await a.locator('dialog[open] .soundboard').waitFor();
  check('soundboard lists event, guest-action and level clips', (await a.locator('.board-play').count()) === 12);
  await a.locator('.board-play').first().click();
  await a.waitForFunction(() => window.__towSounds.length > 0);
  check('preview plays even while effects are off', (await sounds(a))[0] === 'wrong' && (await a.locator('.sound-pin b').textContent()) === 'Off');
  await a.screenshot({ path: output + '/390-soundboard.png' });
  await a.locator('.board-switch .primary-button').click();
  check('soundboard switch turns sound on', (await a.locator('.sound-pin b').textContent()) === 'On');
  await a.keyboard.press('Escape');
  await a.reload(); await a.waitForSelector('.hero');
  check('on survives reload but waits for a tap', (await a.locator('.sound-pin b').textContent()) === 'Tap');
  await a.locator('.sound-pin').click();
  check('tapping the pin arms audio without turning it off', (await a.locator('.sound-pin b').textContent()) === 'On');

  // “Sad.” for the guest's own emoji reaction, with the rising meme.
  await a.getByLabel('Search races').fill('Talarico');
  const tx = a.locator('#race-senate-tx');
  await tx.getByRole('button', { name: /^On fire for/ }).waitFor();
  await a.waitForFunction(() => !document.querySelector('#race-senate-tx .reaction-row button')?.disabled);
  let sads = await sadCount(a);
  await tx.getByRole('button', { name: /^On fire for/ }).click();
  await a.waitForFunction(n => window.__towSounds.filter(s => s.id === 'sad').length > n, sads);
  const reacted = await meme(a);
  check('an emoji reaction with sound on plays “Sad.”', (await sadCount(a)) === sads + 1);
  check('the meme rises with the clip’s words', reacted.open && reacted.clip === 'sad' && reacted.caption === 'SAD.' && reacted.animation === 'meme-rise');
  await a.waitForTimeout(900);
  await a.screenshot({ path: output + '/390-meme-reaction.png' });
  await a.waitForTimeout(1400);
  sads = await sadCount(a);
  await tx.getByRole('button', { name: /^On fire for/ }).click();
  await a.waitForFunction(() => document.querySelector('#race-senate-tx .reaction-row button[title="On fire"]')?.getAttribute('aria-pressed') === 'false');
  await a.waitForTimeout(500);
  check('clearing your reaction stays quiet', (await sadCount(a)) === sads);
  await a.waitForTimeout(2100);
  await tx.getByRole('button', { name: /^Love it for/ }).click();
  await a.waitForFunction(n => window.__towSounds.filter(s => s.id === 'sad').length > n, sads);
  await a.waitForFunction(() => !document.querySelector('#race-senate-tx .reaction-row button')?.disabled);
  await tx.getByRole('button', { name: /^Watching for/ }).click();
  await a.waitForFunction(() => document.querySelector('#race-senate-tx .reaction-row button[title="Watching"]')?.getAttribute('aria-pressed') === 'true');
  await a.waitForTimeout(500);
  check('rapid reactions get one “Sad.” per cooldown', (await sadCount(a)) === sads + 1);
  await a.waitForFunction(() => !document.querySelector('#race-senate-tx .reaction-row button')?.disabled);
  await tx.getByRole('button', { name: /^Watching for/ }).click();
  await a.waitForFunction(() => document.querySelector('#race-senate-tx .reaction-row button[title="Watching"]')?.getAttribute('aria-pressed') === 'false');
  await a.waitForTimeout(3800);
  check('the meme clears itself', !(await meme(a)).open && !(await meme(a)).clip);
  await a.getByLabel('Search races').fill('');

  // Chat pings between two browsers in the staging room.
  stage = 'baseline';
  const b = await page(1280, 900, 'reduce');
  await b.goto(base); await b.waitForSelector('.hero');
  await b.getByRole('button', { name: 'Open the soundboard' }).click();
  await b.locator('dialog[open] .soundboard').waitFor();
  await b.locator('.board-switch .text-button').click();
  await b.locator('.board-play').nth(2).click();
  await b.waitForSelector('.trump-meme');
  const still = await meme(b);
  check('reduced motion: the meme holds still above the open sheet', still.open && still.clip === 'sad' && still.animation === 'none');
  await b.waitForTimeout(600);
  await b.screenshot({ path: output + '/1280-meme-over-soundboard.png' });
  await b.keyboard.press('Escape');
  await b.evaluate(() => { window.__towSounds.length = 0; });
  const post = async (p, text) => { await p.locator('.chat-button').click(); await p.waitForFunction(() => !document.querySelector('#party-message')?.disabled); await p.locator('#party-message').fill(text); await p.getByRole('button', { name: 'Post to the room' }).click(); await p.locator('.party-feedback').filter({ hasText: 'Posted' }).waitFor(); };
  check('chat pings start in waiting state', (await (await a.locator('.chat-button').click(), a.locator('.chat-ping-row')).innerText()).includes('Post once'));
  await a.keyboard.press('Escape');
  await a.waitForTimeout(2100);
  sads = await sadCount(a);
  await post(a, `REHEARSAL ONLY ${tag}: sound check from browser A`);
  check('posting turns chat pings on', (await a.locator('.chat-ping-row').textContent()).includes('Chat pings on'));
  await a.waitForFunction(n => window.__towSounds.filter(s => s.id === 'sad').length > n, sads);
  const posted = await meme(a);
  check('posting with sound on plays “Sad.” and the meme rises above the chat', posted.open && posted.clip === 'sad' && await a.locator('dialog[open] .party-page').isVisible());
  await a.waitForTimeout(900);
  await a.screenshot({ path: output + '/390-meme-over-chat.png' });
  await a.screenshot({ path: output + '/390-chat-pings-on.png' });
  const pings = async () => (await sounds(a)).filter(s => s === 'ping').length;
  const startPings = await pings();
  await post(b, `REHEARSAL ONLY ${tag}: browser B replies`);
  await a.waitForFunction(n => window.__towSounds.filter(s => s.id === 'ping').length > n, startPings, { timeout: 15000 });
  check('another guest’s post pings the contributor', (await pings()) === startPings + 1);
  await a.locator('.chat-ping-row button').click();
  check('chat pings can be muted in the chat', (await a.locator('.chat-ping-row').textContent()).includes('muted'));
  const muted = await pings();
  await b.waitForTimeout(3200);
  await b.locator('#party-message').fill(`REHEARSAL ONLY ${tag}: muted check`);
  await b.getByRole('button', { name: 'Post to the room' }).click();
  await a.waitForTimeout(7000);
  check('muted browser hears no ping', (await pings()) === muted);
  check('effects stay on after muting chat', (await a.locator('.sound-pin b').textContent()) === 'On');
  check('a sound-off guest posts silently', !(await sounds(b)).includes('sad') && !(await meme(b)).clip);
  sads = await sadCount(a);
  await a.locator('#party-message').fill(`REHEARSAL ONLY ${tag}: muted post`);
  await a.getByRole('button', { name: 'Post to the room' }).click();
  await a.waitForFunction(() => !document.querySelector('#party-message')?.value);
  await a.waitForTimeout(700);
  check('muting chat sounds also silences “Sad.” on your posts', (await sadCount(a)) === sads);

  // Host stats from the staging telemetry database.
  await b.keyboard.press('Escape');
  const login = await b.evaluate(async key => (await fetch('/api/party/host-login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Party-Request': '1' }, body: JSON.stringify({ key }) })).status, key);
  check('host login works', login === 200);
  await b.locator('.chat-button').click();
  await b.locator('.host-stats dl').waitFor();
  check('host sees the crowd stats', (await b.locator('.host-stats').innerText()).includes('BROWSERS') || (await b.locator('.host-stats').innerText()).includes('Browsers'));
  await b.locator('.host-stats').scrollIntoViewIfNeeded();
  await b.screenshot({ path: output + '/1280-host-stats.png' });
  const guestStats = await a.evaluate(async () => (await fetch('/api/party/host-stats')).status);
  check('guests cannot read stats', guestStats === 403);
  await b.evaluate(async () => fetch('/api/party/host-logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Party-Request': '1' }, body: '{}' }));

  for (const [w, h] of [[320, 640], [360, 740], [1280, 900]]) {
    const p = await page(w, h, 'reduce');
    await p.goto(base); await p.waitForSelector('.hero');
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(`no horizontal overflow at ${w}px`, overflow <= 0);
    await p.screenshot({ path: output + `/${w}-masthead.png` });
    stage = 'call';
    await refresh(p);
    await p.locator('.event-toast').waitFor();
    const box = await p.locator('.event-toast').boundingBox();
    check(`toast fits at ${w}px`, box && box.x >= 0 && box.x + box.width <= w);
    await p.screenshot({ path: output + `/${w}-toast.png` });
    await p.getByRole('button', { name: 'Open the soundboard' }).click();
    await p.locator('.board-play').first().click();
    await p.waitForSelector('.trump-meme');
    await p.waitForTimeout(500);
    const card = await p.locator('.trump-meme').boundingBox();
    check(`meme fits at ${w}px`, card && card.x >= 0 && card.x + card.width <= w && card.y >= 0 && (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
    await p.screenshot({ path: output + `/${w}-meme.png` });
    await p.keyboard.press('Escape');
    stage = 'baseline';
    await p.context().close();
  }
  check('no page errors', errors.length === 0);
} finally {
  writeFileSync(output + '/sound-checks.json', JSON.stringify({ base, synthetic: 'Intercepted copies of the real /api/election response; staging only.', checks, errors, beacons: beacons.length }, null, 2));
  await browser.close();
}
console.log(`${checks.filter(c => c.pass).length}/${checks.length} sound/telemetry checks passed`);
