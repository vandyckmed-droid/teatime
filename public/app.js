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
    key: 'correlationThreshold',
    type: 'threshold',
    label: 'Diversification filter',
    description: 'Fade out (and block adding) any company whose daily-return correlation with something already on your watchlist is at or above this, measured over the ranking date range. Strong negative correlation never blocks — that is diversification, not duplication.',
    default: 0.7,
  },
  {
    // Rendered by renderFlagSettings() into its own section, not by the generic
    // loop — like 'daterange' below. The stored value is a sparse map of
    // per-flag overrides ({} means "every flag at its own default"), so a flag
    // added to ROW_FLAGS later needs no migration and a flag removed from it
    // has its saved value dropped by loadSettings.
    key: 'flags',
    type: 'flags',
    label: 'Flags',
    description: 'Marks on the board that call out a company for something other than its return.',
    default: {},
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
// Preset ranking windows, offered as pills above the Ranks board. Adding one
// is adding an entry here. The day counts are trading-day-ish approximations
// on purpose — "12M" names a window, it isn't a claim about a calendar year —
// and the end offset keeps each window clear of the last few sessions, which
// is where FMP's most recent closes are least settled.
const RANK_WINDOW_PRESETS = [
  { key: '12M', label: '12M', startDaysAgo: 250, endDaysAgo: 20 },
  { key: '6M', label: '6M', startDaysAgo: 130, endDaysAgo: 16 },
];

const DATE_RANGE_STEP_START = 10;
const DATE_RANGE_STEP_END = 2;
const DATE_RANGE_MAX_DAYS_AGO = 1800;
const DATE_RANGE_MIN_GAP = 10;

const TRADING_DAYS_PER_YEAR = 252;

// Diversification-filter stepper. 1.00 means "off": a distinct name effectively
// never reaches r = 1, so nothing gets blocked.
const CORRELATION_STEP = 0.05;
const CORRELATION_MIN = 0.3;
const CORRELATION_MAX = 1;
// A correlation over a handful of days is noise (mirrors MIN_OBSERVATIONS in
// src/correlation.js, used by the snapshot-mode fallback below).
const CORRELATION_MIN_OBSERVATIONS = 20;

// Sectors actually seen in the top 100 by market cap as of the scale-up to
// universeSize=100 (checked live against the screener). Add more here if a
// future resize surfaces a sector not covered — falls back to
// --sector-default rather than breaking.
// Keys are FMP's sector strings; values are the custom properties defined in
// styles.css (see the sector palette block there for how those hues are chosen).
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
  'Basic Materials': '--sector-basic-materials',
  'Real Estate': '--sector-real-estate',
};

// Row-width labels for the same sectors. FMP's full strings ("Communication
// Services") don't fit the narrow name column beside the logo.
const SECTOR_SHORT = {
  Technology: 'Tech',
  'Communication Services': 'Comm',
  'Consumer Cyclical': 'Cyclical',
  Healthcare: 'Health',
  'Financial Services': 'Finance',
  'Consumer Defensive': 'Defensive',
  Industrials: 'Industrials',
  Energy: 'Energy',
  Utilities: 'Utilities',
  'Basic Materials': 'Materials',
  'Real Estate': 'Real Estate',
};

const STORAGE_KEYS = { watchlist: 'teatime.watchlist', settings: 'teatime.settings' };

// ── the Investing tab's two views ────────────────────────────────────
// Remembered rather than reset each visit: which one you want is a standing
// preference, not a per-visit decision. A stored key that is no longer listed
// here falls back to the first view, which is what retires a removed one
// without stranding anyone who was last looking at it.
const INVESTING_VIEWS = [
  { key: 'portfolio', sub: 'Your account balance, from the record you keep by hand.' },
  { key: 'watchlist', sub: 'Tap a green check to remove one.' },
];
const INVESTING_VIEW_KEY = 'teatime.investingView';

function loadInvestingView() {
  try {
    const stored = localStorage.getItem(INVESTING_VIEW_KEY);
    return INVESTING_VIEWS.some((v) => v.key === stored) ? stored : 'portfolio';
  } catch {
    return 'portfolio';
  }
}


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

// Windows the range bar can be read over. A new one is a new entry; the day
// counts are approximate in the same spirit as RANK_WINDOW_PRESETS.
const RANGE_WINDOWS = [
  { key: '12M', label: '12M', days: 366 },
  { key: '6M', label: '6M', days: 186 },
  { key: '3M', label: '3M', days: 93 },
  { key: '1M', label: '1M', days: 31 },
];
const DEFAULT_RANGE_WINDOW = '12M';

// Windows the portfolio balance chart can be read over. "All" first because
// the record only starts in January — a 12M pill would show the same line and
// imply there's a year of it.
const PORTFOLIO_WINDOWS = [
  { key: 'ALL', label: 'All', days: null },
  { key: '6M', label: '6M', days: 186 },
  { key: '3M', label: '3M', days: 93 },
  { key: '1M', label: '1M', days: 31 },
];

// NOTE ON PLACEMENT: this block sits above `state` because loadSettings()
// validates stored flag overrides against ROW_FLAGS, and loadSettings() runs
// while `state` is being built. Declared below, the ReferenceError is swallowed
// by loadSettings()'s own try/catch (it exists for private-mode localStorage)
// and every saved flag override is silently discarded on load — the same
// temporal-dead-zone trap that has bitten INVESTING_VIEWS and RANGE_WINDOWS
// here before. See CLAUDE.md.
// ── row flags ────────────────────────────────────────────────────────
// A registry for "mark this row as special" — the same shape as SETTINGS and
// DETAIL_BLOCKS. One entry is one flag; matching rows get `data-flags` carrying
// its key, and one CSS rule per key sets --flag-orb on that selector (see
// .row[data-flags~=...] in styles.css). The orb machinery itself is written
// once, so a second flag is an entry here plus a single line of CSS, not a new
// rendering path.
//
// Contract for an entry:
//   key    stable identifier; becomes the data-flags token and the CSS hook
//   label  spoken in the row's accessible name, so the glow isn't purely visual
//   test   (company) => boolean, run on every row of both boards
//   note   optional (count) => string, added to the board callout so a
//          highlighted row is never unexplained
//
// Flags are additive: a row can carry several, and the glow composes with the
// saved-row ring rather than replacing it.
//
// $200B is the mega-cap line. Chosen against the live board — it takes in 53 of
// the 300 companies, so it lands on "roughly the top 50" while still being an
// absolute threshold rather than a rank. That matters: a rank would silently
// change meaning every time universeSize moves, whereas "above $200B" means the
// same thing at 250 companies as at 500.
const MEGA_CAP_MIN = 200e9;

const ROW_FLAGS = [
  {
    key: 'mega',
    label: 'mega cap',
    title: 'Mega caps',
    description: 'Put a gold orb behind the logo of any company worth $200B or more. '
      + 'A size marker, not a judgement — it says nothing about return.',
    test: (c) => typeof c.marketCap === 'number' && c.marketCap >= MEGA_CAP_MIN,
    note: (n) => `<b>${n}</b> ${n === 1 ? 'company carries' : 'companies carry'} a gold orb &mdash; `
      + `mega caps, worth <b>$200B</b> or more.`,
  },
];

// Absent from the stored overrides means "on": a flag added to the registry
// later lights up for everyone without a migration, and switching one off is
// the thing that gets recorded.
function flagEnabled(key) {
  const overrides = (state.settings && state.settings.flags) || {};
  return overrides[key] !== false;
}

function rowFlags(c) {
  return ROW_FLAGS.filter((f) => {
    if (!flagEnabled(f.key)) return false;
    try {
      return f.test(c);
    } catch {
      return false; // a broken flag drops itself rather than taking the board down
    }
  });
}

// How many companies a flag would mark, ignoring whether it is switched on —
// the Settings row shows this so the toggle says what it will do before you
// touch it.
function flagMatchCount(flag) {
  if (!state.leaderboard) return null;
  let n = 0;
  for (const c of state.leaderboard.companies) {
    try {
      if (flag.test(c)) n += 1;
    } catch { /* a broken flag counts nothing */ }
  }
  return n;
}


const state = {
  leaderboard: null,
  activeTab: 'ranks',
  // Which of the Investing tab's two views is showing (see INVESTING_VIEWS).
  investingView: loadInvestingView(),
  watchlist: loadWatchlist(),
  settings: loadSettings(),
  rankingsLoaded: false,
  // symbol -> score, populated by refreshRankings() from /api/rank (or the
  // client-side fallback below when running as a static snapshot with no
  // backend to call).
  rankScores: null,
  // symbol -> { value, against }: strongest positive return correlation with
  // something already on the watchlist. Populated by refreshCorrelations().
  correlations: {},
};

// symbol -> { symbol, asOf, series }, oldest first. Shared by the Ranks/Watchlist
// custom-date-range scoring and the per-ticker detail chart.
const historyCache = new Map();

const detail = {
  symbol: null,
  // Whether the sheet is grown to the full-screen data page (see
  // setDetailExpanded). Always false on open — expanding is a deliberate act,
  // not a mode the sheet remembers.
  expanded: false,
  range: DEFAULT_CHART_RANGE,
  // Which window the 52-week bar is drawn over (see RANGE_WINDOWS). Kept
  // across a swipe like `range` is — comparing two companies over the same
  // window is the point of swiping.
  rangeWindow: DEFAULT_RANGE_WINDOW,
  slice: null, // the currently-rendered range's [{date, close}], oldest first
  // How far the sheet is parked below its full position: 0, or the half detent
  // (see initDetailDismiss). Reset on every open.
  detentOffset: 0,
  // The board order the sheet was opened from, and where we are in it — what
  // swiping left/right walks through.
  sequence: null,
  index: 0,
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
// SETTINGS is the schema, not just the render list: stored values are read back
// key by key, so anything that no longer names a real setting is dropped rather
// than carried around forever. Several chart settings have come and gone here,
// and each one used to leave a dead key behind in localStorage.
function loadSettings() {
  // Object defaults are cloned, not handed out by reference: the date-range
  // steppers edit `state.settings.rankDateRange` in place, which would
  // otherwise rewrite the SETTINGS entry's own default object.
  const defaults = Object.fromEntries(SETTINGS.map((s) => [
    s.key,
    s.default && typeof s.default === 'object' ? { ...s.default } : s.default,
  ]));
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || '{}');
    const settings = { ...defaults };
    for (const key of Object.keys(defaults)) {
      if (key in stored) settings[key] = stored[key];
    }

    // A saved window can outlive the bounds it was saved under — the static
    // snapshot carries less history than the live server, so a range stored
    // before that reaches back past any data and scores nothing at all. A
    // stored value of the wrong shape entirely falls back to the default,
    // rather than turning into NaN dates further down.
    const range = settings.rankDateRange;
    if (!range || typeof range.startDaysAgo !== 'number' || typeof range.endDaysAgo !== 'number') {
      settings.rankDateRange = defaults.rankDateRange;
    } else {
      range.startDaysAgo = Math.min(range.startDaysAgo, DATE_RANGE_MAX_DAYS_AGO);
      range.endDaysAgo = Math.min(range.endDaysAgo, range.startDaysAgo - DATE_RANGE_MIN_GAP);
    }

    // Same posture one level down, for the per-flag overrides: a key that is
    // no longer in ROW_FLAGS is dropped rather than kept forever, and anything
    // that isn't a boolean is ignored rather than trusted.
    const flags = settings.flags;
    settings.flags = flags && typeof flags === 'object' && !Array.isArray(flags)
      ? Object.fromEntries(Object.entries(flags)
        .filter(([key, on]) => typeof on === 'boolean' && ROW_FLAGS.some((f) => f.key === key)))
      : {};

    // Write the cleaned-up version back right away rather than waiting for the
    // next setting change, so a retired key doesn't sit in storage indefinitely
    // on a device where nobody touches Settings again.
    if (Object.keys(stored).some((key) => !(key in defaults))
      || JSON.stringify(settings.flags) !== JSON.stringify(stored.flags ?? {})) {
      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
    }
    return settings;
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
// Two decimals. Four was tried, to resolve ties on a 200-name board, and it
// simply doesn't fit: "+4.0070" overruns the 54px value column and spills left
// over the 52-week range labels. An occasional visible tie beats a permanently
// crowded row.
function fmtScore(v) {
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}`;
}

// ── compact forms for the row, where the value column is 54px ────────
// The detail sheet and the chart tooltip deliberately keep full precision —
// they have the room, and the tooltip exists to be read exactly. This is only
// for the board, where a four-digit return would otherwise overlap its
// neighbour. Precision is traded for a stable layout on purpose.
function fmtPctCompact(v) {
  const sign = v > 0 ? '+' : v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}k%`;
  if (abs >= 100) return `${sign}${Math.round(abs)}%`;
  return `${sign}${abs.toFixed(1)}%`;
}
function fmtPrice(v) {
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// The 52-week low/high labels sit under an 88px track, two to a line, so they
// have to stay around six characters. Cents matter at $40.10 and are noise at
// $2,354 — drop them once the figure is big enough not to need them.
// Cents stop earning their space at three figures: on a 393pt row, "$469.47"
// and "$469" say the same thing about where a stock sits in its 52-week range,
// and the shorter one leaves room for the name. Under $100 the decimals still
// carry real proportional weight, so they stay.
function fmtRangePrice(v) {
  return v >= 100
    ? '$' + Math.round(v).toLocaleString('en-US')
    : '$' + v.toFixed(2);
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
// ── calendar dates are rendered in UTC, always ───────────────────────
// Every date in this app is a *calendar date* off the data — a trading
// session, a balance entry, a window edge — not a moment in time. They're
// built at UTC midnight, so formatting them in the device's zone renders
// them a day early anywhere west of Greenwich: the owner's phone showed a
// series starting "Jan 1" that begins on 2026-01-02, and a portfolio "through
// Jul 30" whose last balance is Jul 31. Every suite here ran in UTC, where
// the bug is invisible.
//
// `timeZone: 'UTC'` is the whole fix, and it belongs on every formatter that
// takes a YYYY-MM-DD. The one exception below is fmtDate(), which formats the
// leaderboard's asOf — a real instant, correctly shown in local time.
const CAL_DATE_OPTS = { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' };

function fmtStepperDate(daysAgo) {
  return daysAgoToDate(daysAgo).toLocaleDateString('en-US', CAL_DATE_OPTS);
}
// Two-digit year, for the sticky section header where the whole range has to
// share one line with its label.
function fmtCompactDate(daysAgo) {
  return daysAgoToDate(daysAgo)
    .toLocaleDateString('en-US', { ...CAL_DATE_OPTS, year: '2-digit' })
    .replace(/,\s*(\d\d)$/, " '$1"); // "Nov 22, 25" → "Nov 22 '25"
}

// Company names are the single most-truncated thing in a 62px row, and the
// legal suffix is the least informative part of them ("Sandisk Corporation" →
// "Sandisk" buys back five characters of actual name). Row lists only — the
// detail sheet still shows the full name as returned by the API.
const NAME_SUFFIX = /[\s,]+(?:and\s+|&\s*)?(?:Incorporated|Inc|Corporation|Corp|Company|Co|Holdings|Holding|Group|plc|Ltd|Limited|N\.?V|S\.?A|SE|AG)\.?$/i;

// Word-level abbreviations, applied after the suffix strip. Stripping the legal
// suffix alone still left most names ellipsed in a ~72px column ("Dell
// Technol…", "Marathon P…"); shortening the handful of long words that recur
// across the universe gets many of them to fit whole. Deliberately trading a
// little specificity for a row that doesn't ragged out — the detail sheet still
// carries the full legal name.
const NAME_WORDS = [
  [/\bTechnologies\b/gi, 'Tech'],
  [/\bTechnology\b/gi, 'Tech'],
  [/\bInternational\b/gi, 'Intl'],
  [/\bCommunications\b/gi, 'Comms'],
  [/\bSemiconductors?\b/gi, 'Semi'],
  [/\bPharmaceuticals?\b/gi, 'Pharma'],
  [/\bLaboratories\b/gi, 'Labs'],
  [/\bPetroleum\b/gi, 'Petro'],
  [/\bIndustries\b/gi, 'Ind'],
  [/\bEnterprises\b/gi, 'Ent'],
  [/\bResources\b/gi, 'Res'],
  [/\bServices\b/gi, 'Svcs'],
  [/\bManagement\b/gi, 'Mgmt'],
  [/\bAerospace\b/gi, 'Aero'],
  [/\band\b/gi, '&'],
];
function shortName(name) {
  let s = String(name).replace(/^The\s+/i, '');
  for (let i = 0; i < 3; i++) {
    const next = s.replace(NAME_SUFFIX, '');
    if (next === s) break;
    s = next;
  }
  for (const [pattern, replacement] of NAME_WORDS) s = s.replace(pattern, replacement);
  s = s.trim().replace(/\s{2,}/g, ' ').replace(/[,&]$/, '').trim();
  return s || String(name);
}

// ── scoring: point-to-point return over the custom date range, or an
// annualized-return ÷ annualized-volatility (Sharpe-like) score over the
// same range when volatility-adjusted ──
//
// Mirrors src/ranking.js on the server, function for function — including the
// split between the date-addressed *BetweenDates formulas and the settings-aware
// wrappers below. The rank-over-time fallback scores the same window at ~120
// past dates per company, so it needs a form of the series it can score that
// many times without re-filtering an array each call. If the scoring math
// changes, update both copies.

// Splits a {date, close}[] into parallel arrays plus each day's change from the
// day before. returns[0] is NaN — the first close has no prior day.
function prepareSeries(series) {
  const dates = [];
  const closes = [];
  for (const p of series || []) {
    dates.push(p.date);
    closes.push(p.close);
  }
  const returns = new Float64Array(dates.length);
  if (dates.length > 0) returns[0] = NaN;
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    returns[i] = prev > 0 ? (closes[i] - prev) / prev : NaN;
  }
  return { dates, closes, returns };
}

function indexAtOrBefore(dates, dateStr) {
  let lo = 0;
  let hi = dates.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= dateStr) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans;
}

function indexAtOrAfter(dates, dateStr) {
  let lo = 0;
  let hi = dates.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] >= dateStr) { ans = mid; hi = mid - 1; } else { lo = mid + 1; }
  }
  return ans;
}

