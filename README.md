# teatime

Largest U.S.-traded companies, ranked by trailing price return. Live data via
[Financial Modeling Prep](https://site.financialmodelingprep.com/). An
iPhone-only interface — see `CLAUDE.md` for the full design/workflow
conventions if you're working on this repo.

## Run it

```
export FMP_API_KEY=your_key_here   # or API_KEY
node server.js
```

Then open http://localhost:3000.

## How it works

- `src/fmpClient.js` — thin wrapper around FMP's `stable` API (company screener,
  price-change, profile, historical daily prices).
- `src/leaderboard.js` — builds the universe: largest companies by market cap
  (NYSE/NASDAQ, ETFs/funds excluded, duplicate share classes deduped to the
  larger-cap line), with trailing returns for every configured window. A
  company is marked unavailable for a given window if it hasn't been trading
  long enough for that return to be meaningful (e.g. a company that IPO'd two
  months ago has no real "1Y return") rather than silently showing a clamped,
  misleading number. Per-company FMP calls are concurrency-limited
  (`config.fmpConcurrency`) rather than fired all at once.
- `src/history.js` — daily closes per symbol (`getHistory`) and a
  concurrency-limited batch variant (`getHistoryBatch`) used to load the whole
  universe's history in one request instead of one per company.
- `server.js` — serves the frontend plus `GET /api/leaderboard`,
  `GET /api/history?symbol=X`, `GET /api/history/batch?symbols=A,B,C`, and
  `GET /api/meta`, each with a 5-minute in-memory cache. History endpoints
  only serve symbols in the current leaderboard universe — this is a
  leaderboard companion, not an open proxy for arbitrary FMP queries.
- `public/` — static frontend, three tabs (Ranks, Watchlist, Settings) plus a
  bottom sheet that opens a price chart when you tap a company. Ranks and
  Watchlist rank by a custom date range (set in Settings, adjustable via
  +/− steppers), computed client-side from the batch-fetched history; the
  per-company chart sheet has its own independent window toggle (1D-5Y).

## Extending it

- New return window (for the per-company chart sheet): add a key to
  `METRICS`/`CHART_RANGES` in `src/config.js` / `public/app.js` — it appears
  in the API response and the toggle automatically.
- Bigger or smaller board: `universeSize` in `src/config.js` is the whole
  change — bump it (and `screenerCandidatePool` a good margin above it, since
  candidates get deduped/filtered down) or cut it back down. This is expected
  to change often; see the comment above it in `src/config.js`. Works as-is
  up to a few hundred companies — past that, the fetch-everything-on-load
  architecture itself needs to change (server-side scheduled refresh instead
  of fetch-on-request, ranking computed server-side instead of shipped to the
  browser as raw history). Not built yet; flag it if you're actually headed
  there.
- New setting: add an entry to `SETTINGS` in `public/app.js` — `renderSettings()`
  dispatches on `type` (`'toggle'`, `'daterange'`, ...); a new `type` needs one
  more branch there.
- Different universe (e.g. a specific sector, or largest by revenue instead of
  market cap): adjust the screener call in `src/leaderboard.js`.

## Known limitation

The sector color-coding (`SECTOR_VAR` in `public/app.js`, `--sector-*` custom
properties in `public/styles.css`) doesn't cleanly pass the project's dataviz
colorblind/chroma validator as a 9-color categorical set — checked when adding
the last four sectors, documented in `CLAUDE.md`. Every sector chip always
shows the sector name as text too, so color is never the sole signal, but a
real fix needs a proper palette redesign, not just picking different hex
values by eye.
