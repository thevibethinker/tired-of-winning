// Browser check for the frozen final page. Read-only: visit counting (/api/t) is blocked, and the page has no other writes.
// Usage: node scripts/verify-final.mjs /absolute/evidence-dir <base-url> [--locked]
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '/root/agent-browser/node_modules/playwright-core/index.mjs';

const [output, base] = process.argv.slice(2);
const locked = process.argv.includes('--locked');
if (!output?.startsWith('/') || !base?.startsWith('http')) throw new Error('Usage: node scripts/verify-final.mjs /absolute/evidence-dir <base-url> [--locked]');
mkdirSync(output, { recursive: true });
const stamp = () => new Date().toISOString();
const checks = [], errors = [], partyCalls = [];
const check = (name, pass) => { checks.push({ name, pass: Boolean(pass) }); if (!pass) console.error(`${stamp()} FAIL ${name}`); };

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  for (const [label, viewport] of [['phone320', { width: 320, height: 720 }], ['phone390', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 1000 }]]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.route(/\/api\/t(\/|\?|$)/, route => route.abort());
    page.on('request', request => { if (request.url().includes('/api/party')) partyCalls.push(request.url()); });
    page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error' && !/api\/t|ERR_FAILED/.test(message.text())) errors.push(`${label} console: ${message.text()}`); });
    await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForSelector('.hero', { timeout: 90_000 });
    await page.waitForTimeout(1500);
    const strip = await page.locator('.live-banner').innerText();
    check(`${label}: status strip says ${locked ? 'final' : 'still counting'}`, locked ? /final score/i.test(strip) && /locked/i.test(strip) : /still counting/i.test(strip) && /uncalled/i.test(strip));
    check(`${label}: no countdown, chat, picks or what-if`, (await page.locator('.ticker-clock, .accent-button:has-text("Chat"), #whatif, .crowd-picks, .party-banner').count()) === 0);
    const actions = (await page.locator('.action-bar button').allInnerTexts()).map(t => t.trim());
    check(`${label}: action bar is Races, Map, Sounds`, JSON.stringify(actions) === JSON.stringify(['Races', 'Map', 'Sounds']));
    check(`${label}: verdict is a heading with a winner or a tie`, /beat|even|nothing to score/i.test(await page.locator('#verdict-title').innerText()));
    check(`${label}: masthead pin ${locked ? 'is a static locked badge' : 'refreshes'}`, locked ? (await page.locator('span.live-pin.is-final').count()) === 1 : (await page.locator('button.live-pin').count()) === 1);
    if (locked) check(`${label}: no delayed-feed banner once locked`, (await page.locator('.error-banner').count()) === 0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${label}: no sideways scrolling (${overflow}px)`, overflow <= 0);
    await page.screenshot({ path: `${output}/${label}-top.png` });
    if (label === 'phone390') {
      const level = (await page.locator('.meter-title').innerText()).replace(/\.$/, '').toLowerCase();
      await page.locator('.sound-sticker-go').click();
      await page.waitForSelector('.trump-meme figcaption', { timeout: 10_000 });
      const caption = (await page.locator('.trump-meme figcaption').innerText()).toLowerCase();
      check(`${label}: the sound sticker plays the final level's clip (${level})`, level !== 'tired of winning' || caption.includes('tired of winning'));
      await page.screenshot({ path: `${output}/${label}-finale.png` });
    }

    await page.locator('.search-field input').fill('Michigan');
    await page.waitForTimeout(400);
    const mi = page.locator('#race-senate-mi');
    check(`${label}: Michigan shows the room's 🔥 count as text, not buttons`, /🔥\s*2/.test(await mi.locator('.race-reactions').innerText()) && (await mi.locator('.race-reactions button').count()) === 0);
    await mi.locator('.race-head').click();
    const details = await mi.locator('.race-more').innerText();
    check(`${label}: race details have the count line and no picks`, /count (finished|so far)/i.test(details) && !/your pick/i.test(details));
    await mi.screenshot({ path: `${output}/${label}-michigan.png` });
    await page.locator('.search-field input').fill('');

    await page.locator('.action-bar button', { hasText: 'Map' }).click();
    await page.waitForSelector('dialog[open] .sheet-head', { timeout: 15_000 });
    await page.waitForTimeout(1200);
    check(`${label}: map sheet opens`, (await page.locator('dialog[open]').count()) === 1);
    await page.screenshot({ path: `${output}/${label}-map.png` });
    await page.keyboard.press('Escape');
    await page.locator('.action-bar button', { hasText: 'Sounds' }).click();
    await page.waitForSelector('dialog[open] .soundboard', { timeout: 15_000 });
    const board = await page.locator('dialog[open] .soundboard').innerText();
    check(`${label}: soundboard opens without chat pings`, /what made noise/i.test(board) && !/chat pings/i.test(board));
    if (locked) check(`${label}: soundboard says nothing plays on its own`, /locked|still play/i.test(board));
    await page.screenshot({ path: `${output}/${label}-soundboard.png` });
    await page.keyboard.press('Escape');
    if (label === 'phone390') await page.screenshot({ path: `${output}/${label}-full.png`, fullPage: true });
    await context.close();
  }
  check('no requests to the retired party API', partyCalls.length === 0);
  check('no page errors', errors.length === 0);
} finally {
  await browser.close();
  const failed = checks.filter(c => !c.pass);
  writeFileSync(`${output}/final-checks.json`, JSON.stringify({ base, locked, at: stamp(), passed: checks.length - failed.length, total: checks.length, checks, errors, partyCalls }, null, 1));
  console.log(`${stamp()} ${checks.length - failed.length}/${checks.length} checks passed${errors.length ? `; errors: ${errors.join(' | ')}` : ''}`);
}
assert.equal(checks.filter(c => !c.pass).length, 0, 'Some final-page checks failed');
