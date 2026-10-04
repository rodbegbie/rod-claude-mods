# sportsball Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `sportsball` mod that follows one team and draws its live game
score above the prompt, with team names coloured from their logos.

**Architecture:** One hooks module, `plugins/sportsball/hooks/register.tsx`,
modelled on `pro-limits`: commands in `session.start`, a self-rescheduling
`$.clock.after` poll of the SportScore API through `$.http.fetch`, state in
atoms, and a `ui.render` hook on `AbovePrompt`. Logo colours come from a
Python 3 standard-library helper run through `$.process.run`, cached in
`$.store`.

**Tech Stack:** Claude Code mod hooks (TSX, no DOM, no Node), SportScore
REST API, Python 3 standard library, pytest via `uv`.

**Spec:** `docs/superpowers/specs/2026-10-04-sportsball-design.md`

## Global Constraints

- Work on branch `feature/sportsball`; check `git branch --show-current`
  before each commit.
- Every commit message ends with the trailer
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stage named
  files only, never `git add -A`.
- Develop directly in `plugins/sportsball/`. Try it live with
  `claude --plugin-dir plugins/sportsball`. The engine-generated
  `.claude-plugin/types/` and `tsconfig.json` are gitignored; do not commit
  them.
- Write no code comments unless essential (Rod's rule). Markdown follows the
  `markdown` skill: lines under 80 columns, `-` lists, fenced languages.
- Poll every 30 seconds while a game is live, 5 minutes otherwise, chosen
  after each reading.
- A stale reading older than 10 minutes is dropped. A failed poll keeps the
  last good reading, dimmed, with no toast.
- API base `https://sportscore.com`. Search:
  `/api/v1/search/?q=<text>&sport=basketball`. Team:
  `/api/v1/team/?sport=basketball&slug=<slug>&limit=<n>`. Scores arrive as
  strings.
- Band attribution text is `via SportScore`, dimmed. "Women's National
  Basketball Association" shortens to `WNBA`; other competitions show in
  full. The band answers `next(e)` when off, nothing followed, no live game,
  or `e.props.hasSurvey`.
- Helper: `https://` URLs only (checked in the mod and in the script), at
  most 2 MB read, 10-second timeout, about 40,000 sampled pixels, skip alpha
  below 128, 4-bit-per-channel bins, decodes non-interlaced 8-bit colour
  types 2 and 6 only, prints `#rrggbb`.
- A helper success is cached in `$.store` for good. A failure is remembered
  for the session only and not retried.
- `$` may only be spelled `$.noun.method(...)` and passed only to top-level
  function declarations. Every `$.state` key is declared in
  `types/index.d.ts` under `sportsball`.

## Review Focus

- `/follow-team` with an empty or one-character name must reply with usage
  and make no request (the API needs at least 2 characters).
- A team name with spaces or `&` must be URL-encoded in the search request.
- A live game whose scores are `""` or missing must draw `0`, not blank or
  `NaN`.
- A poll that returns after `/unfollow-team` (or a switch to another team)
  must be discarded, not redraw the old game.
- A missing, empty or non-`https` logo URL must give the neutral colour with
  no helper call.

## Decisions the spec left open

- Luminance floor: relative luminance `(0.2126R + 0.7152G + 0.0722B) / 255`
  below `0.35` is mixed toward white until it reaches `0.35`.
- Pixels with saturation `(max - min) / max` below `0.25`, or `max` below
  `48`, are skipped by the helper.
- The macOS stub guard: before the first helper call, run
  `$.process.run(['xcode-select', '-p'])`. If it resolves with a non-zero
  `exitCode`, treat the helper as unavailable. If it rejects (command not
  found, so not macOS), carry on.
- The helper script lives inline in `register.tsx` as the constant
  `LOGO_COLOUR_SCRIPT`, a `String.raw` template literal that contains no
  backtick and no dollar-brace sequence. A pytest extracts it from there, so
  there is one source of truth.
- Poll scheduling uses `$.clock.after` (the delay changes between readings).
  Its event input is `ClockWait`; confirm the field name in the engine
  typings before stubbing it in tests (`grep -n "ClockWait" claude-code.d.ts`).

## Shared types

`plugins/sportsball/types/index.d.ts` (created in Task 1, extended as
needed):

```ts
export type Followed = { sport: 'basketball'; slug: string; name: string }
export type LiveGame = {
  home: string; away: string
  homeScore: string; awayScore: string
  homeLogo: string; awayLogo: string
  statusText: string; competition: string
}
export type Reading = {
  game: LiveGame | null
  followedSide: 'home' | 'away' | null
  isStale: boolean
  at: number
}
// PluginState['sportsball'] = {
//   reading: Reading | null; isOn: boolean; colours: Record<string, string>
// }
```

`$.store` keys: `followed` (`Followed[]`, a list of one) and `colours`
(`Record<logoUrl, '#rrggbb'>`).

---

### Task 1: Scaffold the mod, manifest entries and docs row

**Files:**

- Create: `plugins/sportsball/.claude-plugin/plugin.json`
- Create: `plugins/sportsball/hooks/hooks.json`
- Create: `plugins/sportsball/hooks/register.tsx`
- Create: `plugins/sportsball/types/index.d.ts`
- Modify: `.claude-plugin/marketplace.json`, `README.md`

**Interfaces:**

- Produces: the Shared types above; `register: Register` exported from
  `hooks/register.tsx`, initially registering nothing.

- [ ] **Step 1: Write the manifest files.** `plugin.json` has name
  `sportsball`, version `0.1.0`, a one-line description, author
  `Rod Begbie`, and `"types": "./types/index.d.ts"`, as `pro-limits` does.
  `hooks.json` is `{ "modules": ["./register.tsx"] }`.
- [ ] **Step 2: Write `types/index.d.ts`** with the Shared types and the
  `declare module 'claude-code'` augmentation for `PluginState['sportsball']`
  as shown above (copy `pro-limits/types/index.d.ts` for the shape).
- [ ] **Step 3: Write the empty `register`** (`export const register:
  Register = () => {}`), importing `Register` from `'claude-code'`.
- [ ] **Step 4: Register the mod** in `.claude-plugin/marketplace.json` and
  the README mods table, with the same version `0.1.0` in all places.
- [ ] **Step 5: Validate.**

Run: `claude plugin validate .` and `claude plugin validate plugins/sportsball`
Expected: both pass with no errors.

- [ ] **Step 6: Commit** ("Scaffold sportsball mod").

---

### Task 2: Logo colour helper (Python)

**Files:**

- Modify: `plugins/sportsball/hooks/register.tsx` (add `LOGO_COLOUR_SCRIPT`)
- Create: `plugins/sportsball/tests/test_logo_colour.py`

**Interfaces:**

- Produces: `const LOGO_COLOUR_SCRIPT: string` (exported for the mod's use
  only). The script defines `check_url(url: str) -> None` (raises
  `ValueError` unless the URL starts with `https://`),
  `dominant_colour(png: bytes) -> str` (returns `'#rrggbb'`, raises
  `ValueError` on an unsupported or all-grey image) and a `main()` that reads
  `sys.argv[1]`, prints the colour, and exits non-zero on any error. `main()`
  runs only when the script is the main module.

- [ ] **Step 1: Write the failing tests** in `test_logo_colour.py`. A loader
  reads `register.tsx`, extracts the template literal that is the value of
  `LOGO_COLOUR_SCRIPT`, and runs it with `exec` in a namespace whose module
  name is not the main-module name. A helper
  `make_png(w, h, rows, colour_type=6, interlace=0, filter_type=0)` builds
  PNGs with `zlib` and `struct` only. Tests:
  - `test_purple_rgba_logo_returns_purple`: a 40x40 image, mostly
    `(110, 40, 160, 255)` with a white border and transparent corners,
    returns a colour within 24 of that purple per channel.
  - `test_ignores_white_black_and_transparent`: a mostly white image with a
    small gold patch returns the gold.
  - `test_decodes_every_png_filter`: the same image encoded with filter types
    1, 2, 3 and 4 (Sub, Up, Average, Paeth) gives the same colour as filter 0.
  - `test_rgb_colour_type_2_is_supported`.
  - `test_interlaced_png_is_rejected`, `test_palette_png_is_rejected`,
    `test_all_grey_image_is_rejected`: each raises `ValueError`.
  - `test_check_url_accepts_only_https`: `file:///etc/passwd`,
    `http://x/y.png` and `''` raise; `https://img.thesports.com/a.png` does
    not.
  - `test_main_exits_non_zero_without_https`: run the script via
    `python3 -c <script> file:///etc/hosts`; exit code is non-zero and
    stdout is empty.
- [ ] **Step 2: Run to verify failure.**

Run: `uv run --with pytest pytest plugins/sportsball/tests -v`
Expected: FAIL (the loader cannot find `LOGO_COLOUR_SCRIPT`).

- [ ] **Step 3: Implement `LOGO_COLOUR_SCRIPT`** in `register.tsx` with the
  signatures above, using `urllib.request`, `zlib` and `struct`. Read at most
  2 MB, 10-second timeout. Sample about 40,000 pixels (stride from image
  size). Apply the skip rules and 4-bit bins from the Global Constraints and
  the saturation and brightness thresholds from "Decisions". The result is
  the mean of the winning bin's pixels. Implement the PNG unfilter with
  per-row filter types 0 to 4.
- [ ] **Step 4: Run tests.**

Run: `uv run --with pytest pytest plugins/sportsball/tests -v`
Expected: all PASS.

- [ ] **Step 5: Smoke test against a real logo.** In the scratchpad,
  extract the script text to `logo_colour.py` and run it with
  `https://img.thesports.com/basketball/team/380d81d4050b81debf9a5500239e96d0.png`
  as `sys.argv[1]` (append a call to `main()` in that scratch copy only).

Expected: a `#rrggbb` that is plausibly the Valkyries' purple.

- [ ] **Step 6: Commit** ("sportsball: add logo colour helper").

---

### Task 3: Commands and persistence

**Files:**

- Modify: `plugins/sportsball/hooks/register.tsx`,
  `plugins/sportsball/hooks/register.test.ts`

**Interfaces:**

- Consumes: the Shared types (Task 1).
- Produces: commands `follow-team`, `unfollow-team`, `sportsball`
  registered in `session.start`; `async function searchTeams($:
  EngineInterface, name: string): Promise<{ slug: string; name: string }[] |
  null>` (`null` on a fetch, status or JSON failure; builds the URL with
  `encodeURIComponent`); `async function followedTeams($: EngineInterface):
  Promise<Followed[]>` reading `$.store` key `followed` (anything not a valid
  list gives `[]`); atoms `isOn` (default `true`), `reading` (default
  `null`), `colours` (default `{}`).

- [ ] **Step 1: Write the test harness and failing tests.** In
  `register.test.ts`, a shared `harness(on, opts)` stubs, once each,
  `http.fetch` (routing by URL from a table the test supplies and answering
  `{ value: { status, ok, headers: {}, text } }`), `store.get`, `store.set`
  and `store.delete` (backed by a `Map`), `session.start`,
  `command.register`, `clock.after`, `clock.now` and `ui.render`. Fixtures
  are the real response bodies from the spec's probe: the "valkyries" search
  (two teams) and the Valkyries team schedule with one `live` match
  ("Half time", `"34"` against `"31"`) plus finished matches. Each test
  asserts the returned `text` and the store contents:
  - `follow-team valkyries` with two search hits replies listing both names
    and stores nothing.
  - `follow-team golden state valkyries` with one hit replies that it is now
    following Golden State Valkyries and stores
    `[{ sport: 'basketball', slug: 'golden-state-valkyries', name: ... }]`.
  - Request URL contains `q=golden%20state%20valkyries`; a name with `&`
    arrives as `%26`.
  - `follow-team` with `''`, `' '` or `'a'` replies with a usage line and
    makes no `http.fetch` call.
  - `follow-team nonsense` with no hits replies that nothing matched.
  - A failed search replies that the lookup failed and stores nothing.
  - `unfollow-team` clears the store and replies; `unfollow-team Aces` while
    following the Valkyries replies that it is not following Aces and keeps
    the Valkyries; `unfollow-team` with nothing followed says so.
  - `sportsball` toggles `isOn` and replies `Sportsball on.` or
    `Sportsball off.`.
  - A followed team in the store before `session.start` is still followed
    afterwards.
- [ ] **Step 2: Run to verify failure.**

Run: `claude plugin test plugins/sportsball`
Expected: FAIL (unknown commands).

- [ ] **Step 3: Implement** the three `command.register` calls with
  descriptions, and `command.run` hooks keyed by `{ command: name }` that
  read `e.args`. Trim the argument; reject names under 2 characters before
  any request. Following replaces the stored list. Matching an unfollow name
  is a case-insensitive substring test on name or slug.
- [ ] **Step 4: Run tests.**

Run: `claude plugin test plugins/sportsball`
Expected: PASS.

- [ ] **Step 5: Validate and commit** ("sportsball: follow, unfollow and
  toggle commands").

---

### Task 4: Polling

**Files:**

- Modify: `plugins/sportsball/hooks/register.tsx`,
  `plugins/sportsball/hooks/register.test.ts`

**Interfaces:**

- Consumes: `followedTeams`, atoms `reading` and `colours`, and the test
  `harness` (Task 3).
- Produces:
  - `async function fetchLiveGame($: EngineInterface, team: Followed):
    Promise<LiveGame | null | 'error'>`: `'error'` on a fetch, status or
    JSON failure, `null` when nothing is live, otherwise the first match
    with `status === 'live'`. Requests `limit=10`.
  - `function toLiveGame(m: Record<string, unknown>): LiveGame`: missing or
    blank scores become `'0'`.
  - `async function poll($: EngineInterface): Promise<void>`: reads the
    followed team, fetches, writes `reading`, schedules the next poll with
    `$.clock.after` at 30 000 ms when live and 300 000 ms otherwise, and
    cancels any pending timer first. `poll` runs from `session.start`, after
    a successful `follow-team`, and after `unfollow-team` (which instead
    clears `reading` and cancels the timer). This task adds those calls to
    the Task 3 command hooks.

- [ ] **Step 1: Write failing tests** (the `clock.after` stub records each
  requested delay and never fires):
  - Live game fixture gives `reading.game` with `homeScore: '34'` and the
    delay recorded is 30 000.
  - No live game gives `reading.game === null` and delay 300 000.
  - `followedSide` is `'home'` when the followed team is the home team.
  - A failed poll after a good one keeps the game and sets `isStale`.
  - A stale reading older than 10 minutes (advance the `clock.now` stub) is
    dropped to `null`.
  - **Review Focus:** `/unfollow-team` issued while a poll's fetch is
    pending, then the fetch resolves with a live game: `reading` stays
    `null`. Pair it with the follow-then-switch case.
  - **Review Focus:** a live match with `home_score: ''` and
    `away_score` missing gives `'0'` and `'0'`.
- [ ] **Step 2: Run to verify failure, implement `poll`, run to verify
  pass.** After the fetch resolves, re-read `followed`; if the slug no longer
  matches the one polled, return without writing. Never write `reading` from
  inside a `ui.render` hook.

Run: `claude plugin test plugins/sportsball`
Expected: FAIL, then PASS.

- [ ] **Step 3: Validate and commit** ("sportsball: poll the followed
  team").

---

### Task 5: Team colours

**Files:**

- Modify: `plugins/sportsball/hooks/register.tsx`,
  `plugins/sportsball/hooks/register.test.ts`

**Interfaces:**

- Consumes: `LOGO_COLOUR_SCRIPT` (Task 2), atom `colours`, `poll` (Task 4).
- Produces: `async function ensureColours($: EngineInterface, game:
  LiveGame): Promise<void>` called by `poll` when a live game is seen; adds
  `#rrggbb` entries to atom `colours` and `$.store` key `colours`.
  `function lightened(hex: string): string` applies the luminance floor.
  `session.start` loads `colours` from the store into the atom.

- [ ] **Step 1: Write failing tests** (stub `process.run`, once per test):
  - A live game triggers one `process.run` per distinct logo, argv
    `['python3', '-c', <script>, <logoUrl>]`, and the printed colour is
    stored and appears in the atom.
  - Cached colours are loaded at `session.start` and `process.run` is not
    called for them.
  - A non-zero exit, a rejection or output that is not `#rrggbb` leaves no
    entry, and a second poll does not call `process.run` again for that URL.
  - **Review Focus:** an empty, missing or `http://` logo URL makes no
    `process.run` call.
  - `xcode-select -p` resolving non-zero skips every helper call; rejecting
    does not.
  - `lightened('#101040')` has relative luminance at least `0.35`;
    `lightened('#e0c050')` is unchanged.
- [ ] **Step 2: Run to verify failure, implement, run to verify pass.** Run
  the helper with `timeoutMs: 15000`. Check the guard once per session
  (module variable), not per call.
- [ ] **Step 3: Validate and commit** ("sportsball: colour team names from
  logos").

---

### Task 6: The band

**Files:**

- Modify: `plugins/sportsball/hooks/register.tsx`,
  `plugins/sportsball/hooks/register.test.ts`

**Interfaces:**

- Consumes: atoms `reading`, `isOn`, `colours` (Tasks 3 to 5);
  `lightened` (Task 5).
- Produces: `function shortCompetition(name: string): string`; a `ui.render`
  hook on `{ component: 'AbovePrompt' }`.

- [ ] **Step 1: Write failing tests** (mount with `$.ui.mount({ plugin:
  'sportsball', surface: 'terminal', component: 'AbovePrompt', props: {
  hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns } })` and
  assert on `JSON.stringify(await band.drawn())`, as `pro-limits` does):
  - Live game draws both team names, `34`, `31`, `Half time`, `WNBA` and
    `via SportScore`.
  - Team names carry their cached colours; a team with no cached colour
    draws with no colour prop.
  - The followed team's score is bold; the other is not.
  - A stale reading draws dimmed.
  - `isOn` false, no reading, `reading.game === null` and
    `hasSurvey: true` each answer `next(e)` (assert via the `ui.render`
    stub, per `CLAUDE.md`'s `next(e)` quirk).
  - **Review Focus:** `bodyColumns: 30` still renders as one truncating row
    (no wrap, no throw).
  - `shortCompetition("Women's National Basketball Association")` draws
    `WNBA`; `NBA Cup` draws `NBA Cup`.
- [ ] **Step 2: Run to verify failure, implement, run to verify pass.** One
  `Box` row, `Text wrap="truncate-end"`, reserving `COLLAPSE_CONTROL_COLUMNS`
  (4), separated by ` · ` as in the spec.

Run: `claude plugin test plugins/sportsball`
Expected: FAIL, then PASS.

- [ ] **Step 3: Validate and commit** ("sportsball: draw the score band").

---

### Task 7: Docs, final checks and a live run

**Files:**

- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: README.** Add a sportsball section: commands, the
  attribution, the need for `python3` for logo colours (and that it is
  optional), that the helper makes its own request outside `$.http.fetch`,
  that it is CLI only, and a `<!-- screenshot placeholder -->`.
- [ ] **Step 2: CLAUDE.md.** Add a `sportsball specifics` section: scores
  are strings; `/fixtures/` is UTC-day only so the mod uses `/team/`; no
  quarter or clock field; `LOGO_COLOUR_SCRIPT` is the single source for the
  pytest; run pytest with
  `uv run --with pytest pytest plugins/sportsball/tests`.
- [ ] **Step 3: Full verification.**

Run: `claude plugin validate .`, `claude plugin test plugins/sportsball`,
`uv run --with pytest pytest plugins/sportsball/tests -v`, and
`markdownlint README.md CLAUDE.md docs/superpowers/plans/2026-10-04-sportsball.md`
Expected: all pass.

- [ ] **Step 4: Live run.** Start `claude --plugin-dir plugins/sportsball`,
  run `/follow-team golden state valkyries`, and confirm the band shows the
  live Valkyries game with coloured names and updates. Run `/sportsball` and
  `/unfollow-team`. Report any step that could not be checked (for example no
  game on).
- [ ] **Step 5: Commit** ("sportsball: document and verify"). Before any PR
  into `main`, remove `docs/superpowers/` from the branch (Rod: planning
  artifacts do not merge to main) and merge with a merge commit.
