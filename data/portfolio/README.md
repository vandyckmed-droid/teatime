# Portfolio balance history

`balances.csv` — the owner's own account balance, one row per trading day,
kept for later work on realized return, volatility, and volatility targeting
(e.g. scaling exposure to a 15% annualized target). Nothing in the app reads
it yet; this is a store, not a feature.

## Format

Two columns, no others:

```csv
date,balance
2026-02-26,29285.18
```

- `date` — ISO `YYYY-MM-DD`. The source screenshots show `MM/DD/YYYY`;
  converted on entry so the file sorts correctly as text.
- `balance` — dollars, plain number. No `$`, no thousands separators, two
  decimals. Anything that reads this file can then treat the column as a
  number without stripping characters first.

Rows are in date order, one per date, no duplicates. Append new rows at the
bottom and keep it that way.

## What's in here now

50 rows, 2026-02-26 through 2026-07-08, transcribed by hand from five
screenshots of the brokerage's "Table view" taken 2026-07-31. The balances
are read directly off those screenshots — no rounding, no interpolation.

## The gaps matter

**This series is not contiguous.** The screenshots captured five windows of
about ten trading days each as the table was scrolled, so there are five
stretches with no data at all:

| Missing span | Trading days lost (approx) |
| --- | --- |
| 2026-03-12 → 2026-03-24 | 9 |
| 2026-04-09 → 2026-04-22 | 9 |
| 2026-05-07 → 2026-05-20 | 10 |
| 2026-06-05 → 2026-06-22 | 12 |
| after 2026-07-08 | to date |

Of the 49 row-to-row steps in the file, **45 are genuine one-trading-day
moves** and 4 span a gap. That's a usable base for a first volatility
estimate, but only if the four are excluded.

This is the one thing that can quietly produce wrong numbers later. Two
traps to avoid when this data is finally used:

1. **Daily returns must only be taken between consecutive rows that are
   actually consecutive trading days.** A naive `balance[i]/balance[i-1]`
   treats the 2026-03-11 → 2026-03-25 jump as a single day's move, which
   inflates measured volatility. Drop any pair more than ~4 calendar days
   apart (covering weekends and holidays) before computing anything.
2. **Total return can't be read off the endpoints.** Start-to-end across a
   gapped series is fine as a rough figure, but it isn't year-to-date, and
   it says nothing about the path.

The brokerage itself reported **+18.45% year-to-date** as of 2026-07-31 on
every one of those screenshots. Worth keeping as a check: whatever this file
produces for the same window should land near it, and a large disagreement
means the gap handling above is wrong rather than that the broker is.

Also unknown from this data alone: whether any **deposits or withdrawals**
happened in the period. A contribution looks exactly like a gain in a
balance series. If any of these moves were cash in or out rather than
performance, that has to be recorded before return figures mean anything.

## Keeping it up to date

The owner maintains this by hand from the same screen. To add a batch:
append the new rows in `date,balance` form, keeping date order, and update
the coverage note above if a new gap opens. Filling in the missing spans
above is more valuable than extending the end — a continuous run is what
volatility work needs.
