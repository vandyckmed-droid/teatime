# Working on teatime

This repo is a live product being iterated on directly with its owner. The
loop is: they use the running app (usually via the standalone preview link,
sometimes by describing what they want), give feedback in plain language, and
Claude takes it all the way to merged on `main` — no intermediate check-ins.
This file is the standing authorization and the conventions that make that
safe. It applies to any Claude session working in this repo, not just the one
that wrote it.

## Standing authority (no need to ask)

- Create branches, open PRs, mark them ready, merge them, and (when
  possible) delete the branch afterward — all without checking in first.
- Restart the shared feature branch from `main` and force-push over it (see
  below). This repo has no other collaborators; there is nothing to clobber.
- Decide the implementation approach for a feature request. The owner wants
  outcomes and something to react to, not design options to choose between.
- The one thing that still warrants asking first: a change that would be
  expensive or awkward to undo (deleting user-facing functionality outright,
  a schema-like change to `localStorage` keys that would silently drop
  existing users' saved state, adding a paid dependency). Everything else in
  the normal edit → test → ship loop does not need a check-in.

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

## /quote — scope check before planning

Trigger: the owner says `/quote <topic>` or "give me a quote on X."

- Give a rough read in a few sentences: problem shape, likely effort/risk,
  where the complexity actually lives. Not a full plan.
- Do not propose a plan, file changes, or a task breakdown at this stage.
- Only move to planning/implementation if the owner explicitly follows up
  with something like "okay, plan it."

This works whether or not consultation mode is active — it's a scoping
estimate, not a commitment, so it doesn't by itself authorize any change.

## /unleash — constraint review

Trigger: the owner says `/unleash` or "unleash my constraints."

- List active constraints/assumptions from `CLAUDE.md`, skills, and prior
  instructions in plain language.
- Rank by likely unintentional cost (friction, overhead, blocked
  improvements) — most costly first, one line of reasoning each.
- For each one, also give its maximally flexible alternative: the simplest
  approach in direct opposition to the constraint, stated plainly in a
  sentence or two — not a middle-ground compromise, the actual opposite
  extreme.
- Do not propose fixes or changes unless asked — listing the flexible
  alternative is part of the read, not a recommendation to adopt it.

Same spirit as `/quote`: this is a read, not a commitment. It doesn't
authorize dropping or changing any constraint on its own.

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
- Missing hover/press/focus states or transitions (iOS idioms — see
  "This is an iPhone interface" below)
- Icon sizing or alignment to baseline

**Ask briefly (one-liner) only for:**
- Significant color shifts (new palette or tone)
- Layout restructuring (major reflow, reordering)
- Font changes — this app is already hard-locked to the OS system stack
  (see "This is an iPhone interface" below), so this only ever means
  "swap away from that," never a weight/size tweak within it
- Visual approaches you're unsure match the intended mood

**After polish:** screenshot before/after if visually significant, per the
testing bar below, then commit directly to `main` (see "Shipping" above —
no branch, no PR). Note what you improved at the top of the commit message.

## /overhaul — full visual redesign

Trigger: the owner says `/overhaul` or asks for a full redesign/visual
overhaul.

Rebuild the UI's visual language from scratch — new color system,
typography scale, spacing model, shadows, radii, interactions. Don't
preserve the old approach, improve it fundamentally. This is deliberately
the opposite of `/polish`: `/polish` keeps the aesthetic and sharpens it,
`/overhaul` is free to replace it.

Two things stay fixed regardless, since they're explicit product decisions
this app has made repeatedly, not "the old approach" being overhauled: the
OS system font stack (no downloaded webfonts) and the fixed-width,
dark-only, iOS-idiom shell (bottom tab bar, large-title headers, bottom
sheet, grouped-list settings) — both covered in "This is an iPhone
interface" below. Redesign everything inside those two boundaries as
aggressively as you want.

**Redesign without asking:**
- Complete layout restructure within the fixed-width iOS shell (grid,
  flow, component organization)
- Color palette swap (new primary, secondary, accent, neutrals) — still
  dark-only, no light variant
- Typography overhaul within the system font stack (new weight system,
  size scale, hierarchy)
- Spacing system (new baseline, scale, density)
- Shadow and depth model (new visual language)
- Border radii, stroke weights, visual texture (start fresh)
- Interaction states (hover, focus, active, disabled) — design from
  scratch
- Visual hierarchy (contrast, sizing, positioning)
- Alignment model, component sizing, proportions

**Ship without asking:**
- New icon set if current one doesn't fit the aesthetic
- Refined animations or transitions that match new mood
- Revised component library with new baseline
- Updated color tokens, shadow definitions, spacing scale

**Ask briefly (one-liner) only for:**
- Major structural decisions if multiple strong approaches exist
- Mood/tone if you're uncertain what the target aesthetic is
- Specific UI patterns (modal styling, navigation approach, etc.) if
  undefined

**After overhaul:** before/after screenshots essential, per the testing
bar below. Commit all at once or in logical visual systems, directly to
`main` (see "Shipping" above — no branch, no PR). Describe the new
aesthetic, rationale, and what changed at the top of the commit message.

## Parking ideas

Not every idea the owner floats should turn into a build-it-now task. When
asked to think through an idea "for later" — filed away, not implemented,
just analyzed — file it under `ideas/` instead of just discussing it in
conversation and losing it to context rot:

- One markdown file per idea, `ideas/<kebab-case-name>.md`. Stamp the top
  with:
  ```
  **Status:** Parked — not started
  **Difficulty:** Easy | Medium | Hard
  **Benefit:** Low | Medium | High
  **Filed:** <date>
  ```
  followed by a one-line summary, what it is, why it might (and might not)
  be worth doing, an implementation sketch, and open questions — enough for
  a future session (or the owner) to pick it up cold without re-deriving the
  analysis.
- These are preliminary, gut-check ratings, not a committed estimate — the
  point is a quick sort signal (worth revisiting soon vs. someday vs.
  probably not), not a project-planning artifact. Don't over-invest in
  precision here.
- Add a row to `ideas/README.md`'s index table (name, difficulty, benefit,
  status) so the whole set is scannable at a glance without opening every
  file.
