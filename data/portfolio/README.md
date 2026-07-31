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

124 rows, 2026-01-02 through 2026-07-08, transcribed by hand from fourteen
screenshots of the brokerage's "Table view" taken 2026-07-31. The balances
are read directly off those screenshots: no rounding, no interpolation.

Batches overlapped on 13 dates, transcribed twice independently. **All 13
agree to the cent** — as good a check on the transcription as this data
allows.

## Coverage

Effectively complete for 2026 so far. Of the 123 row-to-row steps, **119 are
true single-session moves**. Four dates inside the span are missing:

| Missing | Why |
| --- | --- |
| 2026-03-24 | fell between two screenshot windows |
| 2026-04-22 | fell between two screenshot windows |
| 2026-05-07 | fell between two screenshot windows |
| 2026-06-26 | absent from the brokerage's own table — both captures of that stretch skip from 06/25 to 06/29 |

2026-01-02 is the year's first trading session, so the series starts at the
beginning of the year. It does *not* include the 2025 year-end balance,
which is what a true year-to-date figure would be measured from — see the
note on the broker's number below.

Weekends and the 2026 market holidays inside the span (Jan 1, Jan 19 MLK,
Feb 16 Presidents' Day, Apr 3 Good Friday, May 25 Memorial Day, Jun 19
Juneteenth, Jul 3 for Independence Day) are correctly absent, not missing.

## Two traps when this is used

1. **Four steps span two sessions, not one.** 2026-03-23→03-25,
   04-21→04-23, 05-06→05-08 and 06-25→06-29 each cover two days' movement.
   Counting them as one-day returns overstates volatility. `src/portfolio.js`
   excludes them and reports how many it dropped; anything else reading this
   file should do the same.
2. **The first row is not the year-to-date baseline.** Return is measured
   from the 2026-01-02 close, so the first session of the year is already
   inside it.

## On the broker's own number

Every screenshot shows the brokerage reporting **+18.45% "this year"**. This
file's own figures say **+13.9%** from 2026-01-02 to 2026-07-08.

They are not meant to agree, and the difference is not evidence of an error
here. The broker measures from the 2025 year-end balance, which isn't in this
file, and may weight for cash flows. Working backwards, +18.45% to today's
$30,788.95 implies a starting point near $25,993 — about $1,000 below the
2026-01-02 balance recorded here.

Everything computed from this file is derived from these dates and dollar
figures alone. That's deliberate, and it's what the app shows.

Also unknown from this data alone: whether any **deposits or withdrawals**
happened in the period. A contribution looks exactly like a gain in a
balance series. If any of these moves were cash in or out rather than
performance, that has to be recorded before return figures mean anything.

## Keeping it up to date

The owner maintains this by hand from the same screen. To add a batch:
merge the new rows in `date,balance` form, keeping date order, and update
the coverage table above. Overlapping a few rows with what's already here is
worth doing deliberately — re-reading the same dates is the only way to
catch a transcription slip.

Extending the end is the routine update, and everything downstream picks it
up automatically: `src/portfolio.js` re-reads this file on every request, so
the app's portfolio card reflects new rows as soon as they're saved (the
published snapshot needs a rebuild, as always).

Two one-off gaps are still worth filling if the chance comes up: the three
screenshot-boundary dates above, and the 2025 year-end balance, which is
what would make a true year-to-date figure possible.
