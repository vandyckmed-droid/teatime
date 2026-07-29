// ── Settings framework ──────────────────────────────────────────────
// Each entry renders one row on the Settings tab. Add a new entry here
// (with a matching default in loadSettings) to grow the settings page —
// the list renders generically from this array.
const SETTINGS = [
  {
    key: 'volAdjusted',
    type: 'toggle',
    label: 'Volatility-adjusted scores',
    description: 'Rank and score by annualized return ÷ annualized volatility (a Sharpe-like ratio) instead of raw price return, both computed from daily closes over the ranking date range.',
    default: false,
  },
  {
    key: 'rankDateRange',
    type: 'daterange',
    label: 'Ranking date range',
    description: 'Rank and score the board by price change between these two dates, instead of a fixed window.',
    default: { startDaysAgo: 250, endDaysAgo: 20 },
  },
];

// Stepper bounds for the ranking date range, in days. "Start" moves in
// coarser steps since it usually ranges over months; "end" moves in finer
// steps since it's typically being nudged near the present. The max keeps
// "start" within the 5-year history the backend fetches per symbol.
const DATE_RANGE_STEP_START = 10;
const DATE_RANGE_STEP_END = 2;
const DATE_RANGE_MAX_DAYS_AGO = 1800;
const DATE_RANGE_MIN_GAP = 10;

const TRADING_DAYS_PER_YEAR = 252;

// Sectors actually seen in the top 50 by market cap as of the scale-up to
// universeSize=50 (checked live against the screener). Add more here if a
// future resize surfaces a sector not covered — falls back to
// --sector-default rather than breaking.
const SECTOR_VAR = {
  Technology: '--sector-tech',
  'Communication Services': '--sector-comm',
  'Consumer Cyclical': '--sector-consumer',
  Healthcare: '--sector-health',
  'Financial Services': '--sector-financial',
  'Consumer Defensive': '--sector-consumer-defensive',
  Industrials: '--sector-industrials',
  Energy: '--sector-energy',
  Utilities: '--sector-utilities',
};

const STORAGE_KEYS = { watchlist: 'teatime.watchlist', settings: 'teatime.settings' };

// Chart ranges are a subset of METRICS — 1D/5D are dropped because a chart
// built from daily closes has nothing meaningful to show for them.
const CHART_RANGES = [
  { key: '1M', label: '1M', days: 31 },
  { key: '3M', label: '3M', days: 93 },
  { key: '6M', label: '6M', days: 186 },
  { key: 'ytd', label: 'YTD', days: null },
  { key: '1Y', label: '1Y', days: 366 },
  { key: '3Y', label: '3Y', days: 1097 },
  { key: '5Y', label: '5Y', days: 1828 },
];
const DEFAULT_CHART_RANGE = '1Y';

const state = {
  leaderboard: null,
  activeTab: 'ranks',
  watchlist: loadWatchlist(),
  settings: loadSettings(),
  historiesLoaded: false,
};

// symbol -> { symbol, asOf, series }, oldest first. Shared by the Ranks/Watchlist
// custom-date-range scoring and the per-ticker detail chart.
const historyCache = new Map();

const detail = {
  symbol: null,
  range: DEFAULT_CHART_RANGE,
  slice: null, // the currently-rendered range's [{date, close}], oldest first
};

// ── persistence ──────────────────────────────────────────────────────
function loadWatchlist() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.watchlist) || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}
function saveWatchlist() {
  localStorage.setItem(STORAGE_KEYS.watchlist, JSON.stringify([...state.watchlist]));
}
function loadSettings() {
  const defaults = Object.fromEntries(SETTINGS.map((s) => [s.key, s.default]));
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || '{}');
    return { ...defaults, ...stored };
  } catch {
    return defaults;
  }
}
function saveSettings() {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings));
}

