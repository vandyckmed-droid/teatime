// The sheet should stop at a half-screen detent on the way down, and only
// dismiss on a pull clearly past it.
const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');
const S = require('os').tmpdir();
const BASE = process.argv[2] || `file://${require('path').join(__dirname, '..', 'docs', 'index.html')}`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];
  const check = (n, c) => results.push(`${c ? 'PASS' : 'FAIL'} - ${n}`);
  const context = await browser.newContext({ ...devices['iPhone 14 Pro'], colorScheme: 'dark' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
  });
  const drag = async (x, y1, y2, steps = 14) => {
    await touch('touchStart', x, y1);
    for (let i = 1; i <= steps; i++) await touch('touchMove', x, y1 + ((y2 - y1) * i) / steps);
    await touch('touchEnd', x, y2);
    await page.waitForTimeout(750);
  };
  const state = () => page.evaluate(() => {
    const s = document.getElementById('detail-sheet');
    const b = s.getBoundingClientRect();
    return {
      hidden: s.hidden,
      top: Math.round(b.top),
      vh: window.innerHeight,
      inset: getComputedStyle(document.querySelector('.sheet-scroll')).paddingBottom,
      backdrop: Number(getComputedStyle(document.getElementById('sheet-backdrop')).opacity).toFixed(2),
    };
  });

  // Report whatever was verified before an unexpected throw, rather than losing
  // the whole run to one bad locator.
  const report = async (err) => {
    if (err) console.log('THREW:', err.message);
    console.log('=== RESULTS ===');
    results.forEach((r) => console.log(r));
    await browser.close();
    process.exit(err || results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
  };
  process.on('unhandledRejection', report);

  await page.goto(`${BASE}#ranks`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ranks-rows .row', { timeout: 30000 });
  await page.waitForTimeout(2000);

  const open = async () => {
    await page.locator('#ranks-rows .row').nth(3).click();
    await page.waitForSelector('#detail-sheet:not([hidden])', { timeout: 10000 });
    await page.waitForTimeout(1400);
  };

  await open();
  const full = await state();
  check(`opens at full (top ${full.top} of ${full.vh})`, !full.hidden && full.top < full.vh * 0.25);
  const grab = await page.locator('#sheet-grab').boundingBox();
  const x = grab.x + grab.width / 2;
  const y0 = grab.y + 8;

  // ── a long-but-not-extreme pull should now PARK, not dismiss ──
  await drag(x, y0, y0 + 300);
  const parked = await state();
  check(`a 300px pull parks instead of dismissing (top ${parked.top})`, !parked.hidden);
  const halfish = Math.abs(parked.top - parked.vh * 0.5) < parked.vh * 0.12;
  check(`it rests near half screen (top ${parked.top}, half is ${Math.round(parked.vh * 0.5)})`, halfish);
  check(`backdrop lightened at the detent (${parked.backdrop})`, Number(parked.backdrop) < 0.95);
  check(`scroll gains matching bottom inset (${parked.inset})`, parseInt(parked.inset, 10) > 100);
  await page.screenshot({ path: `${S}-half.png` });

  // ── it STAYS there; a tap or a re-render must not snap it back ──
  await page.waitForTimeout(900);
  const stayed = await state();
  check(`it stays put (top ${stayed.top})`, !stayed.hidden && Math.abs(stayed.top - parked.top) < 8);

  // ── content below the fold is still reachable at the detent ──
  const reachable = await page.evaluate(() => {
    const sc = document.querySelector('.sheet-scroll');
    sc.scrollTop = sc.scrollHeight;
    return new Promise((r) => setTimeout(() => {
      const facts = document.getElementById('detail-facts').getBoundingClientRect();
      r({ bottom: Math.round(facts.bottom), vh: window.innerHeight, scrolled: Math.round(sc.scrollTop) });
    }, 350));
  });
  check(`the last content can be scrolled into view at half (facts bottom ${reachable.bottom} <= ${reachable.vh})`,
    reachable.bottom <= reachable.vh + 4);
  await page.screenshot({ path: `${S}-half-scrolled.png` });
  await page.evaluate(() => { document.querySelector('.sheet-scroll').scrollTop = 0; });
  await page.waitForTimeout(300);

  // ── dragging up from the detent returns to full ──
  const grab2 = await page.locator('#sheet-grab').boundingBox();
  await drag(grab2.x + grab2.width / 2, grab2.y + 8, grab2.y + 8 - 260);
  const backUp = await state();
  check(`dragging up returns to full (top ${backUp.top})`, Math.abs(backUp.top - full.top) < 12);
  check(`inset cleared back at full (${backUp.inset})`, parseInt(backUp.inset, 10) < 100);

  // ── from full, a pull past the detent dismisses ──
  const grab3 = await page.locator('#sheet-grab').boundingBox();
  await drag(grab3.x + grab3.width / 2, grab3.y + 8, grab3.y + 8 + 700, 20);
  check('a pull well past the detent still dismisses', (await state()).hidden);

  // ── from the detent, another pull down dismisses ──
  await open();
  const g4 = await page.locator('#sheet-grab').boundingBox();
  await drag(g4.x + g4.width / 2, g4.y + 8, g4.y + 8 + 300);
  const atHalf = await state();
  check(`back at the detent (top ${atHalf.top})`, !atHalf.hidden && Math.abs(atHalf.top - parked.top) < 20);
  const g5 = await page.locator('#sheet-grab').boundingBox();
  await drag(g5.x + g5.width / 2, g5.y + 8, g5.y + 8 + 260);
  check('a second pull from the detent dismisses', (await state()).hidden);

  // ── reopening always starts at full, never remembers the detent ──
  await open();
  const reopened = await state();
  check(`reopens at full, not half (top ${reopened.top})`, Math.abs(reopened.top - full.top) < 12);

  // ── a small pull still springs back to full ──
  await drag(x, y0, y0 + 70);
  const small = await state();
  check(`a 70px pull springs back to full (top ${small.top})`, Math.abs(small.top - full.top) < 12);

  // ── paging between names still works and resets nothing ──
  const box = await page.locator('#detail-sheet').boundingBox();
  const before = (await page.locator('#detail-ticker').textContent()).trim();
  await touch('touchStart', box.x + box.width * 0.8, box.y + 120);
  for (let i = 1; i <= 12; i++) await touch('touchMove', box.x + box.width * 0.8 - i * 22, box.y + 120);
  await touch('touchEnd', box.x + box.width * 0.8 - 264, box.y + 120);
  await page.waitForTimeout(900);
  const after = (await page.locator('#detail-ticker').textContent()).trim();
  check(`sideways paging unaffected (${before} -> ${after})`, after !== before && !(await state()).hidden);

  check(`no page errors (${errors.length})`, errors.length === 0);
  if (errors.length) console.log('ERRORS:', JSON.stringify(errors.slice(0, 4), null, 1));

  await context.close();
  console.log('=== RESULTS ===');
  results.forEach((r) => console.log(r));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
