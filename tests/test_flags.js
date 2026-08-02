// The flags system, whose one occupant is now the correlation groups. What
// this pins down: the registry renders its own Settings section (switch,
// sample orb, live count), the switch genuinely disarms the orbs and
// persists, the orb is drawn on the logo disc (never the card edge — that's
// the saved ring's identity), and every group colour stays out of the two
// protected bands: green is gain and action, red is loss. Colour assertions
// read oklab (a = green/red axis, b = blue/yellow) rather than matching hex,
// per CLAUDE.md.
const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');
const S = require('os').tmpdir();
const BASE = process.argv[2] || 'http://localhost:3210';

// Chromium serialises color-mix results as "oklab(L a b / alpha)".
function parseOklab(str) {
  const m = str.match(/oklab\(([\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/);
  return m ? { L: +m[1], a: +m[2], b: +m[3] } : null;
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];
  const check = (n, c) => results.push(`${c ? 'PASS' : 'FAIL'} - ${n}`);
  const context = await browser.newContext({ ...devices['iPhone 14 Pro'], colorScheme: 'dark' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource|ERR_ABORTED|ERR_CONNECTION_RESET/.test(m.text())) return;
    errors.push(m.text());
  });

  // A watchlist with known co-movers so several groups form: two health
  // insurers, a cybersecurity name, a steel name, a custodian bank.
  await page.addInitScript(() => {
    localStorage.setItem('teatime.watchlist', JSON.stringify(['UNH', 'HUM', 'PANW', 'NUE', 'STT']));
  });
  await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ranks-rows .row', { timeout: 30000 });
  await page.waitForFunction(
    () => document.querySelectorAll('#ranks-rows .row[data-flags~="corr"]').length > 0,
    null, { timeout: 30000 },
  ).catch(() => null);

  // ── the board wears group orbs ──
  const board = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#ranks-rows .row[data-flags~="corr"]')];
    return rows.map((r) => ({
      sym: r.dataset.symbol,
      token: ((r.dataset.flags || '').match(/corr-g\d/) || [null])[0],
      orb: getComputedStyle(r.querySelector('.logo')).boxShadow,
      aria: r.getAttribute('aria-label'),
    }));
  });
  check(`grouped rows exist (${board.length})`, board.length >= 4);
  const tokens = [...new Set(board.map((r) => r.token))];
  check(`several distinct group colours are in play (${tokens.join(', ')})`, tokens.length >= 2);
  check('every grouped row draws its orb on the logo disc',
    board.every((r) => r.orb && r.orb !== 'none'));
  check('every grouped row speaks its flag in the accessible name',
    board.every((r) => /correlation group/.test(r.aria)));

  // ── each group colour stays off the protected bands ──
  // The gain green sits far negative on oklab's a axis, the loss red far
  // positive with b near zero. Flags must not read as either: reject anything
  // strongly green (a < -0.08) and anything red-like (a > 0.08 with b below
  // amber's yellow lift).
  const orbColors = await page.evaluate(() => {
    const out = {};
    for (const r of document.querySelectorAll('#ranks-rows .row[data-flags~="corr"]')) {
      const token = ((r.dataset.flags || '').match(/corr-g\d/) || [null])[0];
      if (!token || out[token]) continue;
      out[token] = getComputedStyle(r.querySelector('.logo')).boxShadow;
    }
    return out;
  });
  for (const [token, shadow] of Object.entries(orbColors)) {
    const lab = parseOklab(shadow);
    const offGreen = !lab || lab.a > -0.08;
    const offRed = !lab || !(lab.a > 0.08 && lab.b < 0.05);
    check(`${token} orb (a=${lab && lab.a}, b=${lab && lab.b}) avoids gain green and loss red`,
      lab !== null && offGreen && offRed);
  }

  // ── a saved grouped row wears orb AND ring — different objects, both ──
  const savedGrouped = await page.evaluate(() => {
    const r = [...document.querySelectorAll('#ranks-rows .row.is-selected[data-flags~="corr"]')][0];
    if (!r) return null;
    return {
      sym: r.dataset.symbol,
      orb: getComputedStyle(r.querySelector('.logo')).boxShadow,
      hasRing: getComputedStyle(r, '::before').content !== 'none',
    };
  });
  check(`a saved anchor carries both treatments (${savedGrouped && savedGrouped.sym})`,
    savedGrouped !== null && savedGrouped.orb !== 'none' && savedGrouped.hasRing);

  // ── the Settings section: one switch, sample orb, live count ──
  await page.click('[data-tab="settings"]');
  await page.waitForTimeout(600);
  const settings = await page.evaluate(() => {
    const container = document.getElementById('flag-settings');
    const rows = [...container.querySelectorAll('.settings-row')];
    return {
      rows: rows.length,
      label: rows[0] ? rows[0].querySelector('.settings-row-label').textContent.trim() : '',
      sampleShadow: rows[0]
        ? getComputedStyle(rows[0].querySelector('.flag-sample-orb')).boxShadow : '',
      countLine: rows[0] ? rows[0].querySelector('.flag-sample-count').textContent.trim() : '',
      switchOn: rows[0]
        ? rows[0].querySelector('.ios-switch').getAttribute('aria-checked') === 'true' : null,
      note: (document.getElementById('flags-note') || {}).textContent || '',
    };
  });
  check(`the registry renders one row per flag (${settings.rows})`, settings.rows === 1);
  check(`it is the correlation groups (${settings.label})`, settings.label === 'Correlation groups');
  check('the sample previews a real orb', settings.sampleShadow !== 'none' && settings.sampleShadow !== '');
  check(`the count line counts the board (${settings.countLine})`,
    new RegExp(`^${board.length} of \\d+ on the board$`).test(settings.countLine));
  check('the switch defaults on', settings.switchOn === true);
  check('the section note explains flags never touch the ranking', /never\s+affects the ranking/.test(settings.note));

  // ── switching it off disarms every orb, and survives a reload ──
  await page.locator('#flag-settings .ios-switch').click();
  await page.waitForTimeout(800);
  const offCount = await page.evaluate(() =>
    document.querySelectorAll('.row[data-flags~="corr"]').length);
  check(`off means no orbs anywhere (${offCount})`, offCount === 0);

  // Not reload(): the hash tracks the active tab, so a reload would come back
  // on #settings with the board panel hidden and its rows never "visible".
  await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ranks-rows .row', { timeout: 30000 });
  await page.waitForTimeout(3500);
  const afterReload = await page.evaluate(() => ({
    flagged: document.querySelectorAll('.row[data-flags~="corr"]').length,
    stored: JSON.parse(localStorage.getItem('teatime.settings') || '{}').flags,
  }));
  check(`the off choice persists (${JSON.stringify(afterReload.stored)})`,
    afterReload.flagged === 0 && afterReload.stored && afterReload.stored.corr === false);

  // Back on: the override is removed rather than stored as true, keeping the
  // sparse-map contract that lets a future flag default on without migration.
  await page.click('[data-tab="settings"]');
  await page.waitForTimeout(600);
  await page.locator('#flag-settings .ios-switch').click();
  await page.waitForTimeout(800);
  const backOn = await page.evaluate(() => ({
    stored: JSON.parse(localStorage.getItem('teatime.settings') || '{}').flags,
    flagged: document.querySelectorAll('.row[data-flags~="corr"]').length,
  }));
  check('switching back on erases the override instead of storing true',
    backOn.stored && !('corr' in backOn.stored));
  check(`and the orbs return (${backOn.flagged})`, backOn.flagged > 0);

  await page.screenshot({ path: `${S}-flags.png` });
  check(`no page errors (${errors.length})`, errors.length === 0);
  if (errors.length) console.log('ERRORS:', JSON.stringify(errors.slice(0, 4)));

  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
