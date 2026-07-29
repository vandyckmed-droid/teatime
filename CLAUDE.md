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

## Branch & PR workflow

- All work happens on a single long-lived branch:
  `claude/top-10-us-companies-returns-dcsgnn`. Don't invent a new branch name
  per feature.
- Because every PR from this branch gets merged (usually squashed), the
  branch and `main` diverge in history even when their content matches.
  Before starting new work:
  ```
  git fetch origin main
  git checkout -B claude/top-10-us-companies-returns-dcsgnn origin/main
  ```
  If you're resuming uncommitted work, `git stash` before the reset and
  `git stash pop` after.
- Push with `git push --force-with-lease -u origin claude/top-10-us-companies-returns-dcsgnn`.
  Force-push is fine here — verify first that the remote branch's content is
  already fully merged into `main` (`git diff <remote-branch-sha> <main-squash-sha> --stat`
  should be empty) if you want to double check, but in practice this branch
  only ever holds either unmerged work-in-progress or already-merged history.
- Open PRs directly as **ready, not draft** (`draft: false`) — there's no CI
  and no other reviewer, so a draft stage is a no-op click. Check
  `pull_request_read` → `get_status` (expect no checks configured) and merge
  with `merge_method: "squash"`.
- Branch deletion after merge will likely fail with a 403 (this session's git
  credentials can delete files but not refs). That's fine — leave it, it's
  harmless, don't spend time working around it.
- If a merge attempt 405s with "has merge conflicts" right after a squash
  merge landed, it's almost always the squash-history mismatch, not a real
  conflict: reset the branch from `origin/main` again, reapply your commit on
  top, force-push, retry.

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
- Check both color schemes (`colorScheme: 'light'` and `'dark'`) — this app
  fully themes both, and it's a real design surface, not decoration.
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

## Extensibility patterns already in place — use them, don't route around them

- `SETTINGS` in `public/app.js` is a config array; each entry renders a
  Settings row generically by `type` (`'toggle'`, `'daterange'`, ...). A new
  setting is a new array entry plus, if it's a new `type`, one more branch in
  `renderSettings()` — not a bespoke one-off section.
- `METRICS` / `CHART_RANGES` in `src/config.js` / `public/app.js` are the
  same pattern for return windows. Ranks/Watchlist ranking is a custom
  date range (Settings-driven); the per-ticker chart sheet's own window
  pills are a separate, independent control — don't conflate the two again.
- Backend history/leaderboard caching, dedupe, and "insufficient history"
  handling are centralized (`src/leaderboard.js`, `src/history.js`) — extend
  those rather than special-casing a symbol or a window inline.
- `universeSize` in `src/config.js` is the scaling dial, expected to move
  both directions repeatedly (the owner's own framing: "bigger and better,"
  then "removal and cutting"). Bump or cut it — `screenerCandidatePool`
  should stay a healthy margin above it since screener results get deduped
  and filtered down. Outbound FMP calls (per-company in `src/leaderboard.js`,
  and history in `src/history.js`) go through `mapWithConcurrency`
  (`src/concurrency.js`) capped at `config.fmpConcurrency`, not unbounded
  `Promise.all` — this is what keeps a bigger `universeSize` from turning
  into a burst of simultaneous FMP requests. The frontend loads the whole
  universe's history in one call via `GET /api/history/batch?symbols=...`
  (`loadAllHistories` in `public/app.js`) rather than one request per
  company — extend the batch endpoint, don't add more per-symbol fetches, if
  boot time needs to improve further.
- This holds up to a few hundred companies as-is. Past that, the
  fetch-everything-on-load model itself needs to change: a scheduled
  server-side refresh instead of fetch-on-request, and ranking computed
  server-side instead of shipping raw history to the browser (25-30MB+ of
  JSON at S&P-500 scale otherwise). That's a real second project, not a
  config bump — don't start it without being asked.

## Charts: follow the dataviz skill, including its accessibility checks