// ── formatting ───────────────────────────────────────────────────────
function fmtPct(v) {
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}
function fmtScore(v) {
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}`;
}
function fmtPrice(v) {
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtCap(v) {
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
  return '$' + (v / 1e6).toFixed(0) + 'M';
}
function fmtDate(iso) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
function daysAgoToDate(daysAgo) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d;
}
function daysAgoToDateStr(daysAgo) {
  return daysAgoToDate(daysAgo).toISOString().slice(0, 10);
}
function fmtStepperDate(daysAgo) {
  return daysAgoToDate(daysAgo).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── scoring: point-to-point return over the custom date range, or an
// annualized-return ÷ annualized-volatility (Sharpe-like) score over the
// same range when volatility-adjusted ──
function closeOnOrBefore(series, dateStr) {
  let result = null;
  for (const p of series) {
    if (p.date <= dateStr) result = p.close;
    else break;
  }
  return result;
}

function customRangeReturn(company) {
  const cached = historyCache.get(company.symbol);
  if (!cached || !cached.series || cached.series.length === 0) return null;
  const { startDaysAgo, endDaysAgo } = state.settings.rankDateRange;
  const startClose = closeOnOrBefore(cached.series, daysAgoToDateStr(startDaysAgo));
  const endClose = closeOnOrBefore(cached.series, daysAgoToDateStr(endDaysAgo));
  if (startClose == null || endClose == null) return null;
  return ((endClose - startClose) / startClose) * 100;
}

// Day-over-day % changes for the trading days that fall within [startStr, endStr].
function dailyReturnsInRange(series, startStr, endStr) {
  const inRange = series.filter((p) => p.date >= startStr && p.date <= endStr);
  const returns = [];
  for (let i = 1; i < inRange.length; i++) {
    const prev = inRange[i - 1].close;
    const cur = inRange[i].close;
    if (prev > 0) returns.push((cur - prev) / prev);
  }
  return returns;
}

// Annualized return ÷ annualized volatility, both derived from the same daily
// returns: annualized mean is mean*252, annualized stdev is stdev*sqrt(252),
// so the ratio simplifies to (mean / stdev) * sqrt(252) — a Sharpe ratio
// without a risk-free-rate subtraction, over the selected date range.
function volAdjustedScore(company) {
  const cached = historyCache.get(company.symbol);
  if (!cached || !cached.series || cached.series.length === 0) return null;
  const { startDaysAgo, endDaysAgo } = state.settings.rankDateRange;
  const startStr = daysAgoToDateStr(startDaysAgo);
  const endStr = daysAgoToDateStr(endDaysAgo);
  if (cached.series[0].date > startStr) return null; // no coverage back to the start date

  const returns = dailyReturnsInRange(cached.series, startStr, endStr);
  if (returns.length < 2) return null;

  const n = returns.length;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const stdev = Math.sqrt(variance);
  if (!(stdev > 0)) return null;

  return (mean / stdev) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

function scoreFor(company) {
  return state.settings.volAdjusted ? volAdjustedScore(company) : customRangeReturn(company);
}

// ── tab routing ──────────────────────────────────────────────────────
function goToTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.panel').forEach((el) => {
    el.hidden = el.dataset.panel !== tab;
  });
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === tab));
  });
  if (location.hash.slice(1) !== tab) history.replaceState(null, '', `#${tab}`);
}

function initTabBar() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => goToTab(btn.dataset.tab));
  });
  window.addEventListener('hashchange', () => {
    const tab = location.hash.slice(1);
    if (['ranks', 'watchlist', 'settings'].includes(tab)) goToTab(tab);
  });
  const initial = location.hash.slice(1);
  goToTab(['ranks', 'watchlist', 'settings'].includes(initial) ? initial : 'ranks');
}

function rankDateRangeLabel() {
  const { startDaysAgo, endDaysAgo } = state.settings.rankDateRange;
  return `${fmtStepperDate(startDaysAgo)} → ${fmtStepperDate(endDaysAgo)}`;
}

function updateScoreLabels() {
  const text = state.settings.volAdjusted
    ? `Ranked by return, ${rankDateRangeLabel()} · vol-adjusted`
    : `Ranked by return, ${rankDateRangeLabel()}`;
  const ranksLabel = document.getElementById('ranks-score-label');
  if (ranksLabel) ranksLabel.textContent = text;
  const watchlistLabel = document.getElementById('watchlist-score-label');
  if (watchlistLabel) watchlistLabel.textContent = text;
}

// ── row rendering (shared by Ranks and Watchlist) ───────────────────
function sectorChip(c) {
  const sectorVar = SECTOR_VAR[c.sector] || '--sector-default';
  const secondary = [fmtCap(c.marketCap), c.sector || 'Uncategorized'].join(' · ');
  return `
    <span class="name-cell">
      <span class="ticker-chip" style="background: color-mix(in srgb, var(${sectorVar}) 16%, transparent); color: var(${sectorVar});">${c.symbol}</span>
      <span class="name-text">
        <div class="company-name">${c.name}</div>
        <div class="sector-line">${secondary}</div>
      </span>
    </span>`;
}

