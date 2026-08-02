# Portfolio balance history

`balances.csv` — the owner's own account balance, one row per trading day,
kept for later work on realized return, volatility, and volatility targeting
(e.g. scaling exposure to a 15% annualized target). Summarized by
`src/portfolio.js` and shown as the portfolio card on the app's Watchlist
tab.

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

141 rows, 2026-01-02 through 2026-07-31, transcribed by hand from seventeen
screenshots of the brokerage's "Table view". The balances are read directly
off those screenshots: no rounding, no interpolation.

Batches overlapped on 17 dates, transcribed twice independently. **All 17
agree to the cent** — as good a check on the transcription as this data
allows.

## Coverage

Effectively complete for 2026 so far. Of the 140 row-to-row steps, **136 are
true single-session moves**. Four dates inside the span are missing:

| Missing | Why |
| --- | --- |
| 2026-03-24 | fell between two screenshot windows |
| 2026-04-22 | fell between two screenshot windows |
| 2026-05-07 | fell between two screenshot windows |
| 2026-06-26 | absent from the brokerage's own table — both captures of that stretch skip from 06/25 to 06/29 |

The series runs to the last completed session. 2026-07-31 was captured from a
"Total account value" summary card rather than the table view, which shows the
change since the previous close alongside the balance — a free check on the
transcription, and it agreed: $31,210.88 with a −$61.53 change is exactly the
recorded 07-30 balance of $31,272.41. Worth taking whenever that card is the
one to hand.

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
file's own figures say **+15.5%** from 2026-01-02 to 2026-07-31.

They are not meant to agree, and the difference is not evidence of an error
here. The broker measures from the 2025 year-end balance, which isn't in this
file, and may weight for cash flows. Working backwards from their figure puts
that starting point about $1,000 below the 2026-01-02 balance recorded here.

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

## What reads this now

- The portfolio card's balance, return, volatility and vol-target multiple.
- **Beta vs SPY** (`computeBeta` in `src/portfolio.js`), which pairs each of
  these daily moves with SPY's move on the same date. Only sessions present in
  both count, and the four gap-spanning steps above are excluded there too, so
  a filled-in gap doesn't just add a row — it adds a pair to the beta window.

## Holdings (`holdings.csv`)

Optional companion to the balances: what the account actually holds, in
dollars, so the app can compare real positions against its suggested plan.
Append-only by date, like the balances — each batch of rows shares a date,
and the latest date is treated as the current picture:

```csv
date,symbol,dollars
2026-08-02,NVDA,4200.00
2026-08-02,SNDK,3100.50
```

Maintained the same way as the balances: the owner sends the brokerage's
positions screen, rows get transcribed, nothing is ever rewritten.

### What's in here now

One batch dated 2026-07-31: 23 equity positions transcribed from four
screenshots taken Sunday 2026-08-02 (so values are Friday 07-31's close).
Two of the screenshots were sorted descending by value and two provided
checks: an alphabetical view re-showed ten of the tickers (all matched to
the cent, FTNT overlapped between the two list views as well), and a
"Balance Details" screen gave exact reconciliation targets.

The reconciliation: broker Long positions $27,668.40 + cash $3,568.51 =
account value $31,236.91, and SPAXX ($6,357.17, the money-market core —
deliberately *not* recorded here as a holding) + Long = the list's own
$34,025.57 total. Both identities check out. The 23 transcribed equities
sum to **$27,369.00, which is $299.40 short of Long** — the descending
list was cut off just below CSX ($301.64) and the alphabetical capture
started at MU, so at least one small position (ticker alphabetically
before MU, value ≤ ~$299) appears in no screenshot. Owner has been asked
for the bottom of the list; append it to the same 2026-07-31 batch when it
arrives (latest-date-wins means adding a row with the same date extends
the batch, it doesn't replace it).

Note the account value here ($31,236.91, captured Sunday) differs from
`balances.csv`'s 07-31 row ($31,210.88, captured Friday after close) by
+$26.03 — weekend interest/dividend accrual posting, not a transcription
conflict. The balances file keeps Friday's figure.
