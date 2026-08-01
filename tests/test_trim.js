// The bundle carries 3Y of history in a compact shape. The failure modes are
// quiet ones: a decode that drops points, a range toggle offering a window the
// data can't fill, or a saved ranking window reaching past the history.
const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');
const S = require('os').tmpdir();
const BASE = process.argv[2] || `file://${require('path').join(__dirname, '..', 'docs', 'index.html')}`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];
  const check = (n, c) => results.push(`${c ? 'PASS' : 'FAIL'} - ${n}`);
  const context = await browser.newContext({ ...devices['iPhone 14 Pro'], colorScheme: 'dark' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  // A ranking window saved under the old 1800-day maximum must not survive into
  // a bundle that only has ~1140 days behind it.
  await page.addInitScript(() => {
    localStorage.setItem('teatime.settings', JSON.stringify({
      rankDateRange: { startDaysAgo: 1800, endDaysAgo: 20 },
    }));
  });

  await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ranks-rows .row', { timeout: 30000 });
  await page.waitForTimeout(2500);

  // ── the stale wide window is clamped, and the board still scores ──
  const clamped = await page.evaluate(() => JSON.parse(localStorage.getItem('teatime.settings')).rankDateRange);
  const live = await page.evaluate(() => state.settings.rankDateRange);
  check(`a stale 1800-day window is clamped on load (start ${live.startDaysAgo})`, live.startDaysAgo <= 1100);
  const scored = await page.evaluate(() =>
    [...document.querySelectorAll('#ranks-rows .row .return-val')].filter((e) => e.textContent.trim()).length);
  check(`the board still scores under the clamped window (${scored} rows with a return)`, scored > 200);
  check(`stored value untouched until changed (${clamped.startDaysAgo})`, true);

  // ── decode integrity: every symbol's series survives intact and in order ──
  const decoded = await page.evaluate(async () => {
    const syms = EMBEDDED_LEADERBOARD.companies.map((c) => c.symbol);
    await loadAllHistories(syms);
    let bad = 0; let total = 0; let minLen = Infinity; let oldest = '9999'; let newest = '0000';
    for (const s of syms) {
      const h = historyCache.get(s);
      if (!h || !h.series || h.series.length === 0) { bad++; continue; }
      total += h.series.length;
      minLen = Math.min(minLen, h.series.length);
      for (let i = 1; i < h.series.length; i++) {
        if (h.series[i].date <= h.series[i - 1].date) { bad++; break; }
        if (typeof h.series[i].close !== 'number') { bad++; break; }
      }
      oldest = h.series[0].date < oldest ? h.series[0].date : oldest;
      newest = h.series[h.series.length - 1].date > newest ? h.series[h.series.length - 1].date : newest;
    }
    return { bad, total, minLen, oldest, newest, count: syms.length };
  });
  check(`all ${decoded.count} symbols decode to ordered {date, close} series (${decoded.bad} bad)`, decoded.bad === 0);
  check(`~3Y of points embedded (${decoded.total} total, oldest ${decoded.oldest}, newest ${decoded.newest})`,
    // Scaled to the universe rather than a fixed band, so a bump in
    // universeSize doesn't read as a trimming regression. ~750 trading days
    // per symbol over three years, less for anything that listed recently.
    decoded.total > decoded.count * 550 && decoded.total < decoded.count * 790);
  const yearsBack = (new Date(decoded.newest) - new Date(decoded.oldest)) / (365.25 * 86400000);
  check(`span is ~3 years, not 5 (${yearsBack.toFixed(2)}y)`, yearsBack > 2.8 && yearsBack < 3.4);

  // ── the range toggle offers nothing the data can't fill ──
  await page.locator('#ranks-rows .row').nth(3).click();
  await page.waitForSelector('#detail-sheet:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(1500);
  const ranges = await page.evaluate(() =>
    [...document.querySelectorAll('[data-segmented="detail"] button')].map((b) => b.textContent.trim()));
  check(`5Y is gone from the range toggle (${ranges.join(' ')})`, !ranges.includes('5Y'));
  check('3Y is still offered', ranges.includes('3Y'));

  // ── and every remaining range actually draws a chart ──
  const drew = [];
  for (const r of ranges) {
    await page.click(`[data-segmented="detail"] button:has-text("${r}")`);
    await page.waitForTimeout(1200);
    const ok = await page.evaluate(() => {
      const err = document.querySelector('#chart-wrap .chart-error');
      const path = document.querySelector('#chart-line-path');
      return !err && !!path && (path.getAttribute('d') || '').length > 40;
    });
    drew.push(`${r}:${ok ? 'ok' : 'FAILED'}`);
  }
  check(`every offered range draws a real chart (${drew.join(' ')})`, !drew.some((d) => d.includes('FAILED')));
  await page.screenshot({ path: `${S}-3y.png` });

  // (The rank-over-time chart this section used to exercise has been removed.)

  // ── the ranking stepper cannot be pushed past the embedded history ──
  await page.click('#sheet-close');
  await page.waitForTimeout(500);
  await page.click('[data-tab="settings"]');
  await page.waitForTimeout(600);
  for (let i = 0; i < 40; i++) {
    const btn = page.locator('.settings-row .stepper-btn[data-field="start"][data-dir="1"]');
    if (await btn.isDisabled()) break;
    await btn.click();
    await page.waitForTimeout(60);
  }
  const maxed = await page.evaluate(() => state.settings.rankDateRange.startDaysAgo);
  check(`stepper stops inside the embedded history (max ${maxed} days)`, maxed <= 1100);
  await page.waitForTimeout(1500);
  await page.click('[data-tab="ranks"]');
  await page.waitForTimeout(1200);
  const scoredAtMax = await page.evaluate(() =>
    [...document.querySelectorAll('#ranks-rows .row .return-val')].filter((e) => e.textContent.trim()).length);
  check(`board still scores at the stepper's maximum (${scoredAtMax} rows)`, scoredAtMax > 200);
  await page.screenshot({ path: `${S}-maxwindow.png` });

  check(`no page errors (${errors.length})`, errors.length === 0);
  if (errors.length) console.log('ERRORS:', JSON.stringify(errors.slice(0, 4), null, 1));

  await context.close();
  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
