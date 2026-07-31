const fs = require('fs');
const path = require('path');

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
  // pairs are reported rather than quietly dropped.
  const daily = [];
  let skipped = 0;
  for (let i = 1; i < series.length; i++) {
    if (sessionsBetween(series[i - 1].date, series[i].date) > 0) { skipped += 1; continue; }
    daily.push(series[i].balance / series[i - 1].balance - 1);
  }

  const dailyVol = stdev(daily);
  const annualizedVol = dailyVol === null ? null : dailyVol * Math.sqrt(TRADING_DAYS_PER_YEAR);
  const totalReturn = last.balance / first.balance - 1;

  // Calendar-time annualization of the total return, so a part-year series
  // isn't reported as if it were a full year's result.
  const days = Math.max(1, Math.round((Date.parse(last.date) - Date.parse(first.date)) / 86400000));
  const annualizedReturn = (1 + totalReturn) ** (365 / days) - 1;

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
    best: daily.length ? Math.max(...daily) * 100 : null,
    worst: daily.length ? Math.min(...daily) * 100 : null,
  };
}

// Read fresh each call rather than caching: the file is edited by hand
// between runs, and it's 124 short lines.
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
  return { ...summary, series: series.map((p) => [p.date, p.balance]) };
}

module.exports = { getPortfolio, summarize, parseCsv, sessionsBetween, TARGET_VOL_PCT };
