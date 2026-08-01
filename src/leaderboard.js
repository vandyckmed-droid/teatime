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

// FMP's profile carries the 52-week range as a "low-high" string, parsed
// defensively because it's a free-text field. Nothing on screen reads these
// any more — the app's price-range card works its own high/low out of daily
// closes over whichever window is selected — but scripts/snapshot.js files
// them into the daily archive, which is the only reason they're still
// collected. A company whose profile omits the range simply records null;
// dataStore used to recompute it from the full history of every company on
// every refresh, which was a lot of work for a figure nothing displayed.
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

  const universe = dedupeByCompany(candidates.filter(isOperatingCompany))
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, config.universeSize);

  const companies = await mapWithConcurrency(universe, config.fmpConcurrency, async (c) => {
    const [priceChange, profile, grades] = await Promise.all([
      fmp.getPriceChange(c.symbol).catch(() => null),
      fmp.getProfile(c.symbol).catch(() => null),
      // Analyst consensus rides the same per-company fetch — a third call in
      // the same concurrency-capped pass, refreshed once daily with the rest.
      fmp.getGradesConsensus(c.symbol).catch(() => null),
    ]);
    const ipoDate = profile ? profile.ipoDate : null;
    // The logo and the 52-week range ride along on the profile call we already
    // make for ipoDate — both cost zero extra requests.
    const range = parse52WeekRange(profile ? profile.range : null);
    return {
      symbol: c.symbol,
      name: c.companyName,
      sector: c.sector,
      // FMP's finer classification under sector ("Biotechnology", "Drug
      // Manufacturers - General", ...). Already on the screener row, so it
      // costs nothing. A biotech dimmer consumed it briefly (built and rolled
      // back at the owner's request); it stays because the daily archive files
      // it, same footing as annVolPct.
      industry: c.industry || null,
      price: c.price,
      marketCap: c.marketCap,
      beta: typeof c.beta === 'number' ? c.beta : null,
      logo: profile && profile.image ? profile.image : null,
      low52: range ? range.low52 : null,
      high52: range ? range.high52 : null,
      ipoDate,
      // Analyst grade counts and FMP's consensus label. On the payload rather
      // than behind an endpoint of their own, so the static snapshot (which
      // embeds this response and can fetch nothing) shows them too, and the
      // daily archive files them — that filing is the time series.
      grades: grades ? {
        strongBuy: grades.strongBuy ?? 0,
        buy: grades.buy ?? 0,
        hold: grades.hold ?? 0,
        sell: grades.sell ?? 0,
        strongSell: grades.strongSell ?? 0,
        consensus: grades.consensus || null,
      } : null,
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
