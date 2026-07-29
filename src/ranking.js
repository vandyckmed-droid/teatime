// Server-side port of the ranking math in public/app.js (closeOnOrBefore /
// customRangeReturn / dailyReturnsInRange / volAdjustedScore). Kept as an
// independent copy rather than a shared import — this is a zero-build-step
// project with no module system shared between server and browser, and the
// browser copy stays in place as the fallback path for the two no-backend
// static-snapshot preview channels. If the scoring math changes, update both.

const TRADING_DAYS_PER_YEAR = 252;

function daysAgoToDateStr(daysAgo) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function closeOnOrBefore(series, dateStr) {
  let result = null;
  for (const p of series) {
    if (p.date <= dateStr) result = p.close;
    else break;
  }
  return result;
}

function customRangeReturn(series, startDaysAgo, endDaysAgo) {
  if (!series || series.length === 0) return null;
  const startClose = closeOnOrBefore(series, daysAgoToDateStr(startDaysAgo));
  const endClose = closeOnOrBefore(series, daysAgoToDateStr(endDaysAgo));
  if (startClose == null || endClose == null) return null;
  return ((endClose - startClose) / startClose) * 100;
}

function dailyReturnsInRange(series, startStr, endStr) {
  const inRange = series.filter((p) => p.date >= startStr && p.date <= endStr);
  const returns = [];
  for (let i = 1; i < inRange.length; i++) {
    const prev = inRange[i - 1].close;
    const cur = inRange[i].close;
    if (prev > 0) returns.push((cur - prev) / prev);
  }
  return returns;
}

function volAdjustedScore(series, startDaysAgo, endDaysAgo) {
  if (!series || series.length === 0) return null;
  const startStr = daysAgoToDateStr(startDaysAgo);
  const endStr = daysAgoToDateStr(endDaysAgo);
  if (series[0].date > startStr) return null;

  const returns = dailyReturnsInRange(series, startStr, endStr);
  if (returns.length < 2) return null;

  const n = returns.length;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const stdev = Math.sqrt(variance);
  if (!(stdev > 0)) return null;

  return (mean / stdev) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

module.exports = { customRangeReturn, volAdjustedScore };