function selectCircle(c) {
  const checked = state.watchlist.has(c.symbol);
  return `
    <span class="select-cell">
      <button type="button" class="select-circle${checked ? ' checked' : ''}" data-symbol="${c.symbol}"
        aria-pressed="${checked}" aria-label="${checked ? 'Remove from' : 'Add to'} watchlist: ${c.name}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>
      </button>
    </span>`;
}

function buildRow(c, rank, value) {
  const isGain = value >= 0;
  return { el: rowEl(c, rank, value, isGain), value };
}

function rowEl(c, rank, value, isGain) {
  const row = document.createElement('div');
  row.className = `row${rank === 1 ? ' ranked-1' : ''}${state.watchlist.has(c.symbol) ? ' is-selected' : ''}`;
  row.dataset.symbol = c.symbol;
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.setAttribute('aria-label', `${c.name}: view chart`);
  row.innerHTML = `
    <span class="rank">${rank}</span>
    ${sectorChip(c)}
    <span class="trailing-cell">
      <span class="price-mini">${fmtPrice(c.price)}</span>
      <span class="return-val ${isGain ? 'gain' : 'loss'}"></span>
      <span class="mini-bar"><span class="mini-bar-mid"></span><span class="mini-bar-fill"></span></span>
    </span>
    ${selectCircle(c)}
  `;
  row.querySelector('.return-val').textContent = state.settings.volAdjusted ? fmtScore(value) : fmtPct(value);
  return row;
}

function buildUnavailableRow(c) {
  const row = document.createElement('div');
  row.className = `row unavailable${state.watchlist.has(c.symbol) ? ' is-selected' : ''}`;
  row.dataset.symbol = c.symbol;
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.setAttribute('aria-label', `${c.name}: view chart`);
  row.innerHTML = `
    <span class="rank">&mdash;</span>
    ${sectorChip(c)}
    <span class="trailing-cell">
      <span class="price-mini">${fmtPrice(c.price)}</span>
      <span class="return-val na">N/A</span>
      <span class="mini-bar"><span class="mini-bar-mid"></span></span>
    </span>
    ${selectCircle(c)}
  `;
  return row;
}

function attachSelectHandlers(container) {
  container.querySelectorAll('.select-circle').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const symbol = btn.dataset.symbol;
      if (state.watchlist.has(symbol)) state.watchlist.delete(symbol);
      else state.watchlist.add(symbol);
      saveWatchlist();
      updateWatchlistBadge(true);
      renderAll();
    });
  });
}

function attachRowHandlers(container) {
  container.querySelectorAll('.row[data-symbol]').forEach((row) => {
    row.addEventListener('click', () => openDetail(row.dataset.symbol));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDetail(row.dataset.symbol);
      }
    });
  });
}

function renderRanksBoard() {
  const companies = state.leaderboard.companies;

  const scored = companies.map((c) => ({ c, value: scoreFor(c) }));
  const available = scored.filter((x) => x.value !== null).sort((a, b) => b.value - a.value);
  const unavailable = scored.filter((x) => x.value === null).map((x) => x.c);
  const maxAbs = Math.max(...available.map((x) => Math.abs(x.value)), 1);

  const rowsEl = document.getElementById('ranks-rows');
  rowsEl.innerHTML = '';

  available.forEach(({ c, value }, i) => {
    const { el } = buildRow(c, i + 1, value);
    const pct = Math.min((Math.abs(value) / maxAbs) * 50, 50);
    const fill = el.querySelector('.mini-bar-fill');
    const isGain = value >= 0;
    fill.classList.add(isGain ? 'gain' : 'loss');
    fill.style.left = isGain ? '50%' : `${50 - pct}%`;
    fill.style.width = `${pct}%`;
    rowsEl.appendChild(el);
  });
  unavailable.forEach((c) => rowsEl.appendChild(buildUnavailableRow(c)));

  attachSelectHandlers(rowsEl);
  attachRowHandlers(rowsEl);
  renderRanksCallout(unavailable);
}

