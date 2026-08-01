// The board row's right-hand columns: return over price as one block on a
// fixed right edge, the add control as its own fixed-width column.
const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');

const BASE = process.argv[2] || 'http://localhost:3210';
const S = require('os').tmpdir();

const results = [];
const check = (n, c) => results.push(`${c ? 'PASS' : 'FAIL'} - ${n}`);

async function readRows(page, panel) {
  return page.evaluate((sel) => {
    const rows = [...document.querySelectorAll(`${sel} .board .row`)].slice(0, 12);
    const R = (el) => { const b = el.getBoundingClientRect(); return { l: +b.left.toFixed(1), r: +b.right.toFixed(1), t: +b.top.toFixed(1), b: +b.bottom.toFixed(1), w: +b.width.toFixed(1) }; };
    return rows.map((row) => ({
      sym: row.dataset.symbol,
      row: R(row),
      cell: R(row.querySelector('.trailing-cell')),
      val: R(row.querySelector('.return-val')),
      price: R(row.querySelector('.price-mini')),
      sel: R(row.querySelector('.select-cell')),
      btn: R(row.querySelector('.add-btn')),
      padRight: parseFloat(getComputedStyle(row).paddingRight),
    }));
  }, panel);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errors = [];

  for (const mode of ['vol-adj', 'percent']) {
    const ctx = await browser.newContext({
      ...devices['iPhone 14 Pro'], viewport: { width: 393, height: 852 }, colorScheme: 'dark',
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript((vol) => {
      localStorage.setItem('teatime.settings', JSON.stringify({ volAdjusted: vol }));
      localStorage.setItem('teatime.watchlist', JSON.stringify(['SNDK', 'WDC', 'TRGP']));
    }, mode === 'vol-adj');
    await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#panel-ranks .board .row', { timeout: 30000 });
    await page.waitForTimeout(800);

    const rows = await readRows(page, '#panel-ranks');
    const one = (get) => new Set(rows.map(get)).size === 1;

    check(`${mode}: the return sits on one right edge down the list (${rows[0].val.r})`, one((r) => r.val.r));
    check(`${mode}: the price shares that exact edge`, one((r) => r.price.r) && rows[0].price.r === rows[0].val.r);
    check(`${mode}: the add control starts at one left edge (${rows[0].btn.l})`, one((r) => r.btn.l));
    check(`${mode}: the select column is one fixed width (${rows[0].sel.w}px)`, one((r) => r.sel.w));

    // Return and price are one block; the control is a separate column. The
    // grouping only reads if the gap between the block and the control is
    // clearly bigger than the gap inside the block.
    const inner = +(rows[0].price.t - rows[0].val.b).toFixed(1);
    const outer = +(rows[0].btn.l - rows[0].val.r).toFixed(1);
    check(`${mode}: no daylight inside the return/price block (${inner}px)`, inner <= 1);
    check(`${mode}: the control is set well apart from it (${outer}px)`, outer >= 10);
    check(`${mode}: and that gutter beats the one inside the block`, outer > inner + 8);

    // The control reads as its own column: its two margins are close to equal.
    const toEdge = +(rows[0].row.r - rows[0].padRight - rows[0].btn.r + rows[0].padRight).toFixed(1);
    const rightMargin = +(rows[0].row.r - rows[0].btn.r).toFixed(1);
    check(`${mode}: its gutters are balanced (${outer}px left / ${rightMargin}px right)`,
      Math.abs(outer - rightMargin) <= 3, `${outer} vs ${rightMargin}`);

    // Nothing spills out of the card.
    check(`${mode}: nothing overflows the row`, rows.every((r) => r.btn.r <= r.row.r && r.cell.l > r.row.l));

    // The column header names the column it sits over.
    const head = await page.evaluate(() => {
      const h = document.querySelector('#panel-ranks .board-head-score').getBoundingClientRect();
      return +h.right.toFixed(1);
    });
    check(`${mode}: the column header lands on the same edge (${head})`, head === rows[0].val.r);

    if (mode === 'vol-adj') {
      // A four-digit return has to take its space from the name column and
      // leave the right edge alone — that is what min-width buys over width.
      const wide = await page.evaluate(() => {
        const row = document.querySelector('#panel-ranks .board .row');
        const val = row.querySelector('.return-val');
        const before = val.getBoundingClientRect().right;
        val.textContent = '+12345.6%'; // wider than the 56px floor, unlike a
                                       // 4-digit return, which just fits
        const r = row.getBoundingClientRect();
        const c = row.querySelector('.trailing-cell').getBoundingClientRect();
        const after = val.getBoundingClientRect().right;
        const name = row.querySelector('.name-cell').getBoundingClientRect();
        return { before: +before.toFixed(1), after: +after.toFixed(1), cellW: +c.width.toFixed(1),
          overflows: c.left < r.left, nameLeft: +name.left.toFixed(1), cellLeft: +c.left.toFixed(1) };
      });
      check(`a wide value keeps the right edge (${wide.before} -> ${wide.after})`, wide.before === wide.after);
      check(`it grows leftward instead of clipping (cell ${wide.cellW}px)`, wide.cellW > 56);
      check('and never spills past the card', !wide.overflows && wide.cellLeft > wide.nameLeft);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#panel-ranks .board .row', { timeout: 30000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${S}/cols-ranks.png` });
    }

    // The watchlist board shares the row builder, so it must match exactly.
    await page.goto(`${BASE}#investing`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.setItem('teatime.investingView', 'watchlist'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#panel-investing .board .row', { timeout: 30000 });
    await page.waitForTimeout(700);
    const wl = await readRows(page, '#panel-investing');
    check(`${mode}: the watchlist board uses the same edges`,
      wl.length > 0 && wl[0].val.r === rows[0].val.r && wl[0].btn.l === rows[0].btn.l,
      wl.length ? `${wl[0].val.r}/${wl[0].btn.l} vs ${rows[0].val.r}/${rows[0].btn.l}` : 'no rows');

    await ctx.close();
  }

  // An unavailable row ("N/A") is built separately — it has to line up too.
  {
    const ctx = await browser.newContext({ ...devices['iPhone 14 Pro'], viewport: { width: 393, height: 852 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#panel-ranks .board .row', { timeout: 30000 });
    await page.waitForTimeout(700);
    const na = await page.evaluate(() => {
      const normal = document.querySelector('#panel-ranks .board .row:not(.unavailable)');
      const ref = normal.querySelector('.return-val').getBoundingClientRect().right;
      const un = document.querySelector('#panel-ranks .board .row.unavailable');
      if (!un) return { ref: +ref.toFixed(1), same: null };
      return { ref: +ref.toFixed(1), same: +un.querySelector('.return-val').getBoundingClientRect().right.toFixed(1) };
    });
    check(`an N/A row lines up with the rest (${na.same === null ? 'none on the board' : na.same})`,
      na.same === null || na.same === na.ref);
    await ctx.close();
  }

  if (errors.length) console.log('ERRORS:', errors.slice(0, 6));
  check('no page errors', errors.length === 0);

  await browser.close();
  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
