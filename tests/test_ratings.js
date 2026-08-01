// Recorded analyst ratings: the archive behind them, and the card they get in
// the full-screen ticker view.
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

  await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ranks-rows .row', { timeout: 30000 });
  await page.waitForTimeout(2800);

  // ── the data reached the browser ──
  const data = await page.evaluate(() => (typeof ratingsData === 'undefined' || !ratingsData)
    ? null
    : {
      symbols: Object.keys(ratingsData.bySymbol).length,
      dates: ratingsData.dates,
      amd: ratingsData.bySymbol.AMD,
      tigo: ratingsData.bySymbol.TIGO,
      missing: !!ratingsData.bySymbol.NOTATICKER,
    });
  check(`ratings loaded (${data && data.symbols} symbols, ${data && data.dates.join(',')})`,
    !!data && data.symbols === 24);
  check(`each reading is [date, rating, score] (${JSON.stringify(data && data.amd)})`,
    !!data && data.amd.length === 1 && data.amd[0][1] === 'Neutral' && data.amd[0][2] === 6.8);
  check(`an unrated observation is kept, not dropped (${JSON.stringify(data && data.tigo)})`,
    !!data && data.tigo.length === 1 && data.tigo[0][1] === null && data.tigo[0][2] === null);

  // ── the card, on a rated company ──
  const openFull = async (symbol) => {
    await page.evaluate((s) => {
      const row = document.querySelector(`#ranks-rows .row[data-symbol="${s}"]`);
      if (row) row.scrollIntoView({ block: 'center' });
    }, symbol);
    await page.waitForTimeout(400);
    await page.locator(`#ranks-rows .row[data-symbol="${symbol}"]`).click();
    await page.waitForSelector('#detail-sheet:not([hidden])', { timeout: 10000 });
    await page.waitForTimeout(1600);
    if (!(await page.evaluate(() => document.getElementById('detail-sheet').classList.contains('is-expanded')))) {
      await page.click('#sheet-expand');
      await page.waitForTimeout(1200);
    }
  };
  const readCard = () => page.evaluate(() => {
    const b = document.querySelector('[data-block="rating"]');
    if (!b) return null;
    const rows = {};
    b.querySelectorAll('.stat-row').forEach((r) => {
      rows[r.querySelector('.stat-label').textContent.trim()] = {
        value: r.querySelector('.stat-value').textContent.trim(),
        cls: r.querySelector('.stat-value').className,
      };
    });
    const fill = b.querySelector('.rating-meter-fill');
    return {
      title: b.querySelector('.detail-block-title').textContent.trim(),
      rows,
      meterWidth: fill && fill.style.width,
      meterClass: fill && fill.className,
      note: b.querySelector('.detail-block-note')?.textContent.trim(),
    };
  });

  await openFull('MU');
  const mu = await readCard();
  check(`MU gets a rating card ("${mu && mu.title}")`, !!mu && /analyst rating/i.test(mu.title));
  check(`it shows the label (${mu && mu.rows.Rating.value})`, mu.rows.Rating.value === 'Very Bullish');
  check(`coloured by sentiment (${mu && mu.rows.Rating.cls})`, /gain/.test(mu.rows.Rating.cls));
  check(`the score out of ten (${mu && mu.rows.Score.value})`, mu.rows.Score.value === '9.1 of 10');
  check(`and the date it was recorded (${mu && mu.rows.Recorded.value})`,
    /Aug 1, 2026/.test(mu.rows.Recorded.value));
  // The browser normalizes "91.0%" to "91%", so compare the number.
  check(`the meter is filled to the score (${mu && mu.meterWidth})`,
    Math.abs(parseFloat(mu.meterWidth) - 91) < 0.05);
  check(`and coloured to match (${mu && mu.meterClass})`, /gain/.test(mu.meterClass));
  check(`the note says it doesn't feed the ranking`, /feeds the board/i.test(mu.note || ''));
  check('one reading on file, so no "Previously" row yet', !mu.rows.Previously);
  await page.screenshot({ path: `${S}-bullish.png` });

  // ── a bearish one reads red ──
  await page.click('#sheet-close');
  await page.waitForTimeout(700);
  await openFull('CAT');
  const cat = await readCard();
  check(`CAT reads bearish (${cat && cat.rows.Rating.value} ${cat && cat.rows.Score.value})`,
    !!cat && cat.rows.Rating.value === 'Bearish' && cat.rows.Score.value === '2.6 of 10');
  check(`in the loss colour (${cat && cat.rows.Rating.cls}, meter ${cat && cat.meterClass})`,
    /loss/.test(cat.rows.Rating.cls) && /loss/.test(cat.meterClass));
  check(`with a short meter (${cat && cat.meterWidth})`,
    Math.abs(parseFloat(cat.meterWidth) - 26) < 0.05);
  await page.screenshot({ path: `${S}-bearish.png` });

  // ── an unrated observation still gets a card, saying so ──
  await page.click('#sheet-close');
  await page.waitForTimeout(700);
  await openFull('RVMD');
  const rvmd = await readCard();
  check(`RVMD's blank reading says so (${rvmd && rvmd.rows.Rating.value})`,
    !!rvmd && /none published/i.test(rvmd.rows.Rating.value));
  check(`and still carries the date it was checked (${rvmd && rvmd.rows.Checked.value})`,
    /Aug 1, 2026/.test(rvmd.rows.Checked?.value || ''));
  check('no meter drawn without a score', !rvmd.meterWidth);

  // ── a company nobody rated gets no card at all ──
  await page.click('#sheet-close');
  await page.waitForTimeout(700);
  const unrated = await page.evaluate(() => {
    const rated = new Set(Object.keys(ratingsData.bySymbol));
    const row = [...document.querySelectorAll('#ranks-rows .row[data-symbol]')]
      .find((r) => !rated.has(r.dataset.symbol));
    return row ? row.dataset.symbol : null;
  });
  await openFull(unrated);
  const none = await readCard();
  const blocks = await page.evaluate(() =>
    [...document.querySelectorAll('#detail-extras .detail-block')].map((b) => b.dataset.block));
  check(`${unrated} has no rating card, and the rest still render (${blocks.join(', ')})`,
    none === null && blocks.length >= 4 && !blocks.includes('rating'));
  await page.screenshot({ path: `${S}-none.png` });

  // ── the card follows a swipe between companies ──
  await page.click('#sheet-close');
  await page.waitForTimeout(700);
  await openFull('CAT');
  const before = await page.evaluate(() => document.getElementById('detail-ticker').textContent.trim());
  const box = await page.locator('#detail-sheet').boundingBox();
  await page.evaluate(({ x1, x2, py }) => {
    const sheet = document.getElementById('detail-sheet');
    const fire = (t, x) => sheet.dispatchEvent(new PointerEvent(t, {
      pointerId: 88, pointerType: 'touch', pressure: 0, isPrimary: true,
      clientX: x, clientY: py, bubbles: true, cancelable: true,
    }));
    fire('pointerdown', x1);
    for (let i = 1; i <= 10; i++) fire('pointermove', x1 + ((x2 - x1) * i) / 10);
    fire('pointerup', x2);
  }, { x1: box.x + box.width * 0.8, x2: box.x + box.width * 0.15, py: box.y + 130 });
  await page.waitForTimeout(2600);
  const after = await page.evaluate(() => document.getElementById('detail-ticker').textContent.trim());
  const swapped = await readCard();
  check(`swiping to ${after} re-renders the block correctly`,
    after !== before && (swapped === null || swapped.rows.Rating));

  // ── two readings on file: the block starts showing movement ──
  // Injected rather than written into the archive, so the suite tests the
  // render path without adding a fake observation to the real record.
  await page.click('#sheet-close');
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    ratingsData.bySymbol.CAT = [
      ['2026-06-15', 'Neutral', 5.4],
      ['2026-08-01', 'Bearish', 2.6],
    ];
    ratingsData.dates = ['2026-06-15', '2026-08-01'];
  });
  await openFull('CAT');
  const twice = await readCard();
  check(`with two readings it names the earlier one (${twice && twice.rows.Previously?.value})`,
    !!twice && /Neutral \(5\.4\) on Jun 15, 2026/.test(twice.rows.Previously?.value || ''));
  check(`and the move between them (${twice && twice.rows.Change?.value})`,
    /^−2\.8$/.test(twice.rows.Change?.value || '') && /loss/.test(twice.rows.Change?.cls || ''));
  check(`the note counts both (${twice && twice.note?.match(/\d+ readings?/)?.[0]})`,
    /2 readings on file/.test(twice.note || ''));
  check('the latest reading is the one displayed',
    twice.rows.Rating.value === 'Bearish' && twice.rows.Recorded.value.includes('Aug 1'));
  await page.screenshot({ path: `${S}-history.png` });

  // ── ratings never touch the board ──
  await page.click('#sheet-close');
  await page.waitForTimeout(700);
  const boardClean = await page.evaluate(() => ({
    onRows: document.querySelectorAll('#ranks-rows .rating-meter, #ranks-rows [data-block="rating"]').length,
    firstSymbol: document.querySelector('#ranks-rows .row')?.dataset.symbol,
  }));
  check(`no rating leaks onto the board rows (${boardClean.onRows})`, boardClean.onRows === 0);
  check(`the board is still ranked by return (#1 ${boardClean.firstSymbol})`,
    boardClean.firstSymbol === 'SNDK');

  check(`no page errors (${errors.length})`, errors.length === 0);
  if (errors.length) console.log('ERRORS:', JSON.stringify(errors.slice(0, 4), null, 1));

  await context.close();
  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
