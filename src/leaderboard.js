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

// FMP's profile carries the 52-week range as a "low-high" string. It's the real
// intraday range, so it beats deriving one from our daily closes — but it comes
// from a free-text field, so parse defensively and let dataStore fall back to
// the close-based range when this can't be trusted.
function parse52WeekRange(range) {
  if (typeof range !== 'string') return null;
  const [low, high] = range.split('-').map((part) => Number(part.trim()));
  if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high <= low) return null;
  return { low52: low, high52: high };
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
    // The logo and the 52-week range ride along on the profile call we already
    // make for ipoDate — both cost zero extra requests.
    const range = parse52WeekRange(profile ? profile.range : null);
    return {
      symbol: c.symbol,
      name: c.companyName,
      sector: c.sector,
      price: c.price,
      marketCap: c.marketCap,
      beta: typeof c.beta === 'number' ? c.beta : null,
      logo: profile && profile.image ? profile.image : null,
      low52: range ? range.low52 : null,
      high52: range ? range.high52 : null,
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
