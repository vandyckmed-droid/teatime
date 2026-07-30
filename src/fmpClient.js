// Thin wrapper around the Financial Modeling Prep "stable" API.

const BASE_URL = 'https://financialmodelingprep.com/stable';

function getApiKey() {
  const key = process.env.FMP_API_KEY || process.env.API_KEY;
  if (!key) {
    throw new Error('Missing FMP API key: set FMP_API_KEY (or API_KEY) in the environment.');
  }
  return key;
}

// Transient on FMP's side: 429 is the per-minute rate ceiling, 5xx is a blip.
// Both are worth waiting out rather than failing the caller, because a refresh
// cycle is all-or-nothing (see src/dataStore.js) — one unlucky request out of
// the ~3 per company would otherwise discard the whole universe's fetch and
// leave the store serving yesterday's data for another day.
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 1500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fmpGet(endpoint, params = {}) {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  url.searchParams.set('apikey', getApiKey());

  let lastStatus = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      const body = await res.json();
      if (body && !Array.isArray(body) && body['Error Message']) {
        throw new Error(`FMP ${endpoint} error: ${body['Error Message']}`);
      }
      return body;
    }
    lastStatus = `${res.status} ${res.statusText}`;
    if (!RETRY_STATUSES.has(res.status) || attempt === MAX_ATTEMPTS) break;
    // Exponential, with jitter so a burst of concurrent callers that all got
    // rate-limited together don't march back in lockstep and trip it again.
    const wait = BASE_BACKOFF_MS * 2 ** (attempt - 1) * (1 + Math.random() * 0.4);
    await sleep(wait);
  }
  throw new Error(`FMP ${endpoint} request failed: ${lastStatus}`);
}

function screenLargestCompanies({ limit, minMarketCap, country, exchanges }) {
  return fmpGet('company-screener', {
    limit,
    marketCapMoreThan: minMarketCap,
    country,
    exchange: exchanges,
    isActivelyTrading: true,
    isEtf: false,
    isFund: false,
  });
}

async function getPriceChange(symbol) {
  const rows = await fmpGet('stock-price-change', { symbol });
  return rows[0];
}

async function getProfile(symbol) {
  const rows = await fmpGet('profile', { symbol });
  return rows[0];
}

function getHistoricalPrices(symbol, from, to) {
  return fmpGet('historical-price-eod/full', { symbol, from, to });
}

module.exports = { screenLargestCompanies, getPriceChange, getProfile, getHistoricalPrices };
