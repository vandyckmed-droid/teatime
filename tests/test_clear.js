const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');
const S = require('os').tmpdir();
const BASE = process.argv[2] || 'http://localhost:3428/';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];
  const check = (n, c) => results.push(`${c ? 'PASS' : 'FAIL'} - ${n}`);
  const context = await browser.newContext({ ...devices['iPhone 14 Pro'], colorScheme: 'dark' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  // Seed a watchlist plus a threshold that actually fades things, so we can
  // check the fade lifts once nothing is held.
  // Seed once only: addInitScript re-runs on every navigation, so seeding
  // unconditionally would silently re-fill the watchlist on the reload check.
  await page.addInitScript(() => {
    // localStorage, not sessionStorage: on file:// origins Chromium doesn't
    // carry sessionStorage across a reload, so the guard would never hold.
    if (!localStorage.getItem('teatime.test.seeded')) {
      localStorage.setItem('teatime.test.seeded', '1');
      localStorage.setItem('teatime.watchlist', JSON.stringify(['NVDA', 'XOM', 'JNJ']));
      localStorage.setItem('teatime.settings', JSON.stringify({ correlationThreshold: 0.45 }));
    }
  });
  // The Investing tab remembers which view you were on and defaults to
  // Portfolio; these assertions are about the saved names.
  await page.addInitScript(() => localStorage.setItem('teatime.investingView', 'watchlist'));
  await page.goto(`${BASE}#investing`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#watchlist-rows .row', { timeout: 25000 });
  await page.waitForTimeout(1800);

  const btn = page.locator('#clear-watchlist');
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('teatime.watchlist') || '[]').length);
  const faded = () => page.evaluate(() =>
    document.querySelectorAll('#ranks-rows .row.correlated').length);

  check('button is visible when the watchlist has names', await btn.isVisible());
  check(`label starts unarmed ("${(await btn.textContent()).trim()}")`,
    (await btn.textContent()).trim() === 'Clear watchlist');
  check(`3 names saved (${await stored()})`, (await stored()) === 3);
  const fadedBefore = await faded();
  check(`some rows are faded as correlates (${fadedBefore})`, fadedBefore > 0);
  await page.screenshot({ path: `${S}-unarmed.png` });

  // ── first tap only arms; nothing is lost ──
  await btn.click();
  await page.waitForTimeout(250);
  const armedLabel = (await btn.textContent()).trim();
  check(`first tap arms and states the count ("${armedLabel}")`, /Tap again to remove 3/.test(armedLabel));
  check('first tap is armed-styled', await btn.evaluate((el) => el.classList.contains('armed')));
  check(`first tap destroys nothing (${await stored()} still saved)`, (await stored()) === 3);
  await page.screenshot({ path: `${S}-armed.png` });

  // ── arming lapses on its own ──
  await page.waitForTimeout(4400);
  check(`armed state reverts after a pause ("${(await btn.textContent()).trim()}")`,
    (await btn.textContent()).trim() === 'Clear watchlist');
  check(`still nothing lost (${await stored()})`, (await stored()) === 3);

  // ── two taps clear it ──
  await btn.click();
  await page.waitForTimeout(200);
  await btn.click();
  await page.waitForTimeout(1600);
  check(`two taps clear the watchlist (${await stored()} saved)`, (await stored()) === 0);
  check('empty state replaces the rows', await page.locator('#watchlist-rows .empty-state').isVisible());
  check('button hides when there is nothing to clear', !(await btn.isVisible()));
  check('badge is gone', await page.locator('#watchlist-badge').isHidden());
  check('stays on the Watchlist tab rather than navigating away',
    await page.locator('#panel-investing').isVisible());
  await page.screenshot({ path: `${S}-cleared.png` });

  // ── the correlation fade lifts, since nothing is held ──
  await page.click('[data-tab="ranks"]');
  await page.waitForTimeout(700);
  check(`fade lifts once nothing is held (${fadedBefore} -> ${await faded()})`, (await faded()) === 0);

  // ── it survives a reload, i.e. localStorage really was written ──
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ranks-rows .row', { timeout: 25000 });
  await page.waitForTimeout(900);
  check(`still empty after reload (${await stored()})`, (await stored()) === 0);

  // ── and adding still works afterwards ──
  await page.locator('#ranks-rows .row .add-btn').first().click();
  await page.waitForTimeout(900);
  check(`can add again after clearing (${await stored()})`, (await stored()) === 1);
  await page.click('[data-tab="investing"]');
  await page.waitForTimeout(400);
  check('button comes back with the first saved name', await btn.isVisible());

  check('no console/page errors', errors.length === 0);
  if (errors.length) console.log('ERRORS:', JSON.stringify(errors.slice(0, 5), null, 1));

  await context.close();
  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