// "On or before" at both edges, so a window edge landing on a weekend or holiday
// uses that week's last real close instead of dropping the company.
function returnBetweenDates(prepared, startStr, endStr) {
  const { dates, closes } = prepared;
  if (dates.length === 0) return null;
  const i = indexAtOrBefore(dates, startStr);
  const j = indexAtOrBefore(dates, endStr);
  if (i < 0 || j < 0) return null;
  const startClose = closes[i];
  if (!(startClose > 0)) return null;
  return ((closes[j] - startClose) / startClose) * 100;
}

// Annualized return ÷ annualized volatility, both derived from the same daily
// returns: annualized mean is mean*252, annualized stdev is stdev*sqrt(252),
// so the ratio simplifies to (mean / stdev) * sqrt(252) — a Sharpe ratio
// without a risk-free-rate subtraction, over the given window.
function volAdjustedBetweenDates(prepared, startStr, endStr) {
  const { dates, returns } = prepared;
  if (dates.length === 0) return null;
  if (dates[0] > startStr) return null; // no coverage back to the start date
  const i = indexAtOrAfter(dates, startStr);
  const j = indexAtOrBefore(dates, endStr);
  if (i < 0 || j <= i) return null;

  let n = 0;
  let sum = 0;
  for (let k = i + 1; k <= j; k++) {
    const r = returns[k];
    if (Number.isNaN(r)) continue;
    n += 1;
    sum += r;
  }
  if (n < 2) return null;
  const mean = sum / n;
  let sumSq = 0;
  for (let k = i + 1; k <= j; k++) {
    const r = returns[k];
    if (Number.isNaN(r)) continue;
    sumSq += (r - mean) ** 2;
  }
  const stdev = Math.sqrt(sumSq / (n - 1));
  if (!(stdev > 0)) return null;
  return (mean / stdev) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

// Prepared series are cached per symbol: the boards score every company on every
// settings change, and the rank chart scores them ~120 times over.
const preparedCache = new Map();
function preparedFor(symbol) {
  let prepared = preparedCache.get(symbol);
  if (prepared) return prepared;
  const cached = historyCache.get(symbol);
  if (!cached || !cached.series || cached.series.length === 0) return null;
  prepared = prepareSeries(cached.series);
  preparedCache.set(symbol, prepared);
  return prepared;
}

function customRangeReturn(company) {
  const prepared = preparedFor(company.symbol);
  if (!prepared) return null;
  const { startDaysAgo, endDaysAgo } = state.settings.rankDateRange;
  return returnBetweenDates(prepared, daysAgoToDateStr(startDaysAgo), daysAgoToDateStr(endDaysAgo));
}

function volAdjustedScore(company) {
  const prepared = preparedFor(company.symbol);
  if (!prepared) return null;
  const { startDaysAgo, endDaysAgo } = state.settings.rankDateRange;
  return volAdjustedBetweenDates(prepared, daysAgoToDateStr(startDaysAgo), daysAgoToDateStr(endDaysAgo));
}

// Live path reads server-computed scores (see refreshRankings below);
// customRangeReturn/volAdjustedScore above only run client-side as the
// fallback for the static-snapshot preview channels, which have no backend.
function scoreFor(company) {
  const v = state.rankScores ? state.rankScores[company.symbol] : undefined;
  return typeof v === 'number' ? v : null;
}

// ── diversification filter ───────────────────────────────────────────
// Whether a name is blocked from being added: it correlates too tightly with
// something already saved. Held names are never blocked (they're already in),
// and a threshold of 1 turns the filter off.
function correlationBlock(company) {
  if (state.watchlist.has(company.symbol)) return null;
  const threshold = state.settings.correlationThreshold;
  if (!(threshold < CORRELATION_MAX)) return null;
  const hit = state.correlations[company.symbol];
  if (!hit || hit.value < threshold) return null;
  return hit;
}

// Signed, not absolute — see the header comment in src/correlation.js.
function correlationClientSide(seriesA, seriesB, startStr, endStr) {
  if (!seriesA || !seriesB) return null;
  const bByDate = new Map();
  for (const p of seriesB) bByDate.set(p.date, p.close);
  const pairs = [];
  for (const p of seriesA) {
    if (p.date < startStr || p.date > endStr) continue;
    const b = bByDate.get(p.date);
    if (b === undefined || !(p.close > 0) || !(b > 0)) continue;
    pairs.push([p.close, b]);
  }
  const n = pairs.length - 1;
  if (n < CORRELATION_MIN_OBSERVATIONS) return null;
  const ra = [];
  const rb = [];
  for (let i = 1; i < pairs.length; i++) {
    ra.push((pairs[i][0] - pairs[i - 1][0]) / pairs[i - 1][0]);
    rb.push((pairs[i][1] - pairs[i - 1][1]) / pairs[i - 1][1]);
  }
  const meanA = ra.reduce((x, y) => x + y, 0) / n;
  const meanB = rb.reduce((x, y) => x + y, 0) / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = ra[i] - meanA;
    const db = rb[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (!(varA > 0) || !(varB > 0)) return null;
  return cov / Math.sqrt(varA * varB);
}

function computeCorrelationsClientSide(held) {
  const { startDaysAgo, endDaysAgo } = state.settings.rankDateRange;
  const startStr = daysAgoToDateStr(startDaysAgo);
  const endStr = daysAgoToDateStr(endDaysAgo);
  const out = {};
  for (const c of state.leaderboard.companies) {
    if (held.includes(c.symbol)) continue;
    const mine = historyCache.get(c.symbol);
    if (!mine) continue;
    let best = null;
    for (const other of held) {
      const theirs = historyCache.get(other);
      if (!theirs) continue;
      const r = correlationClientSide(mine.series, theirs.series, startStr, endStr);
      if (r === null) continue;
      if (best === null || r > best.value) best = { value: r, against: other };
    }
    if (best) out[c.symbol] = best;
  }
  return out;
}

// Same dual-path shape as refreshRankings: the live server computes this over
// history the browser never has to download, and the static snapshot (no
// backend) falls back to computing it from embedded history.
let corrRequestSeq = 0;
async function refreshCorrelations() {
  const seq = ++corrRequestSeq;
  const held = [...state.watchlist];
  if (held.length === 0) {
    state.correlations = {};
    return;
  }
  const { startDaysAgo, endDaysAgo } = state.settings.rankDateRange;
  const params = new URLSearchParams({
    symbols: held.join(','),
    startDaysAgo: String(startDaysAgo),
    endDaysAgo: String(endDaysAgo),
  });

  if (typeof EMBEDDED_LEADERBOARD !== 'undefined') {
    await loadAllHistories(state.leaderboard.companies.map((c) => c.symbol));
    if (seq !== corrRequestSeq) return;
    state.correlations = computeCorrelationsClientSide(held);
    return;
  }
  try {
    const res = await fetch(`/api/correlations?${params}`);
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    const data = await res.json();
    if (seq !== corrRequestSeq) return;
    state.correlations = data.correlations || {};
  } catch {
    await loadAllHistories(state.leaderboard.companies.map((c) => c.symbol));
    if (seq !== corrRequestSeq) return;
    state.correlations = computeCorrelationsClientSide(held);
  }
}

function computeRankScoresClientSide() {
  const scores = {};
  for (const c of state.leaderboard.companies) {
    scores[c.symbol] = state.settings.volAdjusted ? volAdjustedScore(c) : customRangeReturn(c);
  }
  return scores;
}

// Refreshes state.rankScores for the current date-range/vol-adjusted
// settings. Tries the server's /api/rank first (cheap: only a symbol->score
// map, no raw history download) and falls back to the old client-side
// computation over historyCache when that call fails or isn't available at
// all — which is the case on the two static-snapshot preview channels,
// which have no backend to answer /api/rank. EMBEDDED_LEADERBOARD is defined
// only in those assembled snapshot bundles, so it doubles as the signal to
// skip the doomed fetch attempt outright rather than let it fail into the
// console on every load and Settings change.
let rankRequestSeq = 0;
async function refreshRankings() {
  const seq = ++rankRequestSeq;
  if (typeof EMBEDDED_LEADERBOARD !== 'undefined') {
    await loadAllHistories(state.leaderboard.companies.map((c) => c.symbol));
    if (seq !== rankRequestSeq) return;
    state.rankScores = computeRankScoresClientSide();
    return;
  }
  const { startDaysAgo, endDaysAgo } = state.settings.rankDateRange;
  const params = new URLSearchParams({
    startDaysAgo: String(startDaysAgo),
    endDaysAgo: String(endDaysAgo),
    volAdjusted: String(!!state.settings.volAdjusted),
  });
  try {
    const res = await fetch(`/api/rank?${params}`);
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    const data = await res.json();
    if (seq !== rankRequestSeq) return; // superseded by a newer request
    state.rankScores = data.scores;
  } catch {
    await loadAllHistories(state.leaderboard.companies.map((c) => c.symbol));
    if (seq !== rankRequestSeq) return;
    state.rankScores = computeRankScoresClientSide();
  }
}

// ── tab routing ──────────────────────────────────────────────────────
const TABS = ['ranks', 'investing', 'settings'];
// The Investing tab was called Watchlist until the portfolio moved in beside
// it. Old links (and anything bookmarked to #watchlist) still land correctly.
const TAB_ALIASES = { watchlist: 'investing' };

function resolveTab(name) {
  const tab = TAB_ALIASES[name] || name;
  return TABS.includes(tab) ? tab : null;
}

function goToTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.panel').forEach((el) => {
    el.hidden = el.dataset.panel !== tab;
  });
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === tab));
  });
  if (location.hash.slice(1) !== tab) history.replaceState(null, '', `#${tab}`);
  // The segmented thumb needs real layout numbers, which don't exist while
  // the panel is display:none.
  if (tab === 'investing') requestAnimationFrame(() => positionSegmentedThumb('investing', true));
}

function initTabBar() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => goToTab(btn.dataset.tab));
  });
  window.addEventListener('hashchange', () => {
    const tab = resolveTab(location.hash.slice(1));
    if (tab) goToTab(tab);
  });
  goToTab(resolveTab(location.hash.slice(1)) || 'ranks');
}

function setInvestingView(view, { persist = true } = {}) {
  const chosen = INVESTING_VIEWS.find((v) => v.key === view) || INVESTING_VIEWS[0];
  state.investingView = chosen.key;
  if (persist) {
    try { localStorage.setItem(INVESTING_VIEW_KEY, chosen.key); } catch { /* private mode */ }
  }
  document.querySelectorAll('[data-subview]').forEach((el) => {
    el.hidden = el.dataset.subview !== chosen.key;
  });
  document.querySelectorAll('[data-segmented="investing"] button').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.view === chosen.key));
  });
  const sub = document.getElementById('investing-sub');
  if (sub) sub.textContent = chosen.sub;
  positionSegmentedThumb('investing');
  // The chart measures its wrapper in pixels, which reads 0 while the view is
  // hidden — so it has to be drawn after the view is shown, not before.
  if (chosen.key === 'portfolio') { renderPortfolioChart(); renderProjectionCard(); }
}

function initInvestingViews() {
  const el = document.querySelector('[data-segmented="investing"]');
  if (!el) return;
  el.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => setInvestingView(btn.dataset.view));
  });
  setInvestingView(state.investingView, { persist: false });
}

function rankDateRangeLabel() {
  const { startDaysAgo, endDaysAgo } = state.settings.rankDateRange;
  return `${fmtStepperDate(startDaysAgo)} → ${fmtStepperDate(endDaysAgo)}`;
}
function rankDateRangeShort() {
  const { startDaysAgo, endDaysAgo } = state.settings.rankDateRange;
  return `${fmtCompactDate(startDaysAgo)} → ${fmtCompactDate(endDaysAgo)}`;
}

// The section label is a sticky two-part header (see .section-label in
// styles.css): a fixed caps key on the left, the live ranking window in mono on
// the right. Split like that it fits one line, which the old single run of
// uppercased text did not.
// The pills and the Settings steppers are two views of one setting, so each
// re-renders the other. A pill is lit only on an exact match — nudge a
// stepper and the pills go dark, which is the honest reading of "the window
// is no longer one of these".
function renderWindowPills() {
  const host = document.getElementById('ranks-window-pills');
  if (!host) return;
  if (!host.querySelector('button')) {
    host.innerHTML = RANK_WINDOW_PRESETS.map((p) => `
      <button type="button" class="window-pill" data-preset="${p.key}" aria-pressed="false">${p.label}</button>`).join('');
    host.querySelectorAll('.window-pill').forEach((btn) => {
      btn.addEventListener('click', () => applyWindowPreset(btn.dataset.preset));
    });
  }
  const { startDaysAgo, endDaysAgo } = state.settings.rankDateRange;
  host.querySelectorAll('.window-pill').forEach((btn) => {
    const p = RANK_WINDOW_PRESETS.find((x) => x.key === btn.dataset.preset);
    const active = !!p && p.startDaysAgo === startDaysAgo && p.endDaysAgo === endDaysAgo;
    btn.setAttribute('aria-pressed', String(active));
  });
}

async function applyWindowPreset(key) {
  const preset = RANK_WINDOW_PRESETS.find((p) => p.key === key);
  if (!preset) return;
  const range = state.settings.rankDateRange;
  if (range.startDaysAgo === preset.startDaysAgo && range.endDaysAgo === preset.endDaysAgo) return;
  // Clamped exactly as a stored window is, so a preset can't reach past the
  // history the static snapshot carries.
  range.startDaysAgo = Math.min(preset.startDaysAgo, DATE_RANGE_MAX_DAYS_AGO);
  range.endDaysAgo = Math.max(0, Math.min(preset.endDaysAgo, range.startDaysAgo - DATE_RANGE_MIN_GAP));
  saveSettings();
  renderWindowPills();
  renderDateRangeSetting();
  if (state.leaderboard && state.rankingsLoaded) {
    // Both sequence their own requests, so rapid taps each fire but only the
    // latest response applies — same as the steppers.
    await Promise.all([refreshRankings(), refreshCorrelations()]);
    renderAll();
  }
}

