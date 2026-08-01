// The analyst-consensus card in the full-screen ticker view. Grade counts
// ride the company object (`grades` on the leaderboard payload), so the same
// card works identically against the live server and the static bundle.
const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');

const BASE = process.argv[2] || 'http://localhost:3210';

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
  await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#panel-ranks .board .row', { timeout: 30000 });
  await page.waitForTimeout(900);

  // The payload is the source of truth the card must agree with.
  const board = await page.evaluate(async () => {
    if (typeof EMBEDDED_LEADERBOARD !== 'undefined') return EMBEDDED_LEADERBOARD;
    return (await fetch('/api/leaderboard')).json();
  });
  const totalOf = (g) => (g ? g.strongBuy + g.buy + g.hold + g.sell + g.strongSell : 0);
  const covered = board.companies.filter((c) => totalOf(c.grades) > 0);
  console.log(`  ${covered.length} of ${board.companies.length} companies carry analyst grades`);
  check(`most of the board carries analyst grades (${covered.length}/${board.companies.length})`,
    covered.length > board.companies.length * 0.8);
  check('every grades object has a consensus label',
    covered.every((c) => typeof c.grades.consensus === 'string' && c.grades.consensus.length > 0));

  // Pick one Buy-ish and one Sell-ish name visible on the board, so both
  // tones get exercised against real data.
  const onBoard = new Set(await page.$$eval('#panel-ranks .board .row', (rows) => rows.map((r) => r.dataset.symbol)));
  const buyName = covered.find((c) => onBoard.has(c.symbol) && /buy/i.test(c.grades.consensus));
  const sellName = covered.find((c) => onBoard.has(c.symbol) && /sell/i.test(c.grades.consensus));
  check(`a Buy-consensus company exists to test (${buyName && buyName.symbol})`, !!buyName);

  async function openCard(symbol) {
    // A same-URL goto doesn't reload, and the previous card's expanded sheet
    // would intercept the next tap — reload gives each card a clean page.
    await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`#panel-ranks .board .row[data-symbol="${symbol}"]`, { timeout: 30000 });
    await page.waitForTimeout(600);
    await page.evaluate((sym) => {
      document.querySelector(`#panel-ranks .board .row[data-symbol="${sym}"]`).scrollIntoView({ block: 'center' });
    }, symbol);
    await page.waitForTimeout(300);
    await page.click(`#panel-ranks .board .row[data-symbol="${symbol}"]`);
    await page.waitForSelector('#chart-line-path', { timeout: 30000 });
    await page.click('#sheet-expand');
    await page.waitForSelector('.detail-block', { timeout: 30000 });
    await page.waitForTimeout(500);
    return page.evaluate(() => {
      const block = [...document.querySelectorAll('.detail-block')]
        .find((b) => /analyst rating/i.test(b.querySelector('.detail-block-title')?.textContent || ''));
      if (!block) return null;
      const rows = {};
      block.querySelectorAll('.stat-row').forEach((r) => {
        rows[r.querySelector('.stat-label').textContent.trim()] = {
          value: r.querySelector('.stat-value').textContent.trim(),
          cls: r.querySelector('.stat-value').className,
        };
      });
      const fill = block.querySelector('.rating-meter-fill');
      return {
        rows,
        note: (block.querySelector('.detail-block-note') || {}).textContent || '',
        meterWidth: fill ? fill.style.width : null,
        meterCls: fill ? fill.className : '',
      };
    });
  }

  // ── the Buy-consensus card ────────────────────────────────────────
  {
    const g = buyName.grades;
    const total = totalOf(g);
    const pct = ((g.strongBuy + g.buy) / total) * 100;
    const card = await openCard(buyName.symbol);
    check(`${buyName.symbol}: the card renders`, !!card);
    check(`consensus matches the payload (${card.rows.Consensus && card.rows.Consensus.value})`,
      card.rows.Consensus && card.rows.Consensus.value === g.consensus);
    check('a buy consensus reads in the gain tone', /gain/.test(card.rows.Consensus.cls));
    check(`the analyst count is the sum of the buckets (${card.rows.Analysts && card.rows.Analysts.value})`,
      card.rows.Analysts && card.rows.Analysts.value === String(total));
    check(`the leaning is the positive share (${card.rows.Leaning && card.rows.Leaning.value})`,
      card.rows.Leaning && card.rows.Leaning.value === `${pct.toFixed(0)}% positive`);
    check(`the meter is that share wide (${card.meterWidth})`, card.meterWidth === `${pct.toFixed(1)}%`);
    check('the meter carries the same tone', /gain/.test(card.meterCls));
    check('the note spells the buckets out and disclaims the ranking',
      /buy/.test(card.note) && /ranking/.test(card.note));
    const claimed = [...card.note.matchAll(/(\d+) (strong buy|buy|hold|sell|strong sell)/g)]
      .reduce((a, m) => a + Number(m[1]), 0);
    check(`the note's buckets sum to the analyst count (${claimed})`, claimed === total);
  }

  // ── the Sell-consensus card, if the board has one ─────────────────
  if (sellName) {
    const card = await openCard(sellName.symbol);
    check(`${sellName.symbol}: a sell consensus reads in the loss tone`,
      card && /loss/.test(card.rows.Consensus.cls) && /loss/.test(card.meterCls));
    check(`and its meter sits under half (${card && card.meterWidth})`,
      card && parseFloat(card.meterWidth) < 50);
  } else {
    console.log('  (no Sell-consensus name on the board today — tone check skipped)');
  }

  // ── an uncovered company shows no card at all ─────────────────────
  const uncovered = board.companies.find((c) => totalOf(c.grades) === 0 && onBoard.has(c.symbol));
  if (uncovered) {
    const card = await openCard(uncovered.symbol);
    check(`${uncovered.symbol} has no analyst card rather than an empty one`, card === null);
  } else {
    check('every company on the board is covered — nothing to hide (vacuous pass)', true);
  }

  if (errors.length) console.log('ERRORS:', errors.slice(0, 6));
  check('no page errors', errors.length === 0);

  await browser.close();
  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
