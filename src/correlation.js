// Pairwise return correlation, used to fade names that would add little
// diversification to what's already on the watchlist.
//
// Deliberately signed rather than absolute: a strongly *negative* correlation is
// a good diversifier, not a redundant holding, so only high positive correlation
// should disqualify a name. Taking |r| would block exactly the names worth
// adding.
//
// Kept as an independent copy of the browser-side math in public/app.js for the
// same reason src/ranking.js is — no build step, so no module shared between
// server and browser. If this changes, change both.

// A correlation over a handful of days is noise. Require a month of overlap.
const MIN_OBSERVATIONS = 20;

function daysAgoToDateStr(daysAgo) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

// Day-over-day returns for the dates the two series share. Aligning on a common
// calendar matters: a recent listing (or a halted day) leaves one series short,
// and zipping by index would silently compare different days to each other.
function alignedReturns(seriesA, seriesB, startStr, endStr) {
  const bByDate = new Map();
  for (const p of seriesB) bByDate.set(p.date, p.close);

  const pairs = [];
  for (const p of seriesA) {
    if (p.date < startStr || p.date > endStr) continue;
    const b = bByDate.get(p.date);
    if (b === undefined) continue;
    if (!(p.close > 0) || !(b > 0)) continue;
    pairs.push([p.close, b]);
  }

  const ra = [];
  const rb = [];
  for (let i = 1; i < pairs.length; i++) {
    ra.push((pairs[i][0] - pairs[i - 1][0]) / pairs[i - 1][0]);
    rb.push((pairs[i][1] - pairs[i - 1][1]) / pairs[i - 1][1]);
  }
  return [ra, rb];
}

function pearson(a, b) {
  const n = a.length;
  if (n < MIN_OBSERVATIONS) return null;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (!(varA > 0) || !(varB > 0)) return null;
  return cov / Math.sqrt(varA * varB);
}

function correlation(seriesA, seriesB, startDaysAgo, endDaysAgo) {
  if (!seriesA || !seriesB) return null;
  const [ra, rb] = alignedReturns(
    seriesA,
    seriesB,
    daysAgoToDateStr(startDaysAgo),
    daysAgoToDateStr(endDaysAgo),
  );
  return pearson(ra, rb);
}

// For every symbol in the store, its strongest positive correlation against the
// held set, and which holding produced it — the "against" is what lets the UI
// explain a faded row instead of just dimming it for no visible reason. Held
// symbols are skipped: they're already in, so there is nothing to block.
function correlationsAgainst(historyBySymbol, heldSymbols, startDaysAgo, endDaysAgo) {
  const held = heldSymbols.filter((s) => historyBySymbol.has(s));
  const out = {};
  if (held.length === 0) return out;

  for (const [symbol, hist] of historyBySymbol.entries()) {
    if (held.includes(symbol)) continue;
    let best = null;
    for (const other of held) {
      const r = correlation(hist.series, historyBySymbol.get(other).series, startDaysAgo, endDaysAgo);
      if (r === null) continue;
      if (best === null || r > best.value) best = { value: r, against: other };
    }
    if (best) out[symbol] = best;
  }
  return out;
}

// Every pair among one set of symbols, as a square symmetric matrix — the
// "how do my own saved names move against each other" view, as opposed to
// correlationsAgainst() above, which asks the one-directional question "would
// adding this name duplicate what I already hold".
//
// Each pair is computed once and mirrored: correlation is symmetric, and for
// 20 names that halves 400 calculations to 190. Symbols with no history in the
// store are dropped rather than filling a row with nulls, so `symbols` in the
// response is what the matrix is actually indexed by and can be shorter than
// what was asked for. A pair with too little overlapping history comes back
// null — the same "not enough to say" the rest of this file uses, not a zero.
function correlationMatrix(historyBySymbol, symbols, startDaysAgo, endDaysAgo) {
  const present = symbols.filter((s) => historyBySymbol.has(s));
  const matrix = present.map(() => new Array(present.length).fill(null));

  for (let i = 0; i < present.length; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < present.length; j++) {
      const r = correlation(
        historyBySymbol.get(present[i]).series,
        historyBySymbol.get(present[j]).series,
        startDaysAgo,
        endDaysAgo,
      );
      matrix[i][j] = r;
      matrix[j][i] = r;
    }
  }
  return { symbols: present, matrix };
}

module.exports = { correlationsAgainst, correlationMatrix };
