const fs = require('fs');
const path = require('path');

const { getSpySeries } = require('./market');

// ── the owner's own account balance ──────────────────────────────────
// Read from data/portfolio/balances.csv (see the README beside it), which is
// maintained by hand from brokerage screenshots. Everything here is derived
// from those dates and dollar figures alone — deliberately not reconciled
// against the broker's own headline "rate of return", which uses a baseline
// and a method we don't have.
const CSV_PATH = path.join(__dirname, '..', 'data', 'portfolio', 'balances.csv');

const TRADING_DAYS_PER_YEAR = 252;
// The exposure figure below answers "what multiple of today's holdings would
// have run at this volatility". 15% is the owner's stated target.
const TARGET_VOL_PCT = 15;

// 2026 US market closures. Only used to tell a genuinely missing session from
// a weekend or a holiday, so returns aren't computed across a hole in the
// data. Extend this when the series runs into 2027.
const MARKET_HOLIDAYS_2026 = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
]);

function parseCsv(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i++) { // row 0 is the header
    const line = lines[i].trim();
    if (!line) continue;
    const [date, balance] = line.split(',');
    const value = Number(balance);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value) || value <= 0) continue;
    out.push({ date, balance: value });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function isSession(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (day === 0 || day === 6) return false;
  return !MARKET_HOLIDAYS_2026.has(dateStr);
}

// How many trading sessions sit strictly between two dates. 0 means the pair
// is genuinely consecutive — the only kind of step a daily return may be
// taken across. A missed day in the source data would otherwise show up as
// one day with two days of movement in it, inflating volatility.
function sessionsBetween(fromStr, toStr) {
  let count = 0;
  for (let d = addDays(fromStr, 1); d < toStr; d = addDays(d, 1)) {
    if (isSession(d)) count += 1;
  }
  return count;
}

// ── beta against the market ──────────────────────────────────────────
// cov(rp, rm) / var(rm) over a trailing window of sessions where *both* a
// portfolio balance move and a SPY move exist. The join is the whole point:
// a missing balance day is never zero-filled or carried forward, because
// either one would invent a day of "the account didn't move while the market
// did" and drag beta toward zero.
const BETA_WINDOW_SESSIONS = 126; // ~6 months of trading
// Below this the estimate is mostly noise, so the app hides the figure rather
// than printing a number it doesn't believe.
const BETA_MIN_SESSIONS = 60;

// SPY's daily total return, keyed by the date the return landed on. Same
// consecutive-sessions rule as the portfolio side — SPY's series shouldn't
// have holes, but the check only ever drops a pair, never invents one. It
// does drop steps around pre-2026 holidays, which MARKET_HOLIDAYS_2026
// doesn't know about; that costs nothing here, since the join can only keep
// dates the balance file also has.
function marketReturnsByDate(spy) {
  const out = new Map();
  for (let i = 1; i < spy.length; i++) {
    const prev = spy[i - 1];
    const cur = spy[i];
    if (sessionsBetween(prev.date, cur.date) > 0) continue;
    // Dividend added back on its ex-date: this is a total return, matching a
    // brokerage balance, which collects its dividends whether we model them
    // or not.
    out.set(cur.date, (cur.close + cur.dividend) / prev.close - 1);
  }
  return out;
}

function computeBeta(daily, spy) {
  if (!spy || spy.length < 2) return { beta: null, sessions: 0 };

  const rmByDate = marketReturnsByDate(spy);
  const paired = [];
  for (const step of daily) {
    const rm = rmByDate.get(step.date);
    if (rm === undefined) continue;
    paired.push([step.value, rm]);
  }

  const window = paired.slice(-BETA_WINDOW_SESSIONS);
  const n = window.length;
  if (n < BETA_MIN_SESSIONS) return { beta: null, sessions: n };

  const meanP = window.reduce((a, [p]) => a + p, 0) / n;
  const meanM = window.reduce((a, [, m]) => a + m, 0) / n;
  let cov = 0;
  let varM = 0;
  for (const [p, m] of window) {
    cov += (p - meanP) * (m - meanM);
    varM += (m - meanM) ** 2;
  }
  // Sample (n-1) on both, for the same reason stdev() uses it. The divisors
  // cancel in the ratio; they're written out because the formula is the spec.
  cov /= n - 1;
  varM /= n - 1;
  if (!(varM > 0)) return { beta: null, sessions: n };

  return { beta: cov / varM, sessions: n };
}