function updateScoreLabels() {
  renderWindowPills();
  const key = state.settings.volAdjusted ? 'Ranked by vol-adj return' : 'Ranked by return';
  const html =
    `<span class="section-label-key">${key}</span>` +
    `<span class="section-label-value">${rankDateRangeShort()}</span>`;
  const ranksLabel = document.getElementById('ranks-score-label');
  if (ranksLabel) ranksLabel.innerHTML = html;
  const watchlistLabel = document.getElementById('watchlist-score-label');
  if (watchlistLabel) watchlistLabel.innerHTML = html;
  // The score column's header names whichever metric is live.
  document.querySelectorAll('.board-head-score').forEach((el) => {
    el.textContent = state.settings.volAdjusted ? 'Vol-adj return' : 'Return';
  });
}

// ── row rendering (shared by Ranks and Watchlist) ───────────────────
// Brand logo in a circular avatar. The <img> sits over ticker initials; a
// failed load is dropped by pruneBrokenLogos below, revealing the sector-tinted
// initials underneath rather than a broken-image frame.
function logoAvatar(c, sectorVar) {
  const initials = c.symbol.slice(0, 2);
  const img = c.logo
    ? `<img src="${c.logo}" alt="" loading="lazy" decoding="async">`
    : '';
  // logoOnDark is set by the snapshot builder for the handful of marks that are
  // white-on-transparent and would disappear against the white disc.
  const onDark = c.logoOnDark ? ' on-dark' : '';
  return `<span class="logo${onDark}" style="--chip-color: var(${sectorVar})"><span class="logo-fallback">${initials}</span>${img}</span>`;
}

// Where today's price sits inside the 52-week range, as a percentage. Clamped
// because `price` is the latest close while the range can be intraday, so a
// fresh high/low can put the price a hair outside its own range.
// Ticker is the identity now (big, first); the legal name is the subtitle and
// the sector is a colored dot plus a short label, so the whole block stays one
// narrow column beside the logo.
function nameCell(c, sectorVar) {
  return `
    <span class="name-cell">
      <span class="ticker">${c.symbol}</span>
      <span class="company-name">${shortName(c.name)}</span>
      <span class="sector-line">
        <span class="sector-dot" style="background: var(${sectorVar})"></span>${SECTOR_SHORT[c.sector] || c.sector || 'Other'}
      </span>
    </span>`;
}

// The one star that was just tapped, so only it plays the spring — a re-render
// happens for plenty of reasons (a settings change, another row's toggle) and
// every saved star bouncing each time would be noise.
let lastToggledSymbol = null;

// Plus = "add this", check = "added". Both icons ship in the markup and CSS
// picks one by .checked, so toggling never re-parses SVG.
const PLUS_PATH = 'M12 5.5v13M5.5 12h13';
const CHECK_PATH = 'M5 12.6l4.7 4.6L19 7.8';

function addButton(c) {
  const checked = state.watchlist.has(c.symbol);
  const justChecked = checked && c.symbol === lastToggledSymbol;
  const blocked = correlationBlock(c);
  // The reason rides on the label rather than the row: at 393pt there is no
  // room for a per-row note, and the count is explained in the callout instead.
  const label = blocked
    ? `Too correlated to add: ${c.name} moves with ${blocked.against} (r ${blocked.value.toFixed(2)})`
    : `${checked ? 'Remove from' : 'Add to'} watchlist: ${c.name}`;
  return `
    <span class="select-cell">
      <button type="button" class="add-btn${checked ? ' checked' : ''}${justChecked ? ' just-checked' : ''}"
        data-symbol="${c.symbol}" aria-pressed="${checked}"${blocked ? ' disabled' : ''}
        title="${blocked ? label : ''}" aria-label="${label}">
        <svg class="icon-plus" viewBox="0 0 24 24" aria-hidden="true"><path d="${PLUS_PATH}"/></svg>
        <svg class="icon-check" viewBox="0 0 24 24" aria-hidden="true"><path d="${CHECK_PATH}"/></svg>
      </button>
    </span>`;
}

// Both row builders share one column order — rank, logo, name block,
// score/price, add control — which is also what the .board-head label sits
// over, so the two stay aligned by construction. The 52-week range used to be
// a column here; it lives in the full-screen ticker view now, where it has
// the width to be readable.
function baseRow(c, extraClass) {
  const row = document.createElement('div');
  const blocked = correlationBlock(c) ? ' correlated' : '';
  row.className = `row${extraClass}${blocked}${state.watchlist.has(c.symbol) ? ' is-selected' : ''}`;
  row.dataset.symbol = c.symbol;
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  // The flags are a visual signal, so they also go in the accessible name —
  // a glow nobody can hear is a glow half the point of.
  const flags = rowFlags(c);
  if (flags.length) row.dataset.flags = flags.map((f) => f.key).join(' ');
  const suffix = flags.length ? ` (${flags.map((f) => f.label).join(', ')})` : '';
  row.setAttribute('aria-label', `${c.name}${suffix}: view chart`);
  return row;
}

function rowEl(c, rank, value) {
  const isGain = value >= 0;
  const sectorVar = SECTOR_VAR[c.sector] || '--sector-default';
  const row = baseRow(c, rank === 1 ? ' ranked-1' : '');
  // Drives the logo's recentring — see .row[data-rank-digits] in styles.css.
  row.dataset.rankDigits = String(String(rank).length);
  row.innerHTML = `
    <span class="rank">${rank}</span>
    ${logoAvatar(c, sectorVar)}
    ${nameCell(c, sectorVar)}
    <span class="trailing-cell">
      <span class="return-val ${isGain ? 'gain' : 'loss'}"></span>
      <span class="price-mini">${fmtRangePrice(c.price)}</span>
    </span>
    ${addButton(c)}
  `;
  row.querySelector('.return-val').textContent = state.settings.volAdjusted ? fmtScore(value) : fmtPctCompact(value);
  return row;
}

function buildUnavailableRow(c) {
  const sectorVar = SECTOR_VAR[c.sector] || '--sector-default';
  const row = baseRow(c, ' unavailable');
  row.innerHTML = `
    <span class="rank">&mdash;</span>
    ${logoAvatar(c, sectorVar)}
    ${nameCell(c, sectorVar)}
    <span class="trailing-cell">
      <span class="return-val na">N/A</span>
      <span class="price-mini">${fmtRangePrice(c.price)}</span>
    </span>
    ${addButton(c)}
  `;
  return row;
}

// Bound after insertion rather than as an inline onerror attribute — an inline
// handler written through innerHTML never fired. Covers images that already
// failed before this ran (img.complete with no intrinsic width) as well as ones
// still in flight.
function pruneBrokenLogos(container) {
  container.querySelectorAll('.logo img').forEach((img) => {
    if (img.complete && img.naturalWidth === 0) img.remove();
    else img.addEventListener('error', () => img.remove(), { once: true });
  });
}

function attachSelectHandlers(container) {
  container.querySelectorAll('.add-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const symbol = btn.dataset.symbol;
      if (state.watchlist.has(symbol)) state.watchlist.delete(symbol);
      else state.watchlist.add(symbol);
      lastToggledSymbol = symbol;
      saveWatchlist();
      updateWatchlistBadge(true);
      renderAll();
      lastToggledSymbol = null;
      // The held set just changed, so every other name's correlation against it
      // did too. Re-render once it lands.
      refreshCorrelations().then(() => renderAll());
    });
  });
}

function attachRowHandlers(container) {
  // Read the order at click time, not now: the board re-sorts on every settings
  // change, and the sheet's swipe order has to match what's actually on screen.
  const boardOrder = () =>
    [...container.querySelectorAll('.row[data-symbol]')].map((r) => r.dataset.symbol);
  container.querySelectorAll('.row[data-symbol]').forEach((row) => {
    row.addEventListener('click', () => openDetail(row.dataset.symbol, boardOrder()));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDetail(row.dataset.symbol, boardOrder());
      }
    });
  });
}

// Renders one board (Ranks or Watchlist) from scored companies: ranked rows
// first, then the ones with too little history to score. Returns the
// unavailable list so callers can explain it.
function fillBoard(rowsEl, scored) {
  const available = scored.filter((x) => x.value !== null).sort((a, b) => b.value - a.value);
  const unavailable = scored.filter((x) => x.value === null).map((x) => x.c);

  rowsEl.innerHTML = '';
  available.forEach(({ c, value }, i) => rowsEl.appendChild(rowEl(c, i + 1, value)));
  unavailable.forEach((c) => rowsEl.appendChild(buildUnavailableRow(c)));

  attachSelectHandlers(rowsEl);
  attachRowHandlers(rowsEl);
  pruneBrokenLogos(rowsEl);
  return unavailable;
}

function renderRanksBoard() {
  const scored = state.leaderboard.companies.map((c) => ({ c, value: scoreFor(c) }));
  const unavailable = fillBoard(document.getElementById('ranks-rows'), scored);
  renderRanksCallout(unavailable);
}

function renderRanksCallout(unavailable) {
  const box = document.getElementById('ranks-callout');
  const text = document.getElementById('ranks-callout-text');
  const notes = [];

  if (unavailable.length > 0) {
    const names = unavailable
      .map((c) => `<b>${c.name} (${c.symbol})</b>${c.ipoDate ? `, IPO'd ${c.ipoDate}` : ''}`)
      .join('; ');
    notes.push(`Not ranked over ${rankDateRangeLabel()}: ${names} &mdash; not enough trading history for a like-for-like score.`);
  }

  // A faded row with no stated reason is just a mysterious dim row, and there is
  // no space for a per-row note at this width — so the count is explained once,
  // here.
  const faded = state.leaderboard.companies.filter((c) => correlationBlock(c)).length;
  if (faded > 0) {
    notes.push(`<b>${faded}</b> ${faded === 1 ? 'name is' : 'names are'} faded and can't be added &mdash; daily-return correlation of <b>${state.settings.correlationThreshold.toFixed(2)}</b> or more with something already on your watchlist. Adjust or switch this off in Settings.`);
  }

  // One line per flag that has something to say, so a highlighted row is never
  // just a mysteriously brighter row.
  for (const flag of ROW_FLAGS) {
    if (!flag.note) continue;
    const n = state.leaderboard.companies.filter((c) => rowFlags(c).includes(flag)).length;
    if (n > 0) notes.push(flag.note(n));
  }

  if (notes.length === 0) {
    box.hidden = true;
    return;
  }
  text.innerHTML = notes.join('<br><br>');
  box.hidden = false;
}

// ── portfolio card ───────────────────────────────────────────────────
// The owner's own balance history (data/portfolio/balances.csv, summarized by
// src/portfolio.js). Everything shown is derived from those dates and dollar
// figures alone — deliberately not reconciled against the broker's own
// headline rate of return, which uses a baseline and a method we don't have.
let portfolioSummary = null;

async function loadPortfolio() {
  // Absent on the static snapshot, where the assembler embeds it instead.
  if (typeof EMBEDDED_PORTFOLIO !== 'undefined') return EMBEDDED_PORTFOLIO;
  const res = await fetch('/api/portfolio');
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

function fmtMoney(v) {
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
// Whole dollars, for places where cents are noise — the held-vs-plan gaps are
// hundreds of dollars wide and three figures share one row there.
function fmtMoney0(v) {
  return `$${Math.round(v).toLocaleString('en-US')}`;
}
function fmtMoneySigned(v) {
  return `${v >= 0 ? '+' : '−'}${fmtMoney(Math.abs(v))}`;
}
function fmtLongDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', CAL_DATE_OPTS);
}

let portfolioWindow = 'ALL';

// The balance series over the selected window, as the shared chart's
// [{date, value}] shape. Gaps in the record are simply absent points — the
// line joins across them rather than pretending there was no movement.
function portfolioPoints() {
  if (!portfolioSummary || !Array.isArray(portfolioSummary.series)) return [];
  const win = PORTFOLIO_WINDOWS.find((w) => w.key === portfolioWindow) || PORTFOLIO_WINDOWS[0];
  const rows = portfolioSummary.series;
  const cutoff = win.days === null ? null : daysAgoToDateStr(win.days);
  const out = [];
  for (const [date, balance] of rows) {
    if (cutoff && date < cutoff) continue;
    out.push({ date, value: balance });
  }
  return out;
}

function renderPortfolioChart() {
  const wrap = document.getElementById('portfolio-chart-wrap');
  if (!wrap) return;
  const points = portfolioPoints();
  if (points.length < 2) {
    wrap.innerHTML = '<div class="chart-error">Not enough recorded balances for this window.</div>';
    const axis = document.getElementById('portfolio-chart-axis');
    if (axis) axis.innerHTML = '';
    return;
  }
  drawLineChart({
    wrap,
    axisEl: document.getElementById('portfolio-chart-axis'),
    points,
    gradId: 'portfolio-grad',
    label: `Portfolio balance, ${portfolioWindow}`,
    fmtAxis: (v) => `$${Math.round(v).toLocaleString('en-US')}`,
    // The balance itself, not a percentage: this is the one chart in the app
    // about actual dollars, and the axis already carries the round numbers.
    tooltipFor: (c) => ({ text: fmtMoney(c.value), cls: '' }),
  });
}

function renderPortfolioCard() {
  const card = document.getElementById('portfolio-card');
  if (!card) return;
  const p = portfolioSummary;
  if (!p) {
    card.hidden = true;
    return;
  }
  const dir = p.totalReturnPct >= 0 ? 'gain' : 'loss';
  const rows = [
    statRow('Annualized return', fmtPct(p.annualizedReturnPct), signClass(p.annualizedReturnPct)),
    statRow('Volatility', p.annualizedVolPct === null ? 'N/A' : `${p.annualizedVolPct.toFixed(1)}% annualized`),
  ];
  // Neutral, unsigned, two decimals: beta is a sensitivity, not a gain or a
  // loss, so it gets none of the green/red the rows around it use. Absent
  // whenever the server couldn't pair enough sessions to mean anything — see
  // computeBeta() in src/portfolio.js.
  if (typeof p.betaVsSpy === 'number') {
    rows.push(statRow('Beta vs SPY', p.betaVsSpy.toFixed(2)));
  }
  if (p.exposureScale) {
    // Straight arithmetic, not a recommendation: target ÷ realized.
    rows.push(statRow(`${p.targetVolPct}% vol target`, `${p.exposureScale.toFixed(2)}× exposure`));
  }
  if (p.best !== null && p.worst !== null) {
    rows.push(statRow('Best / worst day',
      `<span class="gain">${fmtPct(p.best)}</span> / <span class="loss">${fmtPct(p.worst)}</span>`));
  }
  rows.push(statRow('Sessions recorded', `${p.sessions}`));

  const skipped = p.skippedSteps
    ? ` ${p.skippedSteps} step${p.skippedSteps === 1 ? '' : 's'} spanning a gap in the record ${p.skippedSteps === 1 ? 'is' : 'are'} left out of the volatility figure.`
    : '';

  const pills = PORTFOLIO_WINDOWS.map((w) => `
    <button type="button" class="window-pill" data-portfolio-window="${w.key}"
      aria-pressed="${w.key === portfolioWindow}">${w.label}</button>`).join('');

  card.innerHTML = `
    <div class="portfolio-label">Your portfolio</div>
    <div class="portfolio-balance">${fmtMoney(p.endBalance)}</div>
    <div class="portfolio-change">
      <span class="${dir}">${fmtPct(p.totalReturnPct)}</span>
      <span class="delta">${fmtMoneySigned(p.changeDollars)}</span>
      <span class="since">since ${fmtLongDate(p.start)}</span>
    </div>
    <div class="portfolio-windows" role="group" aria-label="Chart window">${pills}</div>
    <div class="portfolio-chart">
      <div class="chart-wrap" id="portfolio-chart-wrap"></div>
      <div class="chart-axis-x" id="portfolio-chart-axis"></div>
    </div>
    ${rows.join('')}
    <p class="portfolio-note">Computed from ${p.sessions} recorded daily balances through ${fmtLongDate(p.end)}, not from the broker's own figure.${skipped}</p>`;
  card.hidden = false;
  renderProjectionCard();

  card.querySelectorAll('[data-portfolio-window]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (portfolioWindow === btn.dataset.portfolioWindow) return;
      portfolioWindow = btn.dataset.portfolioWindow;
      renderPortfolioCard();
    });
  });
  // After the card is in the DOM: the chart measures its wrapper in pixels.
  renderPortfolioChart();
}

