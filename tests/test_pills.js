// 12M / 6M preset pills on the Ranks board: they set the ranking window that
// Settings' steppers also control, and the two stay in step.
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

  // A window matching neither preset, so nothing starts lit.
  await page.addInitScript(() => {
    localStorage.setItem('teatime.settings', JSON.stringify({
      volAdjusted: true,
      correlationThreshold: 0.7,
      rankDateRange: { startDaysAgo: 120, endDaysAgo: 17 },
    }));
  });

  await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  // Present before the board is: the pills render at init, not with the data.
  await page.waitForSelector('#ranks-window-pills .window-pill', { timeout: 15000 });
  const early = await page.evaluate(() => ({
    pills: [...document.querySelectorAll('#ranks-window-pills .window-pill')].map((b) => b.textContent.trim()),
    rows: document.querySelectorAll('#ranks-rows .row').length,
  }));
  check(`pills exist before the board loads (${early.pills.join(' ')}, ${early.rows} rows)`,
    early.pills.join(' ') === '12M 6M');

  await page.waitForSelector('#ranks-rows .row', { timeout: 30000 });
  await page.waitForTimeout(2500);

  const readState = () => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('teatime.settings') || '{}');
    const pressed = [...document.querySelectorAll('#ranks-window-pills .window-pill')]
      .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim());
    return {
      range: stored.rankDateRange,
      pressed,
      label: document.querySelector('#ranks-score-label .section-label-value')?.textContent.trim(),
      first: document.querySelector('#ranks-rows .row')?.dataset.symbol,
      score: document.querySelector('#ranks-rows .row .score-value')?.textContent.trim(),
    };
  });

  const custom = await readState();
  check(`a custom window lights no pill (${custom.range.startDaysAgo}-${custom.range.endDaysAgo})`,
    custom.pressed.length === 0);
  await page.screenshot({ path: `${S}-custom.png` });

  // ── 12M ──
  await page.click('#ranks-window-pills .window-pill[data-preset="12M"]');
  await page.waitForTimeout(3000);
  const twelve = await readState();
  check(`12M sets the window to 250-20 (${twelve.range.startDaysAgo}-${twelve.range.endDaysAgo})`,
    twelve.range.startDaysAgo === 250 && twelve.range.endDaysAgo === 20);
  check(`and lights only that pill (${twelve.pressed.join(',')})`,
    twelve.pressed.length === 1 && twelve.pressed[0] === '12M');
  check(`the header window text follows (${twelve.label})`, twelve.label !== custom.label);
  check(`and the board re-ranked (${custom.first} -> ${twelve.first})`,
    !!twelve.first && twelve.first !== custom.first);
  await page.screenshot({ path: `${S}-12m.png` });

  // ── 6M ──
  await page.click('#ranks-window-pills .window-pill[data-preset="6M"]');
  await page.waitForTimeout(3000);
  const six = await readState();
  check(`6M sets the window to 130-16 (${six.range.startDaysAgo}-${six.range.endDaysAgo})`,
    six.range.startDaysAgo === 130 && six.range.endDaysAgo === 16);
  check(`and lights only that pill (${six.pressed.join(',')})`,
    six.pressed.length === 1 && six.pressed[0] === '6M');
  check(`the board re-ranked again (${twelve.first} -> ${six.first})`, six.first !== twelve.first);
  await page.screenshot({ path: `${S}-6m.png` });

  // ── Settings shows the same window ──
  await page.click('[data-tab="settings"]');
  await page.waitForTimeout(800);
  const settings = await page.evaluate(() => {
    const days = [...document.querySelectorAll('#daterange-settings .stepper-days')]
      .map((e) => e.textContent.trim());
    return days;
  });
  check(`Settings' steppers show the preset (${settings.join(' / ')})`,
    settings[0] === '130 days ago' && settings[1] === '16 days ago');
  await page.screenshot({ path: `${S}-settings.png` });

  // ── nudging a stepper takes the pill back off ──
  await page.click('#daterange-settings .stepper-btn[data-field="end"][data-dir="1"]');
  await page.waitForTimeout(3000);
  await page.click('[data-tab="ranks"]');
  await page.waitForTimeout(900);
  const nudged = await readState();
  check(`a stepper nudge unlights the pills (${nudged.range.startDaysAgo}-${nudged.range.endDaysAgo}, ${nudged.pressed.length} lit)`,
    nudged.pressed.length === 0 && nudged.range.endDaysAgo === 18);

  // ── tapping the lit pill again is a no-op, not a toggle-off ──
  await page.click('#ranks-window-pills .window-pill[data-preset="12M"]');
  await page.waitForTimeout(2500);
  await page.click('#ranks-window-pills .window-pill[data-preset="12M"]');
  await page.waitForTimeout(1200);
  const again = await readState();
  check(`re-tapping the active pill keeps it set (${again.range.startDaysAgo}-${again.range.endDaysAgo})`,
    again.range.startDaysAgo === 250 && again.range.endDaysAgo === 20 && again.pressed.length === 1);

  // ── the choice survives a reload ──
  await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ranks-rows .row', { timeout: 30000 });
  await page.waitForTimeout(2500);
  const reloaded = await readState();
  check(`the window persists across a reload (${reloaded.pressed.join(',')})`,
    reloaded.pressed.length === 1 && reloaded.pressed[0] === '12M');

  // ── the header stays put while the board scrolls ──
  const stuck = await page.evaluate(() => {
    window.scrollTo(0, 1400);
    return new Promise((r) => requestAnimationFrame(() => {
      const h = document.querySelector('.board-header').getBoundingClientRect();
      const p = document.querySelector('.window-pill').getBoundingClientRect();
      r({ headerTop: Math.round(h.top), pillTop: Math.round(p.top), scrolled: Math.round(window.scrollY) });
    }));
  });
  check(`pills stay on screen when scrolled (${stuck.scrolled}px down, pill at y=${stuck.pillTop})`,
    stuck.scrolled > 800 && stuck.pillTop >= 0 && stuck.pillTop < 140);
  await page.screenshot({ path: `${S}-scrolled.png` });
  await page.evaluate(() => window.scrollTo(0, 0));

  // ── Watchlist is ranked by the same window, and has no pills of its own ──
  const watchlist = await page.evaluate(() => ({
    // The Watchlist has window pills of its own now (the portfolio chart's),
    // so the question is whether any *ranking* preset appears outside Ranks.
    presetsElsewhere: document.querySelectorAll('#panel-watchlist [data-preset], #panel-settings [data-preset]').length,
    headers: document.querySelectorAll('.board-header').length,
  }));
  check(`the ranking presets appear once, on Ranks only (${watchlist.headers} header, ${watchlist.presetsElsewhere} elsewhere)`,
    watchlist.headers === 1 && watchlist.presetsElsewhere === 0);

  check(`no page errors (${errors.length})`, errors.length === 0);
  if (errors.length) console.log('ERRORS:', JSON.stringify(errors.slice(0, 4), null, 1));

  await context.close();
  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
