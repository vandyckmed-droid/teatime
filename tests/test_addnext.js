// The plus on the Watchlist adds the next name down the ranked board, obeying
// the ranking window — and once a name is saved, changing any setting never
// takes it away again. (The old diversification filter also made this skip
// correlated names; the group orbs that replaced it inform without gating, so
// "next" is simply the best-ranked unheld name.)
const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');
const S = require('os').tmpdir();
const BASE = process.argv[2] || `file://${require('path').join(__dirname, '..', 'docs', 'index.html')}`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];
  const check = (n, c) => results.push(`${c ? 'PASS' : 'FAIL'} - ${n}`);
  const context = await browser.newContext({
    ...devices['iPhone 14 Pro'],
    viewport: { width: 393, height: 852 },
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  // Known starting point: 12M window, nothing saved.
  await page.addInitScript(() => {
    localStorage.removeItem('teatime.watchlist');
    localStorage.setItem('teatime.settings', JSON.stringify({
      volAdjusted: false,
      rankDateRange: { startDaysAgo: 250, endDaysAgo: 20 },
    }));
  });

  // The Investing tab remembers which view you were on and defaults to
  // Portfolio; these assertions are about the saved names.
  await page.addInitScript(() => localStorage.setItem('teatime.investingView', 'watchlist'));
  await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ranks-rows .row', { timeout: 30000 });
  await page.waitForTimeout(2800);

  const boardOrder = () => page.evaluate(() =>
    [...document.querySelectorAll('#ranks-rows .row[data-symbol]')].map((r) => ({
      symbol: r.dataset.symbol,
      held: r.querySelector('.add-btn')?.getAttribute('aria-pressed') === 'true',
    })));
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('teatime.watchlist') || '[]'));

  const ranked = await boardOrder();
  check(`board is ranked and unfiltered to start (${ranked.length} rows)`,
    ranked.length > 50 && ranked.every((r) => !r.held));

  await page.click('[data-tab="investing"]');
  await page.waitForTimeout(800);

  // ── the empty-state plus is a real button ──
  const glyph = await page.evaluate(() => {
    const b = document.getElementById('add-next-empty');
    return b ? { tag: b.tagName, disabled: b.disabled, label: b.getAttribute('aria-label') } : null;
  });
  check(`the empty-state plus is an enabled button (${glyph && glyph.tag})`,
    glyph && glyph.tag === 'BUTTON' && !glyph.disabled);
  await page.screenshot({ path: `${S}-empty.png` });

  // ── tap it: the top-ranked name is added ──
  await page.click('#add-next-empty');
  await page.waitForTimeout(2500);
  const first = await saved();
  check(`the plus adds the top-ranked name (${first.join(',')} vs board #1 ${ranked[0].symbol})`,
    first.length === 1 && first[0] === ranked[0].symbol);
  const afterFirst = await page.evaluate(() => ({
    rows: document.querySelectorAll('#watchlist-rows .row').length,
    emptyGone: !document.getElementById('add-next-empty'),
    actionShown: !document.getElementById('watchlist-actions').hidden,
    addLabel: document.getElementById('add-next').textContent.trim(),
  }));
  check('the empty state gives way to the list and the action row',
    afterFirst.rows === 1 && afterFirst.emptyGone && afterFirst.actionShown);
  check(`"${afterFirst.addLabel}" sits beside Clear watchlist`, afterFirst.addLabel === 'Add next ranked');
  await page.screenshot({ path: `${S}-one.png` });

  // ── keep tapping: each adds the next unheld name straight down the board ──
  const order = [first[0]];
  for (let i = 0; i < 3; i++) {
    await page.click('#add-next');
    await page.waitForTimeout(2500);
    const now = await saved();
    order.push(now[now.length - 1]);
  }
  const four = await saved();
  check(`four taps saved four distinct names (${four.join(', ')})`,
    four.length === 4 && new Set(four).size === 4);

  // Each pick must have been the best-ranked unheld name at the time — check
  // the board agrees now: everything above the last pick is held. This is also
  // the regression net for the removed filter: if skipping ever came back,
  // unheld names would sit above the last pick.
  await page.click('[data-tab="ranks"]');
  await page.waitForTimeout(1200);
  const nowBoard = await boardOrder();
  const lastPickIdx = nowBoard.findIndex((r) => r.symbol === four[four.length - 1]);
  const above = nowBoard.slice(0, lastPickIdx);
  const stragglers = above.filter((r) => !r.held);
  check(`nothing was skipped over (${stragglers.length} unheld above rank ${lastPickIdx + 1})`,
    lastPickIdx > 0 && stragglers.length === 0);
  await page.screenshot({ path: `${S}-board.png` });

  // ── the correlation flag informs but never gates what "next" means ──
  // The echo flag has no Settings knob any more (hardwired bar), so the check
  // is simpler: flagged names must be picked exactly like unflagged ones.
  await page.click('[data-tab="investing"]');
  await page.waitForTimeout(700);
  await page.click('#add-next');
  await page.waitForTimeout(2500);
  const five = await saved();
  await page.click('[data-tab="ranks"]');
  await page.waitForTimeout(1000);
  const unfiltered = await boardOrder();
  const firstFree = unfiltered.find((r) => !r.held);
  check(`the next tap adds the next unheld name regardless of flags (${five[4]})`,
    five.length === 5 && !four.includes(five[4]));
  check(`and nothing above it is left unheld (next free is now ${firstFree && firstFree.symbol})`,
    unfiltered.slice(0, unfiltered.findIndex((r) => r.symbol === five[4])).every((r) => r.held));

  // ── the ranking window changes what "next" means, but not what's saved ──
  await page.click('.window-pill[data-preset="6M"]');
  await page.waitForTimeout(3000);
  const keptAfterWindow = await saved();
  check(`switching to the 6M window keeps every saved name (${keptAfterWindow.length})`,
    keptAfterWindow.length === 5 && five.every((s) => keptAfterWindow.includes(s)));

  const sixMonthBoard = await boardOrder();
  check(`the board itself did re-rank (${sixMonthBoard[0].symbol} now #1, was ${nowBoard[0].symbol})`,
    sixMonthBoard[0].symbol !== nowBoard[0].symbol);

  await page.click('[data-tab="investing"]');
  await page.waitForTimeout(900);
  await page.click('#add-next');
  await page.waitForTimeout(2500);
  const six = await saved();
  await page.click('[data-tab="ranks"]');
  await page.waitForTimeout(1000);
  const board6 = await boardOrder();
  const pickIdx = board6.findIndex((r) => r.symbol === six[5]);
  check(`the next pick follows the new window (${six[5]} at rank ${pickIdx + 1})`,
    six.length === 6 && board6.slice(0, pickIdx).every((r) => r.held));

  // ── still removable one at a time, and by Clear ──
  await page.click('[data-tab="investing"]');
  await page.waitForTimeout(900);
  await page.locator('#watchlist-rows .add-btn').first().click();
  await page.waitForTimeout(2000);
  const afterRemove = await saved();
  check(`tapping a check still removes one (${six.length} -> ${afterRemove.length})`,
    afterRemove.length === 5);

  await page.click('#clear-watchlist');
  await page.waitForTimeout(500);
  await page.click('#clear-watchlist');
  await page.waitForTimeout(2000);
  const cleared = await saved();
  check(`Clear watchlist still empties it (${cleared.length})`, cleared.length === 0);
  check('and the empty-state plus is back',
    await page.evaluate(() => !!document.getElementById('add-next-empty')));

  // ── a reload keeps whatever is saved ──
  await page.click('#add-next-empty');
  await page.waitForTimeout(2500);
  const beforeReload = await saved();
  await page.goto(`${BASE}#investing`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#watchlist-rows .row', { timeout: 30000 });
  await page.waitForTimeout(2000);
  const afterReload = await saved();
  check(`saved names survive a reload (${afterReload.join(',')})`,
    afterReload.length === beforeReload.length && afterReload[0] === beforeReload[0]);

  check(`no page errors (${errors.length})`, errors.length === 0);
  if (errors.length) console.log('ERRORS:', JSON.stringify(errors.slice(0, 4), null, 1));

  await context.close();
  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