// ── projection: a log-regression channel over the balance ────────────
// The most standard "where is this heading" chart in portfolio analysis: fit
// a straight line to the *logarithm* of the balance (constant compounding is
// a straight line in log space), draw the band the series actually wobbles in
// around that line, and extend both three months forward. It is arithmetic on
// the recorded balances — "if the trend and the wobble stay what they were" —
// not a forecast of anything else, and the card says so.
const PROJECTION_FORWARD_SESSIONS = 63; // ~3 months of trading days

function fitLogChannel(series) {
  if (!series || series.length < 40) return null; // under ~2 months the "trend" is noise
  const n = series.length;
  const ys = series.map(([, b]) => Math.log(b));
  const xm = (n - 1) / 2;
  const ym = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (i - xm) * (ys[i] - ym); sxx += (i - xm) ** 2; }
  const slope = sxy / sxx;
  const intercept = ym - slope * xm;
  const residuals = ys.map((y, i) => y - (intercept + slope * i));
  const sigma = Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / (n - 2));
  return { slope, intercept, sigma, n };
}

// The next k trading-day dates after dateStr — weekends skipped, holidays
// ignored on purpose (they'd shift a chart label by a day, nothing more).
function futureSessions(dateStr, k) {
  const out = [];
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  while (out.length < k) {
    dt.setUTCDate(dt.getUTCDate() + 1);
    const day = dt.getUTCDay();
    if (day === 0 || day === 6) continue;
    out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}

// Its own renderer, deliberately not a call of drawLineChart: this is a
// channel chart (shaded band + solid history + dashed projection + a today
// divider), not a line chart, and bolting four overlay options onto the one
// shared renderer would cost every other chart clarity to save this one a
// function. Geometry conventions match drawLineChart's.
function drawProjectionChart(wrap, series, fit) {
  const w = wrap.clientWidth || 345;
  const h = wrap.clientHeight || 150;
  const total = fit.n + PROJECTION_FORWARD_SESSIONS;
  const line = (i, k) => fit.intercept + fit.slope * i + k * fit.sigma;

  let min = Infinity;
  let max = -Infinity;
  for (const [, b] of series) { min = Math.min(min, Math.log(b)); max = Math.max(max, Math.log(b)); }
  for (const i of [0, fit.n - 1, total - 1]) {
    min = Math.min(min, line(i, -2));
    max = Math.max(max, line(i, 2));
  }
  const pad = (max - min) * 0.05 || 0.01;
  min -= pad; max += pad;

  const X = (i) => (i / (total - 1)) * w;
  const Y = (v) => h - ((v - min) / (max - min)) * h;
  const channel = (k) => `${X(0)},${Y(line(0, k))} ${X(total - 1)},${Y(line(total - 1, k))}`;

  const history = series.map(([, b], i) => `${X(i).toFixed(1)},${Y(Math.log(b)).toFixed(1)}`).join(' ');
  const todayX = X(fit.n - 1).toFixed(1);

  wrap.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
      <polygon class="proj-band outer" points="${channel(2)} ${channel(-2).split(' ').reverse().join(' ')}"></polygon>
      <polygon class="proj-band inner" points="${channel(1)} ${channel(-1).split(' ').reverse().join(' ')}"></polygon>
      <line class="proj-mid" x1="${X(0)}" y1="${Y(line(0, 0))}" x2="${X(total - 1)}" y2="${Y(line(total - 1, 0))}"></line>
      <line class="proj-today" x1="${todayX}" y1="0" x2="${todayX}" y2="${h}"></line>
      <polyline class="proj-history" points="${history}"></polyline>
    </svg>`;
}

function renderProjectionCard() {
  const card = document.getElementById('projection-card');
  if (!card) return;
  const p = portfolioSummary;
  const fit = p && Array.isArray(p.series) ? fitLogChannel(p.series) : null;
  if (!fit) {
    card.hidden = true;
    return;
  }

  const trendAnnualPct = (Math.exp(fit.slope * TRADING_DAYS_PER_YEAR) - 1) * 100;
  const endI = fit.n - 1 + PROJECTION_FORWARD_SESSIONS;
  const mid = Math.exp(fit.intercept + fit.slope * endI);
  const lo = Math.exp(fit.intercept + fit.slope * endI - fit.sigma);
  const hi = Math.exp(fit.intercept + fit.slope * endI + fit.sigma);
  const endDate = futureSessions(p.end, PROJECTION_FORWARD_SESSIONS)[PROJECTION_FORWARD_SESSIONS - 1];

  card.innerHTML = `
    <div class="portfolio-label">Projection</div>
    <div class="proj-chart" id="projection-wrap"></div>
    <div class="proj-axis">
      <span>${fmtLongDate(p.start)}</span>
      <span>today</span>
      <span>${fmtLongDate(endDate)}</span>
    </div>
    ${statRow('Trend', `${trendAnnualPct >= 0 ? '+' : ''}${trendAnnualPct.toFixed(1)}%/yr`, signClass(trendAnnualPct))}
    ${statRow(`On trend by ${fmtLongDate(endDate)}`, fmtMoney(mid))}
    ${statRow('Usual wobble around it', `${fmtMoney(lo)} – ${fmtMoney(hi)}`)}
    <p class="portfolio-note">A straight line fitted to your balance's compounding path, with the band it
    has actually wandered in (darker: typical, lighter: rare), extended three months. Pure arithmetic on the
    recorded balances — it assumes the trend and the wobble stay what they were, which no market promises.</p>`;
  card.hidden = false;
  drawProjectionChart(document.getElementById('projection-wrap'), p.series, fit);
}

// ── watchlist insights: sectors, a weighted plan, held vs plan ───────
// All three cards compute client-side from history the app already has
// (historyCache via loadAllHistories), which is what lets the static snapshot
// show them with no backend — the same reason the ranking fallback exists.

// Aligned daily returns for the held names: inner join on date over the
// trailing ~1Y, so every column of the covariance matrix describes the same
// sessions. Names without enough shared history are dropped and named.
const PLAN_WINDOW_SESSIONS = 250;
const PLAN_MIN_SESSIONS = 60;

function alignedReturnsFor(symbols) {
  const maps = symbols.map((s) => {
    const ser = (historyCache.get(s) || {}).series || [];
    return new Map(ser.slice(-(PLAN_WINDOW_SESSIONS + 1)).map((pt) => [pt.date, pt.close]));
  });
  const usable = [];
  const dropped = [];
  symbols.forEach((sym, i) => {
    if (maps[i].size >= PLAN_MIN_SESSIONS + 1) usable.push({ sym, map: maps[i] });
    else dropped.push(sym);
  });
  if (usable.length === 0) return { symbols: [], returns: [], dropped };
  let dates = [...usable[0].map.keys()];
  for (const u of usable) dates = dates.filter((d) => u.map.has(d));
  dates.sort();
  const returns = usable.map(() => []);
  for (let i = 1; i < dates.length; i++) {
    usable.forEach((u, k) => {
      returns[k].push(u.map.get(dates[i]) / u.map.get(dates[i - 1]) - 1);
    });
  }
  if (dates.length - 1 < PLAN_MIN_SESSIONS) {
    return { symbols: [], returns: [], dropped: symbols.slice() };
  }
  return { symbols: usable.map((u) => u.sym), returns, dropped };
}

function covarianceMatrix(returns) {
  const n = returns.length;
  const m = returns[0].length;
  const means = returns.map((r) => r.reduce((a, b) => a + b, 0) / m);
  const cov = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let sum = 0;
      for (let k = 0; k < m; k++) sum += (returns[i][k] - means[i]) * (returns[j][k] - means[j]);
      cov[i][j] = sum / (m - 1);
      cov[j][i] = cov[i][j];
    }
  }
  return cov;
}

// Hierarchical risk parity (López de Prado), with average linkage — more
// stable orderings than the original single linkage, which chains: one
// borderline pair can drag two unrelated clusters together.
//
// Three steps: cluster the names by how they move together, order them so
// neighbours are similar (the merge order gives this), then split the list in
// half repeatedly, giving each half budget in inverse proportion to its risk.
// No expected returns anywhere — it only asks "what moves with what, and how
// much", which is why it's the standard answer for weighting a list of picks
// you already believe in.
function hrpWeights(cov) {
  const n = cov.length;
  if (n === 1) return [1];
  const corr = cov.map((row, i) => row.map((v, j) => v / Math.sqrt(cov[i][i] * cov[j][j])));
  const dist = corr.map((row) => row.map((r) => Math.sqrt(Math.max(0, (1 - r) / 2))));

  // Average-linkage agglomeration; each cluster keeps its items in merge
  // order, and the final cluster's order is the quasi-diagonal seriation.
  let clusters = Array.from({ length: n }, (_, i) => [i]);
  const linkage = (a, b) => {
    let sum = 0;
    for (const i of a) for (const j of b) sum += dist[i][j];
    return sum / (a.length * b.length);
  };
  while (clusters.length > 1) {
    let bi = 0;
    let bj = 1;
    let best = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = linkage(clusters[i], clusters[j]);
        if (d < best) { best = d; bi = i; bj = j; }
      }
    }
    const merged = clusters[bi].concat(clusters[bj]);
    clusters = clusters.filter((_, k) => k !== bi && k !== bj);
    clusters.push(merged);
  }
  const order = clusters[0];

  // Recursive bisection over the ordered list. Within a cluster, risk is the
  // variance of its inverse-variance-weighted mix — the cheapest defensible
  // stand-in for "how risky is this half as a unit".
  const clusterVar = (idxs) => {
    const ivp = idxs.map((i) => 1 / cov[i][i]);
    const tot = ivp.reduce((a, b) => a + b, 0);
    const w = ivp.map((v) => v / tot);
    let v = 0;
    for (let a = 0; a < idxs.length; a++) {
      for (let b = 0; b < idxs.length; b++) v += w[a] * w[b] * cov[idxs[a]][idxs[b]];
    }
    return v;
  };
  const weights = new Array(n).fill(1);
  const stack = [order];
  while (stack.length) {
    const idxs = stack.pop();
    if (idxs.length < 2) continue;
    const half = Math.floor(idxs.length / 2);
    const left = idxs.slice(0, half);
    const right = idxs.slice(half);
    const vl = clusterVar(left);
    const vr = clusterVar(right);
    const alpha = 1 - vl / (vl + vr);
    for (const i of left) weights[i] *= alpha;
    for (const i of right) weights[i] *= 1 - alpha;
    stack.push(left, right);
  }
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / total);
}

function portfolioVolAnnualPct(weights, cov) {
  let v = 0;
  for (let i = 0; i < weights.length; i++) {
    for (let j = 0; j < weights.length; j++) v += weights[i] * weights[j] * cov[i][j];
  }
  return Math.sqrt(v * TRADING_DAYS_PER_YEAR) * 100;
}

const PLAN_TARGET_VOL_PCT = 15; // the owner's stated target, same as the portfolio card's

// %/$ is a per-visit choice, like the chart windows — not worth persisting.
let planShowDollars = false;
// The computed plan, kept so the toggle can re-render without recomputing,
// and keyed by the held set so a watchlist edit recomputes.
let planCache = null;

function sectorCounts(companies) {
  const counts = new Map();
  for (const c of companies) {
    const key = c.sector || 'Other';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function renderSectorCard(companies) {
  const el = document.getElementById('watchlist-sectors');
  if (!el) return;
  if (companies.length === 0) { el.hidden = true; return; }
  const counts = sectorCounts(companies);
  const max = counts[0][1];
  const bars = counts.map(([sector, n]) => {
    const v = SECTOR_VAR[sector] || '--sector-default';
    return `
      <div class="sector-bar-row">
        <span class="sector-bar-label"><span class="dot" style="background: var(${v})"></span>${SECTOR_SHORT[sector] || sector}</span>
        <span class="sector-bar-track"><span class="sector-bar-fill" style="width: ${(n / max) * 100}%; background: var(${v})"></span></span>
        <span class="sector-bar-count">${n}</span>
      </div>`;
  }).join('');
  el.innerHTML = `
    <div class="portfolio-label">Sectors</div>
    ${bars}
    <p class="portfolio-note">${counts.length} sector${counts.length === 1 ? '' : 's'} across ${companies.length} saved name${companies.length === 1 ? '' : 's'}.</p>`;
  el.hidden = false;
}

async function computePlan(companies) {
  const held = companies.map((c) => c.symbol);
  await loadAllHistories(held);
  const { symbols, returns, dropped } = alignedReturnsFor(held);
  if (symbols.length === 0) return { key: held.join(','), symbols: [], dropped };
  if (symbols.length === 1) {
    return { key: held.join(','), symbols, weights: [1], volPct: null, scale: null, dropped };
  }
  const cov = covarianceMatrix(returns);
  const weights = hrpWeights(cov);
  const volPct = portfolioVolAnnualPct(weights, cov);
  const scale = volPct > 0 ? PLAN_TARGET_VOL_PCT / volPct : null;
  return { key: held.join(','), symbols, weights, volPct, scale, dropped };
}

function renderPlanCard(plan) {
  const el = document.getElementById('watchlist-plan');
  if (!el) return;
  if (!plan || plan.symbols.length === 0) {
    if (plan && plan.dropped && plan.dropped.length) {
      el.innerHTML = `<div class="portfolio-label">Suggested weights</div>
        <p class="portfolio-note">Not enough shared price history yet to weight these names.</p>`;
      el.hidden = false;
    } else {
      el.hidden = true;
    }
    return;
  }

  const balance = portfolioSummary ? portfolioSummary.endBalance : null;
  const canDollars = balance !== null && plan.scale !== null;
  if (!canDollars) planShowDollars = false;

  const ranked = plan.symbols
    .map((sym, i) => ({ sym, w: plan.weights[i] }))
    .sort((a, b) => b.w - a.w);
  const maxW = ranked[0].w;

  const rows = ranked.map(({ sym, w }) => {
    const value = planShowDollars
      ? fmtMoney(balance * plan.scale * w)
      : `${(w * 100).toFixed(1)}%`;
    return `
      <div class="sector-bar-row">
        <span class="sector-bar-label plan-sym">${sym}</span>
        <span class="sector-bar-track"><span class="sector-bar-fill plan-fill" style="width: ${(w / maxW) * 100}%"></span></span>
        <span class="sector-bar-count plan-amt">${value}</span>
      </div>`;
  }).join('');

  const toggle = canDollars ? `
    <div class="plan-toggle" role="group" aria-label="Show weights as">
      <button type="button" class="window-pill" data-plan-mode="pct" aria-pressed="${!planShowDollars}">%</button>
      <button type="button" class="window-pill" data-plan-mode="usd" aria-pressed="${planShowDollars}">$</button>
    </div>` : '';

  const volLine = plan.volPct === null ? '' : statRow('This mix, left alone', `${plan.volPct.toFixed(1)}% volatility`);
  const scaleLine = plan.scale === null ? '' : statRow(`Scaled to ${PLAN_TARGET_VOL_PCT}%`, `${plan.scale.toFixed(2)}× exposure`);
  const dollarsLine = planShowDollars
    ? statRow('Dollars total', fmtMoney(balance * plan.scale), 'muted')
    : '';
  const droppedNote = plan.dropped.length
    ? ` ${plan.dropped.join(', ')} ${plan.dropped.length === 1 ? 'is' : 'are'} left out — not enough shared history yet.`
    : '';

  el.innerHTML = `
    <div class="portfolio-label">Suggested weights</div>
    ${toggle}
    ${rows}
    ${volLine}
    ${scaleLine}
    ${dollarsLine}
    <p class="portfolio-note">Sized by hierarchical risk parity: names are grouped by how they move
    together, and each group gets budget in inverse proportion to its risk — so one crowded trade can't
    dominate. ${planShowDollars ? `Dollar figures are your last recorded balance times the ${PLAN_TARGET_VOL_PCT}% target scaling, so they can add to more than the balance — that is the leverage the target implies.` : ''}${droppedNote}
    Arithmetic on the last year of daily moves, not advice.</p>`;
  el.hidden = false;

  el.querySelectorAll('[data-plan-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const wantDollars = btn.dataset.planMode === 'usd';
      if (wantDollars === planShowDollars) return;
      planShowDollars = wantDollars;
      renderPlanCard(planCache);
      renderHeldCard(planCache);
    });
  });
}

// Held vs plan: only as good as the holdings record (see
// data/portfolio/holdings.csv) — until one exists, the card says how to start
// rather than pretending.
//
// The comparison is in *dollars*, deliberately, and the obvious alternative is
// a trap worth naming. Comparing a held share of the account against a plan
// weight puts two different denominators either side of the "vs": a plan weight
// is a share of the plan's own names, a held share is of everything in the
// account. With 23 positions against a 10-name plan those aren't comparable,
// and the mismatch reads as agreement exactly when it shouldn't — UNH at 3.2%
// of the account against a 4.1% plan weight scored "on target" while sitting
// $346 below its actual target. Plan dollars are what the card above already
// shows, so the two now agree by construction.
//
// "On track" is within 10% of a name's target rather than a fixed dollar band,
// so the tolerance scales with the position instead of swallowing the small
// ones whole.
const HELD_TOLERANCE_FRAC = 0.1;

function renderHeldCard(plan) {
  const el = document.getElementById('watchlist-held');
  if (!el) return;
  const holdings = portfolioSummary && portfolioSummary.holdings;
  if (!holdings || !holdings.positions || holdings.positions.length === 0) {
    if (!plan || plan.symbols.length === 0) { el.hidden = true; return; }
    el.innerHTML = `
      <div class="portfolio-label">Held vs plan</div>
      <p class="portfolio-note">Nothing recorded yet. Send the brokerage's positions screen (each holding and
      its dollar value) and this card will show where the account sits against the plan above — overweight,
      underweight, missing, or extra.</p>`;
    el.hidden = false;
    return;
  }

  const accountTotal = holdings.positions.reduce((a, h) => a + h.dollars, 0);
  if (!(accountTotal > 0) || !plan || plan.symbols.length === 0) { el.hidden = true; return; }

  const balance = portfolioSummary.endBalance;
  const canDollars = balance !== null && plan.scale !== null;
  const heldBySym = new Map(holdings.positions.map((h) => [h.symbol, h.dollars]));
  const planSet = new Set(plan.symbols);
  const heldInPlan = plan.symbols.reduce((a, s) => a + (heldBySym.get(s) || 0), 0);

  // Targets in the same dollars the plan card shows. Without a balance or a vol
  // scaling there is nothing to price against, so the card prices the same
  // weights off what's already in those names — a narrower denominator, but
  // still one denominator on both sides of the comparison.
  const pool = canDollars ? balance * plan.scale : heldInPlan;
  const ranked = plan.symbols
    .map((sym, i) => ({ sym, target: pool * plan.weights[i], held: heldBySym.get(sym) || 0 }))
    .sort((a, b) => b.target - a.target);

  // Sorted by target, biggest first: the largest gap is the most actionable row
  // and belongs at the top. It's also why a "not held" row is at full strength
  // rather than muted — a name missing against an $8,543 target is the loudest
  // fact on the card, not a footnote.
  //
  // Colour marks the *good* state, not the gap. Painting every gap red made the
  // card a wall of red the moment the account drifted from the plan, which is
  // its normal condition — ten identical red rows discriminate nothing. It also
  // spent the loss colour on something that isn't a loss (same reasoning as the
  // flag palette: a gap is a fact, not a verdict). Being on track is the rare
  // state worth catching the eye, and the words carry the rest.
  const rows = ranked.map(({ sym, target, held }) => {
    const gap = held - target;
    let verdict;
    let cls = '';
    if (held === 0) verdict = 'not held';
    else if (Math.abs(gap) <= target * HELD_TOLERANCE_FRAC) { verdict = 'on track'; cls = 'gain'; }
    else verdict = `${fmtMoney0(Math.abs(gap))} ${gap > 0 ? 'over' : 'light'}`;
    return statRow(sym, `${fmtMoney0(held)} vs ${fmtMoney0(target)} — ${verdict}`, cls);
  });

  const dropped = new Set(plan.dropped || []);
  const extras = holdings.positions
    .filter((h) => !planSet.has(h.symbol))
    .sort((a, b) => b.dollars - a.dollars);
  for (const h of extras) {
    // A saved name the plan couldn't score is not the same as one that was
    // never saved, and saying so beats implying the watchlist forgot it.
    const why = dropped.has(h.symbol) ? 'not enough history to score' : 'not on the watchlist';
    rows.push(statRow(h.symbol, `${fmtMoney0(h.dollars)} held — ${why}`, 'muted'));
  }

  const planTotal = ranked.reduce((a, r) => a + r.target, 0);
  const elsewhere = accountTotal - heldInPlan;
  const context = canDollars
    ? `The plan covers ${plan.symbols.length} name${plan.symbols.length === 1 ? '' : 's'} worth
       ${fmtMoney0(planTotal)} at the ${PLAN_TARGET_VOL_PCT}% target; you hold ${fmtMoney0(heldInPlan)} of those,
       with ${fmtMoney0(elsewhere)} in ${extras.length} other name${extras.length === 1 ? '' : 's'}.`
    : `No balance to price the plan against, so targets here split the ${fmtMoney0(heldInPlan)} already in these
       names by the suggested weights.`;

  el.innerHTML = `
    <div class="portfolio-label">Held vs plan</div>
    ${rows.join('')}
    <p class="portfolio-note">Holdings as recorded ${fmtLongDate(holdings.asOf)}, against the dollar targets
    above. ${context} Within ${Math.round(HELD_TOLERANCE_FRAC * 100)}% of a target counts as on track.</p>`;
  el.hidden = false;
}

// One request-sequence guard for the whole insights strip, same pattern as
// refreshCorrelations — a stale async compute must never paint over a newer
// watchlist.
let planRequestSeq = 0;
async function renderWatchlistInsights(companies) {
  renderSectorCard(companies);
  const planEl = document.getElementById('watchlist-plan');
  const heldEl = document.getElementById('watchlist-held');
  if (companies.length === 0) {
    if (planEl) planEl.hidden = true;
    if (heldEl) heldEl.hidden = true;
    planCache = null;
    return;
  }
  const key = companies.map((c) => c.symbol).join(',');
  if (planCache && planCache.key === key) {
    renderPlanCard(planCache);
    renderHeldCard(planCache);
    return;
  }
  if (planEl && planEl.hidden) {
    planEl.innerHTML = '<div class="portfolio-label">Suggested weights</div><p class="portfolio-note">Working it out…</p>';
    planEl.hidden = false;
  }
  const seq = ++planRequestSeq;
  try {
    const plan = await computePlan(companies);
    if (seq !== planRequestSeq) return;
    planCache = plan;
    renderPlanCard(plan);
    renderHeldCard(plan);
  } catch {
    if (seq !== planRequestSeq) return;
    if (planEl) {
      planEl.innerHTML = '<div class="portfolio-label">Suggested weights</div><p class="portfolio-note">Couldn\'t work these out just now.</p>';
      planEl.hidden = false;
    }
  }
}

// ── add the next ranked name ─────────────────────────────────────────
// "Next" means the highest-scoring company on the Ranks board that isn't
// already held and isn't blocked by the diversification filter — so the
// ranking window and the correlation threshold in Settings both decide what
// gets added, exactly as they decide what the board shows.
//
// They decide it once, at the moment of the tap. Changing either setting
// afterwards re-sorts and re-fades the board but never touches the watchlist:
// a saved name leaves only by its own check or by Clear watchlist.
function nextRankedCandidate() {
  if (!state.leaderboard || !state.rankingsLoaded) return null;
  const scored = state.leaderboard.companies
    .map((c) => ({ c, value: scoreFor(c) }))
    // Unscored names aren't on the ranked list at all under this window, so
    // "the next one down" can't reach them.
    .filter((x) => x.value !== null)
    .sort((a, b) => b.value - a.value);
  for (const { c } of scored) {
    if (state.watchlist.has(c.symbol)) continue;
    if (correlationBlock(c)) continue;
    return c;
  }
  return null;
}

let addNextFlashTimer = null;
function flashAddNext(text) {
  const btn = document.getElementById('add-next');
  if (!btn) return;
  if (addNextFlashTimer) clearTimeout(addNextFlashTimer);
  btn.classList.add('is-spent');
  btn.textContent = text;
  addNextFlashTimer = setTimeout(() => {
    addNextFlashTimer = null;
    btn.classList.remove('is-spent');
    btn.textContent = 'Add next ranked';
  }, 2200);
}

async function addNextRanked() {
  const company = nextRankedCandidate();
  if (!company) {
    // Everything above the correlation threshold is either held already or
    // too close to something held — worth saying, since the alternative is a
    // tap that appears to do nothing.
    flashAddNext('Nothing left to add');
    return;
  }
  state.watchlist.add(company.symbol);
  lastToggledSymbol = company.symbol;
  saveWatchlist();
  updateWatchlistBadge(true);
  renderAll();
  lastToggledSymbol = null;
  // The held set changed, so every other name's correlation against it did
  // too — including what the *next* tap would be allowed to add.
  await refreshCorrelations();
  renderAll();
}

function initWatchlistActions() {
  const btn = document.getElementById('add-next');
  if (btn) btn.addEventListener('click', addNextRanked);
}

function renderWatchlistBoard() {
  const label = document.getElementById('watchlist-score-label');
  const head = document.getElementById('watchlist-board-head');
  const actions = document.getElementById('watchlist-actions');
  const rowsEl = document.getElementById('watchlist-rows');
  const companies = state.leaderboard.companies.filter((c) => state.watchlist.has(c.symbol));

  renderWatchlistInsights(companies);
  if (companies.length === 0) {
    label.hidden = true;
    head.hidden = true;
    actions.hidden = true;
    resetClearWatchlist();
    rowsEl.innerHTML = `
      <div class="empty-state">
        <button type="button" class="empty-state-glyph" id="add-next-empty" aria-label="Add the top-ranked company">
          <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="${PLUS_PATH}"/></svg>
        </button>
        <p>Your watchlist is empty. Tap the plus to add the top-ranked company, or pick your own from Ranks.</p>
      </div>`;
    // Rebuilt with the empty state, so it's wired here rather than once at
    // boot. Disabled until there are scores to rank by — a plus that silently
    // does nothing is worse than one that's visibly not ready.
    const addBtn = document.getElementById('add-next-empty');
    if (addBtn) {
      addBtn.disabled = !state.rankingsLoaded;
      addBtn.addEventListener('click', addNextRanked);
    }
    return;
  }

  label.hidden = false;
  head.hidden = false;
  actions.hidden = false;
  fillBoard(rowsEl, companies.map((c) => ({ c, value: scoreFor(c) })));
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
  // The Flags section shows a live match count, which reads "counting…" until
  // the board exists — renderSettings() runs well before that, so refresh it
  // here rather than leaving it stale on the one screen that explains flags.
  renderFlagSettings();
}

// ── detail sheet (tap a row to see its chart) ────────────────────────
function findCompany(symbol) {
  return state.leaderboard.companies.find((c) => c.symbol === symbol) || null;
}

// Everything inside the sheet for one company. Split out from openDetail so a
// sideways swipe can swap companies without re-running the open animation.
function renderDetailContent(company) {
  const sectorVar = SECTOR_VAR[company.sector] || '--sector-default';
  // Build the node and set the id on it, rather than patching `class="logo"` in
  // the markup string: the white-on-transparent marks render as
  // `class="logo on-dark"`, so that substring didn't match and the id was
  // silently dropped — after which the *next* render found no #detail-logo,
  // threw, and left the sheet half-rendered and stuck mid-swipe.
  const logoSlot = document.getElementById('detail-logo');
  if (logoSlot) {
    const holder = document.createElement('div');
    holder.innerHTML = logoAvatar(company, sectorVar);
    const next = holder.firstElementChild;
    next.id = 'detail-logo';
    logoSlot.replaceWith(next);
  }
  pruneBrokenLogos(document.querySelector('.detail-header'));
  document.getElementById('detail-ticker').textContent = company.symbol;
  // Full legal name here, unlike the rows, which trim the corporate suffix.
  document.getElementById('detail-name').textContent = company.name;
  document.getElementById('detail-sector').textContent = company.sector || 'Uncategorized';
  document.getElementById('detail-price').textContent = fmtPrice(company.price);
  renderDetailReturn(company);
  renderDetailFacts(company);
  renderDetailSegmented();
  // No-ops unless the full-screen view is open; swiping between companies
  // there has to refill the blocks too.
  renderDetailExtras(company);

  // Usually replaced near-instantly (history is prefetched at boot), but shows
  // for real when a symbol missed the batch prefetch and needs its own fetch —
  // also clears out the previously-open company's chart immediately instead of
  // leaving it on screen for a frame.
  const wrap = document.getElementById('chart-wrap');
  wrap.innerHTML = chartSkeletonHTML();
  const opened = company.symbol;
  loadHistoryFor(opened).then(() => {
    // A fast swipe can land a stale fetch after the next company is showing.
    if (detail.symbol !== opened) return;
    renderChart();
    // The range block reads the same history, and on a cold open it was
    // rendered before this resolved.
    renderDetailExtras(company);
  }).catch((err) => {
    if (detail.symbol !== opened) return;
    wrap.innerHTML = `<div class="chart-error">Couldn't load chart: ${err.message}</div>`;
  });
}

