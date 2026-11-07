import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '/root/agent-browser/node_modules/playwright-core/index.mjs';

const output = process.argv[2];
const base = process.argv[3] || 'http://localhost:51754';
if (!output?.startsWith('/') || !['http://localhost:51754', 'https://zite-51754-va.zo.computer'].includes(base)) throw new Error('Use an absolute evidence directory and the staging site. This writes clearly labeled rehearsal comments in staging only.');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const contextA = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
const contextB = await browser.newContext({ viewport: { width: 1280, height: 950 } });
const a = await contextA.newPage(); const b = await contextB.newPage();
const checks = [], errors = [];
for (const page of [a, b]) page.on('pageerror', e => errors.push(e.message));
const check = (name, pass) => { checks.push({ name, pass: Boolean(pass) }); assert.ok(pass, name); };
const openChat = async page => { if (!(await page.locator('dialog[open] .party-page').count())) await page.locator('.action-bar .chat-button').click(); await page.locator('dialog[open] #party-handle').waitFor(); };
const closeChat = async page => { if (await page.locator('dialog[open]').count()) await page.keyboard.press('Escape'); await page.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {}); };
const waitText = (page, text) => page.waitForFunction(value => document.querySelector('.party-messages')?.textContent.includes(value), text, { timeout: 12000 });
const api = (page, action, body) => page.evaluate(async ({ action, body }) => { const r = await fetch('/api/party/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Party-Request': '1' }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; }, { action, body });
const get = page => page.evaluate(async () => (await fetch('/api/party')).json());
const tag = String(Date.now()).slice(-8);
const handleA = 'rehearsal_A_' + tag, handleB = 'rehearsal_B_' + tag;
const body = 'REHEARSAL ONLY — two browsers, one room. <img src=x onerror=alert(1)> 💙';