function renderRanksCallout(unavailable) {
  const box = document.getElementById('ranks-callout');
  const text = document.getElementById('ranks-callout-text');
  if (unavailable.length === 0) {
    box.hidden = true;
    return;
  }
  const names = unavailable
    .map((c) => `<b>${c.name} (${c.symbol})</b>${c.ipoDate ? `, IPO'd ${c.ipoDate}` : ''}`)
    .join('; ');
  text.innerHTML = `Not ranked over ${rankDateRangeLabel()}: ${names} &mdash; not enough trading history for a like-for-like score.`;
  box.hidden = false;
}

function renderWatchlistBoard() {
  const label = document.getElementById('watchlist-score-label');
  const rowsEl = document.getElementById('watchlist-rows');
  const companies = state.leaderboard.companies.filter((c) => state.watchlist.has(c.symbol));

  if (companies.length === 0) {
    label.hidden = true;
    rowsEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="30" height="30"><path fill="none" stroke="currentColor" stroke-width="1.6" d="M12 2.5l2.9 6.05 6.6.86-4.8 4.63 1.18 6.58L12 17.9l-5.88 3.72L7.3 15l-4.8-4.63 6.6-.86L12 2.5z"/></svg>
        </div>
        <p>Your watchlist is empty. Head to Ranks and tap the circle on any company to save it here.</p>
      </div>`;
    return;
  }

  label.hidden = false;
  const scored = companies.map((c) => ({ c, value: scoreFor(c) }));
  const available = scored.filter((x) => x.value !== null).sort((a, b) => b.value - a.value);
  const unavailable = scored.filter((x) => x.value === null).map((x) => x.c);
  const maxAbs = Math.max(...available.map((x) => Math.abs(x.value)), 1);

  rowsEl.innerHTML = '';
  available.forEach(({ c, value }, i) => {
    const { el } = buildRow(c, i + 1, value);
    const pct = Math.min((Math.abs(value) / maxAbs) * 50, 50);
    const fill = el.querySelector('.mini-bar-fill');
    const isGain = value >= 0;
    fill.classList.add(isGain ? 'gain' : 'loss');
    fill.style.left = isGain ? '50%' : `${50 - pct}%`;
    fill.style.width = `${pct}%`;
    rowsEl.appendChild(el);
  });
  unavailable.forEach((c) => rowsEl.appendChild(buildUnavailableRow(c)));

  attachSelectHandlers(rowsEl);
  attachRowHandlers(rowsEl);
}

function updateWatchlistBadge(animate = false) {
  const badge = document.getElementById('watchlist-badge');
  const count = state.watchlist.size;
  badge.textContent = String(count);
  badge.hidden = count === 0;
  if (animate && count > 0) {
    badge.classList.remove('pop');
    void badge.offsetWidth; // restart the animation if it's re-triggered mid-play
    badge.classList.add('pop');
  }
}

function renderAll() {
  updateScoreLabels();
  renderRanksBoard();
  renderWatchlistBoard();
}

// ── detail sheet (tap a row to see its chart) ────────────────────────
function findCompany(symbol) {
  return state.leaderboard.companies.find((c) => c.symbol === symbol) || null;
}

function openDetail(symbol) {
  const company = findCompany(symbol);
  if (!company) return;

  detail.symbol = symbol;
  detail.range = DEFAULT_CHART_RANGE;

  const sectorVar = SECTOR_VAR[company.sector] || '--sector-default';
  const chip = document.getElementById('detail-chip');
  chip.textContent = company.symbol;
  chip.style.background = `color-mix(in srgb, var(${sectorVar}) 16%, transparent)`;
  chip.style.color = `var(${sectorVar})`;
  document.getElementById('detail-name').textContent = company.name;
  document.getElementById('detail-sector').textContent = company.sector || 'Uncategorized';
  document.getElementById('detail-price').textContent = fmtPrice(company.price);
  renderDetailReturn(company);
  renderDetailFacts(company);
  renderDetailSegmented();

  document.getElementById('sheet-backdrop').hidden = false;
  document.getElementById('detail-sheet').hidden = false;
  requestAnimationFrame(() => {
    document.getElementById('sheet-backdrop').classList.add('open');
    document.getElementById('detail-sheet').classList.add('open');
  });

  // Usually replaced near-instantly (history is prefetched at boot), but shows
  // for real when a symbol missed the batch prefetch and needs its own fetch —
  // also clears out the previously-open company's chart immediately instead of
  // leaving it on screen for a frame.
  document.getElementById('chart-wrap').innerHTML = chartSkeletonHTML();

  loadHistoryFor(symbol).then(() => renderChart()).catch((err) => {
    const wrap = document.getElementById('chart-wrap');
    wrap.innerHTML = `<div class="chart-error">Couldn't load chart: ${err.message}</div>`;
  });
}

