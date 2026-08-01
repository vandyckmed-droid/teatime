// The portfolio card on the Watchlist tab, and the numbers behind it.
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

  await page.goto(`${BASE}#investing`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#portfolio-card:not([hidden])', { timeout: 30000 });
  await page.waitForTimeout(1500);

  const card = await page.evaluate(() => {
    const c = document.getElementById('portfolio-card');
    const rows = {};
    c.querySelectorAll('.stat-row').forEach((r) => {
      rows[r.querySelector('.stat-label').textContent.trim()] =
        r.querySelector('.stat-value').textContent.trim();
    });
    return {
      label: c.querySelector('.portfolio-label').textContent.trim(),
      balance: c.querySelector('.portfolio-balance').textContent.trim(),
      pct: c.querySelector('.portfolio-change span').textContent.trim(),
      pctClass: c.querySelector('.portfolio-change span').className,
      dollars: c.querySelector('.portfolio-change .delta').textContent.trim(),
      since: c.querySelector('.portfolio-change .since').textContent.trim(),
      note: c.querySelector('.portfolio-note').textContent.trim(),
      rows,
      width: Math.round(c.getBoundingClientRect().width),
    };
  });

  // What the data layer says, so these assertions don't go stale every time a
  // balance is appended. Works either way round: the bundle embeds it, the
  // live server serves it.
  const api = await page.evaluate(async () => {
    if (typeof EMBEDDED_PORTFOLIO !== 'undefined') return EMBEDDED_PORTFOLIO;
    return (await fetch('/api/portfolio')).json();
  });
  const money = (v) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const longDate = (s) => { const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };

  check(`the card is titled and shows a balance ("${card.label}" ${card.balance})`,
    /portfolio/i.test(card.label) && /^\$[\d,]+\.\d{2}$/.test(card.balance));
  check(`balance is the last recorded one (${card.balance})`, card.balance === money(api.endBalance));
  check(`return is shown and coloured (${card.pct}, ${card.pctClass})`,
    card.pct === `+${api.totalReturnPct.toFixed(1)}%` && card.pctClass === 'gain');
  check(`dollar change alongside it (${card.dollars})`, card.dollars === `+${money(api.changeDollars)}`);
  check(`and the date it is measured from (${card.since})`, card.since === `since ${longDate(api.start)}`);

  check(`annualized return row (${card.rows['Annualized return']})`,
    card.rows['Annualized return'] === `+${api.annualizedReturnPct.toFixed(1)}%`);
  check(`volatility row (${card.rows.Volatility})`,
    card.rows.Volatility === `${api.annualizedVolPct.toFixed(1)}% annualized`);
  check(`15% target exposure row (${card.rows['15% vol target']})`,
    card.rows['15% vol target'] === `${api.exposureScale.toFixed(2)}× exposure`);
  check(`best/worst day row (${card.rows['Best / worst day']})`,
    card.rows['Best / worst day'] === `+${api.best.toFixed(1)}% / ${api.worst.toFixed(1)}%`);
  check(`session count (${card.rows['Sessions recorded']})`, card.rows['Sessions recorded'] === String(api.sessions));
  check('the note says the figures are ours, not the broker\'s', /not from the broker/i.test(card.note));
  check(`and that gap-spanning steps were excluded (${/4 steps/.test(card.note)})`,
    /4 steps spanning a gap/.test(card.note));
  check(`the card fits the phone column (${card.width}px)`, card.width > 300 && card.width <= 440);

  // Nothing about the watchlist itself should have changed.
  const empty = await page.evaluate(() => ({
    emptyState: !!document.querySelector('#watchlist-rows .empty-state'),
    head: document.getElementById('watchlist-board-head').hidden,
    actions: document.getElementById('watchlist-actions').hidden,
  }));
  check('the empty watchlist state still shows below the card',
    empty.emptyState && empty.head && empty.actions);
  await page.screenshot({ path: `${S}-empty.png` });

  // …and with names saved, the two live in separate views of the same tab
  // rather than sharing one scroll.
  await page.click('[data-tab="ranks"]');
  await page.waitForSelector('#ranks-rows .row', { timeout: 30000 });
  await page.waitForTimeout(2000);
  // aria-pressed="false" as well as enabled: the diversification filter
  // disables anything too correlated with what's saved, and clicking an
  // already-saved row's button removes it again.
  let saved = 0;
  for (let n = 0; n < 3; n++) {
    const btn = page.locator('#ranks-rows .add-btn:not([disabled])[aria-pressed="false"]').first();
    if (!(await btn.count())) break;
    await btn.click();
    saved += 1;
    await page.waitForTimeout(600);
  }
  await page.click('[data-tab="investing"]');
  await page.waitForTimeout(900);
  const split = await page.evaluate(() => ({
    cardView: document.getElementById('portfolio-card').closest('[data-subview]').dataset.subview,
    rowsView: document.getElementById('watchlist-rows').closest('[data-subview]').dataset.subview,
    cardShown: !document.querySelector('[data-subview="portfolio"]').hidden,
    rowsShown: !document.querySelector('[data-subview="watchlist"]').hidden,
  }));
  check(`the card and the names are in separate views (${split.cardView} / ${split.rowsView})`,
    split.cardView === 'portfolio' && split.rowsView === 'watchlist');
  check('and only one of them is on screen at a time',
    split.cardShown !== split.rowsShown);

  await page.click('[data-segmented="investing"] button[data-view="watchlist"]');
  await page.waitForTimeout(900);
  const withRows = await page.evaluate(() => ({
    rows: document.querySelectorAll('#watchlist-rows .row').length,
    cardHidden: document.querySelector('[data-subview="portfolio"]').hidden,
  }));
  check(`the saved names are in the Watchlist view (${withRows.rows} of ${saved} saved)`,
    saved > 0 && withRows.rows === saved && withRows.cardHidden);
  await page.screenshot({ path: `${S}-rows.png` });

  // It shouldn't appear anywhere else.
  const elsewhere = await page.evaluate(() => {
    const c = document.getElementById('portfolio-card');
    return c.closest('.panel').dataset.panel;
  });
  check(`the card lives on the Investing tab only (${elsewhere})`, elsewhere === 'investing');

  check(`no page errors (${errors.length})`, errors.length === 0);
  if (errors.length) console.log('ERRORS:', JSON.stringify(errors.slice(0, 4), null, 1));

  await context.close();
  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
