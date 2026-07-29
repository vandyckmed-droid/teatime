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
  universeSize: 10,
  screenerCandidatePool: 40,
  screenerMinMarketCap: 50e9,
  country: 'US',
  exchanges: 'NYSE,NASDAQ',
  cacheTtlMs: 5 * 60 * 1000,
  metrics: METRICS,
  metricMinDays: METRIC_MIN_DAYS,
  defaultMetric: '1Y',
  // One fetch covers the longest chart range; the frontend slices it client-side
  // per range so switching windows never re-hits the API.
  historyLookbackDays: 1828,
};
