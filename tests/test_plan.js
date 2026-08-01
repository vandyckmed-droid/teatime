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
  const expectedCounts = {};
  for (const sym of WATCH) {
    const sec = (bySym.get(sym) || {}).sector || 'Other';
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

  // ── held vs plan, before any holdings exist ───────────────────────
  const held = await page.evaluate(() => {
    const el = document.getElementById('watchlist-held');
    return { hidden: el.hidden, text: el.textContent.replace(/\s+/g, ' ').trim() };
  });
  if (/Nothing recorded yet/.test(held.text)) {
    check('held-vs-plan explains how to start instead of pretending', !held.hidden
      && /positions screen/.test(held.text) && /overweight/.test(held.text));
  } else {
    check('held-vs-plan compares real holdings against the plan',
      !held.hidden && /vs/.test(held.text) && /on target|overweight|underweight|not held/.test(held.text));
  }

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