// `sequence` is the ordered symbols of the board the row was tapped in, so a
// swipe walks the list exactly as it appears on screen — ranked order from
// Ranks, saved order from Watchlist.
function openDetail(symbol, sequence) {
  const company = findCompany(symbol);
  if (!company) return;

  detail.symbol = symbol;
  detail.range = DEFAULT_CHART_RANGE;
  detail.sequence = sequence && sequence.length ? sequence : [symbol];
  detail.index = Math.max(0, detail.sequence.indexOf(symbol));

  // Opening is the reset point for the swipe's inline transform. Without this a
  // gesture that ended badly — a finger lifted outside the sheet, a render that
  // threw mid-page — left the content translated off-screen and transparent,
  // and every later open inherited it: the sheet was "open" but showed nothing.
  const scroll = document.querySelector('.sheet-scroll');
  if (scroll) {
    scroll.style.transition = 'none';
    scroll.style.transform = '';
    scroll.style.opacity = '';
    void scroll.offsetWidth; // flush, so restoring the transition doesn't animate the reset
    scroll.style.transition = '';
    scroll.scrollTop = 0;
    scroll.style.setProperty('--detent-inset', '0px');
  }
  // Same for the sheet itself, which the drag gesture moves. Every open starts
  // at the full detent — a sheet that reopened half-height because that's where
  // it was left last time would read as a bug, not a memory.
  detail.detentOffset = 0;
  const sheetEl = document.getElementById('detail-sheet');
  sheetEl.classList.remove('dragging');
  sheetEl.style.transition = '';
  sheetEl.style.transform = '';
  document.getElementById('sheet-backdrop').style.opacity = '';
  // Every open starts as the card, never full screen — same reasoning as the
  // detent above.
  setDetailExpanded(false);

  // Last gap where a render error could still surface as an open-but-blank
  // sheet: showDetailAt catches its own, but this path had none.
  try {
    renderDetailContent(company);
  } catch (err) {
    console.error('Failed to render detail for', symbol, err);
    return;
  }

  document.getElementById('sheet-backdrop').hidden = false;
  document.getElementById('detail-sheet').hidden = false;
  requestAnimationFrame(() => {
    document.getElementById('sheet-backdrop').classList.add('open');
    document.getElementById('detail-sheet').classList.add('open');
    // The segmented thumb needs real layout numbers, which don't exist until
    // the sheet stops being display:none — and it should be in place before
    // the sheet slides in, not slide sideways afterwards.
    positionSegmentedThumb('detail', true);
  });
}

// Swap to another company in the open sheet, keeping the selected chart range so
// the same window carries across names — the point of swiping is comparison.
function showDetailAt(index) {
  if (!detail.sequence) return false;
  if (index < 0 || index >= detail.sequence.length) return false;
  const company = findCompany(detail.sequence[index]);
  if (!company) return false;
  detail.symbol = company.symbol;
  detail.index = index;
  try {
    renderDetailContent(company);
  } catch (err) {
    // A render that throws must not take the sheet with it. Reporting false
    // sends the caller down its "couldn't page" path, which springs the swipe
    // back to centre instead of leaving the content parked off-screen.
    console.error('Failed to render detail for', company.symbol, err);
    return false;
  }
  positionSegmentedThumb('detail', true);
  const scroll = document.querySelector('.sheet-scroll');
  if (scroll) scroll.scrollTop = 0;
  return true;
}

