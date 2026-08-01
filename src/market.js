const fs = require('fs');
const path = require('path');

const fmp = require('./fmpClient');
const config = require('./config');

// ── the market benchmark ─────────────────────────────────────────────
// SPY's daily closes and cash dividends, committed to the repo as
// data/market/spy.csv (see the README beside it) and refreshed by the daily
// GitHub Actions run alongside the board archive.
//
// It lives in a file rather than in dataStore because its one consumer is the
// portfolio card's beta figure, which the published snapshot has to be able to
// compute at build time: the static site has no backend and makes no network
// calls, so anything it shows must already be a number by the time the bundle
// is assembled.
const SYMBOL = 'SPY';
const CSV_PATH = path.join(__dirname, '..', 'data', 'market', 'spy.csv');

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

// Total return, not price return. FMP's "dividend-adjusted" price endpoint
// gives closes identical to the plain ones — it doesn't reinvest anything — so
// the dividend has to be added back on its ex-date by hand. SPY yields ~1% a
// year in four payments, which is invisible on 124 of 126 days and about a
// quarter of a percent on the other two: small, but exactly the kind of thing
// that shows up as a spurious wiggle in a covariance.
async function fetchSpy() {
  const to = new Date();
  const from = new Date(to.getTime() - config.historyLookbackDays * 86400000);

  const [rows, dividends] = await Promise.all([
    fmp.getHistoricalPrices(SYMBOL, isoDate(from), isoDate(to)),
    fmp.getDividends(SYMBOL),
  ]);

  const divByDate = new Map();
  for (const d of dividends || []) {
    const amount = Number(d.dividend);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '') || !Number.isFinite(amount) || amount <= 0) continue;
    divByDate.set(d.date, amount);
  }

  return (rows || [])
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') && Number.isFinite(r.close) && r.close > 0)
    .map((r) => ({ date: r.date, close: r.close, dividend: divByDate.get(r.date) || 0 }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Rewritten in full each run rather than appended to, unlike the hand-kept
// files under data/. Every row is a straight mirror of FMP's own record, so
// refetching the whole window is self-correcting if a close was ever revised,
// and costs nothing in the diff: the dates are stable, so only the tail
// actually changes from one day to the next.
async function refreshSpyCsv() {
  const series = await fetchSpy();
  if (series.length < 2) throw new Error(`SPY history came back with ${series.length} usable rows`);

  const lines = ['date,close,dividend'];
  for (const p of series) lines.push(`${p.date},${p.close},${p.dividend}`);

  fs.mkdirSync(path.dirname(CSV_PATH), { recursive: true });
  fs.writeFileSync(CSV_PATH, `${lines.join('\n')}\n`);

  return { path: CSV_PATH, rows: series.length, start: series[0].date, end: series[series.length - 1].date };
}

// Read fresh each call, like the other data files here — this one is rewritten
// by a scheduled job between requests rather than edited by hand, but the same
// reasoning applies: it's a few thousand short lines and nothing is gained by
// holding it in memory.
function getSpySeries() {
  let text;
  try {
    text = fs.readFileSync(CSV_PATH, 'utf8');
  } catch {
    return null; // never refreshed — callers fall back to showing nothing
  }
  const out = [];
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i++) { // row 0 is the header
    const line = lines[i].trim();
    if (!line) continue;
    const [date, close, dividend] = line.split(',');
    const price = Number(close);
    const div = Number(dividend);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(price) || price <= 0) continue;
    out.push({ date, close: price, dividend: Number.isFinite(div) && div > 0 ? div : 0 });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out.length ? out : null;
}

module.exports = { getSpySeries, refreshSpyCsv, SYMBOL };
