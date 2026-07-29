// Central knobs for the leaderboard. Add a ticker window here (and it
// automatically appears in the API response and the frontend toggle) or
// widen the universe by bumping universeSize / screenerCandidatePool.

const METRICS = [
  { key: '1D', label: '1D' },
  { key: '5D', label: '5D' },
  { key: '1M', label: '1M' },
  { key: '3M', label: '3M' },
  { key: '6M', label: '6M' },
  { key: 'ytd', label: 'YTD' },
  { key: '1Y', label: '1Y' },
  { key: '3Y', label: '3Y' },
  { key: '5Y', label: '5Y' },
];

// Minimum days of trading history required before a return over that
// window is considered meaningful (protects against recent IPOs whose
// "1Y return" is really just their since-IPO return). 'ytd' is handled
// separately against Jan 1 of the current year.
const METRIC_MIN_DAYS = {
  '1D': 1,
  '5D': 5,
  '1M': 31,
  '3M': 93,
  '6M': 186,
  '1Y': 366,
  '3Y': 1097,
  '5Y': 1828,
};

module.exports = {
  // ── The scaling dial ──────────────────────────────────────────────
  // universeSize is expected to keep changing — bigger, then smaller, back
  // and forth — as this app grows. Bump or cut it here; screenerCandidatePool
  // should stay comfortably above it (candidates get deduped and filtered
  // down, so ask the screener for more than you need). Both are one-line
  // changes with no other code to touch up to a few hundred companies; past
  // that, the fetch-everything-on-load architecture itself needs to change
  // (see CLAUDE.md's Extensibility patterns section).
  universeSize: 150,
  screenerCandidatePool: 450,
  // Caps how many FMP requests this server has in flight at once (leaderboard
  // per-company calls, and batch history fetches). Keeps growth in
  // universeSize from turning into a burst of N simultaneous outbound
  // requests — comfortably under any FMP plan's per-minute limit regardless
  // of how big the universe gets, at the cost of the fetch taking a bit
  // longer wall-clock. Raise it if refreshes feel slow and the FMP plan has
  // headroom; lower it if requests start getting rate-limited.
  fmpConcurrency: 10,

  screenerMinMarketCap: 50e9,
  country: 'US',
  exchanges: 'NYSE,NASDAQ',
  metrics: METRICS,
  metricMinDays: METRIC_MIN_DAYS,
  defaultMetric: '1Y',
  // One fetch covers the longest chart range; the frontend slices it client-side
  // per range so switching windows never re-hits the API.
  historyLookbackDays: 1828,

  // ── Scheduled refresh (see src/dataStore.js) ───────────────────────
  // Everything here is end-of-day data — prices, market caps, returns, and
  // the daily-close history all only change once per trading day, right
  // after close. There's nothing to gain from checking more often than
  // this, so the server refreshes on a timer instead of on each request:
  // cheaper (one fetch per day regardless of visitor count, not one per
  // 5-minute cache miss) and it's what lets the frontend stop downloading
  // full history for the whole universe just to compute rankings — see
  // the /api/rank endpoint and src/ranking.js.
  pricedRefreshMs: 24 * 60 * 60 * 1000,
  // Sector/beta/IPO-date arrive for free in the same fetch as price, but on
  // their own much slower cadence — they rarely change and don't need to
  // track price-refresh timing. This only controls how often fresh values
  // are actually COMMITTED; the fetch happens on the priced schedule above
  // regardless, so this costs zero extra API calls, it just decides
  // whether to use what came back or keep the last-known values.
  slowFactsRefreshMs: 90 * 24 * 60 * 60 * 1000,
};
