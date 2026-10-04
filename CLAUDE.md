# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A Claude Code plugin marketplace of "mods": plugins made of function
hooks that draw UI or react to events inside Claude Code. The marketplace
manifest is `.claude-plugin/marketplace.json`; each mod is a self-contained
folder under `plugins/<mod-name>/`.

Each mod has the same three parts:

- `.claude-plugin/plugin.json`: manifest. Names `types/index.d.ts` if the
  mod keeps `$.state` values.
- `hooks/hooks.json`: `{ "modules": ["./register.tsx"] }`.
- `hooks/register.tsx`: `export const register: Register = (on) => { ... }`,
  with `Register` imported from `'claude-code'`.

## Commands

```bash
claude plugin validate .                  # marketplace manifest
claude plugin validate plugins/<mod>      # one mod: manifest + module source
claude plugin test plugins/<mod>          # runs the mod's *.test.ts files
claude --plugin-dir plugins/<mod>         # try a mod in a fresh session
```

There is no build step or package manager. `claude plugin validate` is the
lint: it reads the module the way the engine will and refuses what the
engine would refuse.

## Adding or changing a mod

- Register a new mod in `.claude-plugin/marketplace.json` and in the
  README's mods table. Keep `version` in `plugin.json` and in its
  marketplace entry in step.
- Write mods with the `plugin-authoring` skill loaded. It writes the engine
  typings (`claude-code.d.ts`) and the API reference that the hook
  environment is checked against; the API is not guessable.
- Hot-reload workflow used so far: develop under
  `~/.claude/dev-mods/<session-id>/<mod>/`, then copy into `plugins/`
  without the engine-generated `.claude-plugin/types/` and `tsconfig.json`
  (both gitignored).
- Delete the dev-mods copy once the mod is installed from the marketplace;
  otherwise both load and the slash command appears twice.

## Hook module constraints that `validate` enforces

- The module runs in an isolated environment with no DOM and no Node. All
  outside access goes through `$`.
- `$` may only be spelled `$.noun.method(...)` at the call site. It can be
  passed to a helper only if that helper is a top-level function
  declaration (not a `const` arrow function or a closure inside
  `register`). `context-bar`'s `refresh($)` is declared this way for that
  reason.
- Every `$.state` key the module names must be declared in the mod's
  `types/index.d.ts` under `interface PluginState`, keyed by mod name.
- Elements come from `$.ui.resolve(e)`; JSX compiles against the global `h`.

## Testing quirks

`claude plugin test` runs hooks against the engine with nothing beneath
them, so a test must stub every event the mod touches or it fails with
"no implementation for X":

- Stub `session.usage`, `session.start`, `command.register` and `ui.render`
  with `on(...)` as needed.
- Result shapes differ per event. In `context-bar`'s tests `session.start`
  answers with a bare `{ cwd }`, while `session.usage`, `command.register`
  and `ui.render` answer with `{ value }`. When a stub fails with
  "returned neither { value } nor { deny }", switch shape.
- Mount a component with `$.ui.mount({ plugin, surface, component, props })`
  and assert on `await mounted.drawn()`, which is plain tree data. Tests
  check the tree, not terminal paint.
- Register each event stub once per test. A second `on('session.usage', ...)`
  fails with "registered twice", so for a changing reading, stub with a
  getter over a mutable variable rather than a call-counted list (call
  order through `session.start` and `session.measure` is not obvious).
- If a mod answers `ui.render` with `next(e)` (nothing to draw), a
  `ui.render` stub returning `{ value: null }` fails with "not a tree
  element". Assert on state or toasts instead of mounting in that case.
- A test's `$` has no `state` noun. To read a mod's state, register
  `on('state.set', (_$, e, next) => (seen[e.key] = e.value, next(e)))`
  and assert on what was written. Assert on the whole write history when
  a stale write could be masked by a later one.
- A `ui.render` stub answers with the tree itself, not `{ value }`. Use
  a distinctive stub tree to tell `next(e)` from the mod's own drawing.
