# The test suite

These Playwright scripts are the only tests this repo has, and a scripted pass
over them **is** the testing bar for every change (see CLAUDE.md). They lived
in session-scratch space for the app's first weeks — ~450 assertions that
would have vanished with the container — and were moved here so they survive
between sessions and accrue like everything else.

## Running them

Each suite is a plain Node script taking the target as its first argument;
without one they default to `http://localhost:3210` or, for the bundle-oriented
suites (`test_trim`, `test_snap`), the committed `docs/index.html`. Run them
from the repo root — several resolve paths relative to it, and from elsewhere
the failure is a swallowed module-not-found rather than an error.

```
PORT=3210 API_KEY=... node server.js &        # wait for "Leaderboard running"
node tests/test_expand.js http://localhost:3210
```

The whole sweep is just a shell loop:

```
for t in tests/test_*.js; do node "$t" http://localhost:3210; done
```

One suite needs no server at all: `test_beta_join.js` copies `src/` and the
data CSVs into a temp dir and exercises the beta join rules directly. It takes
the argument anyway and ignores it, so the sweep above stays uniform.

## The two modes

Suites that can run against the published bundle accept a `file://` target:

```
node tests/test_flags.js "file:///…/docs/index.html"
```

That mode is what proves the static snapshot truly has no network dependency
— several suites count off-origin requests and expect zero. Suites that need
a live backend (`/api/rank`, `/api/correlations`) are live-only; the
bundle-capable ones detect the mode themselves via `BASE.startsWith('file:')`
or `typeof EMBEDDED_LEADERBOARD`. Suites that only make sense in one mode —
`test_snap`/`test_trim` need the bundle, `test_beta` needs a backend to compare
the UI against — check for the wrong target up front and print a `SKIP - …`
line rather than dying on a `ReferenceError` or a refused connection. In a
sweep, a crashed suite and a suite that ran clean both print no `FAIL`, and
that is precisely how missing coverage hides: `test_beta`'s 25 assertions sat
dead for weeks because it read its target from `BASE` in the environment while
every other suite took `argv[2]`, so the documented command aimed it at a port
with nothing on it.

## Conventions the suites rely on

- Chromium at `/opt/pw-browsers/chromium`, Playwright from the global install
  at `/opt/node22/lib/node_modules/playwright` — no npm install step, matching
  the zero-dependency posture of the app itself.
- iPhone 14 Pro viewport (393×852), dark scheme. Phone-sized is the only
  layout this app has.
- Screenshots and other artifacts go to `os.tmpdir()` — nothing a test writes
  lands in the repo.
- Console errors fail a suite, except the FMP logo CDN's
  `ERR_ABORTED`/`ERR_CONNECTION_RESET` noise, which every suite filters.
- Suites print `PASS - …`/`FAIL - …` lines and exit nonzero on any FAIL, so
  `grep -c '^FAIL'` is the whole harness.
- Seed state through `page.addInitScript` writing `teatime.*` localStorage
  keys before load. One trap, learned twice: an init script runs on *every*
  navigation, so a value planted mid-test gets clobbered by the next reload —
  plant-once guards (`if (localStorage.getItem(...)) return`) or a fresh
  context are the fixes.

## What's deliberately not here

The scratch one-offs from past design passes (visual-diff screenshots,
prototype comparisons, probes of FMP endpoints) stayed behind — they tested
states of the app that no longer exist. This directory is the living
regression suite only: if a feature is removed, its assertions are trimmed
the same day, and the rolled-back features' suites (Overlap, the vol orb,
the biotech dimmer) are in git history with the features themselves.
