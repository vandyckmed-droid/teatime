const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');
const S = require('os').tmpdir();
const BASE = process.argv[2] || 'http://localhost:3426/';

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
  await page.waitForTimeout(800);

  // The actual bug: a value wider than its column overflows LEFT (the cell is
  // right-aligned) and lands on top of the column to its left. That used to be
  // the 52-week range; since that moved to the ticker view it's the name block,
  // which is the thing a long return now crowds. Measure against its right edge.
  const audit = () => page.evaluate(() => {
    const rows = [...document.querySelectorAll('#ranks-rows .row')];
    let worstOverlap = -1e9;
    let worstRow = null;
    let widest = { w: 0, text: '' };
    for (const r of rows) {
      const val = r.querySelector('.return-val');
      const price = r.querySelector('.price-mini');
      const range = r.querySelector('.name-cell');
      const cell = r.querySelector('.trailing-cell');
      if (!val || !range || !cell) continue;
      const rangeRight = range.getBoundingClientRect().right;
      for (const el of [val, price].filter(Boolean)) {
        const b = el.getBoundingClientRect();
        // positive => this text starts left of where the range column ends
        const overlap = rangeRight - b.left;
        if (overlap > worstOverlap) { worstOverlap = overlap; worstRow = r.dataset.symbol; }
        if (b.width > widest.w) widest = { w: Math.round(b.width), text: el.textContent };
      }
      const cellW = cell.getBoundingClientRect().width;
      const vb = val.getBoundingClientRect();
      if (vb.width > cellW + 0.5) { /* tracked via overlap */ }
    }
    return {
      worstOverlap: Math.round(worstOverlap),
      worstRow,
      widest,
      sample: rows.slice(0, 6).map((r) => ({
        sym: r.dataset.symbol,
        val: r.querySelector('.return-val').textContent,
        price: r.querySelector('.price-mini') ? r.querySelector('.price-mini').textContent : '',
        name: r.querySelector('.company-name').textContent,
      })),
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  const pctMode = await audit();
  check(`% mode: no value overlaps the name column (worst ${pctMode.worstOverlap}px, ${pctMode.worstRow})`,
    pctMode.worstOverlap <= 0);
  check(`% mode: widest value fits the column (${pctMode.widest.w}px "${pctMode.widest.text}")`,
    pctMode.widest.w <= 54);
  check(`% mode: no page overflow (${pctMode.pageOverflow}px)`, pctMode.pageOverflow <= 0);
  console.log('  % mode sample:', pctMode.sample.map((s) => `${s.sym} ${s.val}`).join('  '));
  await page.screenshot({ path: `${S}-pct.png` });

  // ── vol-adjusted mode: the one in the bug report ──
  await page.click('[data-tab="settings"]');
  await page.waitForTimeout(250);
  await page.locator('.ios-switch').first().click({ force: true });
  await page.waitForTimeout(900);
  await page.click('[data-tab="ranks"]');
  await page.waitForTimeout(600);

  const volMode = await audit();
  check(`vol-adj: no value overlaps the name column (worst ${volMode.worstOverlap}px, ${volMode.worstRow})`,
    volMode.worstOverlap <= 0);
  check(`vol-adj: widest value fits the column (${volMode.widest.w}px "${volMode.widest.text}")`,
    volMode.widest.w <= 54);
  check(`vol-adj scores are 2dp ("${volMode.sample[0].val}")`, /^[+-]?\d+\.\d{2}$/.test(volMode.sample[0].val));
  console.log('  vol-adj sample:', volMode.sample.map((s) => `${s.sym} ${s.val}`).join('  '));
  await page.screenshot({ path: `${S}-vol.png` });

  // ── abbreviations: fewer names ellipsed than before ──
  const names = await page.evaluate(() => {
    const els = [...document.querySelectorAll('#ranks-rows .company-name')];
    const clipped = els.filter((e) => e.scrollWidth > e.clientWidth + 1);
    return { total: els.length, clipped: clipped.length, examples: els.slice(0, 8).map((e) => e.textContent) };
  });
  check(`most names now fit whole (${names.total - names.clipped}/${names.total} un-clipped)`,
    names.clipped < names.total / 2);
  console.log('  names:', names.examples.join(' | '));

  // ── full precision survives where there IS room ──
  await page.locator('#ranks-rows .row').first().click();
  await page.waitForSelector('#detail-sheet:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(700);
  const sheet = await page.evaluate(() => document.getElementById('detail-return').textContent);
  check(`sheet keeps full precision ("${sheet}")`, /\.\d%/.test(sheet));

  check('no console/page errors', errors.length === 0);
  if (errors.length) console.log('ERRORS:', errors.slice(0, 5));

  await context.close();
  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
