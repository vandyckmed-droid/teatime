// Regression test for the sheet dying after swiping onto a company whose logo
// is white-on-transparent (rendered as `class="logo on-dark"`). The old
// id-reattach did string surgery on `class="logo"`, which those names don't
// match — so #detail-logo vanished and the *next* render threw.
const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');
const S = require('os').tmpdir();
const BASE = process.argv[2] || `file://${require('path').join(__dirname, '..', 'docs', 'index.html')}`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];
  const check = (n, c) => results.push(`${c ? 'PASS' : 'FAIL'} - ${n}`);
  const context = await browser.newContext({ ...devices['iPhone 14 Pro'], colorScheme: 'dark' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
  });
  const drag = async (x1, y1, x2, y2, steps = 12) => {
    await touch('touchStart', x1, y1);
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps);
    }
    await touch('touchEnd', x2, y2);
    await page.waitForTimeout(900);
  };
  const state = () => page.evaluate(() => {
    const scroll = document.querySelector('.sheet-scroll');
    const b = scroll.getBoundingClientRect();
    return {
      hidden: document.getElementById('detail-sheet').hidden,
      ticker: document.getElementById('detail-ticker').textContent.trim(),
      hasLogoId: !!document.getElementById('detail-logo'),
      opacity: getComputedStyle(scroll).opacity,
      x: Math.round(b.x),
      chart: !!document.querySelector('#chart-wrap svg, #chart-wrap .chart-error'),
    };
  });
  const usable = (s) => !s.hidden && s.opacity === '1' && Math.abs(s.x) < 40 && s.chart;

  await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ranks-rows .row', { timeout: 30000 });
  await page.waitForTimeout(2500);

  // Open directly on a known white-ink mark, then page off it and back.
  const board = await page.evaluate(() =>
    [...document.querySelectorAll('#ranks-rows .row[data-symbol]')].map((r) => r.dataset.symbol));
  const onDark = await page.evaluate(() =>
    (typeof EMBEDDED_LEADERBOARD === 'undefined' ? [] : EMBEDDED_LEADERBOARD.companies)
      .filter((c) => c.logoOnDark).map((c) => c.symbol));
  const target = onDark.find((s) => board.indexOf(s) > 2) || board[5];
  const idx = board.indexOf(target);
  check(`found a white-ink logo to test (${target}, ${onDark.length} such names)`, idx > 2);

  await page.locator(`#ranks-rows .row[data-symbol="${target}"]`).click();
  await page.waitForSelector('#detail-sheet:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(1800);
  let s = await state();
  check(`sheet opens on ${target}`, usable(s) && s.ticker === target);
  check(`#detail-logo survives rendering ${target}`, s.hasLogoId);

  const sheet = await page.locator('#detail-sheet').boundingBox();
  const y = sheet.y + 120;

  // The reported gesture: swipe right several times in a row.
  for (let i = 1; i <= 4; i++) {
    await drag(sheet.x + sheet.width * 0.25, y, sheet.x + sheet.width * 0.9, y);
    s = await state();
    check(`swipe ${i} keeps the sheet usable (${s.ticker})`, usable(s));
  }
  await page.screenshot({ path: `${S}-after-swipes.png` });

  // ...then close and tap another row, which is where it went fully dead.
  await page.evaluate(() => document.getElementById('sheet-close').click());
  await page.waitForTimeout(800);
  await page.locator('#ranks-rows .row').nth(1).click();
  await page.waitForTimeout(2000);
  s = await state();
  check(`reopening after all that still works (${s.ticker})`, usable(s));
  await page.screenshot({ path: `${S}-reopened.png` });

  // Every white-ink name in turn, since each one used to poison the next render.
  let allOk = true;
  for (const sym of onDark.slice(0, 8)) {
    await page.evaluate(() => document.getElementById('sheet-close').click());
    await page.waitForTimeout(450);
    await page.locator(`#ranks-rows .row[data-symbol="${sym}"]`).click();
    await page.waitForTimeout(1100);
    const st = await state();
    if (!usable(st) || st.ticker !== sym || !st.hasLogoId) { allOk = false; console.log('  broke on', sym, JSON.stringify(st)); }
  }
  check(`opening ${Math.min(8, onDark.length)} white-ink names in a row all render`, allOk);

  check(`no page errors (${errors.length})`, errors.length === 0);
  if (errors.length) console.log('ERRORS:', JSON.stringify(errors.slice(0, 4), null, 1));

  await context.close();
  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
