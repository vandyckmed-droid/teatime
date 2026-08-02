// In-memory store refreshed on a timer instead of per-request (see
// config.pricedRefreshMs / slowFactsRefreshMs). A refresh cycle is
// all-or-nothing: nothing here mutates until every fetch it depends on has
// succeeded, so a failed cycle just logs and leaves the last-known-good data
// serving untouched, and the next interval tries again.

const config = require('./config');
const { getLeaderboard, metricAvailability } = require('./leaderboard');
const { getHistoryBatch } = require('./history');
const { trailingAnnualizedVolPct } = require('./ranking');

const store = {
  leaderboard: null,
  historyBySymbol: null, // Map(symbol -> { symbol, asOf, series })
  historyAsOf: null,
  slowFactsBySymbol: new Map(), // symbol -> { sector, industry, beta, ipoDate }
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
    const industry = useRetained ? previous.industry : fresh.industry;
    const beta = useRetained ? previous.beta : fresh.beta;
    const ipoDate = useRetained ? previous.ipoDate : fresh.ipoDate;
    return { ...fresh, sector, industry, beta, ipoDate, availability: metricAvailability(ipoDate, asOf) };
  });

  const symbols = mergedCompanies.map((c) => c.symbol);
  const historyResults = await getHistoryBatch(symbols);

  // Realized trailing-1Y volatility rides on each company, computed here from
  // the history this refresh just fetched anyway — zero extra API calls. It
  // once fed a high-volatility row flag (rolled back, like the biotech dimmer
  // that briefly replaced it); it stays because the daily archive files it, and
  // a later question about volatility regimes shouldn't need the raw history
  // re-fetched.
  const companiesWithVol = mergedCompanies.map((c, i) => ({
    ...c,
    annVolPct: trailingAnnualizedVolPct(historyResults[i] && historyResults[i].series),
  }));

  // Everything needed has succeeded — commit atomically.
  if (shouldCommitSlowFacts) store.slowFactsAsOf = Date.now();
  const newSlowFactsBySymbol = new Map();
  for (const c of companiesWithVol) {
    newSlowFactsBySymbol.set(c.symbol, { sector: c.sector, industry: c.industry, beta: c.beta, ipoDate: c.ipoDate });
  }
  store.slowFactsBySymbol = newSlowFactsBySymbol;

  store.leaderboard = { ...data, companies: companiesWithVol, asOf: asOf.toISOString() };

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
};
