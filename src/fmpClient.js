// Thin wrapper around the Financial Modeling Prep "stable" API.

const BASE_URL = 'https://financialmodelingprep.com/stable';

function getApiKey() {
  const key = process.env.FMP_API_KEY || process.env.API_KEY;
  if (!key) {
    throw new Error('Missing FMP API key: set FMP_API_KEY (or API_KEY) in the environment.');
  }
  return key;
}

async function fmpGet(endpoint, params = {}) {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  url.searchParams.set('apikey', getApiKey());

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`FMP ${endpoint} request failed: ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  if (body && !Array.isArray(body) && body['Error Message']) {
    throw new Error(`FMP ${endpoint} error: ${body['Error Message']}`);
  }
  return body;
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

module.exports = { screenLargestCompanies, getPriceChange, getProfile };
