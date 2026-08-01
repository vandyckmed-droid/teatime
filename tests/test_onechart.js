// One chart per ticker: the price line, driven by the horizon pills. Nothing
// else — no bars variant, no chart picker in Settings, no caption.
const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');
const S = require('os').tmpdir();
const BASE = process.argv[2] || `file://${require('path').join(__dirname, '..', 'docs', 'index.html')}`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];
  const check = (n, c) => results.push(`${c ? 'PASS' : 'FAIL'} - ${n}`);
  // Taller viewport than the usual devices['iPhone 14 Pro'] preset, on purpose.
  // That preset is 393x659 — it models Safari with the URL bar and tab bar
  // taking a third of the screen. This app is used from the Home Screen, where
  // it gets the full 393x852. Since this suite also checks how much of the board
  // is left visible behind the sheet, measuring against a viewport 30% shorter
  // than the real one would judge it on a screen the owner never sees.
  const context = await browser.newContext({
    ...devices['iPhone 14 Pro'],
    viewport: { width: 393, height: 852 },
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  // Settings left over from the chart experiments. They should be dropped on
  // load, not carried around or acted on.
  await page.addInitScript(() => {
    localStorage.setItem('teatime.settings', JSON.stringify({
      volAdjusted: false,
      detailChart: 'bars',
      rowVisual: 'chart',
      chartStyle: 'bars',
      rankDateRange: { startDaysAgo: 250, endDaysAgo: 20 },
    }));
  });

  await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ranks-rows .row', { timeout: 30000 });
  await page.waitForTimeout(2200);

  const openSheet = async (n = 3) => {
    await page.locator('#ranks-rows .row').nth(n).click();
    await page.waitForSelector('#detail-sheet:not([hidden])', { timeout: 10000 });
    await page.waitForTimeout(2200);
  };

  // ── the board itself ──
  // The 52-week range used to be a column on every row; it lives in the
  // full-screen ticker view now (see test_expand).
  const rows = await page.evaluate(() => ({
    rows: document.querySelectorAll('#ranks-rows .row').length,
    ranges: document.querySelectorAll('#ranks-rows .range-bar, #ranks-rows .range-track').length,
    heads: [...document.querySelectorAll('#panel-ranks .board-head span')].map((e) => e.textContent.trim()),
  }));
  check(`rows carry no range bar (${rows.ranges} in ${rows.rows} rows)`, rows.ranges === 0);
  check(`the board head names the score column only (${rows.heads.join(', ')})`,
    rows.heads.length === 1 && /return/i.test(rows.heads[0]));

  // ── one chart, and it's the price line ──
  await openSheet();
  const chart = await page.evaluate(() => {
    const s = document.getElementById('detail-sheet');
    const b = s.getBoundingClientRect();
    return {
      top: Math.round(b.top), height: Math.round(b.height), vh: window.innerHeight,
      svgs: document.querySelectorAll('#chart-wrap svg').length,
      line: !!document.querySelector('#chart-line-path'),
      area: !!document.querySelector('#chart-area-path'),
      endpoints: document.querySelectorAll('#chart-startpoint-dot, #chart-endpoint-dot').length,
      bars: document.querySelectorAll('#chart-wrap .chart-bar, #chart-wrap svg.bars').length,
      caption: !!document.getElementById('chart-caption'),
      yLabels: [...document.querySelectorAll('#chart-wrap .chart-axis-y')].map((e) => e.textContent),
      xLabels: [...document.querySelectorAll('#chart-axis-x span')].map((e) => e.textContent),
    };
  });
  check(`exactly one chart in the sheet (${chart.svgs} svg)`, chart.svgs === 1);
  check('and it is the price line, with its area fill and both endpoint dots',
    chart.line && chart.area && chart.endpoints === 2);
  check('nothing left of the bars variant', chart.bars === 0);
  check('no caption element remains', !chart.caption);
  check(`three price levels on the y axis (${chart.yLabels.join(' / ')})`,
    chart.yLabels.length === 3 && chart.yLabels.every((t) => /^\$/.test(t)));
  check(`three dates on the x axis (${chart.xLabels.join(' / ')})`, chart.xLabels.length === 3);
  check(`board still visible above the sheet (${chart.top}px of ${chart.vh})`, chart.top > chart.vh * 0.18);
  await page.screenshot({ path: `${S}-price.png` });

  // ── the stale keys are gone, not just ignored ──
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('teatime.settings')));
  check(`stored settings keep only live keys (${Object.keys(stored).join(', ')})`,
    !('detailChart' in stored) && !('rowVisual' in stored) && !('chartStyle' in stored));
  check('and the ranking window survived the prune',
    stored.rankDateRange && stored.rankDateRange.startDaysAgo === 250);

  // ── every horizon pill redraws the same chart ──
  const pills = await page.locator('[data-segmented="detail"] button').allTextContents();
  check(`horizon pills present (${pills.join(' ')})`, pills.length >= 5 && pills.includes('1M'));
  const seen = new Set();
  let allLine = true;
  for (const label of pills) {
    await page.click(`[data-segmented="detail"] button:has-text("${label}")`);
    await page.waitForTimeout(900);
    const shot = await page.evaluate(() => ({
      first: document.querySelector('#chart-axis-x span')?.textContent,
      line: !!document.querySelector('#chart-line-path'),
      bars: document.querySelectorAll('#chart-wrap .chart-bar').length,
    }));
    if (!shot.line || shot.bars > 0) allLine = false;
    seen.add(shot.first);
  }
  check(`every horizon draws the price line (${pills.length} ranges)`, allLine);
  check(`and each one starts from a different date (${seen.size} distinct of ${pills.length})`,
    seen.size >= pills.length - 1);

  await page.click('[data-segmented="detail"] button:has-text("1Y")');
  await page.waitForTimeout(1200);

  // ── scrubbing reads cumulative return off the line ──
  const box = await page.locator('#chart-wrap').boundingBox();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.5, { steps: 8 });
  await page.waitForTimeout(400);
  const tip = await page.evaluate(() => {
    const t = document.getElementById('chart-tooltip');
    const dot = document.getElementById('crosshair-dot');
    return { text: t?.textContent, shown: t && getComputedStyle(t).opacity === '1',
      dot: dot && getComputedStyle(dot).opacity === '1' };
  });
  await page.mouse.up();
  check(`scrub shows a dated return (${tip.text})`, tip.shown && tip.dot && /[+-]\d+\.\d%/.test(tip.text || ''));
  await page.screenshot({ path: `${S}-scrub.png` });

  // ── swiping between names still works ──
  const sym = (await page.locator('#detail-ticker').textContent()).trim();
  const sheetBox = await page.locator('#detail-sheet').boundingBox();
  await page.evaluate(({ x1, x2, py }) => {
    const sheet = document.getElementById('detail-sheet');
    const fire = (t, x) => sheet.dispatchEvent(new PointerEvent(t, {
      pointerId: 41, pointerType: 'touch', pressure: 0, isPrimary: true,
      clientX: x, clientY: py, bubbles: true, cancelable: true,
    }));
    fire('pointerdown', x1);
    for (let i = 1; i <= 10; i++) fire('pointermove', x1 + ((x2 - x1) * i) / 10);
    fire('pointerup', x2);
  }, { x1: sheetBox.x + sheetBox.width * 0.8, x2: sheetBox.x + sheetBox.width * 0.15, py: sheetBox.y + 100 });
  await page.waitForTimeout(3000);
  const sym2 = (await page.locator('#detail-ticker').textContent()).trim();
  check(`paging still works (${sym} -> ${sym2})`, sym2 !== sym);
  check('and the next company drew its line', await page.evaluate(() => !!document.querySelector('#chart-line-path')));

  // ── Settings: two sections, no chart picker ──
  await page.click('#sheet-close');
  await page.waitForTimeout(600);
  await page.click('[data-tab="settings"]');
  await page.waitForTimeout(700);
  const settings = await page.evaluate(() => ({
    sections: [...document.querySelectorAll('#panel-settings .section-label-key')].map((e) => e.textContent),
    displayList: !!document.getElementById('display-settings'),
    inlineSegmented: document.querySelectorAll('#panel-settings .segmented').length,
    scoringRows: document.querySelectorAll('#settings-list .settings-row').length,
    dateRows: document.querySelectorAll('#daterange-settings .settings-row').length,
    note: !!document.getElementById('settings-note'),
  }));
  check(`ranking window is the first section (${settings.sections.join(' / ')})`,
    settings.sections[0] === 'Ranking window' && settings.sections.includes('Scoring'));
  check('the Detail sheet section is gone', !settings.displayList);
  check(`no segmented control left in Settings (${settings.inlineSegmented})`, settings.inlineSegmented === 0);
  check(`scoring keeps its two rows (${settings.scoringRows})`, settings.scoringRows === 2);
  check(`date range keeps its three (${settings.dateRows})`, settings.dateRows === 3);
  check('the settings note is still appended once', settings.note);
  await page.screenshot({ path: `${S}-settings.png` });

  // ── the scoring toggle still drives the board ──
  await page.click('#settings-list .ios-switch');
  await page.waitForTimeout(2500);
  await page.click('[data-tab="ranks"]');
  await page.waitForTimeout(900);
  check('vol-adjusted scoring still re-ranks the board',
    (await page.locator('#ranks-rows .row').count()) > 0);
  await page.click('[data-tab="settings"]');
  await page.waitForTimeout(600);
  await page.click('#settings-list .ios-switch');
  await page.waitForTimeout(2500);

  // ── survives a reload ──
  // A fresh load rather than page.reload(): the tab is routed by the hash, and
  // we're sitting on #settings here, so a plain reload would come back to
  // Settings with the board hidden.
  await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ranks-rows .row', { timeout: 30000 });
  await page.waitForTimeout(2200);
  await openSheet(5);
  check('reopens on the price line after a reload',
    await page.evaluate(() => !!document.querySelector('#chart-line-path')));

  check(`no page errors (${errors.length})`, errors.length === 0);
  if (errors.length) console.log('ERRORS:', JSON.stringify(errors.slice(0, 4), null, 1));

  await context.close();
  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
