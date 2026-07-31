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

87 rows, 2026-02-26 through 2026-07-08, transcribed by hand from ten
screenshots of the brokerage's "Table view" — five taken 2026-07-31 07:28
and five more at 08:24 that filled in the gaps between them. The balances
are read directly off those screenshots: no rounding, no interpolation.

The two batches overlap on 11 dates, which were transcribed twice
independently. **All 11 agree to the cent** — as good a check on the
transcription as this data allows.

## Coverage

Near-continuous. Of the 86 row-to-row steps, **82 are true single-session
moves**. Only four dates inside the span are missing:

| Missing | Why |
| --- | --- |
| 2026-03-24 | fell between two screenshot windows |
| 2026-04-22 | fell between two screenshot windows |
| 2026-05-07 | fell between two screenshot windows |
| 2026-06-26 | absent from the brokerage's own table — both captures of that stretch skip from 06/25 to 06/29 |

Nothing before 2026-02-26 has been captured, so this is not the full year to
date — it starts about two months into 2026.

Weekends and the 2026 market holidays inside the span (Apr 3 Good Friday,
May 25 Memorial Day, Jun 19 Juneteenth, Jul 3 for Independence Day) are
correctly absent, not missing.

## Two traps when this is finally used

1. **Four steps span two sessions, not one.** 2026-03-23→03-25,
   04-21→04-23, 05-06→05-08 and 06-25→06-29 each cover two days' movement.
   Including them as one-day returns overstates volatility slightly. With
   82 clean steps available, drop them rather than adjust them.
2. **Total return can't be read off the endpoints.** First to last is
   +5.13%, but that's late February onward — it is *not* year-to-date and
   says nothing about the path.

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
merge the new rows in `date,balance` form, keeping date order, and update
the coverage table above. Overlapping a few rows with what's already here is
worth doing deliberately — re-reading the same dates is the only way to
catch a transcription slip.

The series now runs forward from 2026-02-26; extending the end is the
routine update. The three screenshot-boundary dates above are worth grabbing
if the table is ever scrolled past them again, and the full year to date
would need the stretch before 2026-02-26.
