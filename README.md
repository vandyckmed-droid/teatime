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
- `src/dataStore.js` — an in-memory store refreshed on a timer
  (`config.pricedRefreshMs`, once every 24h) instead of per-request: this data
  is end-of-day, so nothing is gained by checking more often. A refresh cycle
  is all-or-nothing — every fetch it depends on has to succeed before any of
  the store's fields are updated, so a failed cycle just logs and leaves the
  last-known-good data serving untouched. Sector/beta/IPO-date ("slow facts")
  arrive for free in the same fetch as price but are only committed on their
  own, much slower cadence (`config.slowFactsRefreshMs`, ~quarterly) — this
  costs zero extra API calls, it just decides whether to use what came back or
  keep the last-known values. `server.js` blocks startup on the first
  successful refresh before it starts listening.
- `src/ranking.js` — the custom-date-range return / volatility-adjusted score
  math, run server-side over the store's history so the browser only ever
  gets back a small `{symbol: score}` map, not raw daily-close arrays for the
  whole universe. The formulas live in `returnBetween`/`volAdjustedBetween`,
  which take explicit dates and a `prepareSeries`-flattened series so a window
  can be scored thousands of times without re-filtering an array per call.
- `server.js` — serves the frontend plus `GET /api/leaderboard`,
  `GET /api/history?symbol=X`, `GET /api/history/batch?symbols=A,B,C`,
  `GET /api/rank?startDaysAgo=&endDaysAgo=&volAdjusted=`,
  and `GET /api/meta`, all reading from `src/dataStore.js`'s scheduled-refresh
  store. History endpoints only serve symbols in the current leaderboard
  universe — this is a leaderboard companion, not an open proxy for arbitrary
  FMP queries.
- `public/` — static frontend, three tabs (Ranks, Watchlist, Settings) plus a
  bottom sheet that opens a price chart when you tap a company. Ranks and
  Watchlist rank by a custom date range (set in Settings, adjustable via
  +/− steppers); scoring is computed server-side via `/api/rank` and cached
  in `state.rankScores`. The frontend falls back to the old client-side
  computation (over batch-fetched history) if `/api/rank` isn't reachable —
  this is what makes the static-snapshot preview channels (which have no
  backend at all) still work unmodified. The per-company chart sheet has its
  own window toggle (1M-3Y), unrelated to the ranking date range. That sheet
  shows one chart — a price line, or the rolling volatility-adjusted score as
  bars — chosen in Settings, and the same choice can replace each board row's
  52-week range with a sparkline of it.

## The daily archive

`scripts/snapshot.js` writes one file per day to `data/snapshots/`, run by
`.github/workflows/daily-snapshot.yml` at 09:00 UTC. It's the only workflow in
the repo — publishing the Pages bundle is still a plain commit.

The app keeps no history of itself: `src/dataStore.js` holds the current day in
memory and each refresh overwrites it, so yesterday's board is otherwise gone.
Each file stores the day's ranked list plus the per-company facts and full
returns map behind it, so a later question can be answered without assuming
today what it will be. Schema and caveats: `data/snapshots/README.md`.

Needs an `FMP_API_KEY` repository secret to run in Actions. Locally:
`API_KEY=... node scripts/snapshot.js` (it no-ops if the day's file exists;
`--force` overwrites).

## Extending it

- New return window (for the per-company chart sheet): add a key to
  `METRICS`/`CHART_RANGES` in `src/config.js` / `public/app.js` — it appears
  in the API response and the toggle automatically.
- Bigger or smaller board: `universeSize` in `src/config.js` is the whole
  change — bump it (and `screenerCandidatePool` a good margin above it, since
  candidates get deduped/filtered down) or cut it back down. This is expected
  to change often; see the comment above it in `src/config.js`. Server-side
  scheduled refresh and server-side ranking (see `src/dataStore.js` /
  `src/ranking.js` above) already remove the two biggest costs of scaling
  further — repeated FMP fetches per visitor, and shipping the full universe's
  history JSON to the browser just to rank it.
- New setting: add an entry to `SETTINGS` in `public/app.js` — `renderSettings()`
  dispatches on `type` (`'toggle'`, `'daterange'`, ...); a new `type` needs one
  more branch there.
- Different universe (e.g. a specific sector, or largest by revenue instead of
  market cap): adjust the screener call in `src/leaderboard.js`.

## Design notes

- Dark is the only theme — there's no light-mode CSS or `prefers-color-scheme`
  branching to maintain (this is a single-user app; see `CLAUDE.md`).
- All design tokens (colors, type scale, spacing, radii, shadows, motion
  easings) live as CSS custom properties in one `:root` block at the top of
  `public/styles.css` — a true-black canvas with charcoal card surfaces, one
  green shared deliberately by gains and key actions (active tab, selected
  segment, rank 1, watchlist star — "green = good / yours / act here"), and
  red reserved for loss.
- Sector chip colors (`SECTOR_VAR` in `public/app.js`, `--sector-*` custom
  properties in `public/styles.css`, currently 11 sectors + a default) vary
  hue, lightness, *and* chroma deliberately — not a fixed saturation/lightness
  ring — so neighboring sectors differ in punch, not just hue. The two
  closest to a reserved gain/loss hue are deliberately de-chromatized so
  they can't be misread as a semantic color. Not validated against a
  colorblind-safety floor. Every chip still shows the sector name as text
  too, so color is never the sole signal. Add a new sector's color in the
  same style (see the comment block above the palette in `styles.css`) if
  `universeSize` surfaces one not yet covered.
