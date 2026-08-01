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

- `src/fmpClient.js` — thin wrapper around FMP's `stable` API (company
  screener, price-change, profile, historical daily prices). Retries 429/5xx
  with backoff and honours `Retry-After`; everything else fails fast.
- `src/leaderboard.js` — builds the universe: largest companies by market cap
  (NYSE/NASDAQ, ETFs/funds excluded), with trailing returns for every
  configured window. Two filters run before the top-N cut, because the
  screener also returns bond and preferred lines carrying their *parent's*
  market cap — AT&T's "5.35% GLB NTS 66" sorts in beside AT&T itself. Names
  that read as debt or preferred stock are dropped, as is anything trading
  under $4M a day (a real company this size trades $9M+ a day; these lines
  trade a fraction of that, and the floor gets re-measured whenever the
  market-cap floor moves — see the comment on it in `src/leaderboard.js`). Remaining duplicate lines of one company — share
  classes like GOOGL/GOOG, BRK-A/BRK-B — collapse to whichever line actually
  trades, not the higher market cap: the lines report near-identical caps,
  so that tiebreak decided nothing and let a $10k-a-day listing stand in for
  its company. A
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
- `src/portfolio.js` — the one part of this app that isn't about the market:
  it reads the owner's own account balances from `data/portfolio/balances.csv`
  (maintained by hand) and derives return, annualized volatility, and the
  exposure multiple that would have run at a 15% volatility target. Daily
  returns are only taken across genuinely consecutive trading sessions, so a
  missing day in the record can't masquerade as one very volatile day. Figures
  come from those dates and dollar amounts alone — deliberately not
  reconciled against the broker's own headline rate of return, which uses a
  baseline and a method the file doesn't contain. It also computes beta
  against SPY — cov(rp, rm) / var(rm) over a trailing 126 sessions where
  *both* a balance move and a market move exist. That join is an inner join
  and nothing is ever zero-filled or carried forward, because a fabricated
  "the account didn't move while the market did" day drags beta toward zero;
  gap-spanning steps already excluded from the volatility figure stay
  excluded here too, and below 60 paired sessions the figure is reported as
  null and the card simply omits the row.
- `src/market.js` — SPY's daily closes and dividends, kept in
  `data/market/spy.csv` and refreshed by the daily Actions run. It's a file
  rather than another `dataStore` field because the published snapshot has to
  be able to compute beta at build time: the static site has no backend and
  makes no network calls, so anything it shows must already be a number by
  the time the bundle is assembled. Daily returns are total returns — the
  dividend is added back on its ex-date, because FMP's "dividend-adjusted"
  price endpoint returns closes identical to the plain ones.
- `src/ratings.js` — published analyst sentiment per ticker, recorded by hand
  in `data/ratings/ratings.csv` and append-only by (date, symbol), so a
  company rated again later keeps every earlier reading. Nothing here feeds
  the ranking; the boards score price return and only that.
- `server.js` — serves the frontend plus `GET /api/leaderboard`,
  `GET /api/history?symbol=X`, `GET /api/history/batch?symbols=A,B,C`,
  `GET /api/rank?startDaysAgo=&endDaysAgo=&volAdjusted=`,
  `GET /api/correlations?symbols=&startDaysAgo=&endDaysAgo=`,
  `GET /api/portfolio` and `GET /api/ratings`. The first five read from
  `src/dataStore.js`'s scheduled-refresh store; the portfolio and ratings
  endpoints read their CSVs off disk on each call, since those change only
  when the files are edited. Every one of them is called by the frontend —
  an endpoint nothing consumes is dead weight, and one (`/api/meta`) was.
  History endpoints only serve symbols in the current leaderboard universe —
  this is a leaderboard companion, not an open proxy for arbitrary FMP
  queries.
- `src/correlation.js` — `correlationsAgainst`: every universe name against
  the held set, keeping only each name's strongest positive match, which is
  what fades a row on the board. Signed rather than absolute: a strongly
  negative correlation is a good diversifier, so taking `|r|` would flag
  exactly the names worth adding.
- `public/app.js`'s `drawLineChart` is the one line-chart renderer, shared by
  the per-ticker price chart and the portfolio balance chart: same geometry,
  same axis landmarks, same scrub crosshair, differing only in three
  callbacks for what the labels say.