try {
  await Promise.all([a.goto(base + '/#party', { waitUntil: 'networkidle' }), b.goto(base + '/#party', { waitUntil: 'networkidle' })]);
  await a.waitForFunction(() => document.querySelector('#party-handle')?.value.startsWith('guest_'));
  await b.waitForFunction(() => document.querySelector('#party-handle')?.value.startsWith('guest_'));
  check('two browsers have distinct default handles', await a.locator('#party-handle').inputValue() !== await b.locator('#party-handle').inputValue());
  for (const [page, handle] of [[a, handleA], [b, handleB]]) {
    await page.getByLabel('Your handle', { exact: true }).fill(handle);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Handle saved. You’re on the guest list.').waitFor();
  }
  check('handles save in both browsers', (await get(a)).me.handle === handleA && (await get(b)).me.handle === handleB);
  await b.getByLabel('Your handle', { exact: true }).fill(handleA.toLowerCase());
  await b.getByRole('button', { name: 'Save', exact: true }).click();
  await b.getByRole('alert').waitFor();
  check('duplicate handle rejected beside the handle field', (await b.locator('.party-identity [role=alert]').innerText()).includes('taken'));
  await b.getByLabel('Your handle', { exact: true }).fill(handleB);
  await a.getByLabel('What’s the room saying?').fill(body);
  await a.getByRole('button', { name: 'Post to the room', exact: true }).click();
  await waitText(b, body);
  check('new comments reach the other browser through automatic polling', (await b.locator('.party-messages').innerText()).includes(handleA));
  check('user content is escaped, never rendered as HTML', await b.locator('.party-messages img').count() === 0);
  await a.reload({ waitUntil: 'networkidle' });
  check('handle persists on reload', await a.locator('#party-handle').inputValue() === handleA);
  const comment = (await get(a)).comments.find(c => c.body === body);
  check('second browser cannot delete first browser message', (await api(b, 'remove-comment', { id: comment.id })).status === 403);
  for (const page of [a, b]) {
    await closeChat(page);
    await page.getByLabel('Search races').fill('Talarico');
  }
  const cardA = a.locator('#race-senate-tx'), cardB = b.locator('#race-senate-tx');
  await cardA.getByRole('button', { name: /^Love it for/ }).click();
  await b.waitForFunction(() => document.querySelector('.reaction-row button[title="Love it"] b')?.textContent === '1', null, { timeout: 12000 });
  check('reaction from browser A reaches browser B', await cardB.getByRole('button', { name: /^Love it for/ }).getAttribute('aria-pressed') === 'false');
  await cardB.getByRole('button', { name: /^On fire for/ }).click();
  await a.waitForFunction(() => document.querySelector('.reaction-row button[title="On fire"] b')?.textContent === '1', null, { timeout: 12000 });
  check('both reactions aggregate independently', (await get(a)).races['senate-tx'].reactions['💙'] === 1 && (await get(a)).races['senate-tx'].reactions['🔥'] === 1);
  await cardA.locator('.race-head').click();
  await cardB.locator('.race-head').click();
  await cardA.locator('.crowd-picks>button').nth(0).click();
  await cardB.locator('.crowd-picks>button').nth(1).click();
  await a.waitForFunction(() => document.querySelector('#race-senate-tx .crowd-picks h4 span')?.textContent === '2 votes', null, { timeout: 12000 });
  check('two independent audience picks count once each', (await get(a)).races['senate-tx'].totalPicks === 2);
  await cardA.locator('.crowd-picks>button').nth(1).click();
  await a.waitForFunction(() => document.querySelectorAll('.crowd-picks>button')[1]?.textContent.includes('100%'));
  check('changing a pick does not increase the voter count', (await get(a)).races['senate-tx'].totalPicks === 2);
  check('crowd sentiment explicitly distinguished from forecasts', (await cardA.locator('.crowd-picks>p').textContent()).includes('not a forecast'));
  for (const width of [360, 390, 768, 1440]) {
    await a.setViewportSize({ width, height: 900 });
    check('race controls fit at ' + width, await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await a.screenshot({ path: output + '/race-' + width + '.png', fullPage: true });
    await openChat(a);
    check('party fits at ' + width, await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await a.screenshot({ path: output + '/party-' + width + '.png', fullPage: true });
    await closeChat(a);
  }
  await a.setViewportSize({ width: 390, height: 844 });
  await openChat(a);
  await a.route('**/api/party', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic outage' }) }));
  await a.getByText('Party updates paused.', { exact: false }).waitFor({ timeout: 12000 });
  check('failed refresh shows stale social state honestly', (await a.locator('.party-messages').innerText()).includes(body));
  check('posting disabled while social updates unavailable', await a.getByLabel('What’s the room saying?').isDisabled());
  await a.unroute('**/api/party');
  await a.locator('dialog[open]').getByRole('button', { name: 'Reconnect', exact: true }).click();
  await a.waitForFunction(() => !document.querySelector('#party-message').disabled);
  check('outage recovery preserves identity and messages', (await get(a)).me.handle === handleA);
  await a.getByLabel('What’s the room saying?').fill('REHEARSAL LONG TEXT ' + 'x'.repeat(470));
  await a.getByRole('button', { name: 'Post to the room', exact: true }).click();
  await a.waitForFunction(() => document.querySelector('.party-feedback')?.textContent === 'Posted.');
  check('long unbroken comment cannot overflow mobile', await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await a.screenshot({ path: output + '/party-long-message.png', fullPage: true });
  await a.getByLabel('What’s the room saying?').fill('REHEARSAL keyboard check');
  await a.getByLabel('What’s the room saying?').focus();
  await a.keyboard.press('Tab');
  check('composer supports keyboard navigation', await a.evaluate(() => document.activeElement?.tagName === 'BUTTON'));
  check('no browser exceptions', errors.length === 0);
} finally {
  for (const page of [a, b]) {
    try {
      const state = await get(page);
      for (const comment of state.comments.filter(c => c.mine)) await api(page, 'remove-comment', { id: comment.id });
      await api(page, 'reaction', { race: 'senate-tx', emoji: null });
      await api(page, 'pick', { race: 'senate-tx', choice: null });
    } catch {}
  }
  writeFileSync(output + '/checks.json', JSON.stringify({ at: new Date().toISOString(), base, checks, errors }, null, 2));
  console.log(JSON.stringify({ passed: checks.filter(c => c.pass).length, total: checks.length, errors }));
  await browser.close();
}