function closeDetail() {
  document.getElementById('sheet-backdrop').classList.remove('open');
  document.getElementById('detail-sheet').classList.remove('open');
  setTimeout(() => {
    document.getElementById('sheet-backdrop').hidden = true;
    document.getElementById('detail-sheet').hidden = true;
  }, 320);
}

function renderDetailReturn(company) {
  const el = document.getElementById('detail-return');
  const value = company.returns[detail.range];
  const available = company.availability[detail.range] && typeof value === 'number';
  const rangeLabel = CHART_RANGES.find((r) => r.key === detail.range)?.label || detail.range;
  if (!available) {
    el.className = 'detail-return na';
    el.textContent = `N/A over ${rangeLabel}`;
    return;
  }
  el.className = `detail-return ${value >= 0 ? 'gain' : 'loss'}`;
  el.textContent = `${fmtPct(value)} · ${rangeLabel}`;
}

function renderDetailFacts(company) {
  const sectorVar = SECTOR_VAR[company.sector] || '--sector-default';
  const facts = [
    ['Market cap', fmtCap(company.marketCap), null],
    ['Sector', company.sector || 'Uncategorized', sectorVar],
    ['Beta', typeof company.beta === 'number' ? company.beta.toFixed(2) : 'N/A', null],
  ];
  document.getElementById('detail-facts').innerHTML = facts
    .map(([label, value, colorVar]) => `
      <div class="detail-fact">
        <div class="detail-fact-label">${label}</div>
        <div class="detail-fact-value">${colorVar ? `<span class="fact-color-dot" style="background: var(${colorVar})"></span>` : ''}${value}</div>
      </div>`)
    .join('');
}

function renderDetailSegmented() {
  const el = document.querySelector('[data-segmented="detail"]');
  el.innerHTML = '';
  CHART_RANGES.forEach((r) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = r.label;
    btn.setAttribute('aria-pressed', String(r.key === detail.range));
    btn.addEventListener('click', () => {
      detail.range = r.key;
      renderDetailSegmented();
      const company = findCompany(detail.symbol);
      if (company) renderDetailReturn(company);
      renderChart();
    });
    el.appendChild(btn);
  });
}

async function loadHistoryFor(symbol) {
  if (historyCache.has(symbol)) return historyCache.get(symbol);
  const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  const data = await res.json();
  historyCache.set(symbol, data);
  return data;
}

async function loadAllHistories(symbols) {
  const uncached = symbols.filter((s) => !historyCache.has(s));
  if (uncached.length === 0) return;

  try {
    const res = await fetch(`/api/history/batch?symbols=${uncached.map(encodeURIComponent).join(',')}`);
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    const data = await res.json();
    for (const [symbol, history] of Object.entries(data)) {
      historyCache.set(symbol, history);
    }
  } catch {
    // Best-effort: if the batch call fails, per-ticker taps still work via
    // loadHistoryFor's own fetch — Ranks/Watchlist just show fewer scored rows.
  }
}

function sliceForRange(series, rangeKey) {
  const range = CHART_RANGES.find((r) => r.key === rangeKey);
  const now = new Date();
  let cutoff;
  if (rangeKey === 'ytd') {
    cutoff = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  } else {
    cutoff = new Date(now.getTime() - range.days * 86400000);
  }
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return series.filter((p) => p.date >= cutoffStr);
}

// ── chart: SVG line + area, colored by direction, with a touch-scrub crosshair
const CHART_W = 400;
const CHART_H = 160;
const CHART_PAD = 10;

// A decorative (non-data) wave shape shown in place of "Loading chart…" while
// a symbol's history is being fetched — same skeleton-pulse language as the
// Ranks loading rows, shaped like a chart instead of a generic block.
function chartSkeletonHTML() {
  return `
    <div class="chart-skeleton" aria-hidden="true">
      <svg viewBox="0 0 ${CHART_W} ${CHART_H}" preserveAspectRatio="none">
        <path class="chart-skeleton-area" d="M0,112 C40,96 60,124 100,104 C140,84 160,110 200,92 C240,74 260,100 300,86 C340,72 360,94 400,82 L400,160 L0,160 Z" />
        <path class="chart-skeleton-line" d="M0,112 C40,96 60,124 100,104 C140,84 160,110 200,92 C240,74 260,100 300,86 C340,72 360,94 400,82" />
      </svg>
    </div>`;
}

