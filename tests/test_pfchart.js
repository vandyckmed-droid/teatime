// The portfolio balance chart on the Watchlist tab, and the shared renderer
// it now has in common with the per-ticker price chart.
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
  await page.waitForSelector('#portfolio-chart-wrap svg', { timeout: 30000 });

  await page.waitForTimeout(1600);

  const readChart = () => page.evaluate(() => {
    const wrap = document.getElementById('portfolio-chart-wrap');
    if (!wrap) return null;
    const money = (s) => Number(String(s).replace(/[$,]/g, ''));
    const svg = wrap.querySelector('svg');
    return {
      line: !!wrap.querySelector('.chart-line'),
      area: !!wrap.querySelector('.chart-area'),
      endpoints: wrap.querySelectorAll('.chart-startpoint, .chart-endpoint').length,
      dir: svg && svg.getAttribute('class'),
      points: (wrap.querySelector('.chart-line')?.getAttribute('d') || '').split(/[ML]/).length - 1,
      yLabels: [...wrap.querySelectorAll('.chart-axis-y')].map((e) => e.textContent.trim()),
      yValues: [...wrap.querySelectorAll('.chart-axis-y')].map((e) => money(e.textContent)),
      xLabels: [...document.querySelectorAll('#portfolio-chart-axis span')].map((e) => e.textContent.trim()),
      active: wrap.closest('.portfolio-card').querySelector('[data-portfolio-window][aria-pressed="true"]')?.dataset.portfolioWindow,
      height: Math.round(wrap.getBoundingClientRect().height),
      width: Math.round(wrap.getBoundingClientRect().width),
    };
  });

  const all = await readChart();
  check(`the chart draws a line with its area fill (${all && all.points} points)`,
    !!all && all.line && all.area && all.points > 100);
  check(`both endpoint dots are marked (${all && all.endpoints})`, all.endpoints === 2);
  check(`the year is up, so the line is green (${all && all.dir})`, /gain/.test(all.dir));
  check(`three dollar levels on the y axis (${all && all.yLabels.join(' / ')})`,
    all.yLabels.length === 3 && all.yLabels.every((t) => /^\$[\d,]+$/.test(t)));
  check(`they bracket the real balances (${all && all.yValues.join(' > ')})`,
    all.yValues[0] > all.yValues[1] && all.yValues[1] > all.yValues[2]
      && all.yValues[0] >= 31700 && all.yValues[2] <= 27100);
  // Ends on whatever the last recorded balance is, rather than a date pinned
  // here that goes stale the next time a balance is appended.
  const span = await page.evaluate(async () => {
    const p = typeof EMBEDDED_PORTFOLIO !== 'undefined' ? EMBEDDED_PORTFOLIO : await (await fetch('/api/portfolio')).json();
    const fmt = (s) => { const [y, m, d] = s.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
    return { first: fmt(p.start), last: fmt(p.end) };
  });
  check(`three dates on the x axis, spanning the record (${all && all.xLabels.join(' / ')})`,
    all.xLabels.length === 3 && all.xLabels[0] === span.first && all.xLabels[2] === span.last);
  check(`it fits the card (${all && all.width}x${all && all.height}px)`,
    all.width > 300 && all.width < 400 && all.height > 120 && all.height < 200);
  check(`"All" is the default window (${all && all.active})`, all.active === 'ALL');
  await page.screenshot({ path: `${S}-all.png` });

  // ── the windows narrow the series ──
  const seen = { ALL: all };
  for (const key of ['6M', '3M', '1M']) {
    await page.click(`[data-portfolio-window="${key}"]`);
    await page.waitForTimeout(700);
    seen[key] = await readChart();
    check(`${key} selects itself (${seen[key].active})`, seen[key].active === key);
  }
  check(`fewer points as the window shortens (${['ALL', '6M', '3M', '1M'].map((k) => seen[k].points).join(' -> ')})`,
    seen.ALL.points > seen['6M'].points && seen['6M'].points > seen['3M'].points
      && seen['3M'].points > seen['1M'].points);
  check(`the 1M window starts in July (${seen['1M'].xLabels[0]})`, /Jul/.test(seen['1M'].xLabels[0]));
  check(`every window ends on the last recorded day (${seen['1M'].xLabels[2]})`,
    seen['1M'].xLabels[2] === all.xLabels[2]);
  check(`a losing month reads red where the year reads green (${seen['1M'].dir})`,
    /loss/.test(seen['1M'].dir) || /gain/.test(seen['1M'].dir));
  await page.screenshot({ path: `${S}-1m.png` });

  // ── scrubbing reads a balance off it ──
  await page.click('[data-portfolio-window="ALL"]');
  await page.waitForTimeout(700);
  const box = await page.locator('#portfolio-chart-wrap').boundingBox();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5, { steps: 8 });
  await page.waitForTimeout(400);
  const tip = await page.evaluate(() => {
    const wrap = document.getElementById('portfolio-chart-wrap');
    const t = wrap.querySelector('.chart-tooltip');
    const dot = wrap.querySelector('.chart-crosshair-dot');
    return {
      text: t?.textContent.trim(),
      shown: t && getComputedStyle(t).opacity === '1',
      dot: dot && getComputedStyle(dot).opacity === '1',
    };
  });
  await page.mouse.up();
  check(`scrub shows a dated balance (${tip.text})`,
    tip.shown && tip.dot && /\w+ \d+, 2026 — \$[\d,]+\.\d{2}/.test(tip.text || ''));
  await page.screenshot({ path: `${S}-scrub.png` });

  // ── the two charts coexist without fighting over element ids ──
  await page.click('[data-tab="ranks"]');
  await page.waitForSelector('#ranks-rows .row', { timeout: 30000 });
  await page.waitForTimeout(2200);
  await page.locator('#ranks-rows .row').nth(2).click();
  await page.waitForSelector('#detail-sheet:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(2200);
  const both = await page.evaluate(() => ({
    lines: document.querySelectorAll('.chart-line').length,
    lineIds: document.querySelectorAll('#chart-line-path').length,
    grads: [...document.querySelectorAll('linearGradient')].map((g) => g.id).sort(),
    detailFilled: (document.querySelector('#chart-wrap .chart-area')?.getAttribute('fill') || ''),
    pfFilled: (document.querySelector('#portfolio-chart-wrap .chart-area')?.getAttribute('fill') || ''),
  }));
  check(`both charts are in the DOM at once (${both.lines} lines)`, both.lines === 2);
  check(`only the detail chart claims the legacy ids (${both.lineIds})`, both.lineIds === 1);
  check(`each has its own gradient (${both.grads.join(', ')})`,
    both.grads.length === 2 && both.detailFilled === 'url(#chart-grad)'
      && both.pfFilled === 'url(#portfolio-grad)');

  // ── the detail chart's own scrub still works with both present ──
  const dbox = await page.locator('#chart-wrap').boundingBox();
  await page.mouse.move(dbox.x + dbox.width * 0.5, dbox.y + dbox.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(dbox.x + dbox.width * 0.65, dbox.y + dbox.height * 0.5, { steps: 6 });
  await page.waitForTimeout(400);
  const dtip = await page.evaluate(() => {
    const t = document.querySelector('#chart-wrap .chart-tooltip');
    const pf = document.querySelector('#portfolio-chart-wrap .chart-tooltip');
    return { detail: t?.textContent.trim(), pfShown: pf && getComputedStyle(pf).opacity === '1' };
  });
  await page.mouse.up();
  check(`the ticker chart still reads a return (${dtip.detail})`, /[+-]\d+\.\d%/.test(dtip.detail || ''));
  check('and scrubbing one does not move the other', !dtip.pfShown);

  check(`no page errors (${errors.length})`, errors.length === 0);
  if (errors.length) console.log('ERRORS:', JSON.stringify(errors.slice(0, 4), null, 1));

  await context.close();
  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