- Filing an idea is analysis, not a commitment — same rule as consultation
  mode: don't write feature code as a side effect of writing up the idea.
  Building it later is a separate, explicit ask.
- When an idea does get picked up, update its `Status` (`In progress` /
  `Shipped` / `Rejected: <reason>`) rather than deleting the file — it's a
  record of what was considered and why, not just a todo list.

## Shipping: commit directly to `main`

No feature branches, no PRs. This is a single-owner repo with no CI and no
other reviewer, so the branch/PR/squash-merge dance was pure ceremony with
no safety benefit — a one-line change paid the same overhead as a large one.

- Work directly on `main`. Before starting: `git fetch origin main && git
  reset --hard origin/main` (stash first if you're resuming uncommitted
  work) so you're never committing on top of stale local history.
- Test per the bar below, then `git commit` and `git push origin main`
  directly. No branch to open, no PR to merge.
- The old long-lived branch (`claude/top-10-us-companies-returns-dcsgnn`)
  is retired — don't push new work there.

## Testing bar before shipping any UI change

- `node --check` the touched `.js` files, and parse-check `public/app.js`
  with `new Function(fs.readFileSync(...))` (it's not run under Node's
  module system).
- Boot the server (`PORT=<free-port> nohup node server.js > /tmp/x.log 2>&1 &`)
  and drive it with Playwright — this repo has no committed test suite, so a
  scripted Playwright pass *is* the test suite for each change. Use the
  global install: `/opt/node22/lib/node_modules/playwright`, Chromium at
  `/opt/pw-browsers/chromium`. Test at an iPhone viewport
  (`devices['iPhone 14 Pro']`) since this is an iPhone-only interface — see
  below.
- The app is dark-only (see "This is an iPhone interface" below) — no need
  to test a light color scheme.
- Take screenshots and actually look at them. Playwright assertions catch
  logic bugs; they don't catch a clipped element, a wrapped label, or a
  color pair that doesn't read right. Both matter before calling it done.

