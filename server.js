const http = require('http');
const fs = require('fs');
const path = require('path');

const config = require('./src/config');
const { getLeaderboard } = require('./src/leaderboard');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

let cache = { data: null, expiresAt: 0 };

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function handleLeaderboard(req, res) {
  try {
    if (cache.data && Date.now() < cache.expiresAt) {
      sendJSON(res, 200, cache.data);
      return;
    }
    const data = await getLeaderboard();
    cache = { data, expiresAt: Date.now() + config.cacheTtlMs };
    sendJSON(res, 200, data);
  } catch (err) {
    sendJSON(res, 502, { error: err.message });
  }
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
  if (req.url.startsWith('/api/meta')) {
    sendJSON(res, 200, {
      universeSize: config.universeSize,
      metrics: config.metrics,
      defaultMetric: config.defaultMetric,
    });
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Leaderboard running at http://localhost:${PORT}`);
});
