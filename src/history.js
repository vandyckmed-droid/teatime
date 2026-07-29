const fmp = require('./fmpClient');
const config = require('./config');

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

module.exports = { getHistory };
