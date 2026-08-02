// The echo flag: a top-50 name whose daily moves track at least one name
// ranked above it (pairwise r >= the hardwired ECHO_THRESHOLD over the
// ranking window) wears one amber ring. Deliberately not a grouping or
// colour-coding system, and deliberately independent of the watchlist —
// both were built and cut at the owner's request. This suite recomputes the
// flag definition independently and checks the board agrees.
const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');
const S = require('os').tmpdir();
const BASE = process.argv[2] || 'http://localhost:3425';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];
  const check = (n, c) => results.push(`${c ? 'PASS' : 'FAIL'} - ${n}`);
  const context = await browser.newContext({ ...devices['iPhone 14 Pro'], colorScheme: 'dark' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ranks-rows .row', { timeout: 30000 });
  await page.waitForFunction(
    () => document.querySelectorAll('#ranks-rows .row[data-flags~="echo"]').length > 0,
    null, { timeout: 45000 },
  ).catch(() => null);

  const board = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#ranks-rows .row[data-symbol]')];
    return rows.map((r, i) => ({
      sym: r.dataset.symbol,
      pos: i + 1,
      flagged: (r.dataset.flags || '').includes('echo'),
      aria: r.getAttribute('aria-label'),
    }));
  });
  const flagged = board.filter((r) => r.flagged);

  // ── the shape of the flag ──
  check(`flags exist (${flagged.length} of top 50)`, flagged.length >= 5);
  check(`roughly one in four of the top 50 (${flagged.length})`,
    flagged.length >= 8 && flagged.length <= 20);
  check('rank 1 can never be flagged — nothing is above it', !board[0].flagged);
  check(`nothing below the top 50 is flagged (${board.filter((r) => r.pos > 50 && r.flagged).length})`,
    board.filter((r) => r.pos > 50 && r.flagged).length === 0);
  check('every flagged row speaks the reason',
    flagged.every((r) => /tracks a higher-ranked name/.test(r.aria)));
  const callout = await page.$eval('#ranks-callout-text', (e) => e.textContent).catch(() => '');
  check('the callout explains the ring and the bar',
    new RegExp(`${flagged.length} of the top 50`).test(callout) && /0\.72/.test(callout));

  // ── independent recomputation of the definition itself ──
  // Recompute best-correlation-above for the first few flagged and unflagged
  // rows from the app's own history cache, entirely outside its flag code.
  const audit = await page.evaluate(() => {
    const T = 0.72;
    const { startDaysAgo, endDaysAgo } = state.settings.rankDateRange;
    const dstr = (n) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
    const startStr = dstr(startDaysAgo);
    const endStr = dstr(endDaysAgo);
    const rows = [...document.querySelectorAll('#ranks-rows .row[data-symbol]')].slice(0, 50)
      .map((r) => ({ sym: r.dataset.symbol, flagged: (r.dataset.flags || '').includes('echo') }));
    const corr = (a, b) => {
      const mb = new Map(b.map((p) => [p.date, p.close]));
      const pairs = [];
      for (const p of a) {
        if (p.date < startStr || p.date > endStr) continue;
        const v = mb.get(p.date);
        if (v !== undefined && p.close > 0 && v > 0) pairs.push([p.close, v]);
      }
      const n = pairs.length - 1;
      if (n < 20) return null;
      const ra = []; const rb = [];
      for (let i = 1; i < pairs.length; i++) { ra.push(pairs[i][0] / pairs[i - 1][0] - 1); rb.push(pairs[i][1] / pairs[i - 1][1] - 1); }
      const ma = ra.reduce((x, y) => x + y, 0) / n; const mbn = rb.reduce((x, y) => x + y, 0) / n;
      let cov = 0; let va = 0; let vb = 0;
      for (let i = 0; i < n; i++) { const da = ra[i] - ma; const db = rb[i] - mbn; cov += da * db; va += da * da; vb += db * db; }
      return (va > 0 && vb > 0) ? cov / Math.sqrt(va * vb) : null;
    };
    const out = [];
    for (let k = 0; k < rows.length; k++) {
      const mine = (historyCache.get(rows[k].sym) || {}).series;
      if (!mine) continue;
      let best = -2;
      for (let j = 0; j < k; j++) {
        const theirs = (historyCache.get(rows[j].sym) || {}).series;
        if (!theirs) continue;
        const r = corr(mine, theirs);
        if (r !== null && r > best) best = r;
      }
      out.push({ sym: rows[k].sym, flagged: rows[k].flagged, best });
      if (out.length >= 50) break;
    }
    return { checked: out, threshold: T };
  });
  // Rows right at the threshold can disagree by float noise; leave a margin.
  const wrong = audit.checked.filter((r) =>
    (r.best >= audit.threshold + 0.01 && !r.flagged) || (r.best < audit.threshold - 0.01 && r.flagged && r.best > -2));
  check(`the flag matches an independent recomputation (${wrong.length} disagree${wrong.length ? `: ${wrong.slice(0, 3).map((w) => `${w.sym}@${w.best.toFixed(2)}`).join(', ')}` : ''})`,
    wrong.length === 0);

  // ── the flag is watchlist-independent: saving a name changes nothing ──
  const target = flagged[0].sym;
  const before = await page.evaluate(() => [...document.querySelectorAll('#ranks-rows .row[data-flags~="echo"]')].map((r) => r.dataset.symbol).join(','));
  await page.locator(`#ranks-rows .row[data-symbol="${target}"] .add-btn`).click();
  await page.waitForTimeout(1200);
  const afterSave = await page.evaluate(() => [...document.querySelectorAll('#ranks-rows .row[data-flags~="echo"]')].map((r) => r.dataset.symbol).join(','));
  check('saving a flagged name neither adds nor removes any flag', afterSave === before);
  const savedRow = await page.evaluate((sym) => {
    const r = document.querySelector(`#ranks-rows .row[data-symbol="${sym}"]`);
    return { flagged: (r.dataset.flags || '').includes('echo'), selected: r.classList.contains('is-selected') };
  }, target);
  check('a saved flagged row wears ring and saved treatment together',
    savedRow.flagged && savedRow.selected);
  await page.locator(`#ranks-rows .row[data-symbol="${target}"] .add-btn`).click();
  await page.waitForTimeout(800);

  // ── no threshold control exists any more — the bar is hardwired ──
  await page.click('[data-tab="settings"]');
  await page.waitForTimeout(600);
  const settingsProbe = await page.evaluate(() => ({
    thresholdEl: !!document.getElementById('threshold-value'),
    steppersInList: document.querySelectorAll('#settings-list .stepper-btn').length,
  }));
  check('no tightness stepper survives in Settings',
    !settingsProbe.thresholdEl && settingsProbe.steppersInList === 0);

  await page.screenshot({ path: `${S}-echo.png` });
  check(`no page errors (${errors.length})`, errors.length === 0);
  if (errors.length) console.log('ERRORS:', JSON.stringify(errors.slice(0, 4)));

  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
