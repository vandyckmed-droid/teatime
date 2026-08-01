// The 12M/6M/3M/1M toggle on the range bar in the full-screen ticker view.
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
  await page.waitForTimeout(2600);

  const openFull = async (n = 3) => {
    await page.locator('#ranks-rows .row').nth(n).click();
    await page.waitForSelector('#detail-sheet:not([hidden])', { timeout: 10000 });
    await page.waitForTimeout(1800);
    await page.click('#sheet-expand');
    await page.waitForTimeout(1400);
  };
  const readRange = () => page.evaluate(() => {
    const b = document.querySelector('[data-block="range"]');
    if (!b) return null;
    const rows = {};
    b.querySelectorAll('.stat-row').forEach((r) => {
      rows[r.querySelector('.stat-label').textContent.trim()] = r.querySelector('.stat-value').textContent.trim();
    });
    const money = (s) => Number(String(s).replace(/[$,]/g, ''));
    const ends = [...b.querySelectorAll('.range-bar-ends span')].map((e) => e.textContent.trim());
    return {
      pills: [...b.querySelectorAll('[data-range-window]')].map((p) => p.textContent.trim()),
      active: b.querySelector('[data-range-window][aria-pressed="true"]')?.dataset.rangeWindow,
      low: ends[0] ? money(ends[0]) : null,
      high: ends[1] ? money(ends[1]) : null,
      now: b.querySelector('.range-bar-now')?.textContent.trim(),
      thumb: b.querySelector('.range-thumb')?.style.left,
      rows,
      note: b.querySelector('.detail-block-note')?.textContent.trim(),
    };
  });

  await openFull();
  const twelve = await readRange();
  check(`four windows offered (${twelve && twelve.pills.join(' ')})`,
    !!twelve && twelve.pills.join(' ') === '12M 6M 3M 1M');
  check(`12M is the default (${twelve && twelve.active})`, twelve.active === '12M');
  check(`it has a low and a high ($${twelve.low} - $${twelve.high})`,
    twelve.low > 0 && twelve.high > twelve.low);
  check(`and says the extremes are closes (${/daily closes/.test(twelve.note || '')})`,
    /daily closes over the 12M window/.test(twelve.note || ''));
  await page.screenshot({ path: `${S}-12m.png` });

  // ── each shorter window narrows the range ──
  const seen = { '12M': twelve };
  for (const key of ['6M', '3M', '1M']) {
    await page.click(`[data-range-window="${key}"]`);
    await page.waitForTimeout(500);
    seen[key] = await readRange();
    check(`${key} lights only itself (${seen[key].active})`, seen[key].active === key);
  }
  const spans = ['12M', '6M', '3M', '1M'].map((k) => seen[k].high - seen[k].low);
  check(`ranges narrow as the window shortens (${spans.map((s) => s.toFixed(1)).join(' -> ')})`,
    spans[0] >= spans[1] && spans[1] >= spans[2] && spans[2] >= spans[3]);
  check(`the low never falls and the high never rises (${['12M', '6M', '3M', '1M'].map((k) => `${seen[k].low.toFixed(0)}/${seen[k].high.toFixed(0)}`).join(' ')})`,
    seen['1M'].low >= seen['12M'].low - 0.01 && seen['1M'].high <= seen['12M'].high + 0.01);
  check(`the price marker is unchanged across windows (${seen['12M'].now} / ${seen['1M'].now})`,
    seen['12M'].now === seen['1M'].now);
  check(`session counts shrink too (${['12M', '6M', '3M', '1M'].map((k) => seen[k].note.match(/\((\d+) sessions\)/)[1]).join(' -> ')})`,
    Number(seen['12M'].note.match(/\((\d+) sessions\)/)[1]) > Number(seen['1M'].note.match(/\((\d+) sessions\)/)[1]));
  await page.screenshot({ path: `${S}-1m.png` });

  // ── derived rows follow the window ──
  check(`position is a percentage (${seen['1M'].rows.Position})`, /^\d+% of the range$/.test(seen['1M'].rows.Position));
  check(`off-the-high and above-the-low move with it (${seen['12M'].rows['Off the high']} -> ${seen['1M'].rows['Off the high']})`,
    seen['12M'].rows['Off the high'] !== seen['1M'].rows['Off the high']);

  // ── the choice carries across a swipe, like the chart range does ──
  const before = await page.evaluate(() => document.getElementById('detail-ticker').textContent.trim());
  const box = await page.locator('#detail-sheet').boundingBox();
  await page.evaluate(({ x1, x2, py }) => {
    const sheet = document.getElementById('detail-sheet');
    const fire = (t, x) => sheet.dispatchEvent(new PointerEvent(t, {
      pointerId: 93, pointerType: 'touch', pressure: 0, isPrimary: true,
      clientX: x, clientY: py, bubbles: true, cancelable: true,
    }));
    fire('pointerdown', x1);
    for (let i = 1; i <= 10; i++) fire('pointermove', x1 + ((x2 - x1) * i) / 10);
    fire('pointerup', x2);
  }, { x1: box.x + box.width * 0.8, x2: box.x + box.width * 0.15, py: box.y + 130 });
  await page.waitForTimeout(2800);
  const swiped = await readRange();
  const after = await page.evaluate(() => document.getElementById('detail-ticker').textContent.trim());
  check(`1M stays selected after swiping ${before} -> ${after}`, swiped.active === '1M');
  check('and the new company has its own numbers', swiped.low !== seen['1M'].low);

  // ── a fresh open goes back to 12M's default only if never changed ──
  await page.click('#sheet-close');
  await page.waitForTimeout(800);
  await openFull(6);
  const reopened = await readRange();
  check(`the window persists into the next company opened (${reopened.active})`, reopened.active === '1M');

  check(`no page errors (${errors.length})`, errors.length === 0);
  if (errors.length) console.log('ERRORS:', JSON.stringify(errors.slice(0, 4), null, 1));

  await context.close();
  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