function renderChart() {
  const wrap = document.getElementById('chart-wrap');
  const cached = historyCache.get(detail.symbol);
  if (!cached || cached.series.length < 2) {
    wrap.innerHTML = `<div class="chart-error">No chart data available for ${detail.symbol}.</div>`;
    return;
  }

  const slice = sliceForRange(cached.series, detail.range);
  if (slice.length < 2) {
    wrap.innerHTML = `<div class="chart-error">Not enough trading history yet for this range.</div>`;
    return;
  }
  detail.slice = slice;

  const closes = slice.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const innerH = CHART_H - CHART_PAD * 2;

  const coords = slice.map((p, i) => ({
    x: slice.length === 1 ? CHART_PAD : CHART_PAD + (i / (slice.length - 1)) * (CHART_W - CHART_PAD * 2),
    y: CHART_PAD + innerH - ((p.close - min) / span) * innerH,
    date: p.date,
    close: p.close,
  }));

  const isGain = closes[closes.length - 1] >= closes[0];
  const dir = isGain ? 'gain' : 'loss';

  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' ');
  const areaPath = `${linePath} L${coords[coords.length - 1].x.toFixed(2)},${CHART_H} L0,${CHART_H} Z`;
  const baselineY = coords[0].y.toFixed(2);
  const first = coords[0];
  const last = coords[coords.length - 1];

  wrap.innerHTML = `
    <div class="chart-axis-y max" id="chart-axis-max">${fmtPrice(max)}</div>
    <div class="chart-axis-y min" id="chart-axis-min">${fmtPrice(min)}</div>
    <svg viewBox="0 0 ${CHART_W} ${CHART_H}" preserveAspectRatio="none" role="img" aria-label="${detail.symbol} price chart, ${detail.range}">
      <line class="chart-baseline" x1="0" y1="${baselineY}" x2="${CHART_W}" y2="${baselineY}" />
      <path class="chart-area ${dir}" id="chart-area-path" d="${areaPath}" />
      <path class="chart-line ${dir}" id="chart-line-path" d="${linePath}" />
      <circle class="chart-startpoint" id="chart-startpoint-dot" cx="${first.x.toFixed(2)}" cy="${first.y.toFixed(2)}" r="3.5" />
      <circle class="chart-endpoint ${dir}" id="chart-endpoint-dot" cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="4.5" />
      <line class="chart-crosshair-line" id="crosshair-line" x1="0" y1="0" x2="0" y2="${CHART_H}" />
      <circle class="chart-crosshair-dot" id="crosshair-dot" r="4.5" />
      <rect x="0" y="0" width="${CHART_W}" height="${CHART_H}" fill="transparent" id="chart-hit" />
    </svg>
    <div class="chart-tooltip" id="chart-tooltip"></div>
  `;

  const axisXEl = document.getElementById('chart-axis-x');
  if (axisXEl) {
    axisXEl.innerHTML = `<span>${fmtChartDate(slice[0].date)}</span><span>${fmtChartDate(slice[slice.length - 1].date)}</span>`;
  }

  animateChartIn(wrap);
  attachChartScrub(wrap, coords);
}

// Line "draws in" left-to-right via the classic stroke-dasharray/dashoffset
// technique (works regardless of point count, unlike morphing between ranges'
// differing numbers of trading days). The CSS keyframe animation (chart-line-in
// in styles.css) reads the --dash-length custom property set here for its
// `from` state — animations (unlike transitions) declare their own start
// state, so this plays correctly every time on a freshly-inserted element,
// same technique the app already uses for .panel. prefers-reduced-motion
// turns the animation off in CSS, so this just renders fully drawn instantly.
function animateChartIn(wrap) {
  const linePath = wrap.querySelector('#chart-line-path');
  if (!linePath) return;
  const length = linePath.getTotalLength();
  linePath.style.strokeDasharray = String(length);
  linePath.style.setProperty('--dash-length', String(length));
}

