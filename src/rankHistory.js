// Where one company sat in the pack over time.
//
// At each sampled past date d, every company in the universe is scored over the
// *same* ranking window the boards use, slid back to end at d: [d - startDaysAgo,
// d - endDaysAgo]. The company is then ranked among everyone who had a score on
// that date, and that rank is expressed as a percentile so a date where fewer
// companies had enough history doesn't quietly change the scale.
//
// Two properties this is built around:
//   - The newest sampled date is always the latest trading day, and its window
//     is exactly the board's current one — so the chart's last point is the
//     company's rank on the Ranks tab right now, not an approximation of it.
//   - Scoring runs through src/ranking.js's *Between functions, the same
//     formulas /api/rank uses. No second copy of the math lives here.

const ranking = require('./ranking');

// The chart is ~340px wide, so more points than this land inside a pixel of
// each other. It also bounds the work: a point costs one full pass over the
// universe (see the nested loop below).
const MAX_POINTS = 120;

// A rank needs a pack to be a rank in. Below this the percentile is noise.
const MIN_UNIVERSE = 5;

function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

// Preparing the whole universe costs a pass over every series, so it's memoized
// against the store's asOf stamp — every request between two daily refreshes
// scores the identical data (see src/dataStore.js).
let preparedCache = { key: null, prepared: null };

function prepareUniverse(historyBySymbol, cacheKey) {
  if (preparedCache.key && preparedCache.key === cacheKey) return preparedCache.prepared;
  const prepared = new Map();
  for (const [symbol, hist] of historyBySymbol.entries()) {
    if (hist && hist.series && hist.series.length > 0) {
      prepared.set(symbol, ranking.prepareSeries(hist.series));
    }
  }
  if (cacheKey) preparedCache = { key: cacheKey, prepared };
  return prepared;
}

// Evaluation dates: the symbol's own trading days inside the span, thinned to at
// most MAX_POINTS. Sampled backwards from the newest so the latest trading day is
// always included whatever the step works out to — that's the point that has to
// agree with the live board.
function sampleDates(series, cutoffStr) {
  const dates = [];
  for (const p of series) if (p.date >= cutoffStr) dates.push(p.date);
  if (dates.length === 0) return dates;
  const step = Math.max(1, Math.ceil(dates.length / MAX_POINTS));
  const out = [];
  for (let i = dates.length - 1; i >= 0; i -= step) out.push(dates[i]);
  out.reverse();
  return out;
}

function rankHistory(historyBySymbol, {
  symbol, startDaysAgo, endDaysAgo, volAdjusted, spanDays, cacheKey,
}) {
  const target = historyBySymbol.get(symbol);
  if (!target || !target.series || target.series.length === 0) return null;

  const prepared = prepareUniverse(historyBySymbol, cacheKey);
  const score = volAdjusted ? ranking.volAdjustedBetween : ranking.returnBetween;
  const dates = sampleDates(target.series, ranking.daysAgoToDateStr(spanDays));
  // The boards score their window relative to *today*, not to the last trading
  // day, so the newest point has to as well or the chart's last rank disagrees
  // with the list the user just tapped. Replaces the last sample rather than
  // appending, which would leave a one-day-wide final segment.
  const todayStr = ranking.daysAgoToDateStr(0);
  if (dates.length > 0 && dates[dates.length - 1] < todayStr) dates[dates.length - 1] = todayStr;

  // Reused across dates: scoring the pack is the expensive part, and the ranking
  // step only needs the scores, not which symbol each belongs to.
  const scores = new Float64Array(prepared.size);

  const points = [];
  for (const date of dates) {
    const startStr = addDays(date, -startDaysAgo);
    const endStr = addDays(date, -endDaysAgo);

    let mine = null;
    let of = 0;
    for (const [sym, p] of prepared.entries()) {
      const s = score(p, startStr, endStr);
      if (s === null || !Number.isFinite(s)) continue;
      scores[of] = s;
      of += 1;
      if (sym === symbol) mine = s;
    }
    if (mine === null || of < MIN_UNIVERSE) continue;

    let better = 0;
    for (let i = 0; i < of; i++) if (scores[i] > mine) better += 1;

    const rank = better + 1;
    points.push({
      date,
      rank,
      of,
      // Mapped so rank 1 is percentile 1 and last place is percentile 100,
      // which is what the axis is labelled as.
      pct: ((rank - 1) / (of - 1)) * 99 + 1,
    });
  }

  return {
    symbol,
    startDaysAgo,
    endDaysAgo,
    volAdjusted: !!volAdjusted,
    windowDays: startDaysAgo - endDaysAgo,
    points,
  };
}

module.exports = { rankHistory, MAX_POINTS };
