// The correlation guide: coloured group orbs, not the old fade-and-block
// filter. Names whose daily moves track a saved name (r >= the tightness
// setting) share that name's group colour; nothing is faded and nothing is
// blocked from being added — the orb informs, the choice stays yours. This
// suite is also the regression net for the removed filter: a disabled add
// button or a dimmed row here means it crept back.
const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');
const S = require('os').tmpdir();
const BASE = process.argv[2] || 'http://localhost:3425';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];
  const check = (n, c) => results.push(`${c ? 'PASS' : 'FAIL'} - ${n}`);
  const context = await browser.newContext({ ...devices['iPhone 14 Pro'], colorScheme: 'dark' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  // Seed NVDA on the watchlist, and a tightness low enough to bite on this
  // dataset (nothing here reaches 0.70 against NVDA).
  await page.addInitScript(() => {
    localStorage.setItem('teatime.watchlist', JSON.stringify(['NVDA']));
    localStorage.setItem('teatime.settings', JSON.stringify({ correlationThreshold: 0.45 }));
  });
  await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ranks-rows .row', { timeout: 25000 });
  // Groups land asynchronously after correlations do.
  await page.waitForFunction(
    () => document.querySelectorAll('#ranks-rows .row[data-flags~="corr"]').length > 0,
    null, { timeout: 30000 },
  ).catch(() => null);

  const state = () => page.evaluate(() => {
    const rows = [...document.querySelectorAll('#ranks-rows .row')];
    const flagged = rows.filter((r) => (r.dataset.flags || '').includes('corr'));
    const token = (r) => ((r.dataset.flags || '').match(/corr-g\d/) || [null])[0];
    const nvda = rows.find((r) => r.dataset.symbol === 'NVDA');
    const sample = flagged[0];
    return {
      total: rows.length,
      flagged: flagged.length,
      flaggedSymbols: flagged.slice(0, 6).map((r) => r.dataset.symbol),
      tokens: [...new Set(flagged.map(token))],
      nvdaToken: nvda ? token(nvda) : null,
      sampleOpacity: sample ? getComputedStyle(sample).opacity : null,
      sampleDisabled: sample ? sample.querySelector('.add-btn').disabled : null,
      sampleOrb: sample ? getComputedStyle(sample.querySelector('.logo')).boxShadow : '',
      plainOrb: (() => {
        const plain = rows.find((r) => !r.dataset.flags);
        return plain ? getComputedStyle(plain.querySelector('.logo')).boxShadow : '';
      })(),
      sampleAria: sample ? sample.getAttribute('aria-label') : '',
      callout: document.getElementById('ranks-callout').hidden
        ? '' : document.getElementById('ranks-callout-text').textContent,
    };
  });

  const s1 = await state();
  check(`names group with NVDA at r >= 0.45 (${s1.flagged}/${s1.total}: ${s1.flaggedSymbols.join(', ')})`,
    s1.flagged >= 2);
  check(`the held anchor wears the same colour as its group (${s1.nvdaToken})`,
    s1.nvdaToken !== null && s1.tokens.includes(s1.nvdaToken));
  check('grouped rows draw an orb where plain rows draw none',
    s1.sampleOrb !== 'none' && s1.sampleOrb !== '' && s1.plainOrb === 'none');
  check(`grouped rows are not faded (opacity ${s1.sampleOpacity})`,
    parseFloat(s1.sampleOpacity) === 1);
  check('a grouped row\'s add control stays enabled', s1.sampleDisabled === false);
  check('the accessible name speaks the group', /correlation group/.test(s1.sampleAria));
  check(`the callout explains the colours ("${s1.callout.slice(-90)}")`,
    /glow/.test(s1.callout) && /0\.45/.test(s1.callout));

  await page.screenshot({ path: `${S}-groups.png` });

  // ── the orb is a guide, not a gate: a grouped name can be added ──
  const target = s1.flaggedSymbols.find((sym) => sym !== 'NVDA');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('teatime.watchlist')).length);
  await page.locator(`#ranks-rows .row[data-symbol="${target}"] .add-btn`).click();
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('teatime.watchlist')));
  check(`adding a grouped name works (${before} -> ${after.length}, added ${target})`,
    after.length === before + 1 && after.includes(target));

  // Both saved names now anchor the group; the row keeps its colour and gains
  // the saved ring — the two treatments compose rather than replace.
  const addedRow = await page.evaluate((sym) => {
    const r = document.querySelector(`#ranks-rows .row[data-symbol="${sym}"]`);
    return { flags: r.dataset.flags || '', selected: r.classList.contains('is-selected') };
  }, target);
  check('the added name keeps its group colour and gains the saved ring',
    addedRow.flags.includes('corr') && addedRow.selected);

  // Undo, so the stored list is back to the seed for the checks below.
  await page.locator(`#ranks-rows .row[data-symbol="${target}"] .add-btn`).click();
  await page.waitForTimeout(1500);

  // ── tightness at 1.00 switches grouping off ──
  const ctx2 = await browser.newContext({ ...devices['iPhone 14 Pro'], colorScheme: 'dark' });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push(String(e)));
  await p2.addInitScript(() => {
    localStorage.setItem('teatime.watchlist', JSON.stringify(['NVDA']));
    localStorage.setItem('teatime.settings', JSON.stringify({ correlationThreshold: 1 }));
  });
  await p2.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  await p2.waitForSelector('#ranks-rows .row', { timeout: 25000 });
  await p2.waitForTimeout(3500);
  const offState = await p2.evaluate(() => ({
    flagged: document.querySelectorAll('#ranks-rows .row[data-flags~="corr"]').length,
    thresholdShown: (() => {
      const el = document.getElementById('threshold-value');
      return el ? el.textContent.trim() : '(no settings open)';
    })(),
  }));
  check(`at 1.00 no group orbs draw (${offState.flagged})`, offState.flagged === 0);
  await ctx2.close();

  check(`no page errors (${errors.length})`, errors.length === 0);
  if (errors.length) console.log('ERRORS:', JSON.stringify(errors.slice(0, 4)));

  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
