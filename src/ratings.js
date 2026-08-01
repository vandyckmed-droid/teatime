const fs = require('fs');
const path = require('path');

// ── analyst ratings, recorded over time ──────────────────────────────
// data/ratings/ratings.csv is append-only: one row per (date, symbol), so the
// same ticker rated on several dates keeps every reading rather than
// overwriting the last. Nothing here judges the ratings — this module parses,
// orders and summarizes what was recorded, nothing more.
const CSV_PATH = path.join(__dirname, '..', 'data', 'ratings', 'ratings.csv');

// The scale the source publishes on. Order matters: it's what turns a label
// into a direction for the UI, and it's the list to extend if a new label
// ever shows up rather than special-casing one inline.
const RATING_SCALE = [
  { label: 'Very Bearish', tone: 'loss' },
  { label: 'Bearish', tone: 'loss' },
  { label: 'Neutral', tone: 'neutral' },
  { label: 'Bullish', tone: 'gain' },
  { label: 'Very Bullish', tone: 'gain' },
];
const SCORE_MAX = 10;

function parseCsv(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i++) { // row 0 is the header
    const line = lines[i].trim();
    if (!line) continue;
    const [date, symbol, rating, score] = line.split(',');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !symbol) continue;
    const value = score === '' || score === undefined ? null : Number(score);
    out.push({
      date,
      symbol: symbol.trim().toUpperCase(),
      // A row with no rating is a real observation: the source had nothing to
      // say about that company on that date, which isn't the same as the
      // company never having been looked at.
      rating: (rating || '').trim() || null,
      score: Number.isFinite(value) ? value : null,
    });
  }
  // Oldest first per symbol, which is the order the UI walks.
  out.sort((a, b) => (a.date === b.date ? a.symbol.localeCompare(b.symbol) : (a.date < b.date ? -1 : 1)));
  return out;
}

function getRatings() {
  let text;
  try {
    text = fs.readFileSync(CSV_PATH, 'utf8');
  } catch {
    return null; // nothing recorded — callers hide the panel
  }
  const rows = parseCsv(text);
  if (rows.length === 0) return null;

  const bySymbol = {};
  const dates = new Set();
  for (const row of rows) {
    dates.add(row.date);
    if (!bySymbol[row.symbol]) bySymbol[row.symbol] = [];
    // Same symbol recorded twice on one date: the later line wins, so a
    // correction can be appended without editing history.
    const existing = bySymbol[row.symbol].findIndex((r) => r[0] === row.date);
    const packed = [row.date, row.rating, row.score];
    if (existing >= 0) bySymbol[row.symbol][existing] = packed;
    else bySymbol[row.symbol].push(packed);
  }

  const sortedDates = [...dates].sort();
  return {
    // [date, rating, score] per symbol, oldest first — the compact shape the
    // browser reads, and the same one the snapshot bundle embeds.
    bySymbol,
    dates: sortedDates,
    latestDate: sortedDates[sortedDates.length - 1],
    symbolCount: Object.keys(bySymbol).length,
    scale: RATING_SCALE,
    scoreMax: SCORE_MAX,
  };
}

module.exports = { getRatings };
