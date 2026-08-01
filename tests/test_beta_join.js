// The beta join rules, exercised against a throwaway copy of the repo so the
// real data files are never touched. Covers the cases a live server can't:
// too few paired sessions, no benchmark file at all, and what happens when
// one side of the join has holes.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const REPO = require('path').join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'beta-'));

let pass = 0;
const fails = [];
function check(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`  ok  ${name}`); }
  else { fails.push(`${name}${extra ? ` — ${extra}` : ''}`); console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`); }
}

for (const d of ['src', 'data/portfolio', 'data/market']) fs.mkdirSync(path.join(TMP, d), { recursive: true });
for (const f of fs.readdirSync(path.join(REPO, 'src'))) {
  fs.copyFileSync(path.join(REPO, 'src', f), path.join(TMP, 'src', f));
}
const REAL_BALANCES = fs.readFileSync(path.join(REPO, 'data/portfolio/balances.csv'), 'utf8');
const REAL_SPY = fs.readFileSync(path.join(REPO, 'data/market/spy.csv'), 'utf8');

function run(balances, spy) {
  fs.writeFileSync(path.join(TMP, 'data/portfolio/balances.csv'), balances);
  if (spy === null) fs.rmSync(path.join(TMP, 'data/market/spy.csv'), { force: true });
  else fs.writeFileSync(path.join(TMP, 'data/market/spy.csv'), spy);
  const out = execSync(
    `node -e "console.log(JSON.stringify(require('${TMP}/src/portfolio').getPortfolio()))"`,
    { encoding: 'utf8' },
  );
  return JSON.parse(out);
}

function balanceRows(text) {
  return text.trim().split('\n').slice(1);
}
const HEADER = 'date,balance';

// ── baseline: the real files reproduce the real answer ──────────────
// No literal here on purpose: it moves every time a balance is appended. The
// real check on the value is the independent recomputation at the bottom of
// this file; this one just says a number came out at all.
const full = run(REAL_BALANCES, REAL_SPY);
check('baseline produces a beta', typeof full.betaVsSpy === 'number' && Number.isFinite(full.betaVsSpy),
  String(full.betaVsSpy));
check('baseline is in a plausible range for an equity account',
  full.betaVsSpy > 0 && full.betaVsSpy < 2, String(full.betaVsSpy));
check('baseline fills the 126-session window', full.betaSessions === 126, String(full.betaSessions));

// ── the 60-session floor ────────────────────────────────────────────
const rows = balanceRows(REAL_BALANCES);
// 63 balances -> 62 steps, less the two in that stretch that span a recording
// gap (05-06→05-08 and 06-25→06-29), which lands exactly on the floor at 60.
// The gap arithmetic is the point: a naive count would say 62.
const at60 = run(`${HEADER}\n${rows.slice(-63).join('\n')}\n`, REAL_SPY);
check('60 paired sessions is enough', at60.betaSessions === 60 && typeof at60.betaVsSpy === 'number',
  `${at60.betaSessions} / ${at60.betaVsSpy}`);

const at59 = run(`${HEADER}\n${rows.slice(-62).join('\n')}\n`, REAL_SPY);
check('59 paired sessions is hidden', at59.betaSessions === 59 && at59.betaVsSpy === null,
  `${at59.betaSessions} / ${at59.betaVsSpy}`);
check('hiding beta leaves the rest of the summary intact',
  typeof at59.annualizedVolPct === 'number' && typeof at59.totalReturnPct === 'number');

// ── no benchmark file at all ────────────────────────────────────────
const noSpy = run(REAL_BALANCES, null);
check('missing benchmark hides beta rather than throwing', noSpy.betaVsSpy === null && noSpy.betaSessions === 0,
  `${noSpy.betaVsSpy} / ${noSpy.betaSessions}`);
check('missing benchmark leaves volatility untouched',
  Math.abs(noSpy.annualizedVolPct - full.annualizedVolPct) < 1e-12);

// ── the join is an inner join, on both sides ────────────────────────
// Drop 40 SPY rows that the portfolio does have. Those sessions must leave the
// pairing entirely — not be zero-filled, not be carried forward.
const spyRows = REAL_SPY.trim().split('\n');
const spyHeader = spyRows[0];
const spyBody = spyRows.slice(1);
const holed = [spyHeader, ...spyBody.slice(0, spyBody.length - 45), ...spyBody.slice(spyBody.length - 5)].join('\n');
const punched = run(REAL_BALANCES, `${holed}\n`);
check('a hole in the benchmark removes those sessions from the pairing',
  punched.betaSessions < full.betaSessions, `${punched.betaSessions} vs ${full.betaSessions}`);
check('a hole in the benchmark changes beta rather than being filled in',
  punched.betaVsSpy !== full.betaVsSpy);
// A forward-fill would produce runs of rm === 0 against real portfolio moves,
// which drags beta toward zero. Removing the days instead leaves it in range.
check('beta stays in a sane range after the hole',
  punched.betaVsSpy > 0.2 && punched.betaVsSpy < 1.0, String(punched.betaVsSpy));

// Same on the portfolio side: delete a stretch of balances and the pairs fall
// with them.
const thinned = [...rows.slice(0, rows.length - 40), ...rows.slice(rows.length - 5)];
const thin = run(`${HEADER}\n${thinned.join('\n')}\n`, REAL_SPY);
check('a hole in the balances removes those sessions from the pairing',
  thin.betaSessions < full.betaSessions, `${thin.betaSessions} vs ${full.betaSessions}`);

// ── the recording-gap exclusion carries over ────────────────────────
// The four steps that span a gap are already out of the volatility figure;
// they must be out of beta too. Every paired session is a return step, so the
// pair count can never exceed returnSteps.
check('pairs never exceed the steps volatility used', full.betaSessions <= full.returnSteps,
  `${full.betaSessions} > ${full.returnSteps}`);
check('the four gap-spanning steps are still excluded upstream', full.skippedSteps === 4, String(full.skippedSteps));

// Make one of those gaps enormous: the step across it must not become a pair,
// even though both dates exist in SPY.
const withBigGap = [rows[0], ...rows.slice(70)];
const gapped = run(`${HEADER}\n${withBigGap.join('\n')}\n`, REAL_SPY);
check('a step across a huge gap is not paired', gapped.skippedSteps >= 1, String(gapped.skippedSteps));

// ── trailing window, not leading ────────────────────────────────────
// Appending nothing but removing the oldest rows must not move beta, because
// the window only ever looks at the last 126 pairs.
const trimmedFront = run(`${HEADER}\n${rows.slice(5).join('\n')}\n`, REAL_SPY);
check('dropping the oldest rows leaves beta unchanged',
  Math.abs(trimmedFront.betaVsSpy - full.betaVsSpy) < 1e-12,
  `${trimmedFront.betaVsSpy} vs ${full.betaVsSpy}`);

// ── total return, not price return ──────────────────────────────────
// Zeroing the dividend column has to change the answer; if it doesn't, the
// column is being ignored.
const noDivs = [spyHeader, ...spyBody.map((l) => { const p = l.split(','); return `${p[0]},${p[1]},0`; })].join('\n');
const priceOnly = run(REAL_BALANCES, `${noDivs}\n`);
check('the dividend column actually feeds the return', priceOnly.betaVsSpy !== full.betaVsSpy,
  `${priceOnly.betaVsSpy} vs ${full.betaVsSpy}`);
check('but it moves beta only slightly', Math.abs(priceOnly.betaVsSpy - full.betaVsSpy) < 0.05,
  String(Math.abs(priceOnly.betaVsSpy - full.betaVsSpy)));

// ── the formula ─────────────────────────────────────────────────────
// Independently recomputed here, straight from the two files, using SPY's own
// row order to define "the previous session" rather than a holiday calendar.
const closes = new Map(spyBody.map((l) => { const p = l.split(','); return [p[0], Number(p[1])]; }));
const divs = new Map(spyBody.map((l) => { const p = l.split(','); return [p[0], Number(p[2])]; }));
const dates = spyBody.map((l) => l.split(',')[0]);
const idx = new Map(dates.map((d, i) => [d, i]));
const bal = rows.map((l) => l.split(','));
const pairs = [];
for (let i = 1; i < bal.length; i++) {
  const j = idx.get(bal[i][0]);
  if (j === undefined || j === 0 || dates[j - 1] !== bal[i - 1][0]) continue;
  pairs.push([
    Number(bal[i][1]) / Number(bal[i - 1][1]) - 1,
    (closes.get(bal[i][0]) + divs.get(bal[i][0])) / closes.get(dates[j - 1]) - 1,
  ]);
}
const w = pairs.slice(-126);
const n = w.length;
const mp = w.reduce((a, x) => a + x[0], 0) / n;
const mm = w.reduce((a, x) => a + x[1], 0) / n;
let cov = 0; let varM = 0;
for (const [p, m] of w) { cov += (p - mp) * (m - mm); varM += (m - mm) ** 2; }
cov /= n - 1; varM /= n - 1;
check('matches an independent recomputation', Math.abs(cov / varM - full.betaVsSpy) < 1e-9,
  `${cov / varM} vs ${full.betaVsSpy}`);
check('independent pairing agrees on the count', n === full.betaSessions, `${n} vs ${full.betaSessions}`);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log(`  - ${f}`)); process.exit(1); }