- An `on('clock.after', ...)` stub that resolves makes the kit fire the
  callback at once, in the background. Return a promise that never
  resolves, and record `e.ms`, to assert on the delay without firing.
  sportsball resolves only `ms === 0`, its way of moving work off the
  hook path, so tests wait for that work with a short polling loop.
- A throwing `ui.render` hook is swallowed and the engine draws its own
  tree, which looks like `next(e)` to a test.
- The test runner has no `test.each`; loop and call `test` instead.
- `on(...)` stubs must all be registered before the test first calls
  `$`, so one test cannot build two harnesses.
- Capture toasts with `on('ui.toast', ...)` and drive `session.measure` and
  `command.run` directly with `$.session.measure(...)` and
  `$.command.run(...)`.

## context-bar specifics

- The `AbovePrompt` band has an engine-drawn `[-]` collapse control on the
  right. The bar reserves `COLLAPSE_CONTROL_COLUMNS` (4, an estimate of
  its width) and its segment widths must sum exactly to the remaining
  width. Overshoot makes the last segment wrap, which shows as a stray grey
  block under the start of the free-space segment.
- Segment Texts use `wrap="truncate-end"` so any spill-over is cut rather
  than wrapped.
- `COLOR_OVERRIDES` recolours "System prompt" and "System tools" by
  category name, because the engine gives those rows grey theme colours.
  It matches on `name`, so a rename in `/context` silently falls back to
  grey.
- Percentages are tokens over the compaction window (`rawMaxTokens`), as
  `/context` computes them.

## pro-limits specifics

- Reads `rateLimits` from `$.session.usage()` (`kind` is `five_hour` or
  `seven_day`; `percentUsed`, optional `resetsAt`). It is empty off a
  subscription, so the band draws nothing then.
- Threshold toasts are silent on the first non-empty reading after a
  load or reload, because module variables reset on hot reload and
  `session.start` re-primes them. Toggling off mutes toasts but keeps
  tracking levels, so toggling back on never replays them.
- Readout width is `READOUT_COLUMNS` (24). The 100% easter egg is two
  emoji, each two columns wide, so it fits the same space as `100%`.

## sportsball specifics

- Data is the SportScore public API (anonymous, about 10,000 requests a
  day per IP). Scores come back as strings, whatever the OpenAPI spec
  says. There is no quarter or clock field, only `status_text`.
- The mod polls `/api/v1/team/`, not `/api/v1/fixtures/`, because
  fixtures covers one UTC day and drops a game that crosses midnight.
  The team endpoint returns matches newest-first, up to about 30, so
  the request uses the maximum `limit=50`: a smaller limit returns only
  far-future fixtures and hides a live game for a team with a long
  season (football).
- `live_minute` exists only on `/api/v1/match/`, never in the team
  schedule, and is `null` for basketball, so only sports flagged in
  `HAS_LIVE_MINUTE` pay for the extra request. The match slug is the
  third segment of the match `url`; football URLs carry a trailing id
  that must not be sent. A failed lookup yields no minute and never
  fails the poll. `live_minute` is a string and is `"HT"` at half time,
  so only digits with optional added time (`84`, `90+`, `45+2`) are
  drawn. In stoppage time the API has been seen to send a bare `"90+"`.
- `/follow-team` searches every sport in `SPORTS` (one request each, in
  order) and fails the whole lookup if any request fails. A sport needs
  an entry in `SPORTS` and in `SPORT_EMOJI`, and a `Sport` member in
  `types/index.d.ts`.
- Logo colours come from `LOGO_COLOUR_SCRIPT`, a Python script held as a
  `String.raw` constant in `register.tsx`. The pytest in
  `plugins/sportsball/tests` extracts it from there, so there is one
  copy. Keep backticks and dollar-brace sequences out of it. Run the
  tests with `uv run --with pytest pytest plugins/sportsball/tests`.
- The script runs as `python3 -I -c` with `cwd: '/'`. Without them,
  Python puts the session's working directory first on `sys.path`, so a
  `struct.py` in the user's project would run in place of the stdlib.
