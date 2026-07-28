const SECTOR_VAR = {
  Technology: '--sector-tech',
  'Communication Services': '--sector-comm',
  'Consumer Cyclical': '--sector-consumer',
  Healthcare: '--sector-health',
  'Financial Services': '--sector-financial',
};

let state = { leaderboard: null, activeMetric: null };

function fmtPct(v) {
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
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
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}

function renderSegmented() {
  const el = document.getElementById('segmented');
  el.innerHTML = '';
  state.leaderboard.metrics.forEach((m) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = m.label;
    btn.setAttribute('aria-pressed', String(m.key === state.activeMetric));
    btn.addEventListener('click', () => {
      state.activeMetric = m.key;
      renderSegmented();
      renderRows();
    });
    el.appendChild(btn);
  });
}

function renderRows() {
  const metric = state.activeMetric;
  const companies = state.leaderboard.companies;

  const available = companies.filter((c) => c.availability[metric] && typeof c.returns[metric] === 'number');
  const unavailable = companies.filter((c) => !(c.availability[metric] && typeof c.returns[metric] === 'number'));

  available.sort((a, b) => b.returns[metric] - a.returns[metric]);
  const maxAbs = Math.max(...available.map((c) => Math.abs(c.returns[metric])), 1);

  const rowsEl = document.getElementById('rows');
  rowsEl.innerHTML = '';

  let rank = 1;
  for (const c of available) {
    rowsEl.appendChild(buildRow(c, rank, metric, maxAbs));
    rank += 1;
  }
  for (const c of unavailable) {
    rowsEl.appendChild(buildUnavailableRow(c));
  }

  renderCallout(unavailable, metric);
}

function sectorChip(c) {
  const sectorVar = SECTOR_VAR[c.sector] || '--sector-default';
  return `
    <span class="name-cell">
      <span class="ticker-chip" style="background: color-mix(in srgb, var(${sectorVar}) 16%, transparent); color: var(${sectorVar});">${c.symbol}</span>
      <span class="name-text">
        <div class="company-name">${c.name}</div>
        <div class="sector-line"><span class="sector-dot" style="background: var(${sectorVar});"></span>${c.sector || 'Uncategorized'}</div>
      </span>
    </span>`;
}

function buildRow(c, rank, metric, maxAbs) {
  const val = c.returns[metric];
  const isGain = val >= 0;
  const pct = Math.min((Math.abs(val) / maxAbs) * 50, 50);

  const row = document.createElement('div');
  row.className = `row${rank === 1 ? ' ranked-1' : ''}`;
  row.innerHTML = `
    <span class="rank">${rank}</span>
    ${sectorChip(c)}
    <span class="num price">${fmtPrice(c.price)}</span>
    <span class="num cap">${fmtCap(c.marketCap)}</span>
    <span class="return-cell">
      <span class="return-val ${isGain ? 'gain' : 'loss'}">${fmtPct(val)}</span>
      <span class="bar-track">
        <span class="bar-mid"></span>
        <span class="bar-fill ${isGain ? 'gain' : 'loss'}" style="${isGain ? `left:50%; width:${pct}%;` : `left:${50 - pct}%; width:${pct}%;`}"></span>
      </span>
    </span>
  `;
  return row;
}

function buildUnavailableRow(c) {
  const row = document.createElement('div');
  row.className = 'row unavailable';
  row.innerHTML = `
    <span class="rank">&mdash;</span>
    ${sectorChip(c)}
    <span class="num price">${fmtPrice(c.price)}</span>
    <span class="num cap">${fmtCap(c.marketCap)}</span>
    <span class="return-cell">
      <span class="return-val na">N/A</span>
      <span class="bar-track"><span class="bar-mid"></span></span>
    </span>
  `;
  return row;
}

function renderCallout(unavailable, metric) {
  const box = document.getElementById('callout');
  const text = document.getElementById('callout-text');
  if (unavailable.length === 0) {
    box.hidden = true;
    return;
  }
  const metricLabel = state.leaderboard.metrics.find((m) => m.key === metric)?.label || metric;
  const names = unavailable
    .map((c) => `<b>${c.name} (${c.symbol})</b>${c.ipoDate ? `, IPO'd ${c.ipoDate}` : ''}`)
    .join('; ');
  text.innerHTML = `Not ranked on the ${metricLabel} window: ${names} &mdash; not enough trading history yet for a like-for-like return.`;
  box.hidden = false;
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
  try {
    const data = await loadLeaderboard();
    state.leaderboard = data;
    state.activeMetric = data.defaultMetric;
    document.getElementById('as-of').innerHTML = `As of <b>${fmtDate(data.asOf)}</b>`;
    renderSegmented();
    renderRows();
  } catch (err) {
    document.getElementById('rows').innerHTML = `<div class="error-box">Couldn't load live data: ${err.message}</div>`;
    document.getElementById('as-of').textContent = 'Live data unavailable';
  }
}

init();
