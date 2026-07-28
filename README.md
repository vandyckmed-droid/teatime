# teatime

Ten largest U.S.-traded companies, ranked by trailing price return. Live data via
[Financial Modeling Prep](https://site.financialmodelingprep.com/).

## Run it

```
export FMP_API_KEY=your_key_here   # or API_KEY
node server.js
```

Then open http://localhost:3000.

## How it works

- `src/fmpClient.js` — thin wrapper around FMP's `stable` API (company screener,
  price-change, profile).
- `src/leaderboard.js` — builds the universe: top 10 companies by market cap
  (NYSE/NASDAQ, ETFs/funds excluded, duplicate share classes deduped to the
  larger-cap line), with trailing returns for every configured window. A
  company is marked unavailable for a given window if it hasn't been trading
  long enough for that return to be meaningful (e.g. a company that IPO'd two
  months ago has no real "1Y return") rather than silently showing a clamped,
  misleading number.
- `server.js` — serves the frontend and a `GET /api/leaderboard` JSON endpoint
  (5-minute in-memory cache) plus `GET /api/meta`.
- `public/` — static frontend; a segmented control toggles the return window
  (1D through 5Y) and re-sorts client-side using data already fetched.

## Extending it

- New return window: add a key to `METRICS` and `METRIC_MIN_DAYS` in
  `src/config.js` — it appears in the API response and the frontend toggle
  automatically.
- Bigger board: bump `universeSize` (and `screenerCandidatePool` if needed) in
  `src/config.js`.
- Different universe (e.g. a specific sector, or largest by revenue instead of
  market cap): adjust the screener call in `src/leaderboard.js`.