## This is an iPhone interface, not a responsive webpage

The product owner was explicit about this: no desktop layout to maintain,
no breakpoint compromises. Concretely:
- Fonts are the OS system stack (`-apple-system`, `ui-monospace`) — never
  add a downloaded webfont back in for the live app. It should render as
  real SF Pro / SF Mono on the owner's phone.
- Layout is a fixed phone-width column (see `.app { max-width: 480px }` in
  `public/styles.css`), not a fluid responsive grid.
- Chrome follows iOS idioms: bottom tab bar with outline/filled icon swap,
  large-title nav headers, grouped-list settings rows, iOS-style switches
  and steppers, a bottom sheet (not a modal dialog) for drill-down detail.
  There's no dedicated iOS/HIG skill installed in this account (checked via
  `SearchSkills` — only `canvas-design` and `brand-guidelines` exist, neither
  fits); work from Apple's Human Interface Guidelines directly.
- Dark is the only theme (`public/styles.css`'s `:root` block) — there's no
  light-mode CSS anymore and no `prefers-color-scheme`/`data-theme` branching
  to maintain. Don't reintroduce a light variant without being asked.

## Extensibility patterns already in place — use them, don't route around them

- `SETTINGS` in `public/app.js` is a config array; each entry renders a
  Settings row generically by `type` (`'toggle'`, `'daterange'`, ...). A new
  setting is a new array entry plus, if it's a new `type`, one more branch in
  `renderSettings()` — not a bespoke one-off section.
- `METRICS` / `CHART_RANGES` in `src/config.js` / `public/app.js` are the
  same pattern for return windows. Ranks/Watchlist ranking is a custom
  date range (Settings-driven); the per-ticker chart sheet has its own
  window toggle. No standing rule on how connected these two should be —
  judge it fresh each time a feature touches both.
- Backend history/leaderboard dedupe and "insufficient history" handling are
  centralized (`src/leaderboard.js`, `src/history.js`) — extend those rather
  than special-casing a symbol or a window inline.
- `universeSize` in `src/config.js` is the scaling dial, expected to move
  both directions repeatedly (the owner's own framing: "bigger and better,"
  then "removal and cutting"). Bump or cut it — `screenerCandidatePool`
  should stay a healthy margin above it since screener results get deduped
  and filtered down. Outbound FMP calls (per-company in `src/leaderboard.js`,
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
  reachable — which is exactly what happens on the two static-snapshot
  preview channels below, since neither has a backend to answer `/api/rank`
  at all; `EMBEDDED_LEADERBOARD` being defined is the signal those bundles
  use to skip the live-endpoint attempt outright rather than let it fail
  into the console every load. This holds well past a few hundred
  companies now; the remaining cost to watch as `universeSize` keeps
  growing is the once-daily refresh cycle's own wall-clock time
  (bounded by `config.fmpConcurrency`) and the size of the in-memory store,
  not per-visitor load.

## Preview channel: GitHub Pages is what the owner actually looks at

The owner only uses the GitHub Pages link — there's no separate Artifact
channel to keep in sync anymore, and no live-hosted deployment either. It
can't reach FMP directly or hold a secret API key (a static site has no
server at all), so it's a static snapshot assembled from a locally-run
`server.js`, not a live-fetching copy of the app. A change isn't shipped
until this snapshot is rebuilt and pushed, even though it's a separate step
from the code change itself.

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
   Extensibility section above on why).
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
4. Test the assembled file by opening it with Playwright over `file://`
   (proves it truly has no network dependency) before publishing.
5. Copy the assembled file to `docs/index.html` and commit it straight to
   `main` (that's the whole deploy — no build step, no Actions workflow).

One cost worth knowing about: each redeploy commits a new ~2.5MB HTML file
(the embedded data is what makes it self-contained), so `docs/index.html`'s
history adds up in repo size over many iterations. Not a problem at this
scale; flag it if it ever becomes one.

The Artifact preview that used to be a second channel is retired — don't
republish it going forward.
