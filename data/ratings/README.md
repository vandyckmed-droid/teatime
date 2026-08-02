> **Retired twice, and now fully inert.** First (2026-08-01) as the app's
> live source, replaced by analyst grade counts fetched daily from FMP;
> then (2026-08-02) the FMP feed and the rating card were themselves cut in
> the owner's simplification pass, along with the daily archive that filed
> the counts. No ratings of any kind are fetched or displayed any more.
> This file stays as the hand-kept record it always was — append-only,
> never overwritten — but nothing reads it at runtime.

# Analyst ratings

`ratings.csv` — published analyst sentiment per ticker, recorded by hand on
the date it was seen. Append-only: one row per (date, symbol), so a company
rated again later gains a row rather than overwriting the old one. That's the
whole point — the file is a record *through time*, not a current snapshot.

While live, this was surfaced by `src/ratings.js` behind `GET /api/ratings`
and shown as the "Analyst rating" card in the per-ticker view; both were
removed at retirement (the card now renders FMP's grade counts instead).
Nothing here ever fed the board's ranking; the boards score price return and
only that.

## Format

```csv
date,symbol,rating,score
2026-08-01,HWM,Very Bullish,9.8
2026-08-01,TIGO,,
```

- `date` — ISO `YYYY-MM-DD`, the day the rating was *observed*, which is what
  can be reconstructed from a screenshot. It isn't a claim about when the
  analysts published.
- `symbol` — ticker as the source shows it. It doesn't have to be a company on
  the board; unmatched symbols simply never surface in the app.
- `rating` — the label, spelled out: `Very Bullish`, `Bullish`, `Neutral`,
  `Bearish`, `Very Bearish`.
- `score` — 0–10, one decimal. **Empty when the source showed `--`.** An empty
  pair is a real observation: it says the source had nothing to publish that
  day, which is different from the company never having been looked at.

Rows may be appended in any order; `src/ratings.js` sorts them. If the same
(date, symbol) appears twice the later line wins, so a correction can be
appended rather than edited into history.

## What's in here now

24 symbols, all observed 2026-08-01, transcribed from three screenshots of a
brokerage's analyst-sentiment list. 22 carry a score; TIGO and RVMD showed
`--`.

Overlaps between those screenshots covered 5 symbols (FDX, PANW, DDOG, RPRX,
AMD), transcribed twice and agreeing exactly.

Two of the 24 (TD, TIGO) aren't on the board — the universe is US-listed
companies by market cap and these are Canadian/international lines. They're
kept anyway: the record is of what was published, not of what this app ranks.

## Adding a batch

Still possible — append rows with a new `date`, keeping the format above —
but nothing will display them; this is an archive now, and since the
2026-08-02 pass there is no live ratings series anywhere in the app.
