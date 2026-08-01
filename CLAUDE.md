# Working on teatime

This repo is a live product being iterated on directly with its owner. The
loop is: they use the running app (usually via the GitHub Pages link,
sometimes by describing what they want), give feedback in plain language,
and Claude takes it all the way to pushed on `main` — no intermediate
check-ins. This file is the standing authorization and the conventions
that make that safe. It applies to any Claude session working in this
repo, not just the one that wrote it.

## Talking to the owner

The owner is a physician, not an engineer, and this is their own investing
tool. Write to them as a consultant reporting a result, not as a developer
narrating work. In the owner's own words: "assume I want the result, not the
process."

- **Be short.** Two to four sentences unless they ask for detail.
- **No jargon.** No git internals, no file paths, no library or function
  names, no code-speak — unless they directly ask how something works.
- **Frame changes as outcomes, not mechanics.** "This makes your rankings
  update faster," not "this refactors the caching layer."
- **End with one clear recommendation.** The single best next step, not a
  menu of options to choose between.
- **Flag risks before acting, in plain terms.** "This could slow your app
  down," not "this is O(n²)." If they're heading somewhere risky, name the
  safer alternative rather than only warning.
- **Report failures plainly.** If something didn't work, or a number
  disagrees with what their broker says, say so directly — this is a tool
  they make money decisions with.

This governs replies in the conversation only. Commit messages, code
comments, and the docs in this repo stay as technical and detailed as the
work warrants — they're written for whoever picks the code up next, which
isn't the owner.

## Shipping: commit directly to `main`, then keep the app in sync

No feature branches, no PRs. This is a single-owner repo with no CI and no
other reviewer, so the branch/PR/squash-merge dance was pure ceremony with
no safety benefit — a one-line change paid the same overhead as a large
one.

- Work directly on `main`. Before starting: `git fetch origin main && git
  reset --hard origin/main` (stash first if you're resuming uncommitted
  work) so you're never committing on top of stale local history.
- Test per the bar below, then `git commit` and `git push origin main`
  directly. No branch to open, no PR to merge.

But committing to `main` isn't the same as the owner seeing the change.
The app the owner actually looks at is a static GitHub Pages snapshot
(`docs/index.html`), not a live copy of the code — it can't reach FMP
directly or hold a secret API key (a static site has no server at all), so
it's assembled from a locally-run `server.js` and embedded with real data.
A change isn't done until this snapshot is rebuilt and pushed too, even
though it's a separate mechanical step from the code change itself.

Public URL: https://vandyckmed-droid.github.io/teatime/. GitHub Pages is
configured to serve from `main`, `/docs` folder — enabled once already,
nothing further to toggle on GitHub's side for future updates. Served at
its own origin, so "Add to Home Screen" on iOS gets the real standalone-app
experience: full screen, no Safari chrome, tinted status bar.

### Building and publishing the snapshot

1. Boot `server.js` locally with a real `API_KEY`/`FMP_API_KEY`.
2. Pull a fresh snapshot: `GET /api/leaderboard`, then
   `GET /api/history/batch?symbols=A,B,C,...` for every company in that
   snapshot in one call (not one request per symbol — see the
   Extensibility section below on why).
3. Assemble a single self-contained HTML file: inline `public/styles.css`,
   the `<main class="app">…</main>` body from `public/index.html` (its
   footnote line needs overriding to the "snapshot preview, not live"
   wording), and `public/app.js` with its network-touching functions
   patched to read from embedded data instead of fetching:
   - `loadLeaderboard` → returns `EMBEDDED_LEADERBOARD` directly.
   - `loadHistoryFor` → looks up `EMBEDDED_HISTORY[symbol]` instead of
     calling `/api/history`.
   - `loadAllHistories` → populates `historyCache` directly from
     `EMBEDDED_HISTORY` for the requested symbols instead of calling
     `/api/history/batch`.
   No fonts to embed — system fonts need no asset.
   Embedded history is trimmed to ~3 years and stored as bare `[date, close]`
   pairs, rehydrated by a `decodeEmbeddedHistory` helper the assembler adds.
   Both matter: five years of the API's object-per-point shape made this file
   12MB, most of it the words "date" and "close" repeated 300,000 times. The
   trim has two consequences the assembler handles, and any future range
   change has to keep handling — the 5Y chart range is removed from the
   bundle's `CHART_RANGES`, and `DATE_RANGE_MAX_DAYS_AGO` is capped inside the
   embedded span, so nothing in the bundle can ask for data that isn't there.
