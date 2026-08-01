const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');
const S = require('os').tmpdir();
const BASE = process.argv[2] || 'http://localhost:3427/';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];
  const check = (n, c) => results.push(`${c ? 'PASS' : 'FAIL'} - ${n}`);
  const context = await browser.newContext({ ...devices['iPhone 14 Pro'], colorScheme: 'dark' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ranks-rows .row', { timeout: 25000 });
  await page.waitForTimeout(900);

  const order = await page.evaluate(() =>
    [...document.querySelectorAll('#ranks-rows .row[data-symbol]')].map((r) => r.dataset.symbol));

  // ── backdrop is lighter than before ──
  await page.locator('#ranks-rows .row').nth(3).click();
  await page.waitForSelector('#detail-sheet:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(900);
  const backdrop = await page.evaluate(() => {
    const b = getComputedStyle(document.getElementById('sheet-backdrop'));
    return { filter: b.backdropFilter || b.webkitBackdropFilter, bg: b.backgroundColor };
  });
  const blurPx = parseFloat((backdrop.filter.match(/blur\(([\d.]+)px\)/) || [])[1] || 'NaN');
  const scrim = parseFloat((backdrop.bg.match(/[\d.]+\)$/) || ['1)'])[0]);
  check(`backdrop blur reduced to ${blurPx}px (was 12)`, blurPx > 0 && blurPx < 12);
  check(`scrim lightened to ${scrim} (was 0.6)`, scrim < 0.6);

  const ticker = () => page.locator('#detail-ticker').textContent();
  const startSym = (await ticker()).trim();
  check(`opened the tapped row (${startSym})`, startSym === order[3]);
  await page.screenshot({ path: `${S}-open.png` });

  // ── swipe left => next name in board order ──
  const box = await page.locator('#detail-sheet').boundingBox();
  const y = box.y + 120; // header area: above the chart, below the handle
  const swipe = (fromX, toX, yy) => page.evaluate(({ x1, x2, py }) => {
    const sheet = document.getElementById('detail-sheet');
    const fire = (type, x) => sheet.dispatchEvent(new PointerEvent(type, {
      pointerId: 7, pointerType: 'touch', pressure: 0, isPrimary: true,
      clientX: x, clientY: py, bubbles: true, cancelable: true,
    }));
    fire('pointerdown', x1);
    for (let i = 1; i <= 8; i++) fire('pointermove', x1 + ((x2 - x1) * i) / 8);
    fire('pointerup', x2);
  }, { x1: fromX, x2: toX, py: yy });

  await swipe(box.x + box.width * 0.75, box.x + box.width * 0.2, y);
  await page.waitForTimeout(700);
  const afterLeft = (await ticker()).trim();
  check(`swipe left advances (${startSym} -> ${afterLeft}, expected ${order[4]})`, afterLeft === order[4]);

  // ── swipe right => back ──
  await swipe(box.x + box.width * 0.2, box.x + box.width * 0.8, y);
  await page.waitForTimeout(700);
  const afterRight = (await ticker()).trim();
  check(`swipe right goes back (${afterLeft} -> ${afterRight})`, afterRight === order[3]);

  // ── the chart follows the company ──
  const chartOk = await page.evaluate(() => document.querySelectorAll('#chart-wrap svg path').length > 0);
  check('chart re-renders for the new company', chartOk);
  await page.screenshot({ path: `${S}-swiped.png` });

  // ── selected range carries across names (the point of comparing) ──
  await page.click('[data-segmented="detail"] button:has-text("3M")');
  await page.waitForTimeout(500);
  await swipe(box.x + box.width * 0.75, box.x + box.width * 0.2, y);
  await page.waitForTimeout(700);
  const keptRange = await page.evaluate(() =>
    document.querySelector('[data-segmented="detail"] button[aria-pressed="true"]').textContent);
  check(`chart range carries across a swipe ("${keptRange}")`, keptRange === '3M');

  // ── a short drag must not page ──
  const beforeShort = (await ticker()).trim();
  await swipe(box.x + box.width * 0.6, box.x + box.width * 0.6 - 20, y);
  await page.waitForTimeout(500);
  check(`a 20px drag does not page (${beforeShort})`, (await ticker()).trim() === beforeShort);

  // ── vertical drag must not page either (it's a scroll) ──
  await page.evaluate(({ py }) => {
    const sheet = document.getElementById('detail-sheet');
    const fire = (type, x, yy) => sheet.dispatchEvent(new PointerEvent(type, {
      pointerId: 9, pointerType: 'touch', pressure: 0, isPrimary: true,
      clientX: x, clientY: yy, bubbles: true, cancelable: true,
    }));
    fire('pointerdown', 200, py);
    for (let i = 1; i <= 8; i++) fire('pointermove', 200, py + i * 14);
    fire('pointerup', 200, py + 112);
  }, { py: y });
  await page.waitForTimeout(400);
  check(`a vertical drag does not page (${beforeShort})`, (await ticker()).trim() === beforeShort);

  // ── a drag starting on the chart scrubs, never pages ──
  const cbox = await page.locator('#chart-wrap').boundingBox();
  const beforeChart = (await ticker()).trim();
  await page.evaluate(({ x1, x2, py }) => {
    const hit = document.querySelector('#chart-hit');
    const fire = (type, x) => hit.dispatchEvent(new PointerEvent(type, {
      pointerId: 11, pointerType: 'touch', pressure: 0, isPrimary: true,
      clientX: x, clientY: py, bubbles: true, cancelable: true,
    }));
    fire('pointerdown', x1);
    for (let i = 1; i <= 8; i++) fire('pointermove', x1 + ((x2 - x1) * i) / 8);
    fire('pointerup', x2);
  }, { x1: cbox.x + cbox.width * 0.8, x2: cbox.x + cbox.width * 0.15, py: cbox.y + cbox.height / 2 });
  await page.waitForTimeout(500);
  check(`a chart scrub does not page (${beforeChart})`, (await ticker()).trim() === beforeChart);
  const scrubbed = await page.evaluate(() =>
    getComputedStyle(document.querySelector('#crosshair-line')).opacity === '1');
  check('that same drag did scrub the crosshair', scrubbed);

  // ── ends of the list don't wrap or break ──
  await page.click('#sheet-close');
  await page.waitForTimeout(500);
  await page.locator('#ranks-rows .row').first().click();
  await page.waitForSelector('#detail-sheet:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(700);
  const firstSym = (await ticker()).trim();
  await swipe(box.x + box.width * 0.2, box.x + box.width * 0.85, y); // right, at index 0
  await page.waitForTimeout(700);
  check(`swiping past the first name stays put (${firstSym})`, (await ticker()).trim() === firstSym);

  // ── arrow keys mirror the gesture ──
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  check(`ArrowRight advances (${firstSym} -> ${(await ticker()).trim()})`, (await ticker()).trim() === order[1]);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(500);
  check('ArrowLeft goes back', (await ticker()).trim() === order[0]);

  check('no console/page errors', errors.length === 0);
  if (errors.length) console.log('ERRORS:', errors.slice(0, 5));

  await context.close();
  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