- `public/` — static frontend, three tabs (Ranks, Investing, Settings) plus a
  bottom sheet that opens a price chart when you tap a company. Board rows
  carry rank, logo, name, sector and return only — the 52-week range bar that
  used to be an 88px column moved into the full-screen ticker view, where it
  has the width to be read. The Investing tab holds two views behind a
  segmented control — Portfolio, a card of the owner's own account (see
  `src/portfolio.js`) with a chart of the balance over All/6M/3M/1M and rows
  for return, volatility, beta vs SPY, the 15% vol-target multiple and the
  best/worst day, hidden entirely if no balances are recorded; and Watchlist,
  the saved names. They
  were one scroll until the portfolio card grew tall enough to push the names
  off the bottom of the screen. Which view you were last on is remembered, and
  a stored view that no longer exists falls back to the first one.
  The Watchlist view
  carries an "add next ranked" control — the plus in the empty state, a button
  beside Clear watchlist once there are names — that saves the highest-ranked
  company not already held and not blocked by the diversification filter. The
  watchlist itself is a plain stored set of symbols: the ranking window and
  the correlation threshold decide what a tap adds, but changing them
  afterwards never adds or removes anything. Ranks and
  Watchlist rank by a custom date range (set in Settings, adjustable via
  +/− steppers, or in one tap from the 12M/6M pills that sit with the Ranks
  board's sticky header — `RANK_WINDOW_PRESETS` in `public/app.js`); scoring
  is computed server-side via `/api/rank` and cached in `state.rankScores`.
  The frontend falls back to the old client-side
  computation (over batch-fetched history) if `/api/rank` isn't reachable —
  this is what makes the static-snapshot preview channels (which have no
  backend at all) still work unmodified. The sheet shows exactly one chart —
  the price line — over a window picked by its own range pills (1M-5Y, 1M-3Y
  in the snapshot bundle), unrelated to the ranking date range. The arrow in
  its top-left grows the same sheet to a full-screen scrolling page: same
  chart, same pills, same swipe, plus a stack of data cards built from
  `DETAIL_BLOCKS` — analyst rating, price range (with its own 12M/6M/3M/1M
  toggle), return by window, standing on the board, company facts.
  That list is deliberately a scratch space for
  per-company data and experiments: add an entry to try something, delete it
  to take it away, and a block with nothing to say for a given company drops
  its own card.

## The daily archive

`scripts/snapshot.js` writes one file per day to `data/snapshots/`, run by
`.github/workflows/daily-snapshot.yml` at 09:00 UTC. It's the only workflow in
the repo — publishing the Pages bundle is still a plain commit.

The same run also refreshes `data/market/spy.csv` (see `src/market.js`), and
does it first, so the benchmark keeps advancing even on a day whose board was
already filed. The two are committed together but fail apart: a missed archive
day is gone for good, whereas the SPY file is rewritten in full every run, so a
failed refresh just logs and the next run picks it up.

The app keeps no history of itself: `src/dataStore.js` holds the current day
in memory and each refresh overwrites it, so yesterday's board is otherwise
gone. Each file stores the day's ranked list plus the per-company facts and
full returns map behind it, so a later question can be answered without
assuming today what it will be. Schema and caveats:
`data/snapshots/README.md`.

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
- New row flag: add an entry to `ROW_FLAGS` in `public/app.js` — a `key`, a
  short `label`, a `title` and `description` for its Settings row, a
  `test(company)`, optionally a `note(count)` for the board callout, and an
  `effect` (only `'orb'` exists today). An orb flag draws a coloured bloom
  around the logo disc — one CSS rule setting `--flag-orb` on
  `.row[data-flags~="yourkey"]` plus a `.flag-sample-orb` rule for the
  Settings preview; a different kind of object from the saved-row ring on the
  card's edge, so a row that is both wears both. The one entry yields the
  board mark, the Settings switch, the live count and the callout line.
  Current entry: mega caps at $200B and up (amber orb). A high-volatility orb
  and a biotech dimmer were each built here and rolled back at the owner's
  request; their shapes are in the history.
- New per-company data panel: add an entry to `DETAIL_BLOCKS` in
  `public/app.js` — a title and a `render(company)` returning HTML (use
  `statRow()` for anything list-shaped). It appears as a card in the
  full-screen ticker view with no other wiring.
- New preset ranking window: add an entry to `RANK_WINDOW_PRESETS` in
  `public/app.js` (key, label, `startDaysAgo`, `endDaysAgo`) and it appears
  as a pill above the Ranks board.
- New setting: add an entry to `SETTINGS` in `public/app.js`. Flags are their
  own Settings section, rendered from `ROW_FLAGS` rather than `SETTINGS`,
  because a flag marks a company rather than changing how anything is ranked.
  `renderSettings()` dispatches on `type` (`'toggle'`, `'threshold'`,
  `'daterange'`); a new `type` needs one more branch there. `SETTINGS` is
  also what `loadSettings()` validates stored values against — a key that
  isn't listed there is dropped rather than kept around forever.
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