4. Test the assembled file by opening it with Playwright over `file://`
   (proves it truly has no network dependency) before publishing.
5. Copy the assembled file to `docs/index.html` and commit it straight to
   `main` (that's the whole deploy — no build step, no Actions workflow).

One cost worth knowing about: each redeploy commits a new ~4MB HTML file (the
embedded data is what makes it self-contained), so `docs/index.html`'s history
adds up in repo size over many iterations. Not a problem at this scale; flag
it if it ever becomes one.

## Standing authority (no need to ask)

- Decide the implementation approach for a feature request. The owner
  wants outcomes and something to react to, not design options to choose
  between.
- The one thing that still warrants asking first: a change that would be
  expensive or awkward to undo (deleting user-facing functionality
  outright, a schema-like change to `localStorage` keys that would
  silently drop existing users' saved state, adding a paid dependency).
  Everything else in the normal edit → test → ship loop does not need a
  check-in.

## Consultation mode

The owner can put a session into consultation mode explicitly ("consultation
mode," "read only," "just walk me through this") — treat it as a hard
boundary, not a soft preference:

- Analysis and discussion only. Read code, answer questions, explain how
  something works or why it's built that way, reason through tradeoffs —
  all in conversation, nothing written to disk.
- Do not generate code changes or create new files. This includes changes
  that feel trivial or obviously correct — a one-line fix offered "while
  we're here" is still a file write.
- If something comes up that genuinely seems worth changing, say so and ask
  to exit consultation mode before touching anything — don't just do it
  because the change is small.
- Consultation mode holds until the owner lifts it, or gives an explicit
  go-ahead for a specific change (which authorizes that change only, not a
  general exit).

This doesn't override anything else in this file — once the owner is back
to the normal loop, the standing authority above applies as usual.

## /prune — code & doc pruning pass

Trigger: the owner says `/prune` or asks for a cleanup/pruning pass.

Scan the repo for dead code, stale documentation, and inconsistencies.
Remove obvious junk without asking.

**Remove without asking:**
- Unused functions, imports, or variables
- Comments that contradict current code behavior
- Documentation describing logic that no longer exists
- Dead branches or feature flags that are always on/off
- Stale TODOs or notes (no context, no linked issues)

**Fix without asking:**
- Inconsistencies between docs and actual behavior
- Docstrings that describe old signatures or removed parameters
- Typos, formatting, broken links

**Ask briefly (one-liner) only for:**
- Unused code that might be intentional (placeholder, experimental, etc.)
- Documentation you can't confidently say is stale
- Config/constants with no references — might be sentinel values

**After cleanup:** test per the testing bar below, then commit directly to
`main` (see "Shipping" above — no branch, no PR) with a summary of removals
at the top of the commit message. List any skipped items (things you asked
about) at the end.

## /polish — design polish pass

Trigger: the owner says `/polish` or asks for a design/UI polish pass.

Audit the UI for visual consistency and polish. Improve layout, color,
typography, spacing, and visual hierarchy. Keep the core aesthetic — just
sharper.

**Improve without asking:**
- Inconsistent spacing, padding, margins (standardize to scale)
- Font sizes or weights that don't match established hierarchy
- Color mismatches or low-contrast text
- Alignment issues, misaligned elements, or ragged spacing
- Shadow depth or blur inconsistencies
- Border radii or stroke weights that don't match the system
- Orphaned or awkwardly sized elements
- Typography that doesn't match the declared font stack (`--font-sans`
  / `--font-mono`)

**Enhance without asking:**
- Subtle texture, gradient, or depth where it's visually flat
- Shadow refinements (distance, blur, opacity) for better hierarchy
- Letter spacing or line height tweaks for readability
- Missing hover/press/focus states or transitions
- Icon sizing or alignment to baseline

**Ask briefly (one-liner) only for:**
- Significant color shifts (new palette or tone)
- Layout restructuring (major reflow, reordering)
- Font changes — this app is already hard-locked to the OS system stack
  (see "Phone-sized layout" below), so this only ever means "swap away
  from that," never a weight/size tweak within it
- Visual approaches you're unsure match the intended mood

**After polish:** screenshot before/after if visually significant, per the
testing bar below, then commit directly to `main` (see "Shipping" above —
no branch, no PR). Note what you improved at the top of the commit message.

## Testing bar before shipping any UI change

- `node --check` the touched `.js` files.
- Boot the server (`PORT=<free-port> nohup node server.js > /tmp/x.log 2>&1 &`)
  and drive it with Playwright — this repo has no committed test suite, so a
  scripted Playwright pass *is* the test suite for each change. Use the
  global install: `/opt/node22/lib/node_modules/playwright`, Chromium at
  `/opt/pw-browsers/chromium`. Test at a phone-sized viewport
  (`devices['iPhone 14 Pro']` is a convenient preset — no requirement that
  the design itself be iOS-specific, just that it fits a real phone screen).
- The app is dark-only (see "Phone-sized layout" below) — no need to test
  a light color scheme.
- Take screenshots and actually look at them. Playwright assertions catch
  logic bugs; they don't catch a clipped element, a wrapped label, or a
  color pair that doesn't read right. Both matter before calling it done.

## Phone-sized layout, not a responsive webpage

The product owner was explicit about this: no desktop layout to maintain,
no breakpoint compromises — a design that fits a phone screen, not a
requirement to look or behave like a native iOS app specifically.
Concretely:
- Fonts are the OS system stack (`-apple-system`, `ui-monospace`) — never
  add a downloaded webfont back in for the live app. It should render as
  real SF Pro / SF Mono on the owner's phone.
- Layout is a fixed phone-width column (see `.app { max-width: 480px }` in
  `public/styles.css`), not a fluid responsive grid.
- Dark is the only theme (`public/styles.css`'s `:root` block) — there's no
  light-mode CSS anymore and no `prefers-color-scheme`/`data-theme` branching
  to maintain. Don't reintroduce a light variant without being asked.
- No requirement to follow iOS-specific chrome idioms (bottom tab bar,
  large-title headers, grouped-list settings rows, a bottom sheet instead
  of a modal, etc.). The current app happens to use those patterns — that's
  the existing implementation, not a standing rule to keep building more of
  them. Any phone-appropriate design pattern is fine going forward.

## Extensibility patterns already in place — use them, don't route around them

- `SETTINGS` in `public/app.js` is a config array; each entry renders a
  Settings row generically by `type` (`'toggle'`, `'threshold'`,
  `'daterange'`). A new setting is a new array entry plus, if it's a new
  `type`, one more branch in `renderSettings()` — not a bespoke one-off
  section. It doubles as the schema for what's persisted: `loadSettings()`
  reads stored values back key by key and drops anything no longer listed, so
  a removed setting takes its saved value with it instead of leaving a dead
  key in `localStorage`.
- `DETAIL_BLOCKS` in `public/app.js` is the same idea for the full-screen
  per-ticker view, and it exists specifically to be a dumping ground — the
  owner's framing: "a graveyard of data and experiments." Each entry is one
  card; adding a panel is adding an entry, removing it is deleting the entry,
  and nothing else in the app refers to them. A `render` that returns null
  drops its own card, and one that throws is caught and skipped rather than
  taking the page down. Put new per-company data here rather than
  engineering it into the row or the card — that's the whole point of the
  view existing.
- `METRICS` / `CHART_RANGES` in `src/config.js` / `public/app.js` are the
  same pattern for return windows. Ranks/Watchlist ranking is a custom
  date range (Settings-driven); the per-ticker chart sheet has its own
  window toggle. No standing rule on how connected these two should be —
  judge it fresh each time a feature touches both.
- The tab bar is Ranks / Investing / Settings, and Investing holds two views
  (`INVESTING_VIEWS` in `public/app.js`): the portfolio card and the saved
  names. It was called Watchlist until the portfolio card grew tall enough to
  push the names off the bottom of a shared scroll. `#watchlist` still routes
  there (`TAB_ALIASES`) so old links keep working. A view that contains a chart
  has to draw it *after* being shown — a hidden wrapper measures zero, and
  these charts size themselves in real pixels. `INVESTING_VIEWS` is also what
  the stored view is validated against, so removing an entry retires it
  cleanly: anyone whose phone remembers it lands on the first view instead of
  a blank panel.
- `src/correlation.js` answers one question — `correlationsAgainst`, the
  universe against the held set, which is what fades a board row. Signed,
  never `|r|`: a strong negative is diversification, and taking the absolute
  value would block exactly the names worth adding. An all-pairs matrix and an
  Overlap view that drew it as a heat grid were built and then removed at the
  owner's request; the shape is in the history if it's ever wanted again.
- Anything the `state` object or the `detail` object reads while being built
  must be declared above it. Both have now caused the same
  temporal-dead-zone bug: the error surfaces as a blank board or a silently
  wrong default (`loadInvestingView`'s try/catch swallowed the ReferenceError
  and returned the fallback), not as an obvious crash.
- The watchlist is a stored set of symbols and nothing else, deliberately.
  Settings decide what "add next ranked" (`addNextRanked` / the empty-state
  plus) picks at the moment of the tap; they never retroactively change what's
  held. A saved name leaves only by its own check or Clear watchlist — keep
  it that way, and don't add anything that prunes the set when the window or
  the correlation threshold moves.
- `drawLineChart` in `public/app.js` draws every line chart in the app — the
  per-ticker price line and the portfolio balance line. A third chart should
  be a fourth call, not a second renderer. Two things it has to keep doing:
  the element ids the detail chart carries (`#chart-line-path` and friends)
  are emitted for that chart only, since ids must be unique and both charts
  can be on screen at once, and every internal lookup is scoped to the
  wrapper and keyed on classes. The same applies to tests — a bare
  `.chart-axis-y` or `.chart-tick` selector now matches both charts.
- `PORTFOLIO_WINDOWS` / `RANGE_WINDOWS` in `public/app.js` are the same
  shape again, for the portfolio chart's and the price range card's own
  toggles. The range card's high/low come from the symbol's daily closes over
  the window, deliberately *not* from FMP's 52-week figures for the 12M case:
  those are intraday extremes, and mixing the two would make one pill
  disagree with the rest for no visible reason. Both constants must stay
  declared above the `detail` object, which reads their defaults — a `const`
  below it throws a temporal-dead-zone error at load and leaves the board
  blank.
- `RANK_WINDOW_PRESETS` in `public/app.js` backs the pills above the Ranks
  board; a new preset is a new entry. They and the Settings steppers are two
  views of one stored value, so each re-renders the other, and a pill lights
  only on an exact match — a stepper nudge leaves them all dark, which is
  the honest reading of "the window is no longer one of these". Day counts
  are approximate on purpose (the owner's framing): "12M" names a window, it
  isn't a claim about a calendar year.
- Backend history/leaderboard dedupe and "insufficient history" handling are
  centralized (`src/leaderboard.js`, `src/history.js`) — extend those rather
  than special-casing a symbol or a window inline.
- `universeSize` in `src/config.js` is the scaling dial, expected to move
  both directions repeatedly (the owner's own framing: "bigger and better,"
  then "removal and cutting"). Bump or cut it — `screenerCandidatePool`
  should stay a healthy margin above it since screener results get deduped
  and filtered down. The trap when growing: `screenerMinMarketCap` is the
  real ceiling and binds long before `screenerCandidatePool` does — at $50B
  the screener only had 234 US names to give, so `universeSize: 250` silently
  delivered 234. It bounds the candidate pool only (the top N by market cap
  is still taken from whatever comes back), so lowering it doesn't make the
  board less selective. Check the headroom before bumping — at $22B (the
  floor set for `universeSize: 300`) the screener returns ~440 names, ~425
  after the junk-listing filter below.
- That filter is the other thing to know when growing the universe. FMP's
  screener returns bond and preferred lines alongside operating companies,
  and they carry their *parent's* market cap, so they sort in as a second
  copy of a company already on the board (AT&T's "5.35% GLB NTS 66" was
  sitting at rank 76). `src/leaderboard.js` drops them on two signals from
  the screener row itself — debt/preferred wording in the name, and under
  $1M a day of trading — and picks between a company's remaining lines by
  what trades rather than by market cap, since duplicate lines report
  near-identical caps. Growing the universe surfaces more of these, not
  fewer: re-check the drop list rather than assuming the two rules still
  cover it.
- The owner's own account balances live in `data/portfolio/balances.csv`,
  maintained by hand from brokerage screenshots and summarized by
  `src/portfolio.js` behind `GET /api/portfolio` (embedded as
  `EMBEDDED_PORTFOLIO` in the snapshot bundle). Two standing rules: figures
  are derived from those dates and dollar amounts alone and are *not* to be
  reconciled against the broker's own rate of return, which uses a baseline
  the file doesn't contain; and daily returns are only taken across
  genuinely consecutive trading sessions, so a missing day can't masquerade
  as one very volatile day. Its holiday set is 2026-only — extend it when
  the series runs into 2027. New rows are appended and everything downstream
  picks them up on the next request.
- Analyst ratings live in `data/ratings/ratings.csv`, append-only by (date,
  symbol) and read by `src/ratings.js` behind `GET /api/ratings` (embedded as
  `EMBEDDED_RATINGS` in the bundle). The point of the file is the time series,
  so never overwrite a symbol's earlier row — append a new date. A row with an
  empty rating and score is a real observation meaning "nothing published that
  day", not a blank to be cleaned up. New labels go in `RATING_SCALE`
  (`src/ratings.js`) and `RATING_TONE` (`public/app.js`), which are the same
  scale duplicated for want of a shared module. These never feed the ranking.
- `data/market/spy.csv` is the one data file here that is *not* append-only,
  and the distinction is the rule to keep: the portfolio and ratings files are
  hand-kept observations that refetching would destroy, while this one is a
  straight mirror of FMP and is rewritten in full on every refresh, which makes
  it self-correcting and costs almost nothing in the diff (stable dates, only
  the tail moves). Read by `src/market.js`, consumed only by the portfolio
  card's beta figure. Its returns are *total* returns — the dividend is added
  back on its ex-date, because FMP's "dividend-adjusted" price endpoint hands
  back closes identical to the plain ones and adjusts nothing. If a second
  benchmark is ever wanted, add a column or a sibling file and keep the same
  rewrite-in-full posture; don't start appending to this one.
- Beta (`computeBeta` in `src/portfolio.js`) pairs the portfolio's daily
  returns with SPY's by date — an inner join, trailing 126 pairs, hidden below
  60. Three things there are load-bearing and easy to "simplify" wrongly:
  nothing is ever zero-filled or forward-filled (a fabricated flat day against
  a real market move pulls beta toward zero); the steps already dropped from
  the volatility figure for spanning a recording gap are dropped here by
  construction, because the join walks that same filtered list; and the figure
  has to be computed server-side, since the published bundle embeds
  `EMBEDDED_PORTFOLIO` and cannot fetch anything at page load.
- Daily board snapshots accrue in `data/snapshots/` via `scripts/snapshot.js`
  and the one workflow in the repo (`.github/workflows/daily-snapshot.yml`).
  Append-only and deliberately stores inputs rather than one ranking — extend
  what a file holds rather than adding a second archive, and don't rewrite
  past files. That workflow also refreshes `data/market/spy.csv` first, and
  its commit step stages both paths — a new data directory that isn't in that
  `git add` line is written by the runner and then thrown away with it, which
  is exactly how a month of snapshots was lost once already. Outbound FMP calls (per-company in `src/leaderboard.js`,
  and history in `src/history.js`) go through `mapWithConcurrency`
  (`src/concurrency.js`) capped at `config.fmpConcurrency`, not unbounded
  `Promise.all` — this is what keeps a bigger `universeSize` from turning
  into a burst of simultaneous FMP requests.
- The old "fetch-everything-on-load, past a few hundred companies this
  breaks" ceiling has been addressed: `src/dataStore.js` refreshes the whole
  universe (price/returns/market cap/history) on a once-daily timer instead
  of per-request — this data is end-of-day, so nothing is gained by checking
  more often, and a refresh cycle is all-or-nothing (nothing commits until
  every fetch it needs has succeeded, so a failed cycle just keeps serving
  last-known-good data and logs, rather than partially updating). Sector,
  beta, and IPO-date ("slow facts") arrive for free in that same fetch but
  are only committed on their own much slower cadence
  (`config.slowFactsRefreshMs`, ~quarterly) — this costs zero extra API
  calls, it just decides whether to use the fresh values or keep the
  retained ones. Ranking (`src/ranking.js`) now runs server-side over the
  store's history via `GET /api/rank?startDaysAgo=&endDaysAgo=&volAdjusted=`,
  which returns only a `{symbol: score}` map — the browser no longer
  downloads the whole universe's raw daily-close history just to rank it.
  The frontend (`refreshRankings()` in `public/app.js`) tries `/api/rank`
  first and falls back to the old client-side computation over
  `loadAllHistories`-fetched history when that call fails or isn't
  reachable — which is exactly what happens on the static-snapshot preview
  channel above, since it has no backend to answer `/api/rank` at all;
  `EMBEDDED_LEADERBOARD` being defined is the signal that bundle uses to
  skip the live-endpoint attempt outright rather than let it fail into the
  console every load. The detail sheet draws one chart and one only — the
  price line over the range the pills pick — from the single symbol's own
  history, so it needs no endpoint of its own. Several richer chart views
  have been tried here and all of them have since been reverted; the plain
  price line is the deliberate resting state, not a stub waiting to be
  filled in. This holds well past a few hundred companies now; the remaining
  cost to watch as `universeSize` keeps growing is the once-daily refresh
  cycle's own wall-clock time (bounded by `config.fmpConcurrency`) and the
  size of the in-memory store, not per-visitor load.