- Colour extraction runs from `$.clock.after(0, ...)`, not inside `poll`,
  so session start and `/follow-team` never wait on the helper.
- `/follow-team` follows a lone hit at once; two or more hits, even with
  one exact name match, get a picker. Search hits are made unique by
  sport and slug first, because the API can return one team twice
  (`arsenal` comes back with two entries sharing a slug). Labels that
  still collide get the slug appended.
- Each picker label carries the league, read from the first match of
  `/api/v1/team/?limit=1` (the same `competition` as `limit=50` on every
  team probed). A team with no matches, or a failed lookup, gets no
  league. The search API returns only name, slug, logo and url, and
  nothing gives a country.
- Four or fewer hits use `$.ui.ask`. The engine refuses more than four
  options, and the handler's `.catch` would hide that as "No team
  followed", so the split at `MAX_ASK_OPTIONS` matters. More hits open
  the `sportsball-teams` pane drawn by a `ui.render` hook, with the
  candidates in the `choices` atom and the pick handled by a `ui.select`
  hook, which is the only place with `$`. A `Select` with no options
  makes the render hook throw, so the pane draws an empty `Box` instead.
- In tests, `$.ui.ask` is a `tool.call` of `AskUserQuestion`: its
  questions sit flat on the event (`e.questions`), and `{ deny }` is a
  dismissal. Mount the pane with a top-level `requestId` (not in
  `props`) or the hook is never selected, and `pane.select({ key,
  value })` makes a pick.
- The script only accepts `https://` URLs because the URLs come from API
  data. It decodes 8-bit RGB and RGBA PNGs without interlacing, which
  covers every logo checked; anything else falls back to no colour.
- Colours are lightened to a minimum luminance when accepted and cached
  in `$.store`, keyed by logo URL. A failed logo is not retried until the
  next session.
- The "Powered by SportScore" credit is a `Link` (licence requirement),
  right-aligned on the last game row. It drops to its own row below only
  when fewer than 20 columns would be left for the game text.
- A game is identified by `LiveGame.key`, its match `url` plus start
  `time`: the same fixture URL is reused for repeat matchups between two
  teams, so the URL alone would confuse them. Toasts fire when a followed
  game's `status_text` changes or it turns up as `finished`, and in
  sports flagged in `TOAST_ON_SCORE` (football) when the score changes.
  A status change and a score change in one poll give one toast, labelled
  by the status. The minute alone never toasts. There is no clock in
  `status_text`.
- Each `poll` takes a generation number; only the latest run may
  publish, toast and schedule, so an older fetch finishing late is
  discarded, and the followed sport and slug are re-checked too. A
  reading is only carried over as stale for the same sport and slug.
  Keep these checks if you touch `poll` or `nextReading`.

## Git and PRs

- Default branch is `main`. Branch from it and PR back into it.
- In Claude Code's Bash, redirect stdin (`</dev/null`) for `entire` and
  `gh` commands; a stray stdin read stalls them until the 120s timeout.
- The trail PR from `entire trail create` is a draft. Merge with
  `gh pr ready <n>` then `gh pr merge <n> --merge`, delete the feature
  branch locally and on the remote, and leave the local `entire/<sha>`
  checkpoint branch alone.
- README screenshots live in `docs/`, not inside a plugin folder.
- Merge PRs with a merge commit, not a squash, so the commits that Entire
  checkpoints point at survive.
- The first `git push` after a commit is often rejected with a bare
  `remote rejected (failed)` and no reason. A plain retry has succeeded
  every time so far.

## Entire

`.entire/runners/*.json` configures Entire trail runners (prompt runners
that score the trail on push) with prompts written for this repo's layout.
If the layout conventions above change, update those prompts to match.

`entire trail create` opens a draft PR whose body starts with an
`entire-trail-link-start/end` block and ends with an `entire-shadow-pr`
marker. When rewriting the body, keep both or the trail and PR unlink.

<!-- entire-agent:begin -->
Read .entire/agent-guide.md for this repository's workflow, source inspection, and verification guidance.
@.entire/agent-guide.md
<!-- entire-agent:end -->
