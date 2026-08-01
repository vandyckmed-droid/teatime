const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');
const S = require('os').tmpdir();
const BASE = process.argv[2] || 'http://localhost:3424/';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];
  const check = (n, c) => results.push(`${c ? 'PASS' : 'FAIL'} - ${n}`);
  // hasTouch + isMobile: the whole point is that a real touch reports pressure 0.
  const context = await browser.newContext({ ...devices['iPhone 14 Pro'], colorScheme: 'dark' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ranks-rows .row', { timeout: 25000 });
  await page.locator('#ranks-rows .row').first().click();
  await page.waitForSelector('#detail-sheet:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(900);

  // ── axis landmarks ──
  const marks = await page.evaluate(() => ({
    yLabels: [...document.querySelectorAll('#chart-wrap .chart-axis-y')].map((e) => e.textContent),
    xLabels: [...document.querySelectorAll('#chart-axis-x span')].map((e) => e.textContent),
    ticks: document.querySelectorAll('#chart-wrap .chart-tick').length,
  }));
  check(`three price landmarks (${marks.yLabels.join(' / ')})`, marks.yLabels.length === 3);
  check(`three date landmarks (${marks.xLabels.length})`, marks.xLabels.length === 3);
  check(`four axis ticks, not gridlines (${marks.ticks})`, marks.ticks === 4);
  const midBetween = await page.evaluate(() => {
    const [max, mid, min] = [...document.querySelectorAll('#chart-wrap .chart-axis-y')].map((e) => parseFloat(e.textContent.replace(/[$,]/g, '')));
    return max > mid && mid > min;
  });
  check('mid price label sits between min and max', midBetween);

  // ── tap and drag: the crosshair must follow, using real touch events ──
  const box = await page.locator('#chart-wrap').boundingBox();
  const y = box.y + box.height / 2;
  const xStart = box.x + box.width * 0.25;
  const xEnd = box.x + box.width * 0.75;

  const read = () => page.evaluate(() => {
    const line = document.querySelector('#crosshair-line');
    const tip = document.querySelector('#chart-tooltip');
    return {
      x: line ? Number(line.getAttribute('x1')) : null,
      lineVisible: line ? getComputedStyle(line).opacity === '1' : false,
      tipVisible: tip ? getComputedStyle(tip).opacity === '1' : false,
      tipText: tip ? tip.textContent : '',
      tipClass: tip && tip.querySelector('b') ? tip.querySelector('b').className : '',
    };
  });

  await page.touchscreen.tap(xStart, y);
  await page.waitForTimeout(150);
  const afterTap = await read();
  check('crosshair appears on a plain tap and stays', afterTap.lineVisible && afterTap.tipVisible);

  // Drag with raw touch events so pressure is 0, exactly like a finger.
  await page.evaluate(({ x1, x2, yy }) => {
    const hit = document.querySelector('#chart-hit');
    const fire = (type, x) => hit.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, pointerType: 'touch', pressure: 0, isPrimary: true,
      clientX: x, clientY: yy, bubbles: true, cancelable: true,
    }));
    fire('pointerdown', x1);
    window.__chX = [];
    for (let i = 0; i <= 10; i++) {
      fire('pointermove', x1 + ((x2 - x1) * i) / 10);
      window.__chX.push(Number(document.querySelector('#crosshair-line').getAttribute('x1')));
    }
  }, { x1: xStart, x2: xEnd, yy: y });
  await page.waitForTimeout(120);

  const dragged = await read();
  const track = await page.evaluate(() => window.__chX);
  const distinct = new Set(track.map((v) => Math.round(v))).size;
  check(`crosshair tracks a zero-pressure drag (${distinct} distinct x over 11 moves)`, distinct >= 5);
  check(`crosshair moved right (${Math.round(track[0])} -> ${Math.round(track[track.length - 1])})`,
    track[track.length - 1] > track[0] + 20);

  // ── tooltip shows date + cumulative return, not price ──
  check(`tooltip shows a percentage, not a price ("${dragged.tipText}")`,
    /%/.test(dragged.tipText) && !/\$/.test(dragged.tipText));
  check(`tooltip keeps the date ("${dragged.tipText}")`, /\d{4}/.test(dragged.tipText));
  check(`cumulative return is colored (${dragged.tipClass || 'none'})`, /gain|loss/.test(dragged.tipClass));

  await page.screenshot({ path: `${S}-drag.png` });

  // ── release hides it ──
  await page.evaluate(({ xx, yy }) => {
    const hit = document.querySelector('#chart-hit');
    hit.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, pointerType: 'touch', pressure: 0, isPrimary: true,
      clientX: xx, clientY: yy, bubbles: true, cancelable: true,
    }));
  }, { xx: xEnd, yy: y });
  await page.waitForTimeout(250);
  const afterUp = await read();
  check('reading persists after release', afterUp.lineVisible && afterUp.tipVisible);
  check('reading stays where the drag ended', Math.abs(afterUp.x - track[track.length - 1]) < 2);

  await page.click('[data-segmented="detail"] button:has-text("3Y")').catch(() => {});
  await page.waitForTimeout(600);
  const afterRange = await read();
  check('range switch clears the reading', !afterRange.lineVisible);

  check('no console/page errors', errors.length === 0);
  if (errors.length) console.log('ERRORS:', errors.slice(0, 5));

  await context.close();
  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
