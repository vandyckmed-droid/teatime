// ── Settings framework ──────────────────────────────────────────────
// Each entry renders one row on the Settings tab. Add a new entry here
// (with a matching default in loadSettings) to grow the settings page —
// the list renders generically from this array.
const SETTINGS = [
  {
    key: 'volAdjusted',
    type: 'toggle',
    label: 'Volatility-adjusted scores',
    description: 'Rank and score by return ÷ beta instead of raw price return, so high-beta movers are discounted for the extra risk taken to get there.',
    default: false,
  },
];

const SECTOR_VAR = {
  Technology: '--sector-tech',
  'Communication Services': '--sector-comm',
  'Consumer Cyclical': '--sector-consumer',
  Healthcare: '--sector-health',
  'Financial Services': '--sector-financial',
};

const STORAGE_KEYS = { watchlist: 'teatime.watchlist', settings: 'teatime.settings' };

const state = {
  leaderboard: null,
  activeMetric: null,
  activeTab: 'ranks',
  watchlist: loadWatchlist(),
  settings: loadSettings(),
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
  return `${sign}${v.toFixed(1)}`;
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

// ── scoring: raw return, or return ÷ beta when volatility-adjusted ──
function scoreFor(company, metric) {
  const raw = company.returns[metric];
  const historyOk = company.availability[metric] && typeof raw === 'number';
  if (!historyOk) return null;
  if (!state.settings.volAdjusted) return raw;
  const beta = company.beta;
  if (typeof beta !== 'number' || beta <= 0.05) return null;
  return raw / beta;
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

// ── segmented (return window) control, mirrored across both boards ──
function renderAllSegmented() {
  document.querySelectorAll('[data-segmented]').forEach((el) => {
    el.innerHTML = '';
    state.leaderboard.metrics.forEach((m) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = m.label;
      btn.setAttribute('aria-pressed', String(m.key === state.activeMetric));
      btn.addEventListener('click', () => {
        state.activeMetric = m.key;
        renderAllSegmented();
        renderAll();
      });
      el.appendChild(btn);
    });
  });
}

function updateScoreLabels() {
  const metricLabel = state.leaderboard.metrics.find((m) => m.key === state.activeMetric)?.label || state.activeMetric;
  const text = state.settings.volAdjusted
    ? `Ranked by ${metricLabel} · vol-adjusted score`
    : `Ranked by ${metricLabel} return`;
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
    btn.addEventListener('click', () => {
      const symbol = btn.dataset.symbol;
      if (state.watchlist.has(symbol)) state.watchlist.delete(symbol);
      else state.watchlist.add(symbol);
      saveWatchlist();
      updateWatchlistBadge();
      renderAll();
    });
  });
}

function renderRanksBoard() {
  const metric = state.activeMetric;
  const companies = state.leaderboard.companies;

  const scored = companies.map((c) => ({ c, value: scoreFor(c, metric) }));
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
  renderRanksCallout(unavailable, metric);
}

function renderRanksCallout(unavailable, metric) {
  const box = document.getElementById('ranks-callout');
  const text = document.getElementById('ranks-callout-text');
  if (unavailable.length === 0) {
    box.hidden = true;
    return;
  }
  const metricLabel = state.leaderboard.metrics.find((m) => m.key === metric)?.label || metric;
  const reasonSuffix = state.settings.volAdjusted ? ' or a beta isn’t available' : '';
  const names = unavailable
    .map((c) => `<b>${c.name} (${c.symbol})</b>${c.ipoDate ? `, IPO'd ${c.ipoDate}` : ''}`)
    .join('; ');
  text.innerHTML = `Not ranked on the ${metricLabel} window: ${names} &mdash; not enough trading history yet for a like-for-like score${reasonSuffix}.`;
  box.hidden = false;
}

function renderWatchlistBoard() {
  const metric = state.activeMetric;
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
  const scored = companies.map((c) => ({ c, value: scoreFor(c, metric) }));
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
}

function updateWatchlistBadge() {
  const badge = document.getElementById('watchlist-badge');
  const count = state.watchlist.size;
  badge.textContent = String(count);
  badge.hidden = count === 0;
}

function renderAll() {
  updateScoreLabels();
  renderRanksBoard();
  renderWatchlistBoard();
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
        if (state.leaderboard) renderAll();
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
}

// ── boot ─────────────────────────────────────────────────────────────
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
  renderSettings();
  updateWatchlistBadge();

  try {
    const data = await loadLeaderboard();
    state.leaderboard = data;
    state.activeMetric = data.defaultMetric;
    document.getElementById('as-of').innerHTML = `As of <b>${fmtDate(data.asOf)}</b> · Financial Modeling Prep`;
    renderAllSegmented();
    renderAll();
  } catch (err) {
    document.getElementById('ranks-rows').innerHTML = `<div class="error-box">Couldn't load live data: ${err.message}</div>`;
    document.getElementById('as-of').textContent = 'Live data unavailable';
  }
}

init();
