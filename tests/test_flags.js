// ROW_FLAGS: the row-flag skeleton and its one flag — the mega-cap orb.
// (A high-volatility orb and a biotech dimmer were each built and rolled
// back at the owner's request; the skeleton stays orb-only until a second
// flag earns its keep.)
const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');

const BASE = process.argv[2] || 'http://localhost:3210';
const S = require('os').tmpdir();
const LIVE = !BASE.startsWith('file://');
const MEGA = 200e9;

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
  // NVDA is a mega cap and saved; SNDK is saved but under the line.
  await page.addInitScript(() => {
    localStorage.setItem('teatime.watchlist', JSON.stringify(['NVDA', 'SNDK']));
    localStorage.setItem('teatime.settings', JSON.stringify({ volAdjusted: false, correlationThreshold: 1 }));
  });
  await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#panel-ranks .board .row', { timeout: 30000 });
  await page.waitForTimeout(900);

  // ── which rows carry the flag ─────────────────────────────────────
  const rows = await page.evaluate(() => {
    const board = typeof EMBEDDED_LEADERBOARD !== 'undefined' ? EMBEDDED_LEADERBOARD : null;
    const byId = new Map((board ? board.companies : []).map((c) => [c.symbol, c]));
    return [...document.querySelectorAll('#panel-ranks .board .row')].map((r) => ({
      sym: r.dataset.symbol,
      flags: r.dataset.flags || '',
      dimmedClass: r.classList.contains('dimmed'),
      cap: byId.get(r.dataset.symbol)?.marketCap ?? null,
      aria: r.getAttribute('aria-label'),
    }));
  });

  let caps = new Map(rows.map((r) => [r.sym, r.cap]));
  if (LIVE && [...caps.values()].every((v) => v === null)) {
    const lb = await (await ctx.request.get(`${BASE}/api/leaderboard`)).json();
    caps = new Map(lb.companies.map((c) => [c.symbol, c.marketCap]));
  }

  const flagged = rows.filter((r) => r.flags.split(' ').includes('mega'));
  const plain = rows.filter((r) => !r.flags.split(' ').includes('mega'));
  const expected = rows.filter((r) => (caps.get(r.sym) ?? 0) >= MEGA);

  console.log(`  ${rows.length} rows, ${flagged.length} mega, cutoff $${MEGA / 1e9}B`);
  check(`some rows are flagged and most are not (${flagged.length}/${rows.length})`,
    flagged.length > 20 && flagged.length < rows.length / 3);
  check(`the flagged set is exactly the companies at or above the cutoff (${expected.length})`,
    flagged.length === expected.length
    && flagged.every((r) => (caps.get(r.sym) ?? 0) >= MEGA));
  check('no company below the cutoff is flagged', plain.every((r) => (caps.get(r.sym) ?? 0) < MEGA));
  check(`the flag is spoken, not only shown (${flagged[0] && flagged[0].aria})`,
    /\(mega cap[,)]/.test(flagged[0].aria || ''));
  check('an unflagged row says nothing extra', !/mega cap/.test(plain[0].aria || ''));
  check('nothing on the board is dimmed — the rolled-back dimmer left no trace',
    rows.every((r) => !r.dimmedClass));

  // ── what the flag actually draws ──────────────────────────────────
  const paint = await page.evaluate(() => {
    const pick = (flags) => [...document.querySelectorAll('#panel-ranks .board .row')]
      .find((r) => (r.dataset.flags || '') === flags && !r.classList.contains('is-selected'));
    const read = (row) => {
      if (!row) return null;
      const cs = getComputedStyle(row);
      const logo = getComputedStyle(row.querySelector('.logo'));
      return { rowShadow: cs.boxShadow, rowBg: cs.backgroundColor,
        orb: logo.boxShadow, orbVar: cs.getPropertyValue('--flag-orb').trim() };
    };
    return { on: read(pick('mega')), off: read(pick('')) };
  });

  check(`an unflagged logo carries no orb (${paint.off.orb})`,
    paint.off.orb === 'none' && paint.off.orbVar === 'none');
  check(`a flagged one does (${paint.on.orb.slice(0, 54)}…)`, /rgb|rgba|oklab|#/.test(paint.on.orb));
  check('the orb has two blurred layers', paint.on.orb.split(/,(?![^(]*\))/).length === 2);
  const geom = paint.on.orb.split(/,(?![^(]*\))/).map((layer) => {
    const n = (layer.match(/-?\d+(?:\.\d+)?px/g) || []).map(parseFloat);
    return { blur: n[2] ?? 0, spread: n[3] ?? 0 };
  });
  check(`and no hard ring — every layer is blurred (${geom.map((g) => `${g.blur}/${g.spread}`).join(' ')})`,
    geom.every((g) => g.blur > 0 && g.blur > g.spread * 2));
  check('the row itself is left alone — the orb is not a row treatment',
    paint.on.rowShadow === paint.off.rowShadow && paint.on.rowBg === paint.off.rowBg);

  const oklabOf = (str) => [...str.matchAll(/oklab\(([^)]+)\)/g)].map((m) => {
    const [lab, alpha] = m[1].split('/');
    const [L, a, b] = lab.trim().split(/\s+/).map(Number);
    return { L, a, b, alpha: alpha === undefined ? 1 : Number(alpha) };
  });
  const orbColors = oklabOf(paint.on.orb);
  check(`the orb parses as a colour (${orbColors.length} layers)`, orbColors.length === 2);
  check(`it reads yellow (b ${orbColors[0].b})`, orbColors.every((c) => c.b > 0.08));
  check(`and warm rather than green (a ${orbColors[0].a})`, orbColors.every((c) => c.a > 0));
  check('so it can never be the gain/action green, which sits at a < 0',
    orbColors.every((c) => c.a < 0.10));
  check('nor the loss red, which is far redder than it is yellow',
    orbColors.every((c) => c.b > c.a * 2));
  const alphas = orbColors.map((c) => c.alpha);
  check(`every layer stays translucent (max alpha ${Math.max(...alphas)})`, Math.max(...alphas) <= 0.5);

  // ── it composes with the saved-row treatment ──────────────────────
  const both = await page.evaluate(() => {
    const r = [...document.querySelectorAll('#panel-ranks .board .row')]
      .find((x) => x.dataset.flags && x.classList.contains('is-selected'));
    if (!r) return null;
    const ring = getComputedStyle(r, '::before');
    return { ring: ring.backgroundImage, orb: getComputedStyle(r.querySelector('.logo')).boxShadow };
  });
  check('a saved mega cap exists to test', !!both);
  check(`it keeps the saved ring (${(both.ring || '').slice(0, 18)}…)`, /gradient/.test(both.ring || ''));
  check('and wears the orb at the same time', both.orb !== 'none');

  // ── the callout explains it, and only it ──────────────────────────
  const note = await page.$eval('#ranks-callout-text', (e) => e.textContent.replace(/\s+/g, ' '));
  check(`the board says how many carry the orb (${(note.match(/(\d+) companies carry[^.]*/) || [])[0] || 'missing'})`,
    new RegExp(`\\b${flagged.length}\\b companies carry a gold orb`).test(note));
  check('and names the cutoff in dollars', /\$200B/.test(note));
  check('no line survives from the rolled-back flags', !/violet|biotechnology/.test(note));

  // ── the Flags section in Settings ─────────────────────────────────
  await page.goto(`${BASE}#settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#flag-settings .settings-row', { timeout: 30000 });
  await page.waitForTimeout(900);

  const section = await page.evaluate(() => {
    const wrap = document.querySelector('#panel-settings .wrap');
    const order = [...wrap.children].map((e) => e.id || e.className);
    return {
      order,
      headings: [...wrap.querySelectorAll('.section-label-key')].map((e) => e.textContent.trim()),
      rows: [...document.querySelectorAll('#flag-settings .settings-row')].map((r) => ({
        label: r.querySelector('.settings-row-label').textContent.trim(),
        count: r.querySelector('.flag-sample-count').textContent.trim(),
        orb: getComputedStyle(r.querySelector('.flag-sample-orb')).boxShadow,
        on: r.querySelector('.ios-switch').getAttribute('aria-checked'),
        key: r.querySelector('.ios-switch').dataset.flag,
      })),
      note: (document.getElementById('flags-note') || {}).textContent || '',
    };
  });

  check(`Flags is its own section (${section.headings.join(' / ')})`,
    section.headings.includes('Flags')
    && section.headings.indexOf('Flags') === section.headings.length - 1);
  check('the Scoring note stays under Scoring, not under Flags',
    section.order.indexOf('settings-note') < section.order.indexOf('flag-settings'));
  check(`one row per registered flag (${section.rows.map((r) => r.key).join(',')})`,
    section.rows.length === 1 && section.rows[0].key === 'mega');
  check(`titled for a reader (${section.rows[0].label})`, section.rows[0].label === 'Mega caps');
  check(`it shows a live match count (${section.rows[0].count})`,
    new RegExp(`^${flagged.length} of ${rows.length} on the board$`).test(section.rows[0].count));
  check('and previews the flag with the board\'s own value', section.rows[0].orb === paint.on.orb);
  check(`it defaults on (${section.rows[0].on})`, section.rows[0].on === 'true');
  check('the note points at the registry', /ROW_FLAGS/.test(section.note));

  // ── switching it off ──────────────────────────────────────────────
  await page.click('#flag-settings .ios-switch[data-flag="mega"]');
  await page.waitForTimeout(400);
  const storedOff = await page.evaluate(() => JSON.parse(localStorage.getItem('teatime.settings') || '{}').flags);
  check(`only the deviation is stored (${JSON.stringify(storedOff)})`,
    storedOff && storedOff.mega === false && Object.keys(storedOff).length === 1);

  await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#panel-ranks .board .row', { timeout: 30000 });
  await page.waitForTimeout(800);
  const dark = await page.evaluate(() => {
    const all = [...document.querySelectorAll('#panel-ranks .board .row')];
    return {
      flagged: all.filter((r) => r.dataset.flags).length,
      anyOrb: all.some((r) => getComputedStyle(r.querySelector('.logo')).boxShadow !== 'none'),
      callout: (document.getElementById('ranks-callout-text') || {}).textContent || '',
    };
  });
  check(`switched off, no row carries the flag (${dark.flagged})`, dark.flagged === 0);
  check('and no logo draws an orb', !dark.anyOrb);
  check('the callout drops its line too', !/gold orb/.test(dark.callout));

  // Back on, and the override clears rather than storing true.
  await page.goto(`${BASE}#settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#flag-settings .ios-switch', { timeout: 30000 });
  await page.waitForTimeout(600);
  await page.click('#flag-settings .ios-switch[data-flag="mega"]');
  await page.waitForTimeout(400);
  const backOn = await page.evaluate(() => JSON.parse(localStorage.getItem('teatime.settings') || '{}').flags);
  check(`switching back on clears the override (${JSON.stringify(backOn)})`,
    backOn && Object.keys(backOn).length === 0);

  // ── the watchlist board shares it ─────────────────────────────────
  await page.goto(`${BASE}#investing`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('teatime.investingView', 'watchlist'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#panel-investing .board .row', { timeout: 30000 });
  await page.waitForTimeout(700);
  const wl = await page.evaluate(() => [...document.querySelectorAll('#panel-investing .board .row')]
    .map((r) => ({ sym: r.dataset.symbol, flags: r.dataset.flags || '' })));
  check(`the watchlist board flags the same names (${wl.map((r) => `${r.sym}:${r.flags || '-'}`).join(' ')})`,
    wl.find((r) => r.sym === 'NVDA').flags === 'mega' && wl.find((r) => r.sym === 'SNDK').flags === '');

  await page.screenshot({ path: `${S}/flags-board.png` });

  // ── a retired flag's saved value is dropped ───────────────────────
  // Its own context: this page's init script rewrites settings each navigation.
  {
    const c2 = await browser.newContext({ ...devices['iPhone 14 Pro'], colorScheme: 'dark' });
    const p2 = await c2.newPage();
    p2.on('pageerror', (e) => errors.push(String(e)));
    await p2.addInitScript(() => {
      if (localStorage.getItem('teatime.settings')) return; // plant once, not on every reload
      localStorage.setItem('teatime.settings', JSON.stringify({
        flags: { mega: false, vol: false, biotech: false, bogus: 'yes' },
      }));
    });
    await p2.goto(`${BASE}#settings`, { waitUntil: 'domcontentloaded' });
    await p2.waitForSelector('#flag-settings .settings-row', { timeout: 30000 });
    await p2.waitForTimeout(900);
    const raw = await p2.evaluate(() => localStorage.getItem('teatime.settings'));
    const cleaned = JSON.parse(raw || '{}').flags;
    check(`overrides for the rolled-back flags are dropped (${JSON.stringify(cleaned)})`,
      cleaned && cleaned.mega === false && !('vol' in cleaned) && !('biotech' in cleaned) && !('bogus' in cleaned));
    check('and the surviving override is honoured',
      await p2.$eval('#flag-settings .ios-switch[data-flag="mega"]', (b) => b.getAttribute('aria-checked')) === 'false');
    await c2.close();
  }

  if (errors.length) console.log('ERRORS:', errors.slice(0, 6));
  check('no page errors', errors.length === 0);

  await browser.close();
  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
