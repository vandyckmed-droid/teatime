# Standardized Unexpected Earnings (SUE)

**Status:** Parked — not started
**Difficulty:** Medium
**Benefit:** Medium
**Filed:** 2026-07-29

## One-line summary

How surprising was this earnings beat/miss, relative to how surprising this
company's earnings normally are?

## The recipe

1. **Actual EPS** — what the company reported this quarter.
2. **Expected EPS** — consensus analyst estimate right before the release (or,
   simplest version: same quarter last year's EPS).
3. **Surprise** = Actual − Expected.
4. **Standardize** — divide the surprise by the stock's own trailing surprise
   volatility (e.g. std dev of surprises over the last 8 quarters).

   `SUE = (Actual − Expected) / std_dev(past surprises)`

5. **Result** — a z-score-like number, comparable across stocks regardless of
   how volatile their earnings normally are.

**Interpretation:** high positive SUE tends to drift the stock up for
weeks/months after; large negative SUE tends to drift it down. This is a
well-documented factor (post-earnings-announcement drift) distinct from the
price-return ranking the app already does — it's a fundamentals-based signal,
not a price-based one.

## Why it might be worth doing

- Genuinely different information from anything currently in the app —
  everything today (Ranks, Watchlist, per-ticker chart) is derived from price
  history. SUE is the first fundamentals-derived signal.
- The standardization step is exactly the kind of thing this app already does
  well (comparable, not-raw numbers) — same spirit as `metricAvailability`
  guarding against misleading small-sample returns.
- Could slot in as a new column/metric or a per-company "fact" without
  disturbing the existing return-ranking UI.

## Why it might not be

- Unclear how central a fundamentals factor is to an app whose whole framing
  is "largest companies ranked by return." Might read as scope creep rather
  than a natural extension.
- Depends entirely on data availability (see below) — if consensus estimates
  aren't available on the current FMP plan, the fallback (same-quarter-last-year
  EPS) is a much weaker signal and may not be worth shipping on its own.

## Implementation sketch

- **New data source**: needs an FMP endpoint that returns historical
  actual-vs-estimated EPS per quarter (something like an `earnings`/
  `earnings-surprises` endpoint in FMP's `stable` API — not yet confirmed
  against the plan this app's `FMP_API_KEY` is on; `src/fmpClient.js`
  currently only calls `company-screener`, `stock-price-change`, `profile`,
  and `historical-price-eod/full`). **First real step here is a spike: hit
  the candidate endpoint and confirm it returns consensus estimates, not
  just actuals, for this account's plan tier.**
- **New data shape**: unlike price (daily) or slow facts (sector/beta/IPO
  date, effectively static), earnings surprises are a short, irregular
  quarterly time series per company — a genuinely new shape for
  `src/dataStore.js` to hold, not a fit for the existing daily/quarterly
  binary cadence split. Each company reports on its own schedule, so this is
  closer to "refresh alongside the daily cycle, but the underlying data only
  actually changes ~4x/year per company" — same free-lunch idea as slow
  facts, just per-company-staggered instead of globally quarterly.
  - New store field: `symbol -> [{quarter, actualEps, estimatedEps}, ...]`
    (last 8+ quarters), plus the computed `sue` score.
  - Std dev computation is a few lines, same spirit as `src/ranking.js`.
- **Surfacing in the UI**: open question — a new sortable metric alongside
  return, a fact card in the detail sheet, or a badge/dot on the row. Each has
  different design cost; not scoped here.
- **Extensibility fit**: if it does get built, it should probably follow the
  `METRICS`/`SETTINGS` config-array pattern rather than a bespoke section —
  but the underlying data being quarterly-irregular per company (not a
  uniform lookback window like existing metrics) makes it a less clean fit
  than it first looks.

## Open questions

- Does the FMP plan this app uses actually expose consensus EPS estimates
  (not just actuals)? This is the single biggest unknown and should be
  spiked before any of the rest is scoped more precisely.
- Fallback-to-prior-year-EPS version: is a same-quarter-year-ago comparison
  a strong enough signal to be worth shipping if real consensus estimates
  aren't available?
- Where does this live in the UI — new metric, new fact, new sort? Not
  decided; needs a design pass like the chart work did (dataviz skill).
