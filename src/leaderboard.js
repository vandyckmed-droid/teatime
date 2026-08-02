const fmp = require('./fmpClient');
const config = require('./config');
const { mapWithConcurrency } = require('./concurrency');

// How much of a listing actually changes hands in a day, in dollars. Used
// both to spot listings that aren't really the company (below) and to pick
// which of a company's lines represents it.
function dollarVolume(row) {
  return (row.volume || 0) * (row.price || 0);
}

// The screener returns more than operating companies. Bond and preferred
// lines — AT&T's "5.35% GLB NTS 66", Prudential's junior subordinated notes,
// Fifth Third's preferred series — come back carrying their *parent's* market
// cap, so they sort straight into the top of the board as a second copy of a
// company already on it. Two signals catch them, both already on the screener
// row, so neither costs a request:
//
//  - What it trades. A real company of this size turns over millions of
//    dollars a day; these lines do far less. This floor DID need re-tuning
//    when the universe grew, despite what an earlier note here claimed — the
//    $15B cap floor set for universeSize: 400 surfaced note lines trading
//    $1-2.3M a day (PPL's and Southern's notes, Reinsurance Group's
//    debenture) that sailed over the old $1M floor with no name tell. Two
//    would have reached the board: dedupe can't catch Southern's "Series 2"
//    line (its name string differs from the parent's) or RGA's debenture
//    (the real RGA sits below the cap floor, so its junk line stood alone in
//    the pool). Measured 2026-08-01: junk tops out at $2.3M/day ($6.6M for
//    one line dedupe catches anyway), and the thinnest real company
//    (Cheniere Partners) trades $8.9M — so $4M sits in the gap with ~2x
//    margin each way. Re-measure whenever the cap floor moves; this is the
//    filter that drifts with it.
//  - What it's called. Some preferred lines do trade actively, so for those
//    the name is the only tell.
const MIN_DOLLAR_VOLUME = 4e6;
const NON_COMMON_NAME = /\b(notes?|debentures?|preferred|subordinated|depositary|perpetual|pfd|jrsub)\b|\d\s*%/i;

function isOperatingCompany(row) {
  if (NON_COMMON_NAME.test(row.companyName || '')) return false;
  return dollarVolume(row) >= MIN_DOLLAR_VOLUME;
}

// Multiple share classes (GOOGL/GOOG, BRK-A/BRK-B) and duplicate listings map
// to the same company; keep one line per name. Picked by what trades, not by
// market cap: the lines share a company's market cap (or the secondary one
// even reports slightly more of it), so market cap picked essentially at
// random — which is how a $10k-a-day listing ended up representing PPL and
// Fifth Third on the board.
function dedupeByCompany(rows) {
  const bestByName = new Map();
  for (const row of rows) {
    const existing = bestByName.get(row.companyName);
    if (!existing || dollarVolume(row) > dollarVolume(existing)) {
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

  const universe = dedupeByCompany(candidates.filter(isOperatingCompany))
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, config.universeSize);

  // Two calls per company (price change + profile). A third — analyst grade
  // counts — rode here for a couple of days in August 2026 and was cut with
  // the rating card in the big simplification pass; the daily archive that
  // filed those counts went with it, so re-adding the card means re-adding
  // the call, nothing more.
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
      // Rides along on the profile call we already make for ipoDate.
      logo: profile && profile.image ? profile.image : null,
      ipoDate,
      returns: extractReturns(priceChange),
      availability: metricAvailability(ipoDate, asOf),
    };
  });

  // universeSize and defaultMetric used to ride along here and were never
  // read by anything; scripts/snapshot.js takes universeSize from config
  // directly, which is the copy that means something.
  return {
    asOf: asOf.toISOString(),
    metrics: config.metrics,
    companies,
  };
}

module.exports = { getLeaderboard, metricAvailability };
