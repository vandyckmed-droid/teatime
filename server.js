const http = require('http');
const fs = require('fs');
const path = require('path');

const config = require('./src/config');
const dataStore = require('./src/dataStore');
const ranking = require('./src/ranking');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// All handlers below read from dataStore, which is refreshed on a timer
// (config.pricedRefreshMs) rather than per-request — see src/dataStore.js.
// server startup blocks on the first successful refresh (see start() below),
// so in normal operation these are never hit before data exists.

function handleLeaderboard(req, res) {
  const data = dataStore.getLeaderboard();
  if (!data) {
    sendJSON(res, 503, { error: 'Data not ready yet, try again shortly.' });
    return;
  }
  sendJSON(res, 200, data);
}

// Only serves history for symbols already in the current leaderboard universe —
// this stays a leaderboard companion, not an open proxy for arbitrary FMP queries.
function handleHistory(req, res, symbol) {
  const leaderboard = dataStore.getLeaderboard();
  const historyBySymbol = dataStore.getHistoryBySymbol();
  if (!leaderboard || !historyBySymbol) {
    sendJSON(res, 503, { error: 'Data not ready yet, try again shortly.' });
    return;
  }
  const known = leaderboard.companies.some((c) => c.symbol === symbol);
  if (!known) {
    sendJSON(res, 404, { error: `${symbol} is not in the current leaderboard universe.` });
    return;
  }
  const data = historyBySymbol.get(symbol);
  if (!data) {
    sendJSON(res, 502, { error: `No history available for ${symbol}.` });
    return;
  }
  sendJSON(res, 200, data);
}

// Batch companion to handleHistory — returns history for every requested
// symbol in one response instead of one per symbol.
function handleHistoryBatch(req, res, symbols) {
  const leaderboard = dataStore.getLeaderboard();
  const historyBySymbol = dataStore.getHistoryBySymbol();
  if (!leaderboard || !historyBySymbol) {
    sendJSON(res, 503, { error: 'Data not ready yet, try again shortly.' });
    return;
  }
  const validSymbols = new Set(leaderboard.companies.map((c) => c.symbol));
  const requested = symbols.filter((s) => validSymbols.has(s));
  if (requested.length === 0) {
    sendJSON(res, 400, { error: 'No valid symbols requested.' });
    return;
  }
  const results = {};
  for (const symbol of requested) {
    const data = historyBySymbol.get(symbol);
    if (data) results[symbol] = data;
  }
  sendJSON(res, 200, results);
}

// Computes ranking scores server-side over the full history the store
// already holds, so the browser never has to download raw daily-close
// series just to rank the universe (see CLAUDE.md's Extensibility section
// on why that mattered past a few hundred companies).
function handleRank(req, res, { startDaysAgo, endDaysAgo, volAdjusted }) {
  const historyBySymbol = dataStore.getHistoryBySymbol();
  if (!historyBySymbol) {
    sendJSON(res, 503, { error: 'Data not ready yet, try again shortly.' });
    return;
  }
  if (!Number.isFinite(startDaysAgo) || !Number.isFinite(endDaysAgo)) {
    sendJSON(res, 400, { error: 'startDaysAgo and endDaysAgo must be numbers.' });
    return;
  }
  const scores = {};
  for (const [symbol, hist] of historyBySymbol.entries()) {
    scores[symbol] = volAdjusted
      ? ranking.volAdjustedScore(hist.series, startDaysAgo, endDaysAgo)
      : ranking.customRangeReturn(hist.series, startDaysAgo, endDaysAgo);
  }
  sendJSON(res, 200, {
    asOf: dataStore.getHistoryAsOf(),
    startDaysAgo,
    endDaysAgo,
    volAdjusted,
    scores,
  });
}

function serveStatic(req, res) {
  const reqPath = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.normalize(path.join(PUBLIC_DIR, reqPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/leaderboard')) {
    handleLeaderboard(req, res);
    return;
  }
  if (req.url.startsWith('/api/history/batch')) {
    const symbols = (new URL(req.url, 'http://localhost').searchParams.get('symbols') || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    handleHistoryBatch(req, res, symbols);
    return;
  }
  if (req.url.startsWith('/api/history')) {
    const symbol = new URL(req.url, 'http://localhost').searchParams.get('symbol') || '';
    handleHistory(req, res, symbol.toUpperCase());
    return;
  }
  if (req.url.startsWith('/api/rank')) {
    const params = new URL(req.url, 'http://localhost').searchParams;
    handleRank(req, res, {
      startDaysAgo: Number(params.get('startDaysAgo')),
      endDaysAgo: Number(params.get('endDaysAgo')),
      volAdjusted: params.get('volAdjusted') === 'true',
    });
    return;
  }
  if (req.url.startsWith('/api/meta')) {
    sendJSON(res, 200, {
      universeSize: config.universeSize,
      metrics: config.metrics,
      defaultMetric: config.defaultMetric,
      historyAsOf: dataStore.getHistoryAsOf(),
      slowFactsAsOf: dataStore.getSlowFactsAsOf(),
    });
    return;
  }
  serveStatic(req, res);
});

async function start() {
  await dataStore.init();
  server.listen(PORT, () => {
    console.log(`Leaderboard running at http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