// ── clear watchlist ──────────────────────────────────────────────────
// Two taps, because one tap would throw away saved state with no undo. The
// armed state reverts on its own so a stray first tap can't leave a live
// destructive button sitting there.
const CLEAR_ARM_MS = 4000;
let clearArmedTimer = null;

function resetClearWatchlist() {
  const btn = document.getElementById('clear-watchlist');
  if (!btn) return;
  if (clearArmedTimer) { clearTimeout(clearArmedTimer); clearArmedTimer = null; }
  btn.classList.remove('armed');
  btn.textContent = 'Clear watchlist';
}

function initClearWatchlist() {
  const btn = document.getElementById('clear-watchlist');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const count = state.watchlist.size;
    if (count === 0) return;

    if (!btn.classList.contains('armed')) {
      btn.classList.add('armed');
      btn.textContent = `Tap again to remove ${count}`;
      clearArmedTimer = setTimeout(resetClearWatchlist, CLEAR_ARM_MS);
      return;
    }

    resetClearWatchlist();
    state.watchlist.clear();
    saveWatchlist();
    updateWatchlistBadge();
    // Nothing is held any more, so nothing should still be faded as a
    // correlate of it.
    await refreshCorrelations();
    renderAll();
    // Stays on this tab rather than bouncing to Ranks — the empty state already
    // says where to go, and navigating for the user is a surprise.
  });
}

// ── swipe between companies ──────────────────────────────────────────
// Horizontal drag on the sheet pages to the next/previous name in the board's
// order. Gestures starting on the chart or the range control are left alone —
// both are horizontal by nature (scrub, and a row of pills) and would otherwise
// fight this. Vertical scrolling stays native via touch-action: pan-y.
const SWIPE_COMMIT_PX = 56;
const SWIPE_AXIS_LOCK_PX = 10;
// Past the ends there's nothing to page to, so the drag gets heavily damped
// instead of blocked outright — it still moves, which reads as "that's the end".
const SWIPE_EDGE_DAMPING = 0.22;

function initDetailSwipe() {
  const sheet = document.getElementById('detail-sheet');
  const content = document.querySelector('.sheet-scroll');
  if (!sheet || !content) return;

  let startX = 0;
  let startY = 0;
  let axis = null; // null = undecided, 'x' = ours, 'y' = the scroller's
  let active = false;

  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const neighbour = (dx) => (dx < 0 ? detail.index + 1 : detail.index - 1);
  const hasNeighbour = (dx) => {
    const i = neighbour(dx);
    return !!detail.sequence && i >= 0 && i < detail.sequence.length;
  };

  const setX = (px, animate) => {
    content.style.transition = animate
      ? 'transform 220ms var(--ease-out), opacity 180ms ease-out'
      : 'none';
    content.style.transform = px ? `translateX(${px}px)` : '';
    content.style.opacity = '';
  };

  sheet.addEventListener('pointerdown', (e) => {
    if (e.target.closest('#chart-wrap, [data-segmented="detail"], .sheet-close')) return;
    if (!detail.sequence || detail.sequence.length < 2) return;
    startX = e.clientX;
    startY = e.clientY;
    axis = null;
    active = true;
  });

  sheet.addEventListener('pointermove', (e) => {
    if (!active) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (axis === null) {
      if (Math.abs(dx) < SWIPE_AXIS_LOCK_PX && Math.abs(dy) < SWIPE_AXIS_LOCK_PX) return;
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (axis === 'y') { active = false; return; }
    }
    if (axis !== 'x') return;
    setX(dx * (hasNeighbour(dx) ? 1 : SWIPE_EDGE_DAMPING), false);
  });

  const finish = (e) => {
    if (!active) return;
    const dx = e.clientX - startX;
    active = false;
    if (axis !== 'x') return;

    if (Math.abs(dx) < SWIPE_COMMIT_PX || !hasNeighbour(dx)) {
      setX(0, true); // spring back
      return;
    }
    const next = neighbour(dx);
    if (reduceMotion()) {
      setX(0, false);
      showDetailAt(next);
      return;
    }
    // Out the way the finger was going, then in from the opposite edge.
    const w = content.getBoundingClientRect().width || 360;
    const exit = Math.sign(dx) * w;
    content.style.transition = 'transform 150ms ease-out, opacity 150ms ease-out';
    content.style.transform = `translateX(${exit}px)`;
    content.style.opacity = '0';
    setTimeout(() => {
      if (!showDetailAt(next)) { setX(0, true); return; }
      content.style.transition = 'none';
      content.style.transform = `translateX(${-exit}px)`;
      content.style.opacity = '0';
      requestAnimationFrame(() => setX(0, true));
    }, 150);
  };

  sheet.addEventListener('pointerup', finish);
  sheet.addEventListener('pointercancel', () => { if (active) { active = false; setX(0, true); } });
}

function closeDetail() {
  const sheet = document.getElementById('detail-sheet');
  const backdrop = document.getElementById('sheet-backdrop');
  sheet.classList.remove('dragging');
  // Dismissed mid-drag: carry on down from wherever the finger left it rather
  // than snapping back to rest first and then sliding away.
  if (sheet.style.transform) {
    sheet.style.transition = 'transform 300ms var(--ease-out)';
    sheet.style.transform = 'translateX(-50%) translateY(100%)';
  }
  backdrop.style.opacity = '';
  backdrop.classList.remove('open');
  sheet.classList.remove('open');
  setTimeout(() => {
    backdrop.hidden = true;
    sheet.hidden = true;
    sheet.style.transition = '';
    sheet.style.transform = '';
    // Dropped only once it's out of sight: collapsing a full-screen view on
    // the way down would make the dismissal look like two separate animations.
    setDetailExpanded(false);
  }, 320);
}

// ── drag the sheet between resting positions ─────────────────────────
// Pull down on the top strip (or on the content once it's scrolled to the top)
// and the sheet moves with the finger, then settles on the nearest of two
// detents: full, or half-height with the board visible above it. Dismissing
// takes a deliberate pull *past* the half detent, so the sheet no longer falls
// out the bottom on a gesture that was only meant to peek behind it.
const DISMISS_COMMIT_PX = 110;
const DISMISS_FLICK_VELOCITY = 0.55; // px per ms
// How far a release coasts before it settles, so a fast drag lands where it was
// clearly heading rather than where the finger happened to stop.
const DETENT_PROJECTION_MS = 130;
// Pulling above the full position has nowhere to go, so it's heavily damped
// rather than blocked: the sheet still moves, which reads as "that's the top".
const DISMISS_UP_DAMPING = 0.18;

// Offset that leaves the sheet's top edge at the middle of the screen. Measured
// rather than hard-coded: the sheet's height is content-driven up to its 90vh
// cap, so a short sheet has a correspondingly shallower half position (and none
// at all if it's already under half a screen tall).
function halfDetentOffset() {
  const sheet = document.getElementById('detail-sheet');
  if (!sheet) return 0;
  // Full screen has one resting position. Half a screen of a page built to be
  // scrolled isn't a useful place to park it, and pulling down from there
  // means "put the card back".
  if (detail.expanded) return 0;
  const offset = Math.round(sheet.offsetHeight - window.innerHeight * 0.5);
  return offset > 60 ? offset : 0;
}

function initDetailDismiss() {
  const sheet = document.getElementById('detail-sheet');
  const grab = document.getElementById('sheet-grab');
  const scroll = document.querySelector('.sheet-scroll');
  const backdrop = document.getElementById('sheet-backdrop');
  if (!sheet || !grab || !scroll || !backdrop) return;

  let startY = 0;
  let startX = 0;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;
  let active = false;
  let engaged = false; // past the slop, and this gesture is ours
  let baseOffset = 0;  // the detent the current drag started from

  const setY = (px) => {
    sheet.style.transform = `translateX(-50%) translateY(${px}px)`;
    // The backdrop lightens as the sheet drops, so the board behind comes back
    // progressively instead of all at once on release.
    const reach = Math.min(1, Math.max(0, px / (sheet.offsetHeight || 500)));
    backdrop.style.opacity = String(1 - reach * 0.85);
  };

  // Park at a detent. The scroll container gets matching bottom padding, or the
  // content sitting below the screen's edge would be unreachable: the sheet is
  // translated down, not shortened, so its lower part is off-screen and
  // scrolling alone can never bring the tail of the list into view.
  const settleAt = (offset) => {
    detail.detentOffset = offset;
    sheet.style.transition = 'transform 300ms var(--ease-ios)';
    if (offset > 0) {
      setY(offset);
    } else {
      sheet.style.transform = '';
      backdrop.style.opacity = '';
    }
    scroll.style.setProperty('--detent-inset', `${offset}px`);
    setTimeout(() => { sheet.style.transition = ''; }, 320);
  };

  const release = (dismiss, offset) => {
    sheet.classList.remove('dragging');
    if (dismiss) { closeDetail(); return; }
    settleAt(offset);
  };

  const start = (e) => {
    startY = e.clientY;
    startX = e.clientX;
    lastY = e.clientY;
    lastT = e.timeStamp;
    velocity = 0;
    active = true;
    engaged = false;
    baseOffset = detail.detentOffset || 0;
  };

  // The strip is unambiguous — anything starting there is a dismiss drag,
  // except on the two buttons it now holds, which are taps.
  grab.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    start(e);
    try { grab.setPointerCapture(e.pointerId); } catch { /* capture is best-effort */ }
  });
  // On the content it only counts when there's no scrolling left to do,
  // which is the standard "pull the sheet down from the top of its list" move.
  scroll.addEventListener('pointerdown', (e) => {
    if (scroll.scrollTop > 0) return;
    if (e.target.closest('#chart-wrap, [data-segmented="detail"], button')) return;
    start(e);
  });

  const move = (e) => {
    if (!active) return;
    const dy = e.clientY - startY;
    const dx = e.clientX - startX;

    if (!engaged) {
      if (Math.abs(dy) < SWIPE_AXIS_LOCK_PX && Math.abs(dx) < SWIPE_AXIS_LOCK_PX) return;
      // Horizontal wins ties: paging between companies is the more-used
      // gesture, and initDetailSwipe owns it.
      if (Math.abs(dx) >= Math.abs(dy)) { active = false; return; }
      // A drag that starts by going *up* on the content is a scroll, not a
      // sheet move — hand it back before we've moved anything. Unless the sheet
      // is parked below full, where dragging up is how you get back to full.
      if (dy < 0 && e.currentTarget === scroll && baseOffset === 0) { active = false; return; }
      engaged = true;
      sheet.classList.add('dragging');
    }

    // Only re-measure once there's a real interval to divide by: coalesced
    // pointer events can arrive with identical timestamps, and dividing by a
    // sub-millisecond dt turns a slow drag into a fake flick.
    const dt = e.timeStamp - lastT;
    if (dt >= 8) {
      // Smoothed, so one jittery sample near the end doesn't decide it.
      velocity = velocity * 0.4 + ((e.clientY - lastY) / dt) * 0.6;
      lastY = e.clientY;
      lastT = e.timeStamp;
    }

    // Damping applies only above the *full* position — between detents the
    // sheet tracks the finger exactly.
    const raw = baseOffset + dy;
    setY(raw >= 0 ? raw : raw * DISMISS_UP_DAMPING);
    e.preventDefault();
  };

  const finish = (e) => {
    if (!active) return;
    active = false;
    if (!engaged) return;
    engaged = false;

    const offset = Math.max(0, baseOffset + (e.clientY - startY));

    // From full screen, a pull down is a step back to the card — never a
    // dismissal. Two levels down in one gesture would be too easy to do by
    // accident, and the card is where you'd want to carry on from anyway.
    if (detail.expanded) {
      sheet.classList.remove('dragging');
      if (offset > DISMISS_COMMIT_PX) setDetailExpanded(false);
      settleAt(0);
      return;
    }

    const half = halfDetentOffset();
    // Where the drag was heading, not where the finger stopped — used to pick
    // between detents, deliberately NOT to decide dismissal.
    const projected = offset + velocity * DETENT_PROJECTION_MS;
    const pastLowest = offset - half;

    // Dismissal is decided by where the finger actually ended up, not by how
    // fast it was moving when it got there. Letting velocity alone carry the
    // sheet off-screen is what made a single firm drag from full blow straight
    // past the detent — the sheet has to be dragged clearly below the detent,
    // or flicked on from a stop already there.
    const draggedPast = pastLowest > DISMISS_COMMIT_PX;
    const flickedOnFromDetent = baseOffset >= half && half > 0
      && pastLowest > 0 && velocity > DISMISS_FLICK_VELOCITY;
    if (draggedPast || flickedOnFromDetent) { release(true); return; }

    // Otherwise settle on whichever detent the throw was closest to.
    const detents = half > 0 ? [0, half] : [0];
    let nearest = detents[0];
    for (const d of detents) {
      if (Math.abs(projected - d) < Math.abs(projected - nearest)) nearest = d;
    }
    release(false, nearest);
  };

  for (const el of [grab, scroll]) {
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', () => {
      if (!active) return;
      active = false;
      if (engaged) { engaged = false; release(false, baseOffset); }
    });
  }
}