function attachChartScrub(wrap, coords) {
  const svg = wrap.querySelector('svg');
  const hit = wrap.querySelector('#chart-hit');
  const crosshairLine = wrap.querySelector('#crosshair-line');
  const crosshairDot = wrap.querySelector('#crosshair-dot');
  const tooltip = wrap.querySelector('#chart-tooltip');

  function nearestIndex(clientX) {
    const rect = svg.getBoundingClientRect();
    const relX = ((clientX - rect.left) / rect.width) * CHART_W;
    const idx = Math.round((relX / CHART_W) * (coords.length - 1));
    return Math.min(coords.length - 1, Math.max(0, idx));
  }

  function showAt(clientX) {
    const i = nearestIndex(clientX);
    const c = coords[i];
    crosshairLine.setAttribute('x1', c.x);
    crosshairLine.setAttribute('x2', c.x);
    crosshairLine.style.opacity = '1';
    crosshairDot.setAttribute('cx', c.x);
    crosshairDot.setAttribute('cy', c.y);
    crosshairDot.style.opacity = '1';

    const rect = svg.getBoundingClientRect();
    const pxRatio = rect.width / CHART_W;
    const leftPx = Math.min(Math.max(c.x * pxRatio, 28), rect.width - 28);
    tooltip.style.left = `${leftPx}px`;
    tooltip.style.opacity = '1';
    tooltip.innerHTML = '';
    const dateEl = document.createElement('span');
    dateEl.textContent = fmtChartDate(c.date) + ' — ';
    const priceEl = document.createElement('b');
    priceEl.textContent = fmtPrice(c.close);
    tooltip.appendChild(dateEl);
    tooltip.appendChild(priceEl);
  }

  function hide() {
    crosshairLine.style.opacity = '0';
    crosshairDot.style.opacity = '0';
    tooltip.style.opacity = '0';
  }

  hit.addEventListener('pointerdown', (e) => { showAt(e.clientX); hit.setPointerCapture(e.pointerId); });
  hit.addEventListener('pointermove', (e) => { if (e.pressure > 0 || e.pointerType === 'mouse') showAt(e.clientX); });
  hit.addEventListener('pointerup', hide);
  hit.addEventListener('pointercancel', hide);
  hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
}

function fmtChartDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function initDetailSheet() {
  document.getElementById('sheet-close').addEventListener('click', closeDetail);
  document.getElementById('sheet-backdrop').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('detail-sheet').hidden) closeDetail();
  });
}

// ── settings tab ─────────────────────────────────────────────────────
function renderSettings() {
  const list = document.getElementById('settings-list');
  list.innerHTML = '';
  SETTINGS.forEach((setting) => {
    const row = document.createElement('div');
    row.className = 'settings-row';
    if (setting.type === 'toggle') {
      const checked = !!state.settings[setting.key];
      row.innerHTML = `
        <div class="settings-row-text">
          <div class="settings-row-label">${setting.label}</div>
          <div class="settings-row-desc">${setting.description}</div>
        </div>
        <button type="button" class="ios-switch" role="switch" aria-checked="${checked}" data-key="${setting.key}">
          <span class="knob"></span>
        </button>`;
      list.appendChild(row);
      row.querySelector('.ios-switch').addEventListener('click', (e) => {
        const btn = e.currentTarget;
        const next = btn.getAttribute('aria-checked') !== 'true';
        btn.setAttribute('aria-checked', String(next));
        state.settings[setting.key] = next;
        saveSettings();
        if (state.leaderboard && state.historiesLoaded) renderAll();
      });
    }
  });

  if (!document.getElementById('settings-note')) {
    const note = document.createElement('p');
    note.id = 'settings-note';
    note.className = 'settings-note';
    note.innerHTML = 'More settings land here as the board grows — each one is a config entry in <code>public/app.js</code> (<code>SETTINGS</code>) with no other wiring required.';
    list.parentElement.appendChild(note);
  }

  renderDateRangeSetting();
}

