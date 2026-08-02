// Server-side port of the ranking math in public/app.js (prepareSeries /
// returnBetween / volAdjustedBetween). Kept as an independent copy rather than
// a shared import — this is a zero-build-step project with no module system
// shared between server and browser, and the browser copy stays in place as the
// fallback path for the no-backend static-snapshot preview channel. If the
// scoring math changes, update both.
//
// The formulas live in the *Between functions, which take explicit date strings
// and a "prepared" series — a form cheap enough to score many times without
// re-filtering an array per call. customRangeReturn/volAdjustedScore are the
// days-ago-addressed wrappers /api/rank uses. (A rank-history module once sat
// on the date-addressed layer; it's gone, but the split stays because it is
// what makes the math testable against explicit dates.)

const TRADING_DAYS_PER_YEAR = 252;

function daysAgoToDateStr(daysAgo) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

// Splits a {date, close}[] into parallel arrays plus each day's change from the
// day before, so scoring a window is an index range rather than a filter pass.
// returns[0] is NaN — the first close has no prior day to change from.
function prepareSeries(series) {
  const dates = [];
  const closes = [];
  for (const p of series || []) {
    dates.push(p.date);
    closes.push(p.close);
  }
  const returns = new Float64Array(dates.length);
  if (dates.length > 0) returns[0] = NaN;
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    returns[i] = prev > 0 ? (closes[i] - prev) / prev : NaN;
  }
  return { dates, closes, returns };
}

// Last index whose date is <= dateStr, or -1.
function indexAtOrBefore(dates, dateStr) {
  let lo = 0;
  let hi = dates.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= dateStr) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans;
}

// First index whose date is >= dateStr, or -1.
function indexAtOrAfter(dates, dateStr) {
  let lo = 0;
  let hi = dates.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] >= dateStr) { ans = mid; hi = mid - 1; } else { lo = mid + 1; }
  }
  return ans;
}

// Point-to-point % change between the last close on or before each end of the
// window — "on or before" so an edge landing on a weekend or holiday uses that
// week's last real close instead of dropping the company.
function returnBetween(prepared, startStr, endStr) {
  const { dates, closes } = prepared;
  if (dates.length === 0) return null;
  const i = indexAtOrBefore(dates, startStr);
  const j = indexAtOrBefore(dates, endStr);
  if (i < 0 || j < 0) return null;
  const startClose = closes[i];
  if (!(startClose > 0)) return null;
  return ((closes[j] - startClose) / startClose) * 100;
}

// Annualized return ÷ annualized volatility, both derived from the same daily
// returns: annualized mean is mean*252, annualized stdev is stdev*sqrt(252), so
// the ratio simplifies to (mean / stdev) * sqrt(252) — a Sharpe ratio without a
// risk-free-rate subtraction, over the given window.
function volAdjustedBetween(prepared, startStr, endStr) {
  const { dates, returns } = prepared;
  if (dates.length === 0) return null;
  if (dates[0] > startStr) return null; // no coverage back to the start date
  const i = indexAtOrAfter(dates, startStr);
  const j = indexAtOrBefore(dates, endStr);
  if (i < 0 || j <= i) return null;

  // The window's daily returns are returns[i+1..j]: the change into each
  // in-window trading day except the first, which has no in-window predecessor.
  let n = 0;
  let sum = 0;
  for (let k = i + 1; k <= j; k++) {
    const r = returns[k];
    if (Number.isNaN(r)) continue;
    n += 1;
    sum += r;
  }
  if (n < 2) return null;
  const mean = sum / n;
  let sumSq = 0;
  for (let k = i + 1; k <= j; k++) {
    const r = returns[k];
    if (Number.isNaN(r)) continue;
    sumSq += (r - mean) ** 2;
  }
  const stdev = Math.sqrt(sumSq / (n - 1));
  if (!(stdev > 0)) return null;
  return (mean / stdev) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

// Realized annualized volatility over the trailing ~12 months of closes, in
// percent. Feeds the leaderboard's per-company annVolPct (see dataStore). Its
// one consumer today is the daily archive — the high-volatility row flag that
// prompted it was rolled back — but the window rule it was built under still
// governs: a fixed trailing year, not the ranking window, because a fact about
// the company shouldn't quietly change meaning when the ranking window moves.
// Sample stdev of simple daily returns, same convention as volAdjustedBetween
// above and src/portfolio.js.
const TRAILING_VOL_SESSIONS = 250;
const TRAILING_VOL_MIN_RETURNS = 60; // under ~3 months of history is noise, not a fact

function trailingAnnualizedVolPct(series) {
  const pts = (series || []).slice(-(TRAILING_VOL_SESSIONS + 1));
  if (pts.length < TRAILING_VOL_MIN_RETURNS + 1) return null;
  const returns = [];
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1].close;
    if (!(prev > 0) || !(pts[i].close > 0)) continue;
    returns.push(pts[i].close / prev - 1);
  }
  if (returns.length < TRAILING_VOL_MIN_RETURNS) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100;
}

function customRangeReturn(series, startDaysAgo, endDaysAgo) {
  if (!series || series.length === 0) return null;
  return returnBetween(prepareSeries(series), daysAgoToDateStr(startDaysAgo), daysAgoToDateStr(endDaysAgo));
}

function volAdjustedScore(series, startDaysAgo, endDaysAgo) {
  if (!series || series.length === 0) return null;
  return volAdjustedBetween(prepareSeries(series), daysAgoToDateStr(startDaysAgo), daysAgoToDateStr(endDaysAgo));
}

module.exports = {
  customRangeReturn,
  volAdjustedScore,
  prepareSeries,
  returnBetween,
  volAdjustedBetween,
  trailingAnnualizedVolPct,
  daysAgoToDateStr,
};
