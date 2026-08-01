// One tab named Investing, holding two views: the portfolio and the saved
// names. They no longer share a scroll.
const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');
const S = require('os').tmpdir();
const BASE = process.argv[2] || `file://${require('path').join(__dirname, '..', 'docs', 'index.html')}`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];
  const check = (n, c) => results.push(`${c ? 'PASS' : 'FAIL'} - ${n}`);
  const context = await browser.newContext({
    ...devices['iPhone 14 Pro'],
    viewport: { width: 393, height: 852 },
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  await page.addInitScript(() => {
    localStorage.setItem('teatime.watchlist', JSON.stringify(['NVDA', 'JNJ']));
  });

  await page.goto(`${BASE}#investing`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-segmented="investing"] button', { timeout: 30000 });
  await page.waitForTimeout(2600);

  const readTab = () => page.evaluate(() => {
    const thumb = document.querySelector('[data-segmented="investing"] .segmented-thumb');
    const active = document.querySelector('[data-segmented="investing"] button[aria-pressed="true"]');
    const shown = [...document.querySelectorAll('[data-subview]')].filter((e) => !e.hidden);
    return {
      title: document.querySelector('#panel-investing .nav-title').textContent.trim(),
      tabLabel: document.querySelector('[data-tab="investing"] .tab-label').textContent.trim(),
      views: [...document.querySelectorAll('[data-segmented="investing"] button')].map((b) => b.textContent.trim()),
      active: active && active.dataset.view,
      shown: shown.map((e) => e.dataset.subview),
      sub: document.getElementById('investing-sub').textContent.trim(),
      thumbW: thumb && Math.round(thumb.getBoundingClientRect().width),
      activeW: active && Math.round(active.getBoundingClientRect().width),
      thumbX: thumb && Math.round(thumb.getBoundingClientRect().left),
      activeX: active && Math.round(active.getBoundingClientRect().left),
      stored: localStorage.getItem('teatime.investingView'),
      hash: location.hash,
    };
  });

  const first = await readTab();
  check(`the tab is named for both (title "${first.title}", tab "${first.tabLabel}")`,
    first.title === 'Investing' && first.tabLabel === 'Investing');
  check(`it holds two views (${first.views.join(' / ')})`,
    first.views.join(' / ') === 'Portfolio / Watchlist');
  check(`Portfolio shows first (${first.active})`, first.active === 'portfolio');
  check(`and only that view is on screen (${first.shown.join(',')})`,
    first.shown.length === 1 && first.shown[0] === 'portfolio');
  check(`the thumb sits under the active view (${first.thumbX}/${first.activeX}, ${first.thumbW}px)`,
    Math.abs(first.thumbX - first.activeX) <= 2 && Math.abs(first.thumbW - first.activeW) <= 2);
  check(`the subtitle describes the portfolio ("${first.sub}")`, /account balance/i.test(first.sub));
  await page.screenshot({ path: `${S}-portfolio.png` });

  // ── the portfolio view carries the card and its chart, and nothing else ──
  const pf = await page.evaluate(() => ({
    card: !!document.querySelector('[data-subview="portfolio"] #portfolio-card:not([hidden])'),
    chart: !!document.querySelector('[data-subview="portfolio"] #portfolio-chart-wrap svg'),
    rowsHere: document.querySelectorAll('[data-subview="portfolio"] .row').length,
    balance: document.querySelector('.portfolio-balance')?.textContent.trim(),
  }));
  check(`the portfolio card and its chart are here (${pf.balance})`, pf.card && pf.chart);
  check(`and none of the saved names are (${pf.rowsHere})`, pf.rowsHere === 0);

  // ── switch ──
  await page.click('[data-segmented="investing"] button[data-view="watchlist"]');
  await page.waitForTimeout(900);
  const second = await readTab();
  check(`tapping Watchlist switches the view (${second.active})`, second.active === 'watchlist');
  check(`only the watchlist is on screen now (${second.shown.join(',')})`,
    second.shown.length === 1 && second.shown[0] === 'watchlist');
  check(`the subtitle follows ("${second.sub}")`, /green check/i.test(second.sub));
  check(`the thumb slid across (${first.thumbX} -> ${second.thumbX})`, second.thumbX > first.thumbX);
  const wl = await page.evaluate(() => ({
    rows: document.querySelectorAll('#watchlist-rows .row').length,
    actions: !document.getElementById('watchlist-actions').hidden,
    cardVisible: document.querySelector('[data-subview="portfolio"]').hidden === false,
    firstRowTop: Math.round(document.querySelector('#watchlist-rows .row').getBoundingClientRect().top),
  }));
  check(`the saved names are here (${wl.rows} rows) with their actions`, wl.rows === 2 && wl.actions);
  check(`and the portfolio card is out of the way`, !wl.cardVisible);
  // The complaint that prompted this: the names were pushed off the bottom.
  check(`the first name is on screen without scrolling (y=${wl.firstRowTop})`,
    wl.firstRowTop > 0 && wl.firstRowTop < 400);
  await page.screenshot({ path: `${S}-watchlist.png` });

  // ── the choice is remembered ──
  check(`the choice is stored (${second.stored})`, second.stored === 'watchlist');
  await page.goto(`${BASE}#investing`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-segmented="investing"] button', { timeout: 30000 });
  await page.waitForTimeout(2200);
  const reopened = await readTab();
  check(`and survives a reload (${reopened.active})`, reopened.active === 'watchlist');

  // ── leaving and coming back keeps it, and the thumb stays put ──
  await page.click('[data-tab="ranks"]');
  await page.waitForTimeout(700);
  await page.click('[data-tab="investing"]');
  await page.waitForTimeout(700);
  const back = await readTab();
  check(`switching tabs and back keeps the view (${back.active})`, back.active === 'watchlist');
  check(`the thumb is still positioned correctly (${back.thumbX}/${back.activeX})`,
    Math.abs(back.thumbX - back.activeX) <= 2 && back.thumbW > 100);

  // ── the old #watchlist link still lands here ──
  await page.goto(`${BASE}#watchlist`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-segmented="investing"] button', { timeout: 30000 });
  await page.waitForTimeout(2000);
  const legacy = await page.evaluate(() => ({
    panelShown: !document.getElementById('panel-investing').hidden,
    hash: location.hash,
    tabSelected: document.querySelector('[data-tab="investing"]').getAttribute('aria-selected'),
  }));
  check(`an old #watchlist link still opens the tab (${legacy.hash})`,
    legacy.panelShown && legacy.tabSelected === 'true');

  // ── the chart draws correctly after being revealed, not while hidden ──
  await page.click('[data-segmented="investing"] button[data-view="portfolio"]');
  await page.waitForTimeout(1000);
  const chart = await page.evaluate(() => {
    const wrap = document.getElementById('portfolio-chart-wrap');
    const svg = wrap.querySelector('svg');
    const vb = svg && svg.getAttribute('viewBox');
    return {
      viewBox: vb,
      width: vb ? Number(vb.split(' ')[2]) : 0,
      wrapWidth: Math.round(wrap.getBoundingClientRect().width),
      points: (wrap.querySelector('.chart-line')?.getAttribute('d') || '').split(/[ML]/).length - 1,
    };
  });
  check(`the chart is sized to the visible wrapper, not to zero (${chart.viewBox})`,
    chart.width > 250 && Math.abs(chart.width - chart.wrapWidth) <= 2);
  check(`and it drew the whole series (${chart.points} points)`, chart.points > 100);

  check(`no page errors (${errors.length})`, errors.length === 0);
  if (errors.length) console.log('ERRORS:', JSON.stringify(errors.slice(0, 4), null, 1));

  await context.close();
  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
