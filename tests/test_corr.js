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
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // Seed NVDA on the watchlist, and a threshold low enough to bite on this
  // dataset (nothing here reaches 0.70 against NVDA).
  await page.addInitScript(() => {
    localStorage.setItem('teatime.watchlist', JSON.stringify(['NVDA']));
    localStorage.setItem('teatime.settings', JSON.stringify({ correlationThreshold: 0.45 }));
  });
  await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ranks-rows .row', { timeout: 25000 });
  await page.waitForTimeout(1800);

  const state = () => page.evaluate(() => {
    const rows = [...document.querySelectorAll('#ranks-rows .row')];
    const faded = rows.filter((r) => r.classList.contains('correlated'));
    return {
      total: rows.length,
      faded: faded.length,
      fadedSymbols: faded.slice(0, 5).map((r) => r.dataset.symbol),
      fadedOpacity: faded.length ? getComputedStyle(faded[0]).opacity : null,
      fadedDisabled: faded.length ? faded[0].querySelector('.add-btn').disabled : null,
      fadedLabel: faded.length ? faded[0].querySelector('.add-btn').getAttribute('aria-label') : '',
      heldFaded: rows.filter((r) => r.dataset.symbol === 'NVDA')[0].classList.contains('correlated'),
      callout: document.getElementById('ranks-callout').hidden
        ? '' : document.getElementById('ranks-callout-text').textContent,
    };
  });

  const s1 = await state();
  check(`some rows fade at r >= 0.45 (${s1.faded}/${s1.total}: ${s1.fadedSymbols.join(', ')})`, s1.faded > 0);
  check(`faded rows are dimmed (opacity ${s1.fadedOpacity})`, parseFloat(s1.fadedOpacity) < 0.6);
  check('faded row\'s add control is disabled', s1.fadedDisabled === true);
  check(`disabled control explains itself ("${(s1.fadedLabel || '').slice(0, 62)}…")`,
    /Too correlated/.test(s1.fadedLabel) && /NVDA/.test(s1.fadedLabel));
  check('the held name itself is never faded', s1.heldFaded === false);
  check(`callout states the count ("${s1.callout.slice(0, 70)}…")`,
    /faded/.test(s1.callout) && /0\.45/.test(s1.callout));

  await page.screenshot({ path: `${S}-faded.png` });

  // ── a blocked name genuinely cannot be added ──
  const target = s1.fadedSymbols[0];
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('teatime.watchlist')).length);
  await page.locator(`#ranks-rows .row[data-symbol="${target}"] .add-btn`).click({ force: true }).catch(() => {});
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('teatime.watchlist')).length);
  check(`clicking a blocked control does not add it (${before} -> ${after})`, before === after);

  // ── a non-faded name still adds, and re-fades its own correlates ──
  const freshBefore = await state();
  const addable = await page.evaluate(() => {
    const r = [...document.querySelectorAll('#ranks-rows .row')]
      .find((x) => !x.classList.contains('correlated') && x.dataset.symbol !== 'NVDA');
    return r ? r.dataset.symbol : null;
  });
  await page.locator(`#ranks-rows .row[data-symbol="${addable}"] .add-btn`).click();
  await page.waitForTimeout(1600);
  const s2 = await state();
  check(`an addable name still adds (${addable})`,
    await page.evaluate((sym) => JSON.parse(localStorage.getItem('teatime.watchlist')).includes(sym), addable));
  check(`adding recomputes the filter (${freshBefore.faded} -> ${s2.faded} faded)`, s2.faded !== freshBefore.faded);

  // ── threshold stepper ──
  await page.click('[data-tab="settings"]');
  await page.waitForTimeout(300);
  const shown = () => page.locator('#threshold-value').textContent();
  check(`stepper shows the current threshold ("${await shown()}")`, (await shown()).trim() === '0.45');
  await page.screenshot({ path: `${S}-settings.png` });

  // raise to 1.00 => "Off", nothing faded
  for (let i = 0; i < 11; i++) {
    const plus = page.locator('.stepper-btn[data-key="correlationThreshold"][data-dir="1"]');
    if (await plus.isDisabled()) break;
    await plus.click();
    await page.waitForTimeout(60);
  }
  check(`stepper reads "Off" at the top of its range ("${await shown()}")`, (await shown()).trim() === 'Off');
  await page.click('[data-tab="ranks"]');
  await page.waitForTimeout(500);
  const s3 = await state();
  check(`"Off" fades nothing (${s3.faded} faded)`, s3.faded === 0);
  check('"Off" also clears the callout note', !/faded/.test(s3.callout));

  // and back down clamps at the floor
  await page.click('[data-tab="settings"]');
  await page.waitForTimeout(300);
  for (let i = 0; i < 25; i++) {
    const minus = page.locator('.stepper-btn[data-key="correlationThreshold"][data-dir="-1"]');
    if (await minus.isDisabled()) break;
    await minus.click();
    await page.waitForTimeout(50);
  }
  const floor = (await shown()).trim();
  check(`stepper clamps at its floor ("${floor}") with no float drift`, floor === '0.30');

  check('no console/page errors', errors.length === 0);
  if (errors.length) console.log('ERRORS:', errors.slice(0, 5));

  await context.close();
  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
