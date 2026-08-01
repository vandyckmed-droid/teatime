const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');
const S = require('os').tmpdir();
const BASE = process.argv[2] || 'http://localhost:3423';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];
  const check = (n, c) => results.push(`${c ? 'PASS' : 'FAIL'} - ${n}`);
  const context = await browser.newContext({ ...devices['iPhone 14 Pro'], colorScheme: 'dark' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // The Investing tab remembers which view you were on and defaults to
  // Portfolio; these assertions are about the saved names.
  await page.addInitScript(() => localStorage.setItem('teatime.investingView', 'watchlist'));
  await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ranks-rows .row', { timeout: 25000 });

  // Assert against the bundle's own universe rather than a hard-coded count —
  // universeSize is a dial that moves in both directions (see src/config.js).
  const expectedRows = await page.evaluate(() => EMBEDDED_LEADERBOARD.companies.length);
  const actualRows = await page.locator('#ranks-rows .row').count();
  check(`every company renders a row (${actualRows} of ${expectedRows})`, actualRows === expectedRows);

  // ── no horizontal overflow at phone width: the acid test for 6 columns ──
  const overflow = await page.evaluate(() => ({
    body: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    worstRow: Math.max(...[...document.querySelectorAll('#ranks-rows .row')]
      .slice(0, 60).map((r) => r.scrollWidth - r.clientWidth)),
  }));
  check(`no page h-overflow (${overflow.body}px)`, overflow.body <= 0);
  check(`no row h-overflow (${overflow.worstRow}px)`, overflow.worstRow <= 0);

  // ── the column header lines up with the column it names ──
  // Only the score column is labelled now; the 52-week range moved off the
  // rows into the full-screen ticker view (checked below).
  const align = await page.evaluate(() => {
    const row = document.querySelector('#ranks-rows .row');
    const r = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right)]; };
    return {
      headScore: r(document.querySelector('#panel-ranks .board-head-score')),
      rowScore: r(row.querySelector('.trailing-cell')),
      rowRange: !!row.querySelector('.range-cell, .range-bar'),
    };
  });
  check('no range column left on the rows', !align.rowRange);
  check(`score header aligns with score column (${align.headScore} vs ${align.rowScore})`,
    Math.abs(align.headScore[1] - align.rowScore[1]) <= 2);

  // ── logos actually load (not just the fallback) ──
  await page.waitForTimeout(2500);
  const logos = await page.evaluate(() => {
    // Only rows actually on screen: loading="lazy" means below-fold images are
    // never requested, so counting those would test the browser, not the app.
    const vh = window.innerHeight;
    const imgs = [...document.querySelectorAll('#ranks-rows .row')]
      .filter((r) => { const b = r.getBoundingClientRect(); return b.top < vh && b.bottom > 0; })
      .map((r) => r.querySelector('.logo img')).filter(Boolean);
    return { total: imgs.length, loaded: imgs.filter((i) => i.naturalWidth > 0).length };
  });
  check(`logo images load (${logos.loaded}/${logos.total})`, logos.total > 0 && logos.loaded === logos.total);

  // ── the range slider, in the full-screen ticker view it now lives in ──
  await page.locator('#ranks-rows .row').first().click();
  await page.waitForSelector('#detail-sheet:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(1200);
  await page.click('#sheet-expand');
  await page.waitForTimeout(1200);
  const slider = await page.evaluate(() => {
    const block = document.querySelector('[data-block="range"]');
    if (!block) return null;
    const thumb = block.querySelector('.range-thumb');
    const track = block.querySelector('.range-bar-track');
    const tb = track.getBoundingClientRect(); const hb = thumb.getBoundingClientRect();
    return {
      pct: Math.round(((hb.left + hb.width / 2 - tb.left) / tb.width) * 100),
      ends: [...block.querySelectorAll('.range-bar-ends span')].map((s) => s.textContent),
      now: block.querySelector('.range-bar-now').textContent,
    };
  });
  check(`thumb inside track (${slider && slider.pct}%)`, !!slider && slider.pct >= 0 && slider.pct <= 100);
  check('range shows low and high labels', !!slider && slider.ends.length === 2 && /^\$/.test(slider.ends[0]));
  check('range shows current price', !!slider && /^\$/.test(slider.now));
  await page.click('#sheet-close');
  await page.waitForTimeout(700);

  // ── lime green, not the old emerald ──
  const green = await page.locator('.return-val.gain').first().evaluate((el) => getComputedStyle(el).color);
  check(`gain is the lime (${green})`, green === 'rgb(123, 214, 63)');

  await page.screenshot({ path: `${S}-ranks.png` });
  await page.evaluate(() => window.scrollTo(0, 1500));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${S}-scrolled.png` });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);

  // ── vol-adj mode: score label + 4dp ──
  await page.click('[data-tab="settings"]');
  await page.waitForTimeout(250);
  await page.locator('.ios-switch').first().click({ force: true });
  await page.waitForTimeout(900);
  await page.click('[data-tab="ranks"]');
  await page.waitForTimeout(600);
  const vol = await page.evaluate(() => ({
    head: document.querySelector('.board-head-score').textContent,
    label: document.querySelector('#ranks-score-label .section-label-key').textContent,
    val: document.querySelector('#ranks-rows .return-val').textContent,
  }));
  check(`score header follows the mode ("${vol.head}")`, /vol-adj/i.test(vol.head));
  check(`section label follows the mode ("${vol.label}")`, /vol-adj/i.test(vol.label));
  check(`vol-adj score shows 2dp ("${vol.val}")`, /\.\d{2}$/.test(vol.val));
  await page.screenshot({ path: `${S}-voladj.png` });

  // back to plain return
  await page.click('[data-tab="settings"]');
  await page.waitForTimeout(250);
  await page.locator('.ios-switch').first().click({ force: true });
  await page.waitForTimeout(900);

  // ── watchlist + its own header ──
  await page.click('[data-tab="ranks"]');
  await page.waitForTimeout(400);
  await page.locator('#ranks-rows .row .add-btn').nth(0).click();
  await page.waitForTimeout(200);
  await page.locator('#ranks-rows .row .add-btn').nth(2).click();
  await page.waitForTimeout(400);
  await page.click('[data-tab="investing"]');
  await page.waitForTimeout(450);
  check('watchlist shows 2', (await page.locator('#watchlist-rows .row').count()) === 2);
  check('watchlist header visible', await page.locator('#watchlist-board-head').isVisible());
  await page.screenshot({ path: `${S}-watchlist.png` });

  // ── detail sheet uses the logo + ticker ──
  await page.locator('#watchlist-rows .row').first().click();
  await page.waitForSelector('#detail-sheet:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(900);
  const sheet = await page.evaluate(() => ({
    hasLogo: !!document.querySelector('#detail-logo'),
    ticker: document.querySelector('#detail-ticker').textContent,
    chart: document.querySelectorAll('#chart-wrap svg path').length,
  }));
  check('sheet shows a logo avatar', sheet.hasLogo);
  check(`sheet shows the ticker ("${sheet.ticker}")`, sheet.ticker.length > 0);
  check('sheet chart renders', sheet.chart > 0);
  await page.screenshot({ path: `${S}-sheet.png` });

  check('no console/page errors', errors.length === 0);
  if (errors.length) console.log('ERRORS:', errors.slice(0, 8));

  await context.close();
  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
