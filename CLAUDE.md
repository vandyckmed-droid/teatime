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

## The standalone preview link

The owner's primary way of reviewing work is a single persistent Artifact
URL — https://claude.ai/code/artifact/f3363de1-0c82-4e1d-a349-283203af7b4f —
not a locally-run server, since Artifacts can't reach FMP directly (sandboxed,
no arbitrary external fetch) or hold a secret API key safely. After merging
a change to `main`:

1. Boot `server.js` locally with a real `API_KEY`/`FMP_API_KEY`.
2. Pull a fresh snapshot: `GET /api/leaderboard`, then `GET /api/history?symbol=X`
   for every company in that snapshot (all 10, in parallel).
3. Assemble a single self-contained HTML file: inline `public/styles.css`,
   the `<main class="app">…</main>` body from `public/index.html` (its
   footnote line needs overriding to the "snapshot preview, not live" wording
   — see below), and `public/app.js` with its two `fetch()` calls
   (`loadLeaderboard`, `loadHistoryFor`) replaced by reads from
   `EMBEDDED_LEADERBOARD` / `EMBEDDED_HISTORY` constants holding the JSON you
   just pulled. No fonts to embed — system fonts need no asset.
4. Test the assembled file by opening it with Playwright over `file://`
   (proves it truly has no network dependency, matching the Artifact
   sandbox) before publishing.
5. Publish via the `Artifact` tool with `url` set to the URL above, so it
   redeploys in place rather than minting a new link. Keep the same favicon
   (📈) across redeploys.

This means every feature lands in two places: the real repo (source of
truth, always live-fetching) and a redeployed snapshot of it (what the owner
actually clicks on). Don't consider a change shipped until both are done.
