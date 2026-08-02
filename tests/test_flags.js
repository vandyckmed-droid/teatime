// The flags system, whose one occupant is the echo flag (an amber ring on
// any top-50 name that tracks a name ranked above it). What this pins down:
// the registry renders its own Settings section (switch, sample orb, live
// count), the switch genuinely disarms the rings and persists, and the ring
// treatment itself — which has been through two owner corrections that must
// not regress: blur-only was "too subtle to see or use" (so the ring must be
// crisp), and a ring hugging the white logo disc washed out (so a
// surface-coloured gap must sit between disc and ring). Colour assertions
// read oklab (a = green/red axis, b = blue/yellow) rather than matching hex,
// per CLAUDE.md.
const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');
const S = require('os').tmpdir();
const BASE = process.argv[2] || 'http://localhost:3210';

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

  await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ranks-rows .row', { timeout: 30000 });
  await page.waitForFunction(
    () => document.querySelectorAll('#ranks-rows .row[data-flags~="echo"]').length > 0,
    null, { timeout: 45000 },
  ).catch(() => null);

  // ── the board wears the ring ──
  const board = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#ranks-rows .row[data-flags~="echo"]')];
    return rows.map((r) => ({
      sym: r.dataset.symbol,
      orb: getComputedStyle(r.querySelector('.logo')).boxShadow,
      aria: r.getAttribute('aria-label'),
    }));
  });
  check(`flagged rows exist (${board.length})`, board.length >= 5);
  check('one flag, one look: every flagged logo carries the identical treatment',
    new Set(board.map((r) => r.orb)).size === 1 && board[0].orb !== 'none');
  check('every flagged row speaks its flag in the accessible name',
    board.every((r) => /tracks a higher-ranked name/.test(r.aria)));

  // ── the two owner corrections, as structure ──
  // Serialised box-shadow lists each layer as "<color> x y blur spread".
  // Layer 1 must be the surface-coloured gap (zero blur, real spread), layer
  // 2 the crisp amber ring (zero blur, larger spread), layer 3+ the bloom.
  const layers = board[0].orb.split(/,(?![^(]*\))/).map((s) => s.trim());
  const dims = layers.map((l) => (l.match(/(-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px/) || []).slice(1).map(Number));
  check(`the orb is three layers (gap, ring, bloom) — got ${layers.length}`, layers.length === 3);
  check('layer 1 is a crisp gap (no blur)', dims[0] && dims[0][2] === 0 && dims[0][3] > 0);
  check('layer 2 is a crisp ring outside it (no blur, wider spread)',
    dims[1] && dims[1][2] === 0 && dims[1][3] > dims[0][3]);
  check('layer 3 is the soft bloom (real blur)', dims[2] && dims[2][2] > 0);
  // The gap must be the card surface, not a colour — it reads as empty space.
  const surface = await page.evaluate(() => getComputedStyle(document.querySelector('#ranks-rows .row')).backgroundColor);
  check(`the gap is card-surface coloured (${layers[0].match(/rgba?\([^)]*\)/)?.[0]} vs ${surface})`,
    layers[0].includes(surface));
  // The ring colour stays off the protected bands: not the gain green
  // (a strongly negative), not the loss red (a strongly positive with b low).
  const lab = parseOklab(board[0].orb);
  check(`the ring colour avoids gain green and loss red (a=${lab && lab.a}, b=${lab && lab.b})`,
    lab !== null && lab.a > -0.08 && !(lab.a > 0.08 && lab.b < 0.05));

  // ── flag + saved compose ──
  const composed = await page.evaluate(() => {
    const r = document.querySelector('#ranks-rows .row.is-selected[data-flags~="echo"]');
    if (!r) return null;
    return {
      orb: getComputedStyle(r.querySelector('.logo')).boxShadow,
      hasRing: getComputedStyle(r, '::before').content !== 'none',
    };
  });
  if (composed) {
    check('a saved flagged row wears both treatments', composed.orb !== 'none' && composed.hasRing);
  }

  // ── the Settings section: one switch, sample orb, live count ──
  await page.click('[data-tab="settings"]');
  await page.waitForTimeout(600);
  const settings = await page.evaluate(() => {
    const container = document.getElementById('flag-settings');
    const rows = [...container.querySelectorAll('.settings-row')];
    return {
      rows: rows.length,
      label: rows[0] ? rows[0].querySelector('.settings-row-label').textContent.trim() : '',
      desc: rows[0] ? rows[0].querySelector('.settings-row-desc').textContent.trim() : '',
      sampleShadow: rows[0]
        ? getComputedStyle(rows[0].querySelector('.flag-sample-orb')).boxShadow : '',
      countLine: rows[0] ? rows[0].querySelector('.flag-sample-count').textContent.trim() : '',
      switchOn: rows[0]
        ? rows[0].querySelector('.ios-switch').getAttribute('aria-checked') === 'true' : null,
      note: (document.getElementById('flags-note') || {}).textContent || '',
    };
  });
  check(`the registry renders one row per flag (${settings.rows})`, settings.rows === 1);
  check(`it is the correlation flag (${settings.label})`, settings.label === 'Correlation flag');
  check('the description states the hardwired bar', /0\.72/.test(settings.desc));
  check('the sample previews the real ring', settings.sampleShadow !== 'none' && settings.sampleShadow !== '');
  check(`the count line counts the board (${settings.countLine})`,
    new RegExp(`^${board.length} of \\d+ on the board$`).test(settings.countLine));
  check('the switch defaults on', settings.switchOn === true);
  check('the section note explains flags never touch the ranking', /never\s+affects the ranking/.test(settings.note));

  // ── switching it off disarms every ring, and survives a reload ──
  await page.locator('#flag-settings .ios-switch').click();
  await page.waitForTimeout(800);
  const offCount = await page.evaluate(() =>
    document.querySelectorAll('.row[data-flags~="echo"]').length);
  check(`off means no rings anywhere (${offCount})`, offCount === 0);

  // Not reload(): the hash tracks the active tab, so a reload would come back
  // on #settings with the board panel hidden and its rows never "visible".
  await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ranks-rows .row', { timeout: 30000 });
  await page.waitForTimeout(4000);
  const afterReload = await page.evaluate(() => ({
    flagged: document.querySelectorAll('.row[data-flags~="echo"]').length,
    stored: JSON.parse(localStorage.getItem('teatime.settings') || '{}').flags,
  }));
  check(`the off choice persists (${JSON.stringify(afterReload.stored)})`,
    afterReload.flagged === 0 && afterReload.stored && afterReload.stored.echo === false);

  // Back on: the override is removed rather than stored as true, keeping the
  // sparse-map contract that lets a future flag default on without migration.
  await page.click('[data-tab="settings"]');
  await page.waitForTimeout(600);
  await page.locator('#flag-settings .ios-switch').click();
  await page.waitForTimeout(800);
  const backOn = await page.evaluate(() => ({
    stored: JSON.parse(localStorage.getItem('teatime.settings') || '{}').flags,
    flagged: document.querySelectorAll('.row[data-flags~="echo"]').length,
  }));
  check('switching back on erases the override instead of storing true',
    backOn.stored && !('echo' in backOn.stored));
  check(`and the rings return (${backOn.flagged})`, backOn.flagged > 0);

  await page.screenshot({ path: `${S}-flags.png` });
  check(`no page errors (${errors.length})`, errors.length === 0);
  if (errors.length) console.log('ERRORS:', JSON.stringify(errors.slice(0, 4)));

  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
