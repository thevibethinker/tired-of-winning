import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '/root/agent-browser/node_modules/playwright-core/index.mjs';

const output = process.argv[2];
const base = process.argv[3] || 'http://localhost:51754';
if (!output?.startsWith('/') || base !== 'http://localhost:51754') throw new Error('Usage: node scripts/verify-redesign.mjs /absolute/evidence-dir. Staging only; election responses are intercepted in the browser and never written anywhere.');
mkdirSync(output, { recursive: true });

const real = await (await fetch(base + '/api/election')).json();
const clone = value => JSON.parse(JSON.stringify(value));
const set = (data, id, result) => { const race = data.races.find(r => r.id === id); Object.assign(race.result, result); };
const beforeResults = clone(real);
beforeResults.synthetic = 'REHEARSAL ONLY';
for (const chamber of ['Senate', 'House', 'Governor']) Object.assign(beforeResults.chambers[chamber], { stale: false, error: null, fetchedAt: '2026-11-03T19:00:00Z', sourceUpdatedAt: '2026-11-03T18:59:00Z' });
for (const race of beforeResults.races) {
  race.result = { status: race.result.status === 'unavailable' ? 'unavailable' : 'waiting', margin: null, reporting: 0, votes: 0, candidateVotes: 0, opponentVotes: 0, candidateShare: null, opponentShare: null, winner: null };
}
Object.assign(beforeResults.chambers.Senate, { democratic: 34, republican: 31, independent: 0 });
Object.assign(beforeResults.chambers.House, { democratic: 0, republican: 0, independent: 0 });
Object.assign(beforeResults.chambers.Governor, { democratic: 6, republican: 8, independent: 0 });
const oddsInPlay = r => [r.probability, r.market?.probability].some(p => p !== null && p !== undefined && p >= .02 && p <= .98);
const senateContested = real.races.filter(r => r.chamber === 'Senate' && oddsInPlay(r));
const kyContested = senateContested.some(r => r.state === 'KY');
beforeResults.score = { n: 0, forecast: null, market: null, ids: [] };
function liveFrame() {
  const data = clone(beforeResults);
  data.synthetic = 'REHEARSAL ONLY';
  set(data, 'senate-oh', { status: 'leading', margin: 3.1, reporting: 22, votes: 900000, candidateVotes: 459000, opponentVotes: 431100, candidateShare: 51, opponentShare: 47.9 });
  set(data, 'senate-ga', { status: 'won', margin: 8.2, reporting: 96, votes: 3900000, candidateVotes: 2100000, opponentVotes: 1780000, candidateShare: 53.8, opponentShare: 45.6, winner: 'Jon Ossoff' });
  set(data, 'senate-ky', { status: 'lost', margin: -18, reporting: 91, votes: 1500000, candidateVotes: 600000, opponentVotes: 870000, candidateShare: 40, opponentShare: 58, winner: 'Andy Barr' });
  set(data, 'senate-sc', { status: 'trailing', margin: -2.4, reporting: 40, votes: 800000, candidateVotes: 386000, opponentVotes: 405000, candidateShare: 48.2, opponentShare: 50.6 });
  data.chambers.Senate.democratic = 35; data.chambers.Senate.republican = 32;
  data.score = { n: 2, forecast: 0.0101, market: 0.0233, ids: ['senate-ga', 'senate-ky'] };
  return data;
}

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const checks = [], errors = [];
const check = (name, pass) => { checks.push({ name, pass: Boolean(pass) }); assert.ok(pass, name); };

async function open(viewport, iso, frame, hash = '') {
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.install({ time: new Date(iso) });
  await page.route('**/api/election', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(frame) }));
  await page.goto(base + '/' + hash, { waitUntil: 'networkidle' });
  await page.locator('.hero h1').waitFor();
  return page;
}
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const smallTargets = page => page.evaluate(() => [...document.querySelectorAll('main button, .action-bar button, .ticker, .masthead button')].filter(b => { const r = b.getBoundingClientRect(); return r.width && r.height && !b.closest('.hero-todo') && (r.height < 44 || r.width < 40); }).map(b => b.textContent.trim().slice(0, 30) || b.getAttribute('aria-label')));

