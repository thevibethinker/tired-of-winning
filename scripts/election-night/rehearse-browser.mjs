import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '/root/agent-browser/node_modules/playwright-core/index.mjs';

const output = process.argv[2];
const base = process.argv[3] || 'http://localhost:51754';
if (!output?.startsWith('/')) throw new Error('Usage: node scripts/rehearse-browser.mjs /absolute/rehearsal-directory [staging-url]');
const replay = JSON.parse(readFileSync(output + '/synthetic-replay.json', 'utf8'));
assert.equal(replay.synthetic, true);
const checks = [];
const errors = [];
let current = replay.frames[0];
let requests = 0;
let transportFailure = false;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
page.on('pageerror', error => errors.push(error.message));
await page.clock.install();
await page.route('**/api/election', async route => {
  requests++;
  await route.fulfill({ status: transportFailure ? 503 : 200, contentType: 'application/json', body: transportFailure ? '{}' : JSON.stringify(current.data) });
});
await page.route('**/api/receipts', route => route.fulfill({ contentType: 'application/json', body: readFileSync(output + '/synthetic-audit.json', 'utf8') }));

function check(name, condition) {
  checks.push({ name, pass: Boolean(condition) });
  assert.ok(condition, name);
}
async function nav(name) {
  const labels = { Map: 'The map', Races: 'The races', Receipts: 'The receipts' };
  await page.locator(page.viewportSize().width <= 720 ? '.mobile-nav' : '.desktop-nav').getByRole('button', { name: page.viewportSize().width <= 720 ? name : labels[name] || name, exact: true }).click();
}
async function tick() {
  const before = requests;
  await page.clock.fastForward(30_100);
  await page.waitForFunction(() => !document.querySelector('[aria-label="Refresh election results"]')?.disabled);
  check('automatic screen refresh: ' + current.label, requests > before);
}
async function map() {
  await nav('Map');
  await page.getByLabel('Choose a state').selectOption('TX');
  await page.getByRole('button', { name: 'Live calls', exact: true }).click();
}

try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('.election-map').waitFor();
  await page.evaluate(() => {
    const banner = document.createElement('div');
    banner.id = 'rehearsal-banner';
    banner.textContent = 'SIMULATED RETURNS · NOT REAL ELECTION RESULTS';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#ffe46b;color:#111;text-align:center;padding:10px 5px;font:bold 11px system-ui;pointer-events:none';
    document.body.prepend(banner);
  });
  check('zero vote waiting state appears', (await page.locator('.hero-note').textContent()).includes('Waiting on the votes'));
  await map();
  const forecastColors = async () => page.locator('.map-state').evaluateAll(states => states.map(state => state.getAttribute('class')?.replace(' selected', '')));
  await page.getByRole('button', { name: 'Frozen forecast', exact: true }).click();
  const originalForecast = await forecastColors();
  await page.getByRole('button', { name: 'Live calls', exact: true }).click();
  const labels = { waiting: 'Awaiting votes', leading: 'Leading · not called', trailing: 'Trailing · not called', won: 'Called win', lost: 'Called loss' };
  for (const frame of replay.frames.slice(1)) {
    current = frame;
    await tick();
    const tx = frame.data.races.find(race => race.id === 'senate-tx');
    await page.waitForFunction(expected => document.querySelector('.map-race-list small')?.textContent === expected, labels[tx.result.status]);
    check('Texas status: ' + frame.label, (await page.locator('.map-race-list small').first().textContent()) === labels[tx.result.status]);
    const path = page.getByRole('button', { name: /^Texas:/ });
    const tone = tx.result.status === 'won' ? 'dem' : tx.result.status === 'lost' ? 'gop' : 'waiting';
    check('map color: ' + frame.label, (await path.getAttribute('class')).includes('map-' + tone));
    check('warning state: ' + frame.label, await page.locator('.error-banner').count() === (frame.data.chambers.Senate.error || frame.data.chambers.Senate.stale ? 1 : 0));
    if (/First calls|Retraction|Correction|Feed failure: http|59 D-caucus/.test(frame.label)) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: output + '/' + frame.label.split(':')[0].replaceAll(' ', '-').toLowerCase() + '-mobile.png', fullPage: true });
    }
    if (/First calls|Retraction|Correction/.test(frame.label)) {
      await page.locator('.map-open').click();
      check('race card status after ' + frame.label, (await page.locator('.race-status').textContent()).trim() === labels[tx.result.status]);
      await page.getByRole('button', { name: /^Show details/ }).click();
      check('candidate vote counts after ' + frame.label, (await page.locator('.vote-row b').first().textContent()) === tx.result.candidateVotes.toLocaleString() + ' votes');
      await nav('Receipts');
      const scores = await page.locator('.receipt-scoreboard strong').allTextContents();
      check('provisional scoring after ' + frame.label, Number.parseInt(scores[0]) === frame.data.score.n && scores[1] === (frame.data.score.forecast?.toFixed(3) ?? '—') && scores[2] === (frame.data.score.market?.toFixed(3) ?? '—'));
      await map();
    }
    if (frame.label.startsWith('Synthetic calls:')) {
      await nav('Tonight');
      const seats = frame.data.chambers.Senate.democratic;
      const titles = { 51: 'WINNING.', 52: 'BIGLY WINNING.', 54: 'SO MUCH WINNING.', 56: 'TIRED OF WINNING.', 59: 'NO MORE WINNING.' };
      check(seats + ' seats displayed in live board', Number(await page.locator('.chamber-panel').first().locator('.blue-text strong').textContent()) === seats);
      check(seats + ' seats activate correct mood', await page.locator('.fatigue-panel h2').textContent() === titles[seats]);
      if (seats === 59) await page.screenshot({ path: output + '/59-seats-mobile.png', fullPage: true });
      await map();
    }
  }
  await page.getByRole('button', { name: 'Frozen forecast', exact: true }).click();
  check('all live updates preserve frozen map colors', JSON.stringify(await forecastColors()) === JSON.stringify(originalForecast));
  await nav('Tonight');
  transportFailure = true;
  await tick();
  check('browser HTTP failure retains last successful count', await page.locator('.error-banner').count() === 1 && await page.locator('.chamber-panel').first().locator('.blue-text strong').textContent() === '59');
  transportFailure = false;
  await tick();
  check('browser HTTP recovery clears banner', await page.locator('.error-banner').count() === 0);
  await page.getByRole('button', { name: 'Preview Winning scenario at 51 Senate seats', exact: true }).click();
  check('scenario can diverge from the live count', await page.locator('.scenario-seat strong').textContent() === '51');
  await nav('Tonight');
  check('scenario leaves live count intact', await page.locator('.chamber-panel').first().locator('.blue-text strong').textContent() === '59');
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const tab of ['Tonight', 'Map', 'Races', 'Receipts']) {
      await nav(tab);
      check(`${tab} with populated results fits ${width}px`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await nav('Map');
  await page.screenshot({ path: output + '/called-map-desktop.png', fullPage: true });
  check('no JavaScript exceptions', errors.length === 0);
} finally {
  writeFileSync(output + '/browser-checks.json', JSON.stringify({ synthetic: true, base, checks, errors, interceptedResponses: requests, at: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ passed: checks.filter(check => check.pass).length, total: checks.length, errors, output }));
  await browser.close();
}