function renderDetailReturn(company) {
  const el = document.getElementById('detail-return');
  const value = company.returns[detail.range];
  const available = company.availability[detail.range] && typeof value === 'number';
  if (!available) {
    el.className = 'detail-return na';
    el.textContent = 'N/A';
    return;
  }
  // No range suffix and no arrow: the range toggle sits directly beneath this,
  // and the sign is already in the number and the colour. Both were saying
  // something the eye had just read.
  el.className = `detail-return ${value >= 0 ? 'gain' : 'loss'}`;
  el.textContent = fmtPct(value);
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

// ── the full-screen view's blocks ────────────────────────────────────
// The expanded per-ticker page is a stack of cards built from this list, in
// order. It's meant to be a dumping ground: adding a panel of data is adding
// an entry here, taking it away is deleting the entry, and nothing else in
// the app refers to them. `render` returns the card's inner HTML, or null to
// leave the card out entirely — a block with nothing to say shouldn't leave
// an empty shell behind.
//
// Use statRow() for anything list-shaped so a new block inherits the app's
// spacing and hairlines instead of inventing a layout; a block that needs its
// own shape can return whatever markup it likes.
const DETAIL_BLOCKS = [
  { key: 'rating', title: 'Analyst rating', render: blockRating },
  // Not "52-week range" any more — the window is a toggle now, and a card
  // headed 52-week while showing a 1M span would be lying.
  { key: 'range', title: 'Price range', render: blockRange },
  { key: 'returns', title: 'Return by window', render: blockReturns },
  { key: 'standing', title: 'Standing on the board', render: blockStanding },
  { key: 'profile', title: 'Company', render: blockProfile },
];

function statRow(label, value, cls = '') {
  return `<div class="stat-row"><span class="stat-label">${label}</span><span class="stat-value${cls ? ` ${cls}` : ''}">${value}</span></div>`;
}

function signClass(v) {
  if (!(typeof v === 'number') || v === 0) return '';
  return v > 0 ? 'gain' : 'loss';
}

// ── analyst consensus ────────────────────────────────────────────────
// Grade counts and FMP's consensus label ride the company object itself
// (`grades` on the leaderboard payload, fetched once daily server-side with
// everything else) — which is what lets the static snapshot show this card
// with no backend and no endpoint of its own. The time series accrues in the
// daily archive (data/snapshots/), which files each day's counts; the card
// only ever shows today's. The owner's earlier hand-kept readings remain in
// data/ratings/ratings.csv as a record, no longer displayed.
const CONSENSUS_TONE = {
  'strong buy': 'gain',
  buy: 'gain',
  hold: '',
  sell: 'loss',
  'strong sell': 'loss',
};

function blockRating(company) {
  const g = company.grades;
  if (!g || typeof g !== 'object') return null;
  const counts = [g.strongBuy, g.buy, g.hold, g.sell, g.strongSell]
    .map((v) => (typeof v === 'number' && v > 0 ? v : 0));
  const total = counts.reduce((a, b) => a + b, 0);
  // No card for a company nobody covers — an empty "Analyst rating" panel
  // would be noise, same reasoning as the hand-kept version before it.
  if (total === 0) return null;

  const positive = counts[0] + counts[1];
  const pct = (positive / total) * 100;
  const tone = CONSENSUS_TONE[String(g.consensus || '').toLowerCase()] ?? '';
  const meter = `
    <div class="rating-meter">
      <span class="rating-meter-fill ${tone}" style="width: ${pct.toFixed(1)}%"></span>
    </div>`;

  const parts = [];
  if (counts[0]) parts.push(`${counts[0]} strong buy`);
  if (counts[1]) parts.push(`${counts[1]} buy`);
  if (counts[2]) parts.push(`${counts[2]} hold`);
  if (counts[3]) parts.push(`${counts[3]} sell`);
  if (counts[4]) parts.push(`${counts[4]} strong sell`);

  const rows = [
    statRow('Consensus', g.consensus || 'Mixed', tone),
    statRow('Analysts', `${total}`),
    statRow('Leaning', `${pct.toFixed(0)}% positive`, tone),
  ];
  rows.push(`<p class="detail-block-note">${parts.join(' &middot; ')}. Analyst grade counts, refreshed daily. Nothing here feeds the board's ranking.</p>`);

  return meter + rows.join('');
}

// High and low over a window, from the symbol's own daily closes. Every
// window is measured the same way, which is why this doesn't fall back to
// FMP's 52-week figures for the 12M case: those are intraday extremes, and
// mixing the two would make one pill disagree with the rest by a few percent
// for no reason the reader could see.
function rangeOver(symbol, days) {
  const cached = historyCache.get(symbol);
  if (!cached || !Array.isArray(cached.series)) return null;
  const cutoff = daysAgoToDateStr(days);
  let low = Infinity;
  let high = -Infinity;
  let count = 0;
  for (const p of cached.series) {
    if (p.date < cutoff || !(p.close > 0)) continue;
    if (p.close < low) low = p.close;
    if (p.close > high) high = p.close;
    count += 1;
  }
  if (count < 2 || !(high > low)) return null;
  return { low, high, count };
}

// Where today's price sits between a window's extremes. This was an 88px
// column on every board row until it moved here; at that width the price
// labels were 9px and the bar competed with the return for attention. Full
// width it can carry a window toggle and three derived figures.
function blockRange(company) {
  const active = RANGE_WINDOWS.find((w) => w.key === detail.rangeWindow) || RANGE_WINDOWS[0];
  const span = rangeOver(company.symbol, active.days);
  const pills = RANGE_WINDOWS.map((w) => `
    <button type="button" class="window-pill" data-range-window="${w.key}"
      aria-pressed="${w.key === active.key}">${w.label}</button>`).join('');
  const head = `<div class="range-windows" role="group" aria-label="Range window">${pills}</div>`;

  // History not in yet, or a company too new for this window — keep the pills
  // so the reader can pick a shorter one rather than dropping the card.
  if (!span) {
    return `${head}${statRow('Range', 'Not enough history for this window', 'muted')}`;
  }

  const pct = Math.max(0, Math.min(100, ((company.price - span.low) / (span.high - span.low)) * 100));
  // The thumb sits at the true position; the price label is pulled in from
  // the edges so it can't be clipped when the price is at an extreme.
  const labelPct = Math.max(9, Math.min(91, pct));
  return `
    ${head}
    <div class="range-bar">
      <span class="range-bar-now" style="left: ${labelPct.toFixed(1)}%">${fmtRangePrice(company.price)}</span>
      <span class="range-bar-track">
        <span class="range-cap lo"></span>
        <span class="range-cap hi"></span>
        <span class="range-thumb" style="left: ${pct.toFixed(1)}%"></span>
      </span>
      <span class="range-bar-ends">
        <span>${fmtRangePrice(span.low)}</span>
        <span>${fmtRangePrice(span.high)}</span>
      </span>
    </div>
    ${statRow('Position', `${Math.round(pct)}% of the range`)}
    ${statRow('Off the high', fmtPct(((company.price - span.high) / span.high) * 100),
    signClass(company.price - span.high))}
    ${statRow('Above the low', fmtPct(((company.price - span.low) / span.low) * 100),
    signClass(company.price - span.low))}
    <p class="detail-block-note">High and low are daily closes over the ${active.label} window (${span.count} sessions), so they sit just inside the intraday extremes a broker quotes.</p>`;
}

// Every window the API carries, not just the one the board happens to be
// sorted by — the board can only ever show one at a time.
function blockReturns(company) {
  const metrics = (state.leaderboard && state.leaderboard.metrics) || [];
  if (!metrics.length) return null;
  let short = false;
  const rows = metrics.map((m) => {
    const value = company.returns ? company.returns[m.key] : null;
    const usable = typeof value === 'number'
      && (!company.availability || company.availability[m.key] !== false);
    if (!usable) {
      short = true;
      return statRow(m.label, '&mdash;', 'muted');
    }
    return statRow(m.label, fmtPct(value), signClass(value));
  });
  if (short) {
    rows.push('<p class="detail-block-note">&mdash; where the company hasn\'t traded long enough for that window to mean anything.</p>');
  }
  return rows.join('');
}

// Where this name sits in the board as currently scored — the number the row
// shows, plus the things the row has no room for.
function blockStanding(company) {
  if (!state.leaderboard) return null;
  const scored = state.leaderboard.companies
    .map((c) => ({ symbol: c.symbol, value: scoreFor(c) }))
    .filter((x) => x.value !== null)
    .sort((a, b) => b.value - a.value);
  const index = scored.findIndex((x) => x.symbol === company.symbol);
  const volAdjusted = !!state.settings.volAdjusted;

  const rows = [];
  if (index === -1) {
    rows.push(statRow('Rank', 'Not ranked', 'muted'));
  } else {
    const score = scored[index].value;
    rows.push(statRow('Rank', `${index + 1} of ${scored.length}`));
    rows.push(statRow('Score', volAdjusted ? fmtScore(score) : fmtPct(score), signClass(score)));
    rows.push(statRow('Percentile', `top ${Math.max(1, Math.round(((index + 1) / scored.length) * 100))}%`));
  }
  rows.push(statRow('Scored by', volAdjusted ? 'Return ÷ volatility' : 'Price return'));
  rows.push(statRow('Window', rankDateRangeLabel()));
  if (index === -1) {
    rows.push('<p class="detail-block-note">Too little trading history to score over this window. Widen it in Settings, or move the end date back.</p>');
  }
  return rows.join('');
}

function blockProfile(company) {
  const universe = (state.leaderboard && state.leaderboard.companies) || [];
  const sizeIndex = universe.findIndex((c) => c.symbol === company.symbol);
  const rows = [
    statRow('Price', fmtPrice(company.price)),
    statRow('Market cap', fmtCap(company.marketCap)),
  ];
  // The board is the largest N by market cap, in that order, so position in
  // it is the size ranking — no extra data needed to say so.
  if (sizeIndex >= 0) rows.push(statRow('Size rank', `${sizeIndex + 1} of ${universe.length}`));
  rows.push(statRow('Sector', company.sector || 'Uncategorized'));
  rows.push(statRow('Beta', typeof company.beta === 'number' ? company.beta.toFixed(2) : 'N/A'));
  // The 52-week figures have their own block above, with the bar.
  if (company.ipoDate) rows.push(statRow('Listed', fmtChartDate(company.ipoDate)));
  return rows.join('');
}

function renderDetailExtras(company) {
  const host = document.getElementById('detail-extras');
  if (!host) return;
  if (!detail.expanded || !company) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }
  const cards = [];
  for (const block of DETAIL_BLOCKS) {
    let body = null;
    try {
      body = block.render(company);
    } catch (err) {
      // This list is explicitly a place for half-finished ideas, so one that
      // throws drops its own card rather than taking the page down with it.
      console.error(`Detail block "${block.key}" failed to render`, err);
      continue;
    }
    if (!body) continue;
    cards.push(`<section class="detail-block" data-block="${block.key}">
        <h3 class="detail-block-title">${block.title}</h3>
        ${body}
      </section>`);
  }
  host.innerHTML = cards.join('');
  host.hidden = cards.length === 0;

  // Blocks are rebuilt wholesale, so any controls inside them are wired here
  // rather than once at boot.
  host.querySelectorAll('[data-range-window]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (detail.rangeWindow === btn.dataset.rangeWindow) return;
      detail.rangeWindow = btn.dataset.rangeWindow;
      const current = detail.symbol ? findCompany(detail.symbol) : null;
      if (current) renderDetailExtras(current);
    });
  });
}

const EXPAND_ICON = '<path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/>';
const COLLAPSE_ICON = '<path d="M20 10h-6V4M14 10l6-6M4 14h6v6M10 14l-6 6"/>';

// Grows the sheet to fill the screen, or puts it back. Deliberately not a
// second component: same DOM, same chart, same range pills, same swipe — the
// blocks below simply become visible and the height cap comes off.
function setDetailExpanded(next) {
  const sheet = document.getElementById('detail-sheet');
  if (!sheet) return;
  detail.expanded = !!next;
  sheet.classList.toggle('is-expanded', detail.expanded);

  const btn = document.getElementById('sheet-expand');
  if (btn) {
    btn.setAttribute('aria-expanded', String(detail.expanded));
    btn.setAttribute('aria-label', detail.expanded ? 'Back to the card' : 'Expand to full screen');
    const icon = document.getElementById('sheet-expand-icon');
    if (icon) icon.innerHTML = detail.expanded ? COLLAPSE_ICON : EXPAND_ICON;
  }

  // Either direction lands at the full position. A sheet parked at the half
  // detent carries an inline transform that would otherwise hold the
  // full-screen view halfway down the screen.
  detail.detentOffset = 0;
  sheet.style.transform = '';
  const scroll = document.querySelector('.sheet-scroll');
  if (scroll) {
    scroll.style.setProperty('--detent-inset', '0px');
    scroll.scrollTop = 0;
  }
  const backdrop = document.getElementById('sheet-backdrop');
  if (backdrop) backdrop.style.opacity = '';

  // Nothing below is worth doing while the sheet is closed — closeDetail calls
  // this to reset state, not to draw anything.
  if (sheet.hidden) return;

  renderDetailExtras(detail.symbol ? findCompany(detail.symbol) : null);
  // The chart's viewBox is measured in real pixels and its wrapper just
  // changed height, so it needs a redraw rather than a rescale.
  requestAnimationFrame(() => {
    if (detail.symbol && historyCache.has(detail.symbol)) renderChart();
    positionSegmentedThumb('detail', true);
  });
}

// Built once, then only aria-pressed and the thumb's position change. The old
// version re-rendered its innerHTML on every tap, which is why no transition
// ever played: a freshly-inserted element has no previous value to animate
// from (same reason the chart marks below use `animation`, not `transition`).
function renderDetailSegmented() {
  const el = document.querySelector('[data-segmented="detail"]');
  if (!el) return;
  if (!el.querySelector('button')) {
    el.innerHTML = '<span class="segmented-thumb" aria-hidden="true"></span>';
    CHART_RANGES.forEach((r) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = r.label;
      btn.dataset.range = r.key;
      btn.addEventListener('click', () => {
        detail.range = r.key;
        syncSegmented();
        const company = findCompany(detail.symbol);
        if (company) renderDetailReturn(company);
        renderChart();
      });
      el.appendChild(btn);
    });
  }
  syncSegmented();
}

function syncSegmented() {
  const el = document.querySelector('[data-segmented="detail"]');
  if (!el) return;
  el.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.range === detail.range));
  });
  positionSegmentedThumb('detail');
}

// `instant` skips the slide — used when the sheet is (re)opening, where the
// thumb should simply already be under the right label.
function positionSegmentedThumb(group = 'detail', instant = false) {
  const el = document.querySelector(`[data-segmented="${group}"]`);
  if (!el) return;
  const thumb = el.querySelector('.segmented-thumb');
  const active = el.querySelector('button[aria-pressed="true"]');
  if (!thumb || !active || !active.offsetWidth) return; // not laid out yet
  const skipAnim = instant || !thumb.style.width;
  if (skipAnim) thumb.style.transition = 'none';
  thumb.style.width = `${active.offsetWidth}px`;
  thumb.style.transform = `translateX(${active.offsetLeft}px)`;
  if (skipAnim) {
    void thumb.offsetWidth; // flush, so the restored transition doesn't animate this move
    thumb.style.transition = '';
  }
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

// Falls back to the default range for a key that isn't in CHART_RANGES: the
// static snapshot bundle publishes a shorter list than the live app (it carries
// less history), so "this key no longer exists" is a real state, not a typo.
function sliceForRange(series, rangeKey) {
  const range = CHART_RANGES.find((r) => r.key === rangeKey)
    || CHART_RANGES.find((r) => r.key === DEFAULT_CHART_RANGE)
    || CHART_RANGES[0];
  const now = new Date();
  let cutoff;
  if (range.days === null) {
    cutoff = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)); // YTD
  } else {
    cutoff = new Date(now.getTime() - range.days * 86400000);
  }
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return series.filter((p) => p.date >= cutoffStr);
}

// ── chart: SVG line + gradient area, colored by direction, with a touch-scrub
// crosshair.
//
// The viewBox is measured from the wrapper in CSS pixels at render time (1 unit
// = 1 px) rather than being a fixed 400x160 box stretched to fit with
// preserveAspectRatio="none". That stretch scaled x and y by different factors,
// which turned every circle into an ellipse and made diagonal stroke weight
// inconsistent — visible on the endpoint dots. Trade-off: the geometry is tied
// to the rendered size, so a viewport change has to re-render (see the resize
// handler at the bottom of this section).
const CHART_PAD_X = 6;
// Generous top/bottom inset: it keeps the min/max labels in a band no data
// point can reach, which is what used to make the low label collide with the
// start-point dot whenever a range bottomed out on its first day.
const CHART_PAD_Y = 26;
const CHART_FALLBACK_W = 344;
const CHART_FALLBACK_H = 184;

function chartSize(wrap) {
  return {
    w: Math.max(Math.round(wrap?.clientWidth || 0) || CHART_FALLBACK_W, 160),
    h: Math.max(Math.round(wrap?.clientHeight || 0) || CHART_FALLBACK_H, 100),
  };
}

// A decorative (non-data) wave shape shown in place of "Loading chart…" while
// a symbol's history is being fetched — same shimmer language as the Ranks
// loading rows, shaped like a chart instead of a generic block. Purely
// decorative, so this one keeps the cheap stretched viewBox.
function chartSkeletonHTML() {
  return `
    <div class="chart-skeleton" aria-hidden="true">
      <svg viewBox="0 0 400 160" preserveAspectRatio="none">
        <path class="chart-skeleton-area" d="M0,112 C40,96 60,124 100,104 C140,84 160,110 200,92 C240,74 260,100 300,86 C340,72 360,94 400,82 L400,160 L0,160 Z" />
        <path class="chart-skeleton-line" d="M0,112 C40,96 60,124 100,104 C140,84 160,110 200,92 C240,74 260,100 300,86 C340,72 360,94 400,82" />
      </svg>
    </div>`;
}

