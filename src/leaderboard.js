const fmp = require('./fmpClient');
const config = require('./config');
const { mapWithConcurrency } = require('./concurrency');

// Multiple share classes (GOOGL/GOOG, BRK-A/BRK-B) and duplicate listings
// map to the same company; keep only the higher-market-cap line per name.
function dedupeByCompany(rows) {
  const bestByName = new Map();
  for (const row of rows) {
    const existing = bestByName.get(row.companyName);
    if (!existing || row.marketCap > existing.marketCap) {
      bestByName.set(row.companyName, row);
    }
  }
  return [...bestByName.values()];
}

function daysBetween(from, to) {
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

// Per metric window, whether this company has enough trading history for
// the return to be meaningful rather than a clamped since-IPO figure.
function metricAvailability(ipoDate, asOf) {
  const availability = {};
  if (!ipoDate) {
    for (const key of Object.keys(config.metricMinDays)) availability[key] = true;
    availability.ytd = true;
    return availability;
  }
  const ipo = new Date(ipoDate);
  const daysSinceIpo = daysBetween(ipo, asOf);
  for (const [key, minDays] of Object.entries(config.metricMinDays)) {
    availability[key] = daysSinceIpo >= minDays;
  }
  const jan1 = new Date(Date.UTC(asOf.getUTCFullYear(), 0, 1));
  availability.ytd = ipo <= jan1;
  return availability;
}

function extractReturns(priceChange) {
  const out = {};
  for (const metric of config.metrics) {
    out[metric.key] = priceChange ? priceChange[metric.key] : null;
  }
  return out;
}

async function getLeaderboard() {
  const asOf = new Date();

  const candidates = await fmp.screenLargestCompanies({
    limit: config.screenerCandidatePool,
    minMarketCap: config.screenerMinMarketCap,
    country: config.country,
    exchanges: config.exchanges,
  });

  const universe = dedupeByCompany(candidates)
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, config.universeSize);

  const companies = await mapWithConcurrency(universe, config.fmpConcurrency, async (c) => {
    const [priceChange, profile] = await Promise.all([
      fmp.getPriceChange(c.symbol).catch(() => null),
      fmp.getProfile(c.symbol).catch(() => null),
    ]);
    const ipoDate = profile ? profile.ipoDate : null;
    return {
      symbol: c.symbol,
      name: c.companyName,
      sector: c.sector,
      price: c.price,
      marketCap: c.marketCap,
      beta: typeof c.beta === 'number' ? c.beta : null,
      ipoDate,
      returns: extractReturns(priceChange),
      availability: metricAvailability(ipoDate, asOf),
    };
  });

  return {
    asOf: asOf.toISOString(),
    universeSize: config.universeSize,
    metrics: config.metrics,
    defaultMetric: config.defaultMetric,
    companies,
  };
}

module.exports = { getLeaderboard, metricAvailability };
