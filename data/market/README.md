# Market benchmark

`spy.csv` — SPY's daily closes and cash dividends, the market side of the
portfolio card's **Beta vs SPY** figure. Read by `src/market.js`, used by
`src/portfolio.js`, refreshed by the daily GitHub Actions run
(`.github/workflows/daily-snapshot.yml`, via `scripts/snapshot.js`).

## Format

```csv
date,close,dividend
2026-07-31,747.03,0
2026-06-18,690.11,1.90352
```

- `date` — ISO `YYYY-MM-DD`, one row per trading session, oldest first.
- `close` — the session's closing price, plain number.
- `dividend` — the cash dividend whose **ex-date** is that session, or `0`.
  SPY pays quarterly, so this is non-zero about four rows a year.

## Why the dividend column exists

The row's daily return is a **total** return:

```
r = (close_t + dividend_t) / close_{t-1} - 1
```

FMP's `historical-price-eod/dividend-adjusted` endpoint sounds like it would
save the trouble, but it returns closes identical to the plain ones — it does
not reinvest anything — so the dividend has to be added back on its ex-date by
hand. SPY yields around 1% a year in four payments: invisible on most days,
about a quarter of a percent on four of them. Small, but it is exactly the
kind of thing that shows up as a spurious spike in a covariance, and the
portfolio side it's compared against is a brokerage balance that collects its
dividends whether or not we model them.

## Rewritten, not appended

Unlike `data/portfolio/balances.csv` and `data/ratings/ratings.csv` — which
are hand-kept observations and strictly append-only — this file is a straight
mirror of FMP's own record and is rewritten in full on every refresh. That is
deliberate:

- It is self-correcting. A revised close, or a split, propagates on the next
  run instead of leaving a stale row nobody would think to look at.
- It costs nothing in the diff. The dates are stable, so only the tail
  actually changes from one day to the next.

Nothing here is an observation that would be lost by refetching, which is the
property that makes the other two files append-only.

## Span

Currently about five years back (`config.historyLookbackDays`, the same window
the company histories use). The beta window needs only the trailing 126
sessions that pair with a recorded balance, so this is a wide margin.

## Regenerating it by hand

```
API_KEY=... node -e "require('./src/market').refreshSpyCsv().then(console.log)"
```

Or just run `API_KEY=... node scripts/snapshot.js`, which refreshes this file
before it does anything else.