Any new chart work should follow the project's dataviz skill procedure (form
→ color → validate → marks → interaction). Concretely learned from the
existing price chart: this app's `--gain`/`--loss` red/green pair **fails**
the palette validator's colorblind-separation check (CVD ΔE 4.7–5.3, under
the 6.0 floor). Recoloring the app is a real design decision, not something
to do as a side effect of an unrelated feature — the mitigation in place
instead is redundant encoding (▲/▼ glyph + explicit sign on every colored
return value, never color alone). Keep that pattern for new colored values;
raise recoloring the palette itself as an explicit, separate suggestion if
it comes up again.

The sector chip colors (`--sector-*` in `public/styles.css`, `SECTOR_VAR` in
`public/app.js`) have the same problem, worse: run as a 9-color categorical
set through the validator (needed once `universeSize` grew past 10 and more
sectors started appearing), it fails chroma-floor and CVD-separation hard —
not the borderline "under the 6.0 floor" case gain/loss is, some pairs came
back near 1.0 ΔE, barely distinguishable even with normal color vision. Two
rounds of hand-picked hue redesigns (even hue-wheel spacing, then boosted
saturation) both still failed. This was scoped out rather than chased
further: it's a secondary polish item, not the thing being shipped, and a
real fix needs either a proper systematic OKLCH palette search or accepting
fewer fully-distinct sector categories — both bigger asks than "add four
colors." Mitigation in place is the same principle as gain/loss: every chip
shows the sector name as text alongside the color, so identity never depends
on hue alone. Worth a real attempt if sector color-coding turns out to
matter more than expected in practice.

## Preview channels: the repo isn't what the owner actually looks at

Neither of the owner's two preview channels can reach FMP directly or hold
a secret API key — Artifacts are sandboxed (no arbitrary external fetch),
and a static GitHub Pages site has no server at all. Both are static
snapshots assembled from a locally-run `server.js`, not live-fetching
copies of the app. This means every feature lands in **three** places: the
real repo (source of truth, always live-fetching, needs Railway or a local
run to actually see data), and two redeployed snapshots. Don't consider a
change shipped until all three are done.

### Building the snapshot bundle (shared by both channels)

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
4. Test the assembled file by opening it with Playwright over `file://` in
   both color schemes (proves it truly has no network dependency) before
   publishing anywhere.

### Channel 1 — Artifact (zero-setup, but claude.ai-wrapped)

Persistent URL: https://claude.ai/code/artifact/f3363de1-0c82-4e1d-a349-283203af7b4f.
Publish the bundle via the `Artifact` tool with `url` set to that URL so it
redeploys in place rather than minting a new link. Keep the same favicon
(📈) across redeploys. Nothing to set up, works instantly — but because the
page is wrapped inside a claude.ai viewer rather than served at its own
origin, "Add to Home Screen" from there won't reliably trigger the
full-screen, no-Safari-chrome standalone mode the app's meta tags
(`apple-mobile-web-app-capable`, `theme-color`) are built for.

### Channel 2 — GitHub Pages (own URL, real install experience)

Public URL: https://vandyckmed-droid.github.io/teatime/. Copy the same
assembled bundle to `docs/index.html` in the repo (that's the whole
deploy — no build step, no Actions workflow) and ship it through the
normal branch/PR/merge flow like any other change. GitHub Pages is
configured to serve from `main` branch, `/docs` folder — enabled once
already; nothing further to toggle on GitHub's side for future updates.
Because this is served at its own origin (not wrapped in a viewer), "Add to
Home Screen" on iOS gets the real standalone-app experience: full screen,
no Safari chrome, tinted status bar — this is the channel that actually
looks and feels like a native app, at zero hosting cost since it's fully
static.

One cost worth knowing about: each redeploy commits a new ~2.5MB HTML file
(the embedded data is what makes it self-contained), so `docs/index.html`'s
history adds up in repo size over many iterations. Not a problem at this
scale; flag it if it ever becomes one.