function stdev(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  // Sample standard deviation: these returns are a sample of the strategy's
  // behaviour, not the whole population of it.
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function summarize(series) {
  if (series.length < 2) return null;

  const first = series[0];
  const last = series[series.length - 1];

  // Simple returns across genuinely consecutive sessions only; the skipped
  // pairs are reported rather than quietly dropped. Each return is tagged with
  // the date it landed on, which is what lets beta pair it with the market's
  // move on the same session.
  const daily = [];
  let skipped = 0;
  for (let i = 1; i < series.length; i++) {
    if (sessionsBetween(series[i - 1].date, series[i].date) > 0) { skipped += 1; continue; }
    daily.push({ date: series[i].date, value: series[i].balance / series[i - 1].balance - 1 });
  }
  const dailyValues = daily.map((d) => d.value);

  const dailyVol = stdev(dailyValues);
  const annualizedVol = dailyVol === null ? null : dailyVol * Math.sqrt(TRADING_DAYS_PER_YEAR);
  const totalReturn = last.balance / first.balance - 1;

  // Calendar-time annualization of the total return, so a part-year series
  // isn't reported as if it were a full year's result.
  const days = Math.max(1, Math.round((Date.parse(last.date) - Date.parse(first.date)) / 86400000));
  const annualizedReturn = (1 + totalReturn) ** (365 / days) - 1;

  const { beta, sessions: betaSessions } = computeBeta(daily, getSpySeries());

  return {
    start: first.date,
    end: last.date,
    startBalance: first.balance,
    endBalance: last.balance,
    changeDollars: last.balance - first.balance,
    totalReturnPct: totalReturn * 100,
    annualizedReturnPct: annualizedReturn * 100,
    calendarDays: days,
    sessions: series.length,
    // Steps a daily return was taken across, and steps that spanned a gap in
    // the source data and were left out of the volatility figure.
    returnSteps: daily.length,
    skippedSteps: skipped,
    dailyVolPct: dailyVol === null ? null : dailyVol * 100,
    annualizedVolPct: annualizedVol === null ? null : annualizedVol * 100,
    targetVolPct: TARGET_VOL_PCT,
    // What multiple of the current exposure would have run at the target
    // volatility, given the volatility this series actually realized. Above 1
    // means the account was quieter than the target.
    exposureScale: annualizedVol > 0 ? (TARGET_VOL_PCT / 100) / annualizedVol : null,
    best: dailyValues.length ? Math.max(...dailyValues) * 100 : null,
    worst: dailyValues.length ? Math.min(...dailyValues) * 100 : null,
    // Null whenever the paired window is too short to mean anything (or SPY
    // has never been fetched); the card leaves the row out entirely rather
    // than showing a placeholder.
    betaVsSpy: beta,
    betaSessions,
    betaWindowSessions: BETA_WINDOW_SESSIONS,
    betaMinSessions: BETA_MIN_SESSIONS,
  };
}

// Read fresh each call rather than caching: the file is edited by hand
// between runs, and it's a few hundred short lines. (A holdings.csv companion
// — per-position dollars feeding a held-vs-plan card — lived here for two
// days in August 2026 and was removed at the owner's request: transcribing
// positions from brokerage screenshots was more upkeep than the card was
// worth. The balances below are the piece the owner chose to keep.)
function getPortfolio() {
  let text;
  try {
    text = fs.readFileSync(CSV_PATH, 'utf8');
  } catch {
    return null; // no balances recorded — callers hide the panel
  }
  const series = parseCsv(text);
  if (series.length < 2) return null;
  const summary = summarize(series);
  return {
    ...summary,
    series: series.map((p) => [p.date, p.balance]),
  };
}

module.exports = { getPortfolio };
