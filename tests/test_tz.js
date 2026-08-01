// Calendar dates must read the same wherever the phone is, and scrolled
// content must not collide with the status bar.
//
// Both of these were invisible to every other suite here: they all run in UTC
// on a browser where env(safe-area-inset-top) is 0, which is exactly the one
// configuration where neither bug shows up.
const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');

const BASE = process.argv[2] || 'http://localhost:3210';
const S = require('os').tmpdir();

const results = [];
const check = (n, c) => results.push(`${c ? 'PASS' : 'FAIL'} - ${n}`);

// One well west of UTC, one east, and UTC itself. West is where the old bug
// bit (UTC midnight renders as the previous day); east is the direction a
// naive "just add a day" fix would break instead.
const ZONES = ['UTC', 'America/Los_Angeles', 'Pacific/Auckland'];

async function readDates(browser, tz) {
  const context = await browser.newContext({
    ...devices['iPhone 14 Pro'], viewport: { width: 393, height: 852 }, colorScheme: 'dark', timezoneId: tz,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    localStorage.setItem('teatime.watchlist', JSON.stringify(['NVDA', 'AMD', 'KO']));
    localStorage.setItem('teatime.investingView', 'portfolio');
  });

  await page.goto(`${BASE}#investing`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#portfolio-card:not([hidden]) .stat-row', { timeout: 30000 });
  await page.waitForTimeout(500);
  const portfolio = await page.evaluate(() => ({
    since: document.querySelector('.portfolio-change .since').textContent.trim(),
    note: (document.querySelector('.portfolio-note').textContent.match(/through (.+?), (\d{4})/) || []).slice(1).join(', '),
    axis: [...document.querySelectorAll('#portfolio-chart-axis span')].map((e) => e.textContent.trim()),
  }));

  // The Ranks board's sticky header prints the ranking window; Settings prints
  // it twice more through a different formatter.
  await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ranks-score-label .section-label-value', { timeout: 30000 });
  const overlapWindow = await page.$eval('#ranks-score-label .section-label-value', (e) => e.textContent.trim());

  await page.goto(`${BASE}#settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.stepper-date', { timeout: 30000 });
  const steppers = await page.$$eval('.stepper-date', (els) => els.map((e) => e.textContent.trim()));

  // And the detail sheet's own chart axis and scrub label.
  await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.board .row', { timeout: 30000 });
  await page.click('.board .row');
  await page.waitForSelector('#chart-line-path', { timeout: 30000 });
  await page.waitForTimeout(600);
  const chartAxis = await page.$$eval('.sheet .chart-axis-x span', (els) => els.map((e) => e.textContent.trim()));

  await context.close();
  return { portfolio, overlapWindow, steppers, chartAxis, errors };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  const seen = {};
  for (const tz of ZONES) seen[tz] = await readDates(browser, tz);

  const base = seen.UTC;
  console.log(`  UTC portfolio: ${JSON.stringify(base.portfolio)}`);
  console.log(`  UTC window:    ${base.overlapWindow} | steppers ${base.steppers.join(' / ')}`);
  console.log(`  UTC chart:     ${base.chartAxis.join(' / ')}`);

  for (const tz of ZONES.slice(1)) {
    const s = seen[tz];
    check(`${tz}: the portfolio start date matches UTC (${s.portfolio.since})`,
      s.portfolio.since === base.portfolio.since);
    check(`${tz}: the "computed through" date matches (${s.portfolio.note})`,
      s.portfolio.note === base.portfolio.note);
    check(`${tz}: the balance chart's axis matches (${s.portfolio.axis.join(' / ')})`,
      s.portfolio.axis.join('|') === base.portfolio.axis.join('|'));
    check(`${tz}: the ranking window on the board matches (${s.overlapWindow})`,
      s.overlapWindow === base.overlapWindow);
    check(`${tz}: the Settings window steppers match (${s.steppers.join(' / ')})`,
      s.steppers.join('|') === base.steppers.join('|'));
    check(`${tz}: the price chart's axis matches (${s.chartAxis.join(' / ')})`,
      s.chartAxis.join('|') === base.chartAxis.join('|'));
    check(`${tz}: no page errors`, s.errors.length === 0);
  }

  // The dates on screen must be the dates in the data, not one either side.
  // The bundle has no backend, so read the same figures out of the page.
  const context = await browser.newContext({ ...devices['iPhone 14 Pro'], timezoneId: 'America/Los_Angeles' });
  let api;
  if (BASE.startsWith('file://')) {
    const p2 = await context.newPage();
    await p2.goto(BASE, { waitUntil: 'domcontentloaded' });
    api = await p2.evaluate(() => EMBEDDED_PORTFOLIO);
    await p2.close();
  } else {
    api = await (await context.request.get(`${BASE}/api/portfolio`)).json();
  }
  const asShown = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
  };
  check(`the start date shown is the first row in the file (${base.portfolio.since})`,
    base.portfolio.since === `since ${asShown(api.start)}`);
  check(`the end date shown is the last row in the file (${base.portfolio.note})`,
    base.portfolio.note === asShown(api.end));
  check(`the axis ends on that same date (${base.portfolio.axis[2]})`,
    base.portfolio.axis[2] === asShown(api.end));
  await context.close();

  // ── the status-bar scrim ──────────────────────────────────────────
  {
    const ctx = await browser.newContext({ ...devices['iPhone 14 Pro'], viewport: { width: 393, height: 852 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto(`${BASE}#investing`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#portfolio-card:not([hidden])', { timeout: 30000 });

    const scrim = await page.evaluate(() => {
      const el = document.querySelector('.statusbar-scrim');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { position: cs.position, top: cs.top, zIndex: cs.zIndex, pointerEvents: cs.pointerEvents,
        blur: cs.webkitBackdropFilter || cs.backdropFilter, hidden: el.getAttribute('aria-hidden') };
    });
    check('a status-bar scrim exists', !!scrim);
    check(`it is pinned to the top (${scrim && scrim.position} / ${scrim && scrim.top})`,
      scrim.position === 'fixed' && scrim.top === '0px');
    check(`it sits under the tab bar and the sheet, over the content (z ${scrim.zIndex})`,
      Number(scrim.zIndex) === 40);
    check('it never eats a tap', scrim.pointerEvents === 'none');
    check(`it is blurred like the other bars (${scrim.blur})`, /blur/.test(scrim.blur || ''));
    check('it is hidden from assistive tech', scrim.hidden === 'true');

    // Chromium reports a 0 inset, so force a realistic one to prove the strip
    // actually covers scrolled content rather than just existing.
    await page.evaluate(() => {
      document.querySelector('.statusbar-scrim').style.height = '59px';
      document.querySelector('#panel-investing').scrollIntoView();
      window.scrollTo(0, 260);
      const p = document.querySelector('#panel-investing');
      if (p.scrollHeight > p.clientHeight) p.scrollTop = 260;
    });
    await page.waitForTimeout(300);
    // elementFromPoint skips pointer-events:none, so lift that just for the
    // hit test — the point here is paint order, and the property itself is
    // asserted separately above.
    const covered = await page.evaluate(() => {
      const el = document.querySelector('.statusbar-scrim');
      el.style.pointerEvents = 'auto';
      const hit = document.elementFromPoint(196, 20);
      el.style.pointerEvents = '';
      return hit ? hit.className : null;
    });
    check(`at 59px it is what sits under the clock (${covered})`, /statusbar-scrim/.test(covered || ''));
    await page.screenshot({ path: `${S}/tz-scrim.png` });
    await ctx.close();
  }

  await browser.close();
  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
