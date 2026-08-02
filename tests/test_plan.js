// The projection channel on the Portfolio view, and the watchlist insights
// strip: sector mix, the HRP-weighted plan with 15% vol targeting and the
// %/$ toggle, and the held-vs-plan card's empty state. Everything computes
// client-side, so the same assertions run against the live server and the
// static bundle.
const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');

const BASE = process.argv[2] || 'http://localhost:3210';
const S = require('os').tmpdir();
const WATCH = ['SNDK', 'WDC', 'TRGP', 'STT', 'DELL', 'CSX', 'FTNT', 'NVDA'];

const results = [];
const check = (n, c) => results.push(`${c ? 'PASS' : 'FAIL'} - ${n}`);

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errors = [];
  const ctx = await browser.newContext({
    ...devices['iPhone 14 Pro'], viewport: { width: 393, height: 852 }, colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource|ERR_ABORTED|ERR_CONNECTION_RESET/.test(m.text())) return;
    errors.push(m.text());
  });
  await page.addInitScript((w) => {
    localStorage.setItem('teatime.watchlist', JSON.stringify(w));
    localStorage.setItem('teatime.investingView', 'portfolio');
    localStorage.setItem('teatime.settings', JSON.stringify({ correlationThreshold: 1 }));
  }, WATCH);
  await page.goto(`${BASE}#investing`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#projection-card:not([hidden])', { timeout: 30000 });
  await page.waitForTimeout(900);

  // ── the projection channel ────────────────────────────────────────
  const port = await page.evaluate(async () => {
    if (typeof EMBEDDED_PORTFOLIO !== 'undefined') return EMBEDDED_PORTFOLIO;
    return (await fetch('/api/portfolio')).json();
  });
  const proj = await page.evaluate(() => ({
    rows: Object.fromEntries([...document.querySelectorAll('#projection-card .stat-row')]
      .map((r) => [r.querySelector('.stat-label').textContent.trim(), r.querySelector('.stat-value').textContent.trim()])),
    layers: ['.proj-band.outer', '.proj-band.inner', '.proj-mid', '.proj-today', '.proj-history']
      .map((sel) => !!document.querySelector(`#projection-wrap ${sel}`)),
    axis: [...document.querySelectorAll('#projection-card .proj-axis span')].map((e) => e.textContent.trim()),
    note: document.querySelector('#projection-card .portfolio-note').textContent,
  }));

  check('the projection card renders all five layers (bands, centre, today, history)',
    proj.layers.every(Boolean));
  check(`its axis runs start → today → three months out (${proj.axis.join(' / ')})`,
    proj.axis.length === 3 && proj.axis[1] === 'today');
  check('the copy owns up to being arithmetic, not a promise',
    /assumes the trend/.test(proj.note) && /no market promises/.test(proj.note));

  // Recompute the fit independently from the same series the app used.
  {
    const series = port.series;
    const n = series.length;
    const ys = series.map(([, b]) => Math.log(b));
    const xm = (n - 1) / 2;
    const ym = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0; let sxx = 0;
    for (let i = 0; i < n; i++) { sxy += (i - xm) * (ys[i] - ym); sxx += (i - xm) ** 2; }
    const slope = sxy / sxx;
    const intercept = ym - slope * xm;
    const sigma = Math.sqrt(ys.reduce((a, y, i) => a + (y - (intercept + slope * i)) ** 2, 0) / (n - 2));
    const trendPct = (Math.exp(slope * 252) - 1) * 100;
    const endI = n - 1 + 63;
    const mid = Math.exp(intercept + slope * endI);
    const lo = Math.exp(intercept + slope * endI - sigma);
    const hi = Math.exp(intercept + slope * endI + sigma);
    const money = (v) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    check(`the trend figure matches an independent refit (${proj.rows.Trend})`,
      proj.rows.Trend === `${trendPct >= 0 ? '+' : ''}${trendPct.toFixed(1)}%/yr`);
    const onTrendKey = Object.keys(proj.rows).find((k) => /^On trend by /.test(k));
    check(`so does the on-trend balance (${proj.rows[onTrendKey]})`,
      proj.rows[onTrendKey] === money(mid));
    check(`and the ±1σ wobble around it (${proj.rows['Usual wobble around it']})`,
      proj.rows['Usual wobble around it'] === `${money(lo)} – ${money(hi)}`);
  }

  // ── the watchlist insights ────────────────────────────────────────
  await page.click('[data-view="watchlist"]');
  await page.waitForSelector('#watchlist-plan:not([hidden]) .sector-bar-row', { timeout: 45000 });
  await page.waitForTimeout(800);

  const board = await page.evaluate(async () => {
    if (typeof EMBEDDED_LEADERBOARD !== 'undefined') return EMBEDDED_LEADERBOARD;
    return (await fetch('/api/leaderboard')).json();
  });
  const bySym = new Map(board.companies.map((c) => [c.symbol, c]));

  // Sector card counts match the saved names' sectors.
  const sectors = await page.evaluate(() => ({
    bars: [...document.querySelectorAll('#watchlist-sectors .sector-bar-row')].map((r) => ({
      label: r.querySelector('.sector-bar-label').textContent.trim(),
      count: Number(r.querySelector('.sector-bar-count').textContent),
    })),
    note: document.querySelector('#watchlist-sectors .portfolio-note').textContent,
  }));
  // The card labels sectors the same way the board rows do, so the expected
  // counts are keyed by the short label rather than FMP's full string.
  const SHORT = {
    Technology: 'Tech', 'Communication Services': 'Comm', 'Consumer Cyclical': 'Cyclical',
    Healthcare: 'Health', 'Financial Services': 'Finance', 'Consumer Defensive': 'Defensive',
    'Basic Materials': 'Materials',
  };
  const expectedCounts = {};
  for (const sym of WATCH) {
    const raw = (bySym.get(sym) || {}).sector || 'Other';
    const sec = SHORT[raw] || raw;
    expectedCounts[sec] = (expectedCounts[sec] || 0) + 1;
  }
  check(`the sector card carries one bar per sector (${sectors.bars.map((b) => `${b.label}:${b.count}`).join(' ')})`,
    sectors.bars.length === Object.keys(expectedCounts).length
    && sectors.bars.every((b) => expectedCounts[b.label] === b.count));
  check('bars are sorted largest first',
    sectors.bars.every((b, i) => i === 0 || b.count <= sectors.bars[i - 1].count));
  check(`the note states the totals (${sectors.note.trim()})`,
    new RegExp(`${Object.keys(expectedCounts).length} sectors across ${WATCH.length} saved names`).test(sectors.note));

  // The plan card: weights, vol, target scaling.
  const plan = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#watchlist-plan .sector-bar-row')].map((r) => ({
      sym: r.querySelector('.sector-bar-label').textContent.trim(),
      value: r.querySelector('.sector-bar-count').textContent.trim(),
    })),
    stats: Object.fromEntries([...document.querySelectorAll('#watchlist-plan .stat-row')]
      .map((r) => [r.querySelector('.stat-label').textContent.trim(), r.querySelector('.stat-value').textContent.trim()])),
    note: document.querySelector('#watchlist-plan .portfolio-note').textContent,
  }));

  check(`the plan covers every saved name (${plan.rows.length}/${WATCH.length})`,
    plan.rows.length === WATCH.length
    && WATCH.every((sym) => plan.rows.some((r) => r.sym === sym)));
  const pctSum = plan.rows.reduce((a, r) => a + parseFloat(r.value), 0);
  check(`percent weights sum to 100 (${pctSum.toFixed(1)})`, Math.abs(pctSum - 100) < 0.5);
  check('weights are sorted largest first',
    plan.rows.every((r, i) => i === 0 || parseFloat(r.value) <= parseFloat(plan.rows[i - 1].value)));

  const volPct = parseFloat(plan.stats['This mix, left alone']);
  const scale = parseFloat(plan.stats['Scaled to 15%']);
  check(`the mix's volatility is stated (${volPct}%)`, volPct > 3 && volPct < 60);
  check(`and the target scaling is 15 ÷ that (${scale}×)`,
    Math.abs(scale - 15 / volPct) < 0.02);
  check('the copy explains HRP in words and disclaims advice',
    /grouped by how they move\s+together/.test(plan.note) && /not advice/.test(plan.note));

  // Risk direction: the wildest name on the list must get less budget than
  // the calmest. SNDK trails ~115% annualized vol; CSX ~25%.
  const w = Object.fromEntries(plan.rows.map((r) => [r.sym, parseFloat(r.value)]));
  check(`the most volatile name gets the least budget (SNDK ${w.SNDK}% vs CSX ${w.CSX}%)`,
    w.SNDK < w.CSX);

  // The stated volatility is consistent: recompute w'Σw from the same
  // history the app used, with the displayed weights.
  {
    const consistency = await page.evaluate(async (watch) => {
      await loadAllHistories(watch);
      const { symbols, returns } = alignedReturnsFor(watch);
      const cov = covarianceMatrix(returns);
      const shown = [...document.querySelectorAll('#watchlist-plan .sector-bar-row')].map((r) => ({
        sym: r.querySelector('.sector-bar-label').textContent.trim(),
        w: parseFloat(r.querySelector('.sector-bar-count').textContent) / 100,
      }));
      const wv = symbols.map((s) => (shown.find((x) => x.sym === s) || {}).w || 0);
      let v = 0;
      for (let i = 0; i < wv.length; i++) for (let j = 0; j < wv.length; j++) v += wv[i] * wv[j] * cov[i][j];
      return { recomputed: Math.sqrt(v * 252) * 100 };
    }, WATCH);
    check(`the stated volatility matches w'Σw over the same history (${consistency.recomputed.toFixed(1)}% vs ${volPct}%)`,
      Math.abs(consistency.recomputed - volPct) < 0.15);
  }

  // ── the dollar toggle ─────────────────────────────────────────────
  const balance = port.endBalance;
  await page.click('[data-plan-mode="usd"]');
  await page.waitForTimeout(400);
  const dollars = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#watchlist-plan .sector-bar-row')].map((r) => ({
      sym: r.querySelector('.sector-bar-label').textContent.trim(),
      value: r.querySelector('.sector-bar-count').textContent.trim(),
    })),
    total: ([...document.querySelectorAll('#watchlist-plan .stat-row')]
      .find((r) => /Dollars total/.test(r.textContent)) || {}).textContent || '',
    pressed: document.querySelector('[data-plan-mode="usd"]').getAttribute('aria-pressed'),
  }));
  check(`the $ pill lights (${dollars.pressed})`, dollars.pressed === 'true');
  check('every row turns into dollars', dollars.rows.every((r) => /^\$[\d,]+\.\d{2}$/.test(r.value)));
  const parseMoney = (t) => Number(t.replace(/[$,]/g, ''));
  const dollarSum = dollars.rows.reduce((a, r) => a + parseMoney(r.value), 0);
  const expectedTotal = balance * scale;
  check(`dollar rows sum to balance × exposure (${dollarSum.toFixed(0)} vs ${expectedTotal.toFixed(0)})`,
    Math.abs(dollarSum - expectedTotal) < expectedTotal * 0.01);
  check('and the total row says the same',
    Math.abs(parseMoney(dollars.total.replace('Dollars total', '')) - expectedTotal) < expectedTotal * 0.01);
  check(`each dollar figure is its weight times that total (${dollars.rows[0].sym})`,
    dollars.rows.every((r) => {
      const pw = w[r.sym] / 100;
      return Math.abs(parseMoney(r.value) - pw * expectedTotal) < expectedTotal * 0.01;
    }));

  await page.click('[data-plan-mode="pct"]');
  await page.waitForTimeout(300);
  const backPct = await page.$eval('#watchlist-plan .sector-bar-row .sector-bar-count', (e) => e.textContent.trim());
  check(`the toggle returns to percent (${backPct})`, /%$/.test(backPct));

  // ── held vs plan ──────────────────────────────────────────────────
  // The card compares dollars, not shares. That is the whole point of it: a
  // held share is of the whole account while a plan weight is of the plan's own
  // names, so comparing the two put different denominators either side of the
  // "vs" and scored names "on target" that were hundreds of dollars light.
  // These checks recompute every target independently and would fail again if
  // the comparison ever drifted back to percentages.
  const held = await page.evaluate(() => {
    const el = document.getElementById('watchlist-held');
    const rows = [...el.querySelectorAll('.stat-row')].map((r) => ({
      sym: r.querySelector('.stat-label').textContent.trim(),
      value: r.querySelector('.stat-value').textContent.replace(/\s+/g, ' ').trim(),
      muted: r.querySelector('.stat-value').classList.contains('muted'),
      gain: r.querySelector('.stat-value').classList.contains('gain'),
      loss: r.querySelector('.stat-value').classList.contains('loss'),
    }));
    return {
      hidden: el.hidden,
      text: el.textContent.replace(/\s+/g, ' ').trim(),
      rows,
      holdings: typeof portfolioSummary !== 'undefined' && portfolioSummary
        ? portfolioSummary.holdings : null,
    };
  });

  if (/Nothing recorded yet/.test(held.text)) {
    check('held-vs-plan explains how to start instead of pretending', !held.hidden
      && /positions screen/.test(held.text) && /overweight/.test(held.text));
  } else {
    const heldBySym = new Map(held.holdings.positions.map((h) => [h.symbol, h.dollars]));
    const planTotal = balance * scale;
    const planRows = held.rows.filter((r) => Object.hasOwn(w, r.sym));
    const extras = held.rows.filter((r) => !Object.hasOwn(w, r.sym));

    check(`every plan name gets a row (${planRows.length} of ${Object.keys(w).length})`,
      planRows.length === Object.keys(w).length);

    // Each row states held dollars, target dollars, and the gap between them.
    // Held is checked against the raw holdings and the target against a
    // recomputation from the plan card's own weights — those are printed to one
    // decimal, so the target only has to agree to a couple of percent. The gap
    // and the verdict are then checked against the row's own two figures, which
    // is what a reader actually does.
    const num = (s) => Number(s.replace(/,/g, ''));
    const badRow = planRows.find((r) => {
      const m = r.value.match(/^\$([\d,]+) vs \$([\d,]+) — (.+)$/);
      if (!m) return true;
      const shownHeld = num(m[1]);
      const shownTarget = num(m[2]);
      const verdict = m[3];
      const actualHeld = heldBySym.get(r.sym) || 0;
      const wantTarget = (w[r.sym] / 100) * planTotal;
      if (Math.abs(shownHeld - Math.round(actualHeld)) > 1) return true;
      // Slack covers both roundings the recomputation inherits: the weight is
      // read back at one decimal (±0.05pp of the whole pool) and the exposure
      // scaling at two (±0.5%). Still far tighter than a wrong denominator —
      // pricing off the account total instead of the plan's would move every
      // target by about 7%.
      if (Math.abs(shownTarget - wantTarget) > wantTarget * 0.03 + planTotal * 0.001) return true;
      const gap = shownHeld - shownTarget;
      if (actualHeld === 0) return verdict !== 'not held';
      if (Math.abs(gap) <= shownTarget * 0.1) return verdict !== 'on track';
      const g = verdict.match(/^\$([\d,]+) (over|light)$/);
      if (!g) return true;
      if (g[2] !== (gap > 0 ? 'over' : 'light')) return true;
      return Math.abs(num(g[1]) - Math.abs(gap)) > 1;
    });
    check(`each row's held, target and gap are the real dollar figures${badRow ? ` (${badRow.sym}: ${badRow.value})` : ''}`,
      !badRow);

    // The regression itself: a name whose share of the account happens to sit
    // near its plan weight, but whose dollars are well short, must not read as
    // on track. UNH did exactly this — 3.2% vs 4.1% "on target", $346 light.
    const accountTotal = held.holdings.positions.reduce((a, h) => a + h.dollars, 0);
    const falseFriends = planRows.filter((r) => {
      const dollars = heldBySym.get(r.sym) || 0;
      if (dollars === 0) return false;
      const sharePp = Math.abs((dollars / accountTotal) * 100 - w[r.sym]);
      const target = (w[r.sym] / 100) * planTotal;
      return sharePp <= 3 && Math.abs(dollars - target) > target * 0.1;
    });
    check(`names close by share but light in dollars are not called on track (${falseFriends.length} such)`,
      falseFriends.every((r) => !/on track/.test(r.value)));

    check('rows run biggest target first, so the largest gap leads',
      planRows.every((r, i) => i === 0 || w[planRows[i - 1].sym] >= w[r.sym] - 1e-9));
    check('a name missing against a large target is emphasised, not muted',
      planRows.filter((r) => /not held/.test(r.value)).every((r) => !r.muted));
    // Colour marks being on track, never the gap — red is the loss colour here
    // and a gap isn't a loss (the card used to paint every row red at once).
    check('gaps are not painted in the loss colour',
      planRows.every((r) => !r.loss || /on track/.test(r.value)));
    check('on-track rows are the ones that carry colour',
      planRows.filter((r) => /on track/.test(r.value)).every((r) => r.gain));
    check(`holdings outside the plan are listed after it, muted (${extras.length})`,
      extras.length === 0 || (extras.every((r) => r.muted && /held —/.test(r.value))
        && held.rows.indexOf(extras[0]) > held.rows.indexOf(planRows[planRows.length - 1])));

    const covered = planRows.reduce((a, r) => a + (heldBySym.get(r.sym) || 0), 0);
    check('the note reconciles what is held inside the plan against the rest',
      held.text.includes(`$${Math.round(covered).toLocaleString('en-US')} of those`)
      && held.text.includes(`$${Math.round(accountTotal - covered).toLocaleString('en-US')} in ${extras.length}`));

    // The %/$ toggle drives the plan card only — this one is always dollars.
    await page.click('[data-plan-mode="usd"]');
    await page.waitForTimeout(250);
    const afterToggle = await page.$eval('#watchlist-held', (e) => e.textContent.replace(/\s+/g, ' ').trim());
    check('the %/$ toggle leaves the held comparison in dollars', afterToggle === held.text);
    await page.click('[data-plan-mode="pct"]');
    await page.waitForTimeout(250);
  }

  // Sector labels match the ones the board rows carry, rather than FMP's full
  // strings — "Health", not "Healthcare", in both places.
  const sectorLabels = await page.$$eval('#watchlist-sectors .sector-bar-label',
    (els) => els.map((e) => e.textContent.trim()));
  check(`sector names match the board's short labels (${sectorLabels.join(', ')})`,
    sectorLabels.length > 0
    && !sectorLabels.some((l) => ['Healthcare', 'Financial Services', 'Basic Materials',
      'Communication Services', 'Consumer Cyclical', 'Consumer Defensive'].includes(l)));
  const clipped = await page.$$eval('#watchlist-sectors .sector-bar-label',
    (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim()));
  check(`no sector label is clipped${clipped.length ? ` (${clipped.join(', ')})` : ''}`, clipped.length === 0);

  await page.screenshot({ path: `${S}/plan-final.png` });

  // ── an empty watchlist hides the whole strip ──────────────────────
  // Its own context: this page's init script re-seeds the watchlist on every
  // navigation, so clearing it and reloading would just plant it again — the
  // exact trap tests/README.md warns about.
  {
    const c2 = await browser.newContext({ ...devices['iPhone 14 Pro'], colorScheme: 'dark' });
    const p2 = await c2.newPage();
    p2.on('pageerror', (e) => errors.push(String(e)));
    await p2.addInitScript(() => {
      localStorage.setItem('teatime.watchlist', '[]');
      localStorage.setItem('teatime.investingView', 'watchlist');
    });
    await p2.goto(`${BASE}#investing`, { waitUntil: 'domcontentloaded' });
    await p2.waitForSelector('#panel-investing:not([hidden])', { timeout: 30000 });
    await p2.waitForTimeout(1200);
    const empty = await p2.evaluate(() => ({
      sectors: document.getElementById('watchlist-sectors').hidden,
      plan: document.getElementById('watchlist-plan').hidden,
      held: document.getElementById('watchlist-held').hidden,
    }));
    check('with nothing saved, no insight card shows',
      empty.sectors && empty.plan && empty.held);
    await c2.close();
  }
  if (errors.length) console.log('ERRORS:', errors.slice(0, 6));
  check('no page errors', errors.length === 0);

  await browser.close();
  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
