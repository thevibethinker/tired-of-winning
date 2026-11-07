import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '/root/agent-browser/node_modules/playwright-core/index.mjs';

const output = process.argv[2];
const base = process.argv[3] || 'http://localhost:51754';
if (!output?.startsWith('/') || !['http://localhost:51754', 'https://tired-of-winning-va.zocomputer.io'].includes(base)) throw new Error('Supply an absolute evidence directory and an approved site URL.');
mkdirSync(output, { recursive: true });
const real = await (await fetch(base + '/api/election')).json();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const checks = [], errors = [];
const check = (name, pass, actual) => checks.push({ name, pass: Boolean(pass), ...(actual === undefined ? {} : { actual }) });

try {
  for (const width of [320, 390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    let offline = false;
    const frame = structuredClone(real);
    frame.generatedAt = '2026-11-03T23:30:00Z';
    Object.assign(frame.chambers.Senate, { fetchedAt: '2026-11-03T23:25:00Z', sourceUpdatedAt: '2026-11-03T23:24:00Z', stale: false, error: null });
    Object.assign(frame.chambers.House, { fetchedAt: '2026-11-03T23:28:00Z', sourceUpdatedAt: '2026-11-03T23:27:00Z', stale: false, error: null });
    await page.route('**/api/**', async route => {
      if (route.request().method() !== 'GET') return route.fulfill({ status: 403, json: { error: 'Read-only browser check.' } });
      if (new URL(route.request().url()).pathname === '/api/election') {
        if (offline) return route.abort('failed');
        return route.fulfill({ json: frame });
      }
      return route.continue();
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('.hero').waitFor();
    const refresh = async () => {
      await page.locator('.live-pin').click();
      await page.waitForFunction(() => document.querySelector('.live-pin')?.getAttribute('aria-busy') === 'false');
    };
    const pin = await page.locator('.live-pin').textContent();
    check(`${width}: freshness uses the older successful receipt, not response creation`, pin.includes('6:25') && !pin.includes('6:30'), pin);
    check(`${width}: receipt label does not imply a vote change`, pin.includes('Checked'), pin);
    const label = await page.locator('.live-pin').getAttribute('aria-label');
    check(`${width}: accessible label distinguishes both chambers`, label.includes('Senate 6:25 PM ET') && label.includes('House 6:28 PM ET'), label);
    frame.chambers.Senate.error = 'Source returned HTTP 502';
    frame.chambers.Senate.stale = true;
    await refresh();
    const warning = await page.locator('.error-banner').innerText();
    check(`${width}: delayed feed exposes both actual receipt times`, warning.includes('Senate 6:25 PM ET') && warning.includes('House 6:28 PM ET') && !warning.includes('6:30'), warning);
    check(`${width}: retry behavior is clear`, warning.includes('Retrying automatically.'), warning);
    check(`${width}: delay flag visible`, (await page.locator('.live-pin').innerText()).includes('Delayed'));
    check(`${width}: warning fits`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const retryBox = await page.locator('.error-banner button').boundingBox();
    check(`${width}: retry has a 44px touch target`, retryBox.width >= 44 && retryBox.height >= 44, retryBox);
    await page.evaluate(() => { const marker = document.createElement('div'); marker.textContent = 'SIMULATED FEED DELAY — VERIFICATION ONLY'; marker.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#fff;color:#111;font:12px sans-serif;text-align:center;z-index:99999'; document.body.append(marker); });
    await page.screenshot({ path: `${output}/delay-${width}.png` });
    const rowsBefore = await page.locator('.race-row').count();
    offline = true;
    await refresh();
    const disconnected = await page.locator('.error-banner').innerText();
    check(`${width}: connection loss retains receipt times`, disconnected.includes('Senate 6:25 PM ET') && disconnected.includes('House 6:28 PM ET'), disconnected);
    check(`${width}: connection loss retains races`, rowsBefore > 0 && await page.locator('.race-row').count() === rowsBefore);
    offline = false;
    for (const chamber of ['Senate', 'House']) Object.assign(frame.chambers[chamber], { fetchedAt: '2026-11-03T23:32:00Z', error: null, stale: false });
    frame.generatedAt = '2026-11-03T23:34:00Z';
    await refresh();
    check(`${width}: recovery removes warning`, await page.locator('.error-banner').count() === 0);
    check(`${width}: recovery uses successful receipt`, (await page.locator('.live-pin').innerText()).includes('6:32'));
    await context.close();
  }
} finally {
  await browser.close();
}
check('no page errors', errors.length === 0, errors);
const result = { at: new Date().toISOString(), base, synthetic: true, writesBlocked: true, passed: checks.filter(c => c.pass).length, total: checks.length, checks, errors };
writeFileSync(`${output}/checks.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ passed: result.passed, total: result.total, failed: checks.filter(c => !c.pass), errors }));
if (result.passed !== result.total) process.exitCode = 1;