for (const [name, viewport] of [['phone360', { width: 360, height: 740 }], ['phone390', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]]) {
  const pre = await open(viewport, '2026-11-03T19:00:00Z', beforeResults);
  const ticker = await pre.locator('.ticker').innerText();
  check(`${name}: pre-results ticker counts down to 6 p.m. Kentucky`, /First polls close in/i.test(ticker) && ticker.includes('3:59:59') || ticker.includes('4:00:00') && ticker.includes('KY'));
  check(`${name}: no horizontal overflow`, await overflow(pre) <= 0);
  check(`${name}: ${senateContested.length} contested Senate races by default (2–98% model or market odds)`, await pre.locator('.race-row').count() === senateContested.length);
  check(`${name}: contested list starts at ${kyContested ? '6' : '7'} p.m.`, (await pre.locator('.close-head h3').first().innerText()) === (kyContested ? '6:00 p.m. ET' : '7:00 p.m. ET'));
  check(`${name}: rows say polls open before closing`, (await pre.locator('#race-senate-oh .race-status').innerText()) === 'Polls open');
  check(`${name}: pre-results to-do line visible`, await pre.locator('.hero-todo').isVisible());
  check(`${name}: buttons meet 44px targets`, (await smallTargets(pre)).length === 0 || console.log('small', await smallTargets(pre)));
  await pre.screenshot({ path: `${output}/${name}-pre-top.png` });
  await pre.getByLabel('Which races').getByRole('button', { name: 'All 35' }).click();
  check(`${name}: All shows every Senate race`, await pre.locator('.race-row').count() === 35);
  await pre.getByLabel('Chamber').getByRole('button', { name: 'House' }).click();
  const houseAll = await pre.locator('.race-row').count();
  check(`${name}: House "All" is capped at 60 with a show-more control`, houseAll === 60 && await pre.getByRole('button', { name: /^Show 375 more House races/ }).isVisible());
  await pre.getByLabel('Chamber').getByRole('button', { name: 'Senate' }).click();
  await pre.getByLabel('Search races').fill('talarico');
  check(`${name}: candidate search works`, await pre.locator('.race-row').count() === 1);
  await pre.getByLabel('Search races').fill('');

  await pre.getByRole('button', { name: 'Map', exact: true }).click();
  await pre.locator('dialog.sheet[open] .election-map').waitFor();
  check(`${name}: map opens as a sheet`, await pre.locator('dialog.sheet[open]').count() === 1);
  await pre.screenshot({ path: `${output}/${name}-map.png` });
  await pre.locator('.map-state-picker select').selectOption('WY');
  await pre.locator('.map-open').click();
  await pre.waitForTimeout(400);
  check(`${name}: tapping a safe state closes the map and opens its race`, await pre.locator('dialog.sheet[open]').count() === 0 && await pre.locator('#race-senate-wy.is-open').count() === 1);
  await pre.close();

  const live = await open(viewport, '2026-11-04T00:45:00Z', liveFrame());
  const liveTicker = await live.locator('.ticker').innerText();
  check(`${name}: 7:45 p.m. ticker points to 8 p.m.`, /Next polls close in/i.test(liveTicker) && /0:1[45]:\d\d/.test(liveTicker) && liveTicker.includes('8:00 p.m. ET'));
  check(`${name}: with votes in, races default to “What’s happening now” groups`, (await live.locator('.race-sort select').inputValue()) === 'live' && await live.locator('.bucket-group').count() > 0);
  check(`${name}: a 22%-in lead is grouped too early to tell and labeled early`, await live.locator('.group-early #race-senate-oh').count() === 1 && (await live.locator('#race-senate-oh .race-status').innerText()).includes('22% in, early'));
  check(`${name}: held-seat calls sit in “Called, no flip”`, await live.locator('.group-held #race-senate-ga').count() === 1);
  await live.locator('.race-sort select').selectOption('closing');
  check(`${name}: closed groups say so; FL/NH group says most closed`, (await live.locator('.close-group', { has: live.locator('#race-senate-nh') }).locator('.close-status').innerText()).toLowerCase() === 'most polls closed');
  check(`${name}: 8 p.m. group is flagged next`, (await live.locator('.close-group.is-next .close-head h3').innerText()) === '8:00 p.m. ET');
  await live.getByLabel('Which races').getByRole('button', { name: 'All 35' }).click();
  check(`${name}: lead is labeled not called`, (await live.locator('#race-senate-oh .race-status').innerText()).includes('Leads, not called · 22% in'));
  check(`${name}: call names the winner`, (await live.locator('#race-senate-ga .race-status').innerText()) === 'Called for Ossoff' && (await live.locator('#race-senate-ky .race-status').innerText()) === 'Called for Barr');
  check(`${name}: scorecard names the leader`, (await live.locator('.scorecard-line').innerText()) === 'So far, the nerds (model) are beating the crypto bros (market).');
  check(`${name}: hero to-do hides once votes exist`, await live.locator('.hero-todo').count() === 0);
  check(`${name}: three equal chamber cards (Senate, House, Governors)`, (await live.locator('.chamber-trio .chamber-card h2').allInnerTexts()).map(t => t.toUpperCase()).join() === 'SENATE,HOUSE,GOVERNORS');
  check(`${name}: held-seat calls are not flips (GA hold, KY GOP hold) so net flips stay 0`, (await live.locator('.flip-total b').innerText()) === '0' && (await live.locator('.hero .meter-title').innerText()).includes('LOW ENERGY'));
  await live.getByLabel('Chamber').getByRole('button', { name: 'Gov', exact: true }).click();
  await live.getByLabel('Which races').getByRole('button', { name: 'All 36' }).click();
  check(`${name}: governors tab lists all 36 with market odds and no model`, await live.locator('.race-row').count() === 36 && (await live.locator('#race-gov-ga .race-nums').innerText()).includes('—'));
  check(`${name}: Alaska compares against the leading Republican`, (await live.locator('#race-gov-ak .race-who small').innerText()).includes('Leading Republican'));
  await live.getByLabel('Chamber').getByRole('button', { name: 'Senate', exact: true }).click();
  await live.locator('#race-senate-oh .race-head').click();
  check(`${name}: expanded race shows votes, close note and picks`, await live.locator('#more-senate-oh .votes').isVisible() && (await live.locator('#more-senate-oh').innerText()).includes('Polls close 7:30 p.m. ET') && await live.locator('#more-senate-oh .crowd-picks').isVisible());
  await live.locator('#race-senate-oh').scrollIntoViewIfNeeded();
  await live.screenshot({ path: `${output}/${name}-live-oh.png` });
  await live.getByRole('button', { name: 'Find me 59 seats' }).click();
  check(`${name}: 59 seats = +12 Senate net flips`, (await live.locator('.whatif-seats strong').innerText()) === '59' && (await live.locator('.whatif-flips').innerText()).includes('Senate +12'));
  await live.locator('.whatif').scrollIntoViewIfNeeded();
  await live.screenshot({ path: `${output}/${name}-whatif.png` });
  await live.close();

  const chat = await open(viewport, '2026-11-03T19:00:00Z', beforeResults, '#party');
  await chat.locator('dialog.sheet[open] #party-handle').waitFor();
  check(`${name}: #party deep link opens the room`, await chat.locator('dialog.sheet[open] .party-page').isVisible());
  await chat.screenshot({ path: `${output}/${name}-chat.png` });
  await chat.keyboard.press('Escape');
  check(`${name}: Escape closes the room and clears the hash`, await chat.locator('dialog.sheet[open]').count() === 0 && !(await chat.evaluate(() => location.hash)));
  await chat.close();
}

check('no page errors', errors.length === 0);
await browser.close();
writeFileSync(`${output}/checks.json`, JSON.stringify({ synthetic: 'Election responses intercepted in the browser; clocks faked; nothing written to staging or production.', checks, errors }, null, 2));
console.log(`${checks.filter(c => c.pass).length}/${checks.length} checks passed; ${errors.length} page errors`);
