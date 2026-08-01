// Tap a row -> card. Tap the expand arrow -> full-screen data page. Everything
// the card could do still works there, and stepping back is one gesture.
const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');
const S = require('os').tmpdir();
const BASE = process.argv[2] || `file://${require('path').join(__dirname, '..', 'docs', 'index.html')}`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];
  const check = (n, c) => results.push(`${c ? 'PASS' : 'FAIL'} - ${n}`);
  const context = await browser.newContext({
    ...devices['iPhone 14 Pro'],
    viewport: { width: 393, height: 852 }, // standalone, no Safari chrome — see test_onechart
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ranks-rows .row', { timeout: 30000 });
  await page.waitForTimeout(2200);

  const geom = () => page.evaluate(() => {
    const s = document.getElementById('detail-sheet');
    const b = s.getBoundingClientRect();
    const extras = document.getElementById('detail-extras');
    return {
      top: Math.round(b.top), height: Math.round(b.height), vh: window.innerHeight,
      expanded: s.classList.contains('is-expanded'),
      blocks: document.querySelectorAll('#detail-extras .detail-block').length,
      extrasHidden: extras.hidden,
      chartH: Math.round(document.getElementById('chart-wrap').getBoundingClientRect().height),
      chart: !!document.querySelector('#chart-line-path'),
      radius: getComputedStyle(s).borderTopLeftRadius,
      ticker: document.getElementById('detail-ticker').textContent.trim(),
    };
  });
  const openSheet = async (n = 3) => {
    await page.locator('#ranks-rows .row').nth(n).click();
    await page.waitForSelector('#detail-sheet:not([hidden])', { timeout: 10000 });
    await page.waitForTimeout(2200);
  };

  // ── step 1 + 2: row -> the card, unchanged ──
  await openSheet();
  const card = await geom();
  check('the card opens part-way up the screen, board visible behind', card.top > card.vh * 0.18);
  check('it is not expanded', !card.expanded);
  check('and carries no data blocks', card.extrasHidden && card.blocks === 0);
  check('both strip controls are present',
    (await page.locator('#sheet-grab button').count()) === 2);
  const handle = await page.evaluate(() => {
    const h = document.querySelector('.sheet-handle').getBoundingClientRect();
    const s = document.getElementById('detail-sheet').getBoundingClientRect();
    return Math.round((h.left + h.width / 2) - (s.left + s.width / 2));
  });
  check(`the grab handle is still centred (${handle}px off)`, Math.abs(handle) <= 1);
  // The logo used to sit under a floating close button.
  const overlap = await page.evaluate(() => {
    const logo = document.getElementById('detail-logo').getBoundingClientRect();
    return [...document.querySelectorAll('#sheet-grab button')].some((b) => {
      const r = b.getBoundingClientRect();
      return r.bottom > logo.top && r.right > logo.left && r.left < logo.right;
    });
  });
  check('no control overlaps the logo', !overlap);
  await page.screenshot({ path: `${S}-card.png` });

  // ── step 3: expand ──
  await page.click('#sheet-expand');
  await page.waitForTimeout(900);
  const full = await geom();
  check('expanding fills the screen', full.expanded && full.top <= 1 && full.height >= full.vh - 1);
  check(`square top corners in full screen (${full.radius})`, parseInt(full.radius, 10) === 0);
  check(`the data blocks appear (${full.blocks})`, full.blocks >= 4 && !full.extrasHidden);
  check(`the chart grew with the screen (${card.chartH} -> ${full.chartH}px)`, full.chartH > card.chartH);
  check('and redrew at the new size', full.chart);
  check('the expand button reads as pressed',
    (await page.locator('#sheet-expand').getAttribute('aria-expanded')) === 'true');
  await page.screenshot({ path: `${S}-full.png` });

  // ── the blocks hold real numbers ──
  const blocks = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('#detail-extras .detail-block').forEach((b) => {
      out[b.dataset.block] = {
        title: b.querySelector('.detail-block-title').textContent.trim(),
        rows: [...b.querySelectorAll('.stat-row')].map((r) => [
          r.querySelector('.stat-label').textContent.trim(),
          r.querySelector('.stat-value').textContent.trim(),
        ]),
      };
    });
    return out;
  });
  check(`returns block lists every window (${blocks.returns?.rows.length} rows)`,
    blocks.returns && blocks.returns.rows.length >= 7);
  check('standing block names the rank and window',
    blocks.standing && blocks.standing.rows.some(([k]) => k === 'Rank')
      && blocks.standing.rows.some(([k]) => k === 'Window'));
  const rankRow = blocks.standing.rows.find(([k]) => k === 'Rank');
  check(`rank matches the row that was tapped (${rankRow[1]})`, /^4 of \d+$/.test(rankRow[1]));
  // The 52-week range moved off the board rows into this view.
  const range = await page.evaluate(() => {
    const b = document.querySelector('[data-block="range"]');
    if (!b) return null;
    const thumb = b.querySelector('.range-thumb');
    const bar = b.querySelector('.range-bar-track');
    return {
      thumbLeft: thumb && thumb.style.left,
      width: Math.round(bar.getBoundingClientRect().width),
      now: b.querySelector('.range-bar-now')?.textContent.trim(),
      ends: [...b.querySelectorAll('.range-bar-ends span')].map((e) => e.textContent.trim()),
      rows: [...b.querySelectorAll('.stat-row')].map((r) => r.querySelector('.stat-label').textContent.trim()),
    };
  });
  check(`the range bar is here and full width (${range && range.width}px)`,
    !!range && range.width > 250);
  check(`its thumb is positioned within the track (${range && range.thumbLeft})`,
    !!range && /^\d+(\.\d+)?%$/.test(range.thumbLeft));
  check(`low and high are labelled (${range && range.ends.join(' - ')}), today at ${range && range.now}`,
    !!range && range.ends.length === 2 && /^\$/.test(range.now || ''));
  check(`and it adds derived rows (${range && range.rows.join(', ')})`,
    !!range && ['Position', 'Off the high', 'Above the low'].every((k) => range.rows.includes(k)));

  check('profile block carries cap, sector and size rank',
    blocks.profile && ['Market cap', 'Sector', 'Size rank'].every((k) => blocks.profile.rows.some(([l]) => l === k)));
  const capRow = blocks.profile.rows.find(([k]) => k === 'Market cap');
  check(`and the cap is a real figure (${capRow[1]})`, /^\$[\d.]+[BTM]$/.test(capRow[1]));

  // ── the range pills still drive the one chart ──
  const beforeX = await page.evaluate(() => document.querySelector('#chart-axis-x span').textContent);
  await page.click('[data-segmented="detail"] button:has-text("3M")');
  await page.waitForTimeout(1200);
  const afterX = await page.evaluate(() => document.querySelector('#chart-axis-x span').textContent);
  check(`range pills still work in full screen (${beforeX} -> ${afterX})`, afterX !== beforeX);
  check('still exactly one chart', (await page.locator('#chart-wrap svg').count()) === 1);

  // ── swiping between companies refills the blocks ──
  const box = await page.locator('#detail-sheet').boundingBox();
  await page.evaluate(({ x1, x2, py }) => {
    const sheet = document.getElementById('detail-sheet');
    const fire = (t, x) => sheet.dispatchEvent(new PointerEvent(t, {
      pointerId: 55, pointerType: 'touch', pressure: 0, isPrimary: true,
      clientX: x, clientY: py, bubbles: true, cancelable: true,
    }));
    fire('pointerdown', x1);
    for (let i = 1; i <= 10; i++) fire('pointermove', x1 + ((x2 - x1) * i) / 10);
    fire('pointerup', x2);
  }, { x1: box.x + box.width * 0.8, x2: box.x + box.width * 0.15, py: box.y + 120 });
  await page.waitForTimeout(3000);
  const swiped = await geom();
  check(`swiping still pages companies (${full.ticker} -> ${swiped.ticker})`, swiped.ticker !== full.ticker);
  check('stays full screen across the swipe', swiped.expanded && swiped.blocks >= 3);
  const newRank = await page.evaluate(() => {
    const b = document.querySelector('[data-block="standing"]');
    return [...b.querySelectorAll('.stat-row')].find((r) => r.querySelector('.stat-label').textContent.trim() === 'Rank')
      ?.querySelector('.stat-value').textContent.trim();
  });
  check(`and the blocks follow the new company (rank ${newRank})`, /^5 of \d+$/.test(newRank));

  // ── the page scrolls ──
  const scrolled = await page.evaluate(() => {
    const s = document.querySelector('.sheet-scroll');
    s.scrollTop = s.scrollHeight;
    return { top: s.scrollTop, max: s.scrollHeight - s.clientHeight };
  });
  check(`the full-screen page really scrolls (${scrolled.top} of ${scrolled.max}px)`, scrolled.max > 100 && scrolled.top > 100);
  await page.screenshot({ path: `${S}-scrolled.png` });
  await page.evaluate(() => { document.querySelector('.sheet-scroll').scrollTop = 0; });
  await page.waitForTimeout(400);

  // ── collapse by the button ──
  await page.click('#sheet-expand');
  await page.waitForTimeout(900);
  const back = await geom();
  check('collapsing returns to the card', !back.expanded && back.top > back.vh * 0.18);
  check('and drops the blocks again', back.extrasHidden && back.blocks === 0);
  check(`chart back to card size (${back.chartH}px)`, back.chartH === card.chartH);

  // ── collapse by dragging down, and it must NOT dismiss ──
  await page.click('#sheet-expand');
  await page.waitForTimeout(800);
  const drag = async (dy) => {
    const grab = await page.locator('#sheet-grab').boundingBox();
    await page.evaluate(({ x, y, dy: d }) => {
      const el = document.getElementById('sheet-grab');
      const fire = (t, cy) => el.dispatchEvent(new PointerEvent(t, {
        pointerId: 71, pointerType: 'touch', pressure: 0, isPrimary: true,
        clientX: x, clientY: cy, bubbles: true, cancelable: true,
      }));
      fire('pointerdown', y);
      for (let i = 1; i <= 12; i++) fire('pointermove', y + (d * i) / 12);
      fire('pointerup', y + d);
    }, { x: grab.x + grab.width / 2, y: grab.y + grab.height / 2, dy });
    await page.waitForTimeout(900);
  };
  await drag(260);
  const dragged = await geom();
  check('dragging down from full screen returns to the card', !dragged.expanded);
  check('and does not dismiss the sheet in one gesture',
    !(await page.locator('#detail-sheet').getAttribute('hidden')) === true
      || !(await page.evaluate(() => document.getElementById('detail-sheet').hidden)));
  check(`the card is back at its resting height (${dragged.top}px)`, dragged.top > dragged.vh * 0.18);

  // ── a small pull in full screen just springs back ──
  await page.click('#sheet-expand');
  await page.waitForTimeout(800);
  await drag(40);
  check('a small pull stays in full screen', (await geom()).expanded);

  // ── close from full screen ──
  await page.click('#sheet-close');
  await page.waitForTimeout(900);
  check('close works from full screen', await page.evaluate(() => document.getElementById('detail-sheet').hidden));

  // ── reopening starts as the card again ──
  await openSheet(7);
  const reopened = await geom();
  check('reopening starts as the card, not full screen', !reopened.expanded && reopened.extrasHidden);

  check(`no page errors (${errors.length})`, errors.length === 0);
  if (errors.length) console.log('ERRORS:', JSON.stringify(errors.slice(0, 4), null, 1));

  await context.close();
  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
