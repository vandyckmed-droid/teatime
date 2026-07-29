// In-memory store refreshed on a timer instead of per-request (see
// config.pricedRefreshMs / slowFactsRefreshMs). A refresh cycle is
// all-or-nothing: nothing here mutates until every fetch it depends on has
// succeeded, so a failed cycle just logs and leaves the last-known-good data
// serving untouched, and the next interval tries again.

const config = require('./config');
const { getLeaderboard, metricAvailability } = require('./leaderboard');
const { getHistoryBatch } = require('./history');

const store = {
  leaderboard: null,
  historyBySymbol: null, // Map(symbol -> { symbol, asOf, series })
  historyAsOf: null,
  slowFactsBySymbol: new Map(), // symbol -> { sector, beta, ipoDate }
  slowFactsAsOf: null,
};

async function refreshAll() {
  const asOf = new Date();
  const data = await getLeaderboard();

  const shouldCommitSlowFacts =
    !store.slowFactsAsOf || Date.now() - store.slowFactsAsOf >= config.slowFactsRefreshMs;

  const mergedCompanies = data.companies.map((fresh) => {
    const previous = store.slowFactsBySymbol.get(fresh.symbol);
    const useRetained = previous && !shouldCommitSlowFacts;
    const sector = useRetained ? previous.sector : fresh.sector;
    const beta = useRetained ? previous.beta : fresh.beta;
    const ipoDate = useRetained ? previous.ipoDate : fresh.ipoDate;
    return { ...fresh, sector, beta, ipoDate, availability: metricAvailability(ipoDate, asOf) };
  });

  const symbols = mergedCompanies.map((c) => c.symbol);
  const historyResults = await getHistoryBatch(symbols);

  // Everything needed has succeeded — commit atomically.
  if (shouldCommitSlowFacts) store.slowFactsAsOf = Date.now();
  const newSlowFactsBySymbol = new Map();
  for (const c of mergedCompanies) {
    newSlowFactsBySymbol.set(c.symbol, { sector: c.sector, beta: c.beta, ipoDate: c.ipoDate });
  }
  store.slowFactsBySymbol = newSlowFactsBySymbol;

  store.leaderboard = { ...data, companies: mergedCompanies, asOf: asOf.toISOString() };

  const newHistoryBySymbol = new Map();
  historyResults.forEach((h, i) => newHistoryBySymbol.set(symbols[i], h));
  store.historyBySymbol = newHistoryBySymbol;
  store.historyAsOf = asOf.toISOString();
}

async function init() {
  await refreshAll();
  setInterval(() => {
    refreshAll().catch((err) => {
      console.error('Scheduled refresh failed, keeping last-known-good data:', err.message);
    });
  }, config.pricedRefreshMs);
}

module.exports = {
  init,
  getLeaderboard: () => store.leaderboard,
  getHistoryBySymbol: () => store.historyBySymbol,
  getHistoryAsOf: () => store.historyAsOf,
  getSlowFactsAsOf: () => store.slowFactsAsOf,
};