// ── the shared line chart ────────────────────────────────────────────
// One renderer, two callers: the per-ticker price chart in the detail sheet
// and the portfolio balance chart on the Watchlist tab. They draw the same
// thing — a filled line with three axis landmarks each way and a scrub
// crosshair — and differ only in what the labels say, so the difference is
// three callbacks rather than a second copy of the geometry.
//
// `points` is [{date, value}], oldest first.
// `ids` emits the element ids the detail chart has always carried. Only one
// chart may claim them (ids must be unique in a document) and both charts can
// be on screen at once, so the portfolio chart goes without; every lookup
// below is scoped to `wrap` and uses classes, so nothing depends on them.
function drawLineChart({ wrap, axisEl, points, gradId, label, fmtAxis, tooltipFor, ids = false }) {
  const { w: W, h: H } = chartSize(wrap);
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const innerH = H - CHART_PAD_Y * 2;
  const innerW = W - CHART_PAD_X * 2;

  const coords = points.map((p, i) => ({
    x: points.length === 1 ? CHART_PAD_X : CHART_PAD_X + (i / (points.length - 1)) * innerW,
    y: CHART_PAD_Y + innerH - ((p.value - min) / span) * innerH,
    date: p.date,
    value: p.value,
  }));

  const dir = values[values.length - 1] >= values[0] ? 'gain' : 'loss';
  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' ');
  const first = coords[0];
  const last = coords[coords.length - 1];
  // Closed against the line's own first/last x, not 0/W — anchoring it to the
  // container's edges put a stray diagonal wedge under the first point.
  const areaPath = `${linePath} L${last.x.toFixed(2)},${H} L${first.x.toFixed(2)},${H} Z`;
  const baselineY = first.y.toFixed(2);

  // Axis landmarks: three levels and three dates, marked with 5px ticks rather
  // than gridlines. Discrete and generously spaced on purpose — a full grid
  // over a 344px sparkline reads as noise, but with the tooltip showing
  // something other than the raw level, the levels have to come from somewhere.
  // Only the mid tick: the min/max labels sit outside the data band (see
  // CHART_PAD_Y), so ticks level with them would float free of their labels.
  const midIdx = Math.floor((points.length - 1) / 2);
  const ticks = [
    `<line class="chart-tick" x1="1" y1="${(CHART_PAD_Y + innerH / 2).toFixed(2)}" x2="6" y2="${(CHART_PAD_Y + innerH / 2).toFixed(2)}" />`,
    ...[first.x, coords[midIdx].x, last.x].map((x) => `<line class="chart-tick" x1="${x.toFixed(2)}" y1="${H - 7}" x2="${x.toFixed(2)}" y2="${H - 2}" />`),
  ].join('');

  const id = (name) => (ids ? ` id="${name}"` : '');
  wrap.innerHTML = `
    <div class="chart-axis-y max">${fmtAxis(max)}</div>
    <div class="chart-axis-y mid">${fmtAxis((min + max) / 2)}</div>
    <div class="chart-axis-y min">${fmtAxis(min)}</div>
    <svg class="chart-svg ${dir}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="currentColor" stop-opacity="0.34" />
          <stop offset="72%" stop-color="currentColor" stop-opacity="0.07" />
          <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
        </linearGradient>
      </defs>
      ${ticks}
      <line class="chart-baseline" x1="0" y1="${baselineY}" x2="${W}" y2="${baselineY}" />
      <path class="chart-area"${id('chart-area-path')} fill="url(#${gradId})" d="${areaPath}" />
      <path class="chart-line"${id('chart-line-path')} d="${linePath}" />
      <circle class="chart-startpoint"${id('chart-startpoint-dot')} cx="${first.x.toFixed(2)}" cy="${first.y.toFixed(2)}" r="3.5" />
      <circle class="chart-endpoint"${id('chart-endpoint-dot')} cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="4.5" />
      <line class="chart-crosshair-line"${id('crosshair-line')} x1="0" y1="0" x2="0" y2="${H}" />
      <circle class="chart-crosshair-dot"${id('crosshair-dot')} r="4.5" />
      <rect class="chart-hit"${id('chart-hit')} x="0" y="0" width="${W}" height="${H}" fill="transparent" />
    </svg>
    <div class="chart-tooltip"${id('chart-tooltip')}></div>
  `;

  if (axisEl) {
    axisEl.innerHTML =
      `<span>${fmtChartDate(points[0].date)}</span>` +
      `<span>${fmtChartDate(points[midIdx].date)}</span>` +
      `<span>${fmtChartDate(points[points.length - 1].date)}</span>`;
  }

  animateChartIn(wrap);
  attachChartScrub(wrap, coords, W, tooltipFor);
}

function renderChart() {
  const wrap = document.getElementById('chart-wrap');
  if (!wrap) return;
  const cached = historyCache.get(detail.symbol);
  if (!cached || !Array.isArray(cached.series) || cached.series.length < 2) {
    wrap.innerHTML = `<div class="chart-error">No chart data available for ${detail.symbol}.</div>`;
    return;
  }

  const slice = sliceForRange(cached.series, detail.range);
  if (slice.length < 2) {
    wrap.innerHTML = `<div class="chart-error">Not enough trading history yet for this range.</div>`;
    return;
  }
  detail.slice = slice;

  drawLineChart({
    wrap,
    axisEl: document.getElementById('chart-axis-x'),
    points: slice.map((p) => ({ date: p.date, value: p.close })),
    gradId: 'chart-grad',
    label: `${detail.symbol} price chart, ${detail.range}`,
    fmtAxis: fmtRangePrice,
    // Cumulative return from the range's opening close, not the raw price: the
    // price is already readable off the y-axis landmarks, and "how far up from
    // where this range started" is what the chart is actually about.
    tooltipFor: (c, all) => {
      const base = all[0].value;
      const cum = base > 0 ? ((c.value - base) / base) * 100 : null;
      return { text: cum === null ? 'N/A' : fmtPct(cum), cls: cum === null ? '' : signClass(cum) };
    },
    ids: true,
  });
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
  const linePath = wrap.querySelector('.chart-line');
  if (!linePath) return;
  const length = linePath.getTotalLength();
  linePath.style.strokeDasharray = String(length);
  linePath.style.setProperty('--dash-length', String(length));
}

function attachChartScrub(wrap, coords, chartW, tooltipFor) {
  const svg = wrap.querySelector('svg');
  const hit = wrap.querySelector('.chart-hit');
  const crosshairLine = wrap.querySelector('.chart-crosshair-line');
  const crosshairDot = wrap.querySelector('.chart-crosshair-dot');
  const tooltip = wrap.querySelector('.chart-tooltip');
  if (!svg || !hit) return;

  function nearestIndex(clientX) {
    const rect = svg.getBoundingClientRect();
    const relX = ((clientX - rect.left) / rect.width) * chartW;
    const idx = Math.round((relX / chartW) * (coords.length - 1));
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
    const pxRatio = rect.width / chartW;
    tooltip.style.left = `${Math.min(Math.max(c.x * pxRatio, 62), rect.width - 62)}px`;
    tooltip.style.opacity = '1';
    const { text, cls } = tooltipFor(c, coords);
    tooltip.innerHTML = '';
    const dateEl = document.createElement('span');
    dateEl.textContent = `${fmtChartDate(c.date)} — `;
    const valueEl = document.createElement('b');
    valueEl.textContent = text;
    if (cls) valueEl.className = cls;
    tooltip.appendChild(dateEl);
    tooltip.appendChild(valueEl);
  }

  function hide() {
    crosshairLine.style.opacity = '0';
    crosshairDot.style.opacity = '0';
    tooltip.style.opacity = '0';
  }

  // Track the drag ourselves rather than testing e.pressure: a plain iOS touch
  // reports pressure 0, so the old `pressure > 0` gate meant no pointermove ever
  // counted and the crosshair stuck wherever the finger first landed instead of
  // following it. Pointer capture keeps the moves coming to this element even
  // once the finger leaves it.
  let dragging = false;
  hit.addEventListener('pointerdown', (e) => {
    dragging = true;
    try { hit.setPointerCapture(e.pointerId); } catch { /* capture is best-effort */ }
    showAt(e.clientX);
    e.preventDefault(); // don't let the drag turn into a scroll
  });
  hit.addEventListener('pointermove', (e) => {
    if (dragging || e.pointerType === 'mouse') showAt(e.clientX);
  });
  // Releasing leaves the reading on screen rather than clearing it: a quick tap
  // is a legitimate "what was it here?" and hiding on pointerup would make that
  // gesture flash and vanish. It clears on the next render.
  hit.addEventListener('pointerup', () => { dragging = false; });
  hit.addEventListener('pointercancel', () => { dragging = false; hide(); });
  hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !dragging) hide(); });
}

function fmtChartDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', CAL_DATE_OPTS);
}

function initDetailSheet() {
  document.getElementById('sheet-close').addEventListener('click', closeDetail);
  document.getElementById('sheet-backdrop').addEventListener('click', closeDetail);
  document.getElementById('sheet-expand').addEventListener('click', () => {
    setDetailExpanded(!detail.expanded);
  });
  initDetailSwipe();
  initDetailDismiss();
  initClearWatchlist();
  initWatchlistActions();
  document.addEventListener('keydown', (e) => {
    const sheetOpen = !document.getElementById('detail-sheet').hidden;
    // Escape steps back one level rather than always closing: from full screen
    // it returns to the card, which is where the gesture equivalent lands too.
    if (e.key === 'Escape' && sheetOpen) {
      if (detail.expanded) setDetailExpanded(false);
      else closeDetail();
    }
    // Keyboard equivalent of the swipe.
    if (sheetOpen && e.key === 'ArrowRight') { e.preventDefault(); showDetailAt(detail.index + 1); }
    if (sheetOpen && e.key === 'ArrowLeft') { e.preventDefault(); showDetailAt(detail.index - 1); }
  });

  // The chart's viewBox is in real pixels, so a size change (rotation, or the
  // keyboard/URL bar appearing) needs a re-render rather than a rescale. Only
  // matters while the sheet is actually open.
  let resizeRaf = null;
  window.addEventListener('resize', () => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = null;
      // Both charts measure their wrapper in real pixels, so a size change is
      // a re-render rather than a rescale.
      renderPortfolioChart();
      const sheet = document.getElementById('detail-sheet');
      if (!sheet || sheet.hidden || !detail.symbol) return;
      if (historyCache.has(detail.symbol)) renderChart();
      positionSegmentedThumb('detail', true);
    });
  });
}

// ── settings tab ─────────────────────────────────────────────────────
function renderSettings() {
  const list = document.getElementById('settings-list');
  if (!list) return;
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
      row.querySelector('.ios-switch').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const next = btn.getAttribute('aria-checked') !== 'true';
        btn.setAttribute('aria-checked', String(next));
        state.settings[setting.key] = next;
        saveSettings();
        if (state.leaderboard && state.rankingsLoaded) {
          await refreshRankings();
          renderAll();
        }
      });
    }
    // Threshold stepper: 0.30–1.00 in 0.05 steps, 1.00 shown as "Off". Changing
    // it needs no refetch — the correlations themselves don't depend on the
    // threshold, only on the watchlist and the date range — so this just
    // re-renders.
    if (setting.type === 'threshold') {
      const value = state.settings[setting.key];
      const off = !(value < CORRELATION_MAX);
      row.innerHTML = `
        <div class="settings-row-text">
          <div class="settings-row-label">${setting.label}</div>
          <div class="settings-row-desc">${setting.description}</div>
          <div class="stepper-date${off ? ' is-off' : ''}" id="threshold-value">${off ? 'Off' : value.toFixed(2)}</div>
        </div>
        <div class="stepper" role="group" aria-label="${setting.label}">
          <button type="button" class="stepper-btn" data-key="${setting.key}" data-dir="-1" aria-label="Lower the correlation threshold"${value - CORRELATION_STEP < CORRELATION_MIN - 1e-9 ? ' disabled' : ''}>&minus;</button>
          <button type="button" class="stepper-btn" data-key="${setting.key}" data-dir="1" aria-label="Raise the correlation threshold"${off ? ' disabled' : ''}>+</button>
        </div>`;
      list.appendChild(row);
      row.querySelectorAll('.stepper-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const dir = Number(btn.dataset.dir);
          const next = state.settings[setting.key] + dir * CORRELATION_STEP;
          // Round to the step: repeated float addition drifts (0.7 + 0.05 …).
          state.settings[setting.key] = Math.min(
            CORRELATION_MAX,
            Math.max(CORRELATION_MIN, Math.round(next / CORRELATION_STEP) * CORRELATION_STEP),
          );
          saveSettings();
          renderSettings();
          if (state.leaderboard && state.rankingsLoaded) renderAll();
        });
      });
    }
  });

  if (!document.getElementById('settings-note')) {
    const note = document.createElement('p');
    note.id = 'settings-note';
    note.className = 'settings-note';
    note.innerHTML = 'More settings land here as the board grows — each one is a config entry in <code>public/app.js</code> (<code>SETTINGS</code>) with no other wiring required.';
    // Directly after its own list, not appended to the panel: with a second
    // section below it, a note parked at the bottom reads as belonging to
    // whatever it happens to follow.
    list.insertAdjacentElement('afterend', note);
  }

  renderDateRangeSetting();
  renderFlagSettings();
}

// The Flags section, built entirely from ROW_FLAGS — one entry there yields a
// board mark and a switch here, with nothing to wire up in between. That is the
// point of the section existing before there is more than one flag in it.
function renderFlagSettings() {
  const container = document.getElementById('flag-settings');
  if (!container) return;
  container.innerHTML = '';

  ROW_FLAGS.forEach((flag) => {
    const on = flagEnabled(flag.key);
    const count = flagMatchCount(flag);
    const row = document.createElement('div');
    row.className = 'settings-row';
    row.innerHTML = `
      <div class="settings-row-text">
        <div class="settings-row-label">${flag.title || flag.label}</div>
        <div class="settings-row-desc">${flag.description || ''}</div>
        <div class="flag-sample" aria-hidden="true">
          <span class="flag-sample-orb" data-flag-sample="${flag.key}"></span>
          <span class="flag-sample-count">${count === null ? 'counting…'
            : `${count} of ${state.leaderboard.companies.length} on the board`}</span>
        </div>
      </div>
      <button type="button" class="ios-switch" role="switch" aria-checked="${on}"
        data-flag="${flag.key}" aria-label="${flag.title || flag.label}">
        <span class="knob"></span>
      </button>`;
    container.appendChild(row);

    row.querySelector('.ios-switch').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const next = btn.getAttribute('aria-checked') !== 'true';
      btn.setAttribute('aria-checked', String(next));
      // Only the deviation from the default is stored, so the map stays sparse
      // and a flag's own default keeps meaning something.
      if (next) delete state.settings.flags[flag.key];
      else state.settings.flags[flag.key] = false;
      saveSettings();
      if (state.leaderboard) renderAll();
    });
  });

  if (!document.getElementById('flags-note')) {
    const note = document.createElement('p');
    note.id = 'flags-note';
    note.className = 'settings-note';
    note.innerHTML = 'A flag marks a company for something other than its return, and never '
      + 'affects the ranking. More land here as they are built &mdash; each is a config entry '
      + 'in <code>public/app.js</code> (<code>ROW_FLAGS</code>) plus one CSS rule for its colour.';
    container.insertAdjacentElement('afterend', note);
  }
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
    btn.addEventListener('click', async () => {
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
      renderWindowPills();
      if (state.leaderboard && state.rankingsLoaded) {
        // Both of these sequence their own requests, so rapid stepper clicks
        // each fire but only the latest response applies.
        await Promise.all([refreshRankings(), refreshCorrelations()]);
        renderAll();
      }
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
  initInvestingViews();
  initDetailSheet();
  renderSettings();
  // Before the board arrives, so the window controls are there to read (and
  // to set) while the skeleton rows are still up.
  renderWindowPills();
  updateWatchlistBadge();

  document.getElementById('ranks-rows').innerHTML = skeletonRowsHTML(8);

  // Independent of the market data: it comes off disk, not from FMP, so it
  // neither waits for the board nor fails with it.
  loadPortfolio()
    .then((data) => {
      portfolioSummary = data;
      renderPortfolioCard();
      // Redraw once visible: the card may have been built inside a hidden
      // view, where the chart wrapper measures zero.
      if (state.investingView === 'portfolio') renderPortfolioChart();
    })
    .catch(() => { /* nothing recorded yet — the card stays hidden */ });

  // Same: off disk, not FMP. Nothing waits on it — the rating block simply
  // isn't drawn until it lands, and drops itself if it never does.

  try {
    const data = await loadLeaderboard();
    state.leaderboard = data;
    document.getElementById('as-of').innerHTML = `As of <b>${fmtDate(data.asOf)}</b> · Financial Modeling Prep`;

    document.getElementById('ranks-rows').innerHTML = skeletonRowsHTML(8);
    await refreshRankings();
    state.rankingsLoaded = true;
    await refreshCorrelations();

    renderAll();
  } catch (err) {
    document.getElementById('ranks-rows').innerHTML = `<div class="error-box">Couldn't load live data: ${err.message}</div>`;
    document.getElementById('as-of').textContent = 'Live data unavailable';
  }
}

init();
