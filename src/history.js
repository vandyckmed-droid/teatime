const fmp = require('./fmpClient');
const config = require('./config');
const { mapWithConcurrency } = require('./concurrency');

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

// One symbol's daily closes, oldest first, covering the longest chart range —
// the frontend slices this per selected window instead of refetching.
async function getHistory(symbol) {
  const to = new Date();
  const from = new Date(to.getTime() - config.historyLookbackDays * 86400000);

  const rows = await fmp.getHistoricalPrices(symbol, isoDate(from), isoDate(to));
  const series = rows
    .map((r) => ({ date: r.date, close: r.close }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return { symbol, asOf: to.toISOString(), series };
}

// Fetches history for many symbols at once, throttled to config.fmpConcurrency
// in flight — the batch companion to getHistory. Ranks/Watchlist need the
// whole universe's history to rank by a custom date range, so this is what
// lets that stay one request instead of one per company as the universe grows.
async function getHistoryBatch(symbols) {
  return mapWithConcurrency(symbols, config.fmpConcurrency, (symbol) => getHistory(symbol));
}

module.exports = { getHistory, getHistoryBatch };
