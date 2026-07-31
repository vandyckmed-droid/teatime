# Daily board snapshots

One file per day, `YYYY-MM-DD.json`, written by `scripts/snapshot.js` (run
daily by `.github/workflows/daily-snapshot.yml`). Append-only: nothing here is
ever edited after the fact.

The app keeps no history of itself — `src/dataStore.js` holds the current
day in memory and each refresh overwrites it. This directory is the record of
what the board actually said on a given day, which is not the same thing as
what you'd get by re-computing that day later: the universe's membership
changes as market caps move, companies list and delist, and FMP restates
figures.

## What's in a file

Deliberately the *inputs*, not one particular ranking, so a later question
isn't limited by what seemed interesting on the day it was captured.

```jsonc
{
  "schemaVersion": 1,
  "date": "2026-07-30",            // the day the capture ran (UTC)
  "capturedAt": "2026-07-30T…Z",
  "historyAsOf": "2026-07-30T…Z",  // when the underlying fetch completed
  "universeSize": 250,             // config.universeSize — what was asked for
  "capturedCompanies": 234,        // what the screener could actually supply
  "rankWindow": {                  // the window `score`/`rank` below were computed over
    "startDaysAgo": 250, "endDaysAgo": 20,
    "startDate": "2025-11-22", "endDate": "2026-07-10"
  },
  "rankedCount": { "byReturn": 248, "byVolAdjusted": 248 },
  "companies": [                   // in rank order — the file *is* the day's board
    {
      "symbol": "SNDK", "name": "…", "sector": "Technology",
      "price": 1016.0, "marketCap": 1.4e11, "beta": 2.17,
      "ipoDate": "…", "low52": 40.1, "high52": 2354.0,
      "returns": { "1D": …, "5D": …, "1M": …, "3M": …, "6M": …,
                   "ytd": …, "1Y": …, "3Y": …, "5Y": … },
      "availability": { "1Y": true, … },   // false where history is too short to mean anything
      "score": 857.3, "rank": 1,           // point-to-point return over rankWindow
      "volScore": 4.61, "volRank": 3,      // return ÷ volatility over the same window
      "lastClose": "2026-07-29"            // last trading day this company's series reached
    }
  ]
}
```

Notes for whoever reads these later:

- `rank` is among companies that *had* a score that day (`rankedCount`), not
  among `universeSize`. A company with too little history is `null`, not
  last — "no score" and "worst score" are different facts.
- `score` is a percentage (`+857.3` = +857.3%); `volScore` is a ratio.
- Weekend and holiday runs still produce a file. It repeats the previous
  trading day's closes, which `historyAsOf` and `lastClose` let you detect
  and drop.
- `universeSize` is a moving dial (see `src/config.js`), so the universe is
  not a fixed set across files. Compare by symbol, not by position.
- `capturedCompanies` below `universeSize` means the screener ran out of
  qualifying names before the target was filled (`screenerMinMarketCap`), not
  that companies dropped out. The 2026-07-30 file is the first such case: 250
  asked for, 234 supplied under a $50B floor since lowered to $30B.
- Anything not stored here — a different ranking window, sector aggregates,
  correlations — is recomputable from `returns` and the per-company facts. Raw
  daily-close series are *not* stored: they're ~10MB/day, and FMP still serves
  five years of them on demand.
