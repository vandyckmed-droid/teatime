// Beta vs SPY row on the portfolio card.
const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');

const BASE = process.argv[2] || process.env.BASE || 'http://localhost:3210';
const SHOT = require('os').tmpdir();

let pass = 0;
const fails = [];
function check(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`PASS - ${name}`); }
  else { fails.push(`${name}${extra ? ` — ${extra}` : ''}`); console.log(`FAIL - ${name}${extra ? ` — ${extra}` : ''}`); }
}

// Live-only: every assertion below checks the UI against what GET
// /api/portfolio says, which the published bundle has no way to answer. Say so
// and skip, rather than dying on a connection error — in a sweep a crashed
// suite and a clean one both print no FAIL, and that is how coverage goes
// missing unnoticed. (The mirror of the bundle-only skip in test_snap/test_trim.)
if (BASE.startsWith('file:')) {
  console.log(`SKIP - ${BASE} has no backend; this suite checks the UI against /api/portfolio`);
  process.exit(0);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ ...devices['iPhone 14 Pro'] });
  const page = await ctx.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // FMP's logo CDN aborts/resets on this network; not our bug.
    if (/ERR_ABORTED|ERR_CONNECTION_RESET|Failed to load resource/.test(t)) return;
    errors.push(t);
  });

  // What the server says, so the UI can be checked against it rather than
  // against a number hardcoded here.
  const api = await (await ctx.request.get(`${BASE}/api/portfolio`)).json();

  await page.goto(`${BASE}/#investing`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#portfolio-card:not([hidden]) .stat-row', { timeout: 15000 });

  // ── the row itself ────────────────────────────────────────────────
  const rows = await page.$$eval('#portfolio-card .stat-row', (els) => els.map((el) => ({
    label: el.querySelector('.stat-label')?.textContent.trim(),
    value: el.querySelector('.stat-value')?.textContent.trim(),
    valueClass: el.querySelector('.stat-value')?.className || '',
    html: el.querySelector('.stat-value')?.innerHTML || '',
  })));
  const labels = rows.map((r) => r.label);
  console.log(`  rows: ${JSON.stringify(labels)}`);

  const beta = rows.find((r) => r.label === 'Beta vs SPY');
  check('Beta vs SPY row is present', !!beta);
  check('server reported a beta', typeof api.betaVsSpy === 'number', `got ${api.betaVsSpy}`);

  if (beta) {
    check('value is two decimals, unsigned', /^-?\d+\.\d{2}$/.test(beta.value), beta.value);
    check('value has no + prefix', !beta.value.startsWith('+'), beta.value);
    check('value matches the API to 2dp', beta.value === api.betaVsSpy.toFixed(2),
      `${beta.value} vs ${api.betaVsSpy.toFixed(2)}`);
    check('value carries no gain/loss class', !/gain|loss/.test(beta.valueClass), beta.valueClass);
    check('value contains no colored span', !/gain|loss/.test(beta.html), beta.html);
  }

  // Neutral means it renders in the same color as the other plain rows.
  const colors = await page.$$eval('#portfolio-card .stat-row', (els) => els.map((el) => ({
    label: el.querySelector('.stat-label')?.textContent.trim(),
    color: getComputedStyle(el.querySelector('.stat-value')).color,
  })));
  const betaColor = colors.find((c) => c.label === 'Beta vs SPY');
  const volColor = colors.find((c) => c.label === 'Volatility');
  check('renders in the same color as Volatility', !!betaColor && !!volColor && betaColor.color === volColor.color,
    `${betaColor && betaColor.color} vs ${volColor && volColor.color}`);

  // ── nothing existing changed ──────────────────────────────────────
  const expected = ['Annualized return', 'Volatility', 'Beta vs SPY', '15% vol target', 'Best / worst day', 'Sessions recorded'];
  check('row set and order are as expected', JSON.stringify(labels) === JSON.stringify(expected),
    JSON.stringify(labels));
  check('sits directly after Volatility', labels.indexOf('Beta vs SPY') === labels.indexOf('Volatility') + 1);

  const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
  check('Annualized return unchanged', byLabel['Annualized return'] === `${api.annualizedReturnPct >= 0 ? '+' : '−'}${Math.abs(api.annualizedReturnPct).toFixed(1)}%`,
    byLabel['Annualized return']);
  check('Volatility unchanged', byLabel.Volatility === `${api.annualizedVolPct.toFixed(1)}% annualized`, byLabel.Volatility);
  check('vol target unchanged', byLabel['15% vol target'] === `${api.exposureScale.toFixed(2)}× exposure`, byLabel['15% vol target']);
  check('Sessions recorded unchanged', byLabel['Sessions recorded'] === String(api.sessions), byLabel['Sessions recorded']);
  const bestWorst = rows.find((r) => r.label === 'Best / worst day');
  check('Best / worst day still colored', /gain/.test(bestWorst.html) && /loss/.test(bestWorst.html));

  // ── the paired-session contract ───────────────────────────────────
  check('paired sessions counted', Number.isInteger(api.betaSessions), String(api.betaSessions));
  check('paired sessions at or above the floor', api.betaSessions >= api.betaMinSessions,
    `${api.betaSessions} < ${api.betaMinSessions}`);
  check('paired sessions capped at the window', api.betaSessions <= api.betaWindowSessions,
    `${api.betaSessions} > ${api.betaWindowSessions}`);
  check('window is 126 sessions', api.betaWindowSessions === 126, String(api.betaWindowSessions));
  check('floor is 60 sessions', api.betaMinSessions === 60, String(api.betaMinSessions));
  // The join can only ever be a subset of the steps volatility was taken over.
  check('pairs are a subset of the return steps', api.betaSessions <= api.returnSteps,
    `${api.betaSessions} > ${api.returnSteps}`);

  // ── beta survives a re-render ─────────────────────────────────────
  await page.click('[data-portfolio-window="3M"]');
  await page.waitForTimeout(300);
  const afterPill = await page.$$eval('#portfolio-card .stat-row', (els) => els.map((el) => el.querySelector('.stat-label')?.textContent.trim()));
  check('row survives a chart-window change', afterPill.includes('Beta vs SPY'), JSON.stringify(afterPill));
  const betaAfter = await page.$$eval('#portfolio-card .stat-row', (els) => {
    const el = els.find((e) => e.querySelector('.stat-label')?.textContent.trim() === 'Beta vs SPY');
    return el ? el.querySelector('.stat-value').textContent.trim() : null;
  });
  check('value is unchanged by the chart window', betaAfter === (beta && beta.value), `${betaAfter} vs ${beta && beta.value}`);
  await page.click('[data-portfolio-window="ALL"]');
  await page.waitForTimeout(300);

  // ── no runtime network calls beyond the app's own endpoints ───────
  const external = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#portfolio-card:not([hidden]) .stat-row');
  check('no third-party request feeds the beta row',
    external.every((u) => /financialmodelingprep|images\./.test(u)),
    JSON.stringify(external.slice(0, 5)));

  await page.screenshot({ path: `${SHOT}/beta-portfolio.png` });

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach((f) => console.log(`  - ${f}`)); process.exit(1); }
})();