function renderDateRangeSetting() {
  const setting = SETTINGS.find((s) => s.key === 'rankDateRange');
  const container = document.getElementById('daterange-settings');
  if (!setting || !container) return;
  const { startDaysAgo, endDaysAgo } = state.settings.rankDateRange;

  container.innerHTML = `
    <div class="settings-row">
      <div class="settings-row-text">
        <div class="settings-row-label">${setting.label}</div>
        <div class="settings-row-desc">${setting.description}</div>
      </div>
    </div>
    <div class="settings-row">
      <div class="settings-row-text">
        <div class="settings-row-label">Start</div>
        <div class="stepper-date">${fmtStepperDate(startDaysAgo)}</div>
        <div class="stepper-days">${startDaysAgo} days ago</div>
      </div>
      <div class="stepper" role="group" aria-label="Start date">
        <button type="button" class="stepper-btn" data-field="start" data-dir="-1" aria-label="Move start date later"${startDaysAgo - DATE_RANGE_STEP_START < endDaysAgo + DATE_RANGE_MIN_GAP ? ' disabled' : ''}>&minus;</button>
        <button type="button" class="stepper-btn" data-field="start" data-dir="1" aria-label="Move start date earlier"${startDaysAgo + DATE_RANGE_STEP_START > DATE_RANGE_MAX_DAYS_AGO ? ' disabled' : ''}>+</button>
      </div>
    </div>
    <div class="settings-row">
      <div class="settings-row-text">
        <div class="settings-row-label">End</div>
        <div class="stepper-date">${fmtStepperDate(endDaysAgo)}</div>
        <div class="stepper-days">${endDaysAgo} days ago</div>
      </div>
      <div class="stepper" role="group" aria-label="End date">
        <button type="button" class="stepper-btn" data-field="end" data-dir="-1" aria-label="Move end date later"${endDaysAgo - DATE_RANGE_STEP_END < 0 ? ' disabled' : ''}>&minus;</button>
        <button type="button" class="stepper-btn" data-field="end" data-dir="1" aria-label="Move end date earlier"${endDaysAgo + DATE_RANGE_STEP_END > startDaysAgo - DATE_RANGE_MIN_GAP ? ' disabled' : ''}>+</button>
      </div>
    </div>
  `;

  container.querySelectorAll('.stepper-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const field = btn.dataset.field;
      const dir = Number(btn.dataset.dir);
      const range = state.settings.rankDateRange;
      if (field === 'start') {
        const next = range.startDaysAgo + dir * DATE_RANGE_STEP_START;
        range.startDaysAgo = Math.max(range.endDaysAgo + DATE_RANGE_MIN_GAP, Math.min(next, DATE_RANGE_MAX_DAYS_AGO));
      } else {
        const next = range.endDaysAgo + dir * DATE_RANGE_STEP_END;
        range.endDaysAgo = Math.max(0, Math.min(next, range.startDaysAgo - DATE_RANGE_MIN_GAP));
      }
      saveSettings();
      renderDateRangeSetting();
      if (state.leaderboard && state.historiesLoaded) renderAll();
    });
  });
}

// ── boot ─────────────────────────────────────────────────────────────
// Skeleton placeholder rows shaped like a real row (rank/chip/name/sector/value),
// shown while the leaderboard and its price history are still loading — reads
// as "content is on its way" rather than a bare loading message.
function skeletonRowsHTML(count) {
  return Array.from({ length: count }, () => `
    <div class="skeleton-row">
      <span class="skeleton-block skeleton-chip"></span>
      <span class="skeleton-lines">
        <span class="skeleton-block skeleton-line long"></span>
        <span class="skeleton-block skeleton-line short"></span>
      </span>
      <span class="skeleton-block skeleton-trailing"></span>
    </div>`).join('');
}

async function loadLeaderboard() {
  const res = await fetch('/api/leaderboard');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

async function init() {
  initTabBar();
  initDetailSheet();
  renderSettings();
  updateWatchlistBadge();

  document.getElementById('ranks-rows').innerHTML = skeletonRowsHTML(8);

  try {
    const data = await loadLeaderboard();
    state.leaderboard = data;
    document.getElementById('as-of').innerHTML = `As of <b>${fmtDate(data.asOf)}</b> · Financial Modeling Prep`;

    document.getElementById('ranks-rows').innerHTML = skeletonRowsHTML(8);
    await loadAllHistories(data.companies.map((c) => c.symbol));
    state.historiesLoaded = true;

    renderAll();
  } catch (err) {
    document.getElementById('ranks-rows').innerHTML = `<div class="error-box">Couldn't load live data: ${err.message}</div>`;
    document.getElementById('as-of').textContent = 'Live data unavailable';
  }
}

init();
