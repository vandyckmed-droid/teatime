#!/usr/bin/env node
// Writes one day's board to data/snapshots/YYYY-MM-DD.json.
//
// The app itself keeps nothing: `src/dataStore.js` holds the current day in
// memory and the next refresh overwrites it, so yesterday's board is simply
// gone. This is the archive — append-only, one file per trading day, so that
// later analysis has a history of what the board actually said at the time
// rather than a back-computed reconstruction.
//
// What's stored is deliberately the *inputs*, not one particular ranking: every
// company's facts and its full returns map, plus both metrics' scores and ranks
// over the app's default window. Anything else (a different window, a different
// metric, sector aggregates) can be recomputed from that later; nothing here
// bakes in an assumption about what the data will eventually be used for.
//
// Usage:  API_KEY=... node scripts/snapshot.js [--outDir path] [--force]
// Exits 0 and writes nothing if the day's file already exists, so re-running
// it (or a retried cron) is harmless.

const fs = require('fs');
const path = require('path');

const config = require('../src/config');
const dataStore = require('../src/dataStore');
const ranking = require('../src/ranking');
const market = require('../src/market');

// The window the boards default to (mirrors rankDateRange's default in
// public/app.js). Stored alongside the scores so a later reader knows exactly
// what "score" and "rank" meant, even if that default changes.
const DEFAULT_WINDOW = { startDaysAgo: 250, endDaysAgo: 20 };

const SCHEMA_VERSION = 1;

function parseArgs(argv) {
  const args = { outDir: path.join(__dirname, '..', 'data', 'snapshots'), force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--outDir') args.outDir = argv[++i];
    else if (argv[i] === '--force') args.force = true;
  }
  return args;
}

// Ranks by score descending, highest first, with nulls left unranked rather
// than sorted to the bottom — "no score" and "worst score" are different facts
// and collapsing them would be a lie in the archive.
function rankBy(scores) {
  const scored = Object.entries(scores)
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => b[1] - a[1]);
  const ranks = new Map();
  scored.forEach(([symbol], i) => ranks.set(symbol, i + 1));
  return { ranks, of: scored.length };
}

function buildSnapshot() {
  const leaderboard = dataStore.getLeaderboard();
  const historyBySymbol = dataStore.getHistoryBySymbol();
  if (!leaderboard || !historyBySymbol) throw new Error('data store is empty');

  const { startDaysAgo, endDaysAgo } = DEFAULT_WINDOW;
  const startStr = ranking.daysAgoToDateStr(startDaysAgo);
  const endStr = ranking.daysAgoToDateStr(endDaysAgo);

  const returnScores = {};
  const volScores = {};
  for (const [symbol, hist] of historyBySymbol.entries()) {
    const prepared = ranking.prepareSeries(hist && hist.series ? hist.series : []);
    returnScores[symbol] = ranking.returnBetween(prepared, startStr, endStr);
    volScores[symbol] = ranking.volAdjustedBetween(prepared, startStr, endStr);
  }
  const byReturn = rankBy(returnScores);
  const byVol = rankBy(volScores);

  const round = (v, dp) => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(dp)) : null);

  const companies = leaderboard.companies.map((c) => ({
    symbol: c.symbol,
    name: c.name,
    sector: c.sector || null,
    industry: c.industry || null, // FMP's finer classification — added 2026-08 with annVolPct
    price: round(c.price, 4),
    marketCap: c.marketCap ?? null,
    beta: round(c.beta, 4),
    // Trailing-1Y realized vol (see trailingAnnualizedVolPct in src/ranking.js),
    // filed so a later question about volatility regimes doesn't need the raw
    // history re-fetched. New field 2026-08; older files simply lack it.
    annVolPct: round(c.annVolPct, 2),
    // Analyst grade counts + FMP's consensus label, filed daily — this is
    // where the ratings time series accrues. Added 2026-08; older files and
    // uncovered companies simply carry null.
    grades: c.grades ?? null,
    ipoDate: c.ipoDate || null,
    low52: round(c.low52, 4),
    high52: round(c.high52, 4),
    // Every window the app knows about, so a later question about, say, 3M
    // momentum doesn't need the raw history re-fetched.
    returns: Object.fromEntries(config.metrics.map((m) => [m.key, round(c.returns?.[m.key], 4)])),
    availability: c.availability || null,
    score: round(returnScores[c.symbol], 6),
    rank: byReturn.ranks.get(c.symbol) ?? null,
    volScore: round(volScores[c.symbol], 6),
    volRank: byVol.ranks.get(c.symbol) ?? null,
    // The last close this company's history actually reached — the honest
    // "as of" for its numbers, which can lag the run date over a weekend.
    lastClose: (() => {
      const s = historyBySymbol.get(c.symbol)?.series;
      return s && s.length ? s[s.length - 1].date : null;
    })(),
  }));

  // Stored in rank order: the file *is* the day's board, top to bottom.
  companies.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));

  return {
    schemaVersion: SCHEMA_VERSION,
    date: new Date().toISOString().slice(0, 10),
    capturedAt: new Date().toISOString(),
    historyAsOf: dataStore.getHistoryAsOf(),
    // What was asked for vs. what the screener could actually supply. These
    // differ whenever screenerMinMarketCap runs out of qualifying names before
    // universeSize is filled, and a reader comparing files across a resize
    // needs to be able to tell that apart from companies dropping out.
    universeSize: config.universeSize,
    capturedCompanies: companies.length,
    rankWindow: { ...DEFAULT_WINDOW, startDate: startStr, endDate: endStr },
    rankedCount: { byReturn: byReturn.of, byVolAdjusted: byVol.of },
    companies,
  };
}

// The benchmark series behind the portfolio card's beta figure. Refreshed on
// the same schedule but on its own terms: it's rewritten in full every run, so
// a failure here is not the permanent loss that a missed archive day is — the
// next run refetches the whole window regardless. It runs before the
// already-captured check below so the benchmark keeps advancing even on a day
// whose board was already filed.
async function refreshBenchmark() {
  try {
    const result = await market.refreshSpyCsv();
    console.log(`Refreshed ${result.path} (${result.rows} rows, ${result.start} -> ${result.end})`);
  } catch (err) {
    console.error(`SPY refresh failed (last-known data kept, next run retries): ${err.message}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const date = new Date().toISOString().slice(0, 10);
  const outPath = path.join(args.outDir, `${date}.json`);

  await refreshBenchmark();

  if (fs.existsSync(outPath) && !args.force) {
    console.log(`${outPath} already exists — nothing to do (pass --force to overwrite).`);
    return;
  }

  // Same pipeline the server uses, so the archive can never drift from what the
  // app was serving: one all-or-nothing fetch, then read the committed store.
  await dataStore.init();
  const snapshot = buildSnapshot();

  fs.mkdirSync(args.outDir, { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(snapshot, null, 1)}\n`);

  const kb = Math.round(fs.statSync(outPath).size / 1024);
  console.log(`Wrote ${outPath} (${kb}KB)`);
  console.log(`  ${snapshot.companies.length} companies, ${snapshot.rankedCount.byReturn} ranked by return`);
  console.log(`  window ${snapshot.rankWindow.startDate} -> ${snapshot.rankWindow.endDate}`);
  console.log(`  top 5: ${snapshot.companies.slice(0, 5).map((c) => c.symbol).join(', ')}`);
  // dataStore.init() leaves its refresh interval armed; nothing else to do here.
  process.exit(0);
}

main().catch((err) => {
  console.error('Snapshot failed:', err.message);
  process.exit(1);
});
