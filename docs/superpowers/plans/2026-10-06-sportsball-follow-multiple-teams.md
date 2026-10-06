# Sportsball: follow multiple teams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user can follow many teams; every followed team's game is
polled, shown in the band and toasted, and `/following` lists them.

**Architecture:** Each followed team gets its own poll loop, generation
guard and reading, keyed `sport/slug`. Task 1 is a behaviour-preserving
refactor to that shape (still one team at a time); later tasks turn on
multi-follow, the commands and the multi-row band.

**Tech Stack:** TypeScript hook module (`plugins/sportsball/hooks/
register.tsx`), `claude plugin test` for tests, markdownlint for docs.

**Spec:** `docs/superpowers/specs/2026-10-06-sportsball-follow-multiple-
teams-design.md`

## Global Constraints

- Follows are capped at 20 (`MAX_FOLLOWED`); the band shows at most 6
  game rows (`MAX_BAND_ROWS`) then a dim `+N more games` line.
- Poll cadence per team is unchanged: 30 s live, 60 s upcoming, 5 min
  otherwise. Starts are staggered 500 ms apart (`STAGGER_MS`).
- A failed poll keeps that team's last game dimmed for up to 10 minutes
  and never affects another team.
- The "Powered by SportScore" credit sits on the last game row only.
- Version goes to 0.3.0 in `plugin.json` and the marketplace entry.
- No code comments unless essential. British spellings in user text.
- Run on branch `feature/8-follow-multiple-teams`; verify with `git
  branch --show-current` before each commit. Commit messages end with
  the `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` line.
- Test command for every task: `claude plugin test plugins/sportsball`
  (baseline before Task 1: 150 pass, 0 fail).
- Re-sync the dev-mod after each task: `rsync -a --exclude
  '.claude-plugin/types' --exclude tsconfig.json --exclude tests
  plugins/sportsball/
  ~/.claude/dev-mods/32f4dbae-401f-4411-ba28-dfc5ff78d4bd/sportsball/`

## Review Focus

- The store lists the same team twice (hand-edited): it is polled and
  drawn once. Test in Task 2.
- A team is unfollowed while its fetch is in flight: no reading for it
  appears afterwards. Test in Task 2.
- One followed team's API fails while another is live: the live team
  still draws and toasts. Test in Task 2.
- Both teams of one game are followed: one band row and one toast.
  Tests in Tasks 2 and 4.
- All 20 teams have a game: 6 rows, `+14 more games`, one credit on the
  last game row. Test in Task 4.

---

## File Structure

- `plugins/sportsball/hooks/register.tsx`: all logic stays here, as
  today; no split.
- `plugins/sportsball/types/index.d.ts`: state contract.
- `plugins/sportsball/hooks/register.test.ts`: harness and tests.
- `README.md`, `.claude/rules/sportsball.md`, `plugin.json`,
  `.claude-plugin/marketplace.json`: Task 5.

### Task 1: Per-team poll machinery, behaviour unchanged

**Files:**

- Modify: `plugins/sportsball/hooks/register.tsx`
- Modify: `plugins/sportsball/types/index.d.ts`
- Modify: `plugins/sportsball/hooks/register.test.ts:21-125`

**Interfaces:**

- Produces (types): `PluginState.sportsball.readings: Record<string,
  Reading>` replaces `reading`; `pickAction: 'follow' | 'unfollow'` is
  added now so Task 3 needs no type change.
- Produces (register.tsx, top level):
  `teamKey(team: Pick<Followed, 'sport' | 'slug'>): string` returning
  `` `${sport}/${slug}` `` (replaces `choiceValue`);
  `poll($, team: Followed): Promise<void>`;
  `startPolls($): Promise<void>`; `syncPolls($): Promise<void>`;
  `stopPoll(key: string): void`. Constants `MAX_FOLLOWED = 20`,
  `MAX_BAND_ROWS = 6`, `STAGGER_MS = 500`.
- Produces (test harness): `readingOf($)` returns the first value in
  `states.readings` or null; `readingFor(key)` returns
  `states.readings?.[key] ?? null`; `readingWrites` collects, for each
  `readings` write, its first value or null; `harness(...).staggers:
  number[]` records every `clock.after` with `0 < ms < 10_000`, which
  the stub now resolves like `ms === 0`.

- [ ] **Step 1: Update the test harness.** In `harness`, change the
  `state.set` stub to push into `readingWrites` for key `readings`
  (first value of the map, else null); make the `clock.after` stub
  resolve and record in `staggers` when `0 < e.ms < 10_000`; redefine
  `readingOf`; add `readingFor`, `bluefireRoute = 'slug=bluefire-
  valkyries-w'`, `followingBoth` (valkyries then bluefire, both
  basketball) and `gameRows(tree)` = wrapping rows whose text does not
  start with `Powered`.
- [ ] **Step 2: Run the tests; expect many failures** (state key is
  still `reading`). Run: `claude plugin test plugins/sportsball`.
- [ ] **Step 3: Update `types/index.d.ts`** (`readings`, `pickAction`).
- [ ] **Step 4: Implement the machinery in `register.tsx`.**
  - Atoms `readings` (initial `{}`) and `pickAction` (initial
    `'follow'`) replace `reading`.
  - A module counter and `activePolls = new Map<string, number>()`
    (key to current generation) plus `pendingPolls = new Map<string,
    { cancel: () => void }>()` replace `pendingPoll` and
    `pollGeneration`. A poll is current while `activePolls.get(key)`
    equals its generation. A counter, not per-key increments, so a
    refollowed team never matches an old poll.
  - `poll($, team)` is today's `poll` for the given team: after the
    fetch it re-checks that `team` is still in `followedTeams($)` by
    `teamKey`; `previous` is `readings[key]`; it writes with `update`
    (delete the key when the next reading is null).
  - `stopPoll(key)` cancels the pending timer, deletes both map
    entries.
  - `syncPolls($)`: for every key in `activePolls` not followed, call
    `stopPoll` and drop its reading, writing `readings` only if
    something was dropped; for every followed team with no
    `activePolls` entry, call `poll`.
  - `startPolls($)` (session start): `await poll` for the first
    followed team; for team index i >= 1 schedule `poll` with
    `$.clock.after(i * STAGGER_MS, ...)`; with nothing followed,
    write `{}` if readings is non-empty.
  - `follow` still replaces: it stores `[hit]` then `await
    syncPolls($)`. `unfollow-team` stores `[]` then `await
    syncPolls($)`. `session.start` calls `startPolls`.
  - The band reads the first reading that has a game
    (`Object.values(all)`); rendering is otherwise untouched.
- [ ] **Step 5: Run the tests; expect 150 pass, 0 fail.** Every
  existing test must pass unmodified apart from the harness.
- [ ] **Step 6: Validate and commit.** `claude plugin validate
  plugins/sportsball`, re-sync the dev-mod, then commit
  `sportsball: poll each followed team on its own loop`.

### Task 2: Following several teams

**Files:**

- Modify: `plugins/sportsball/hooks/register.tsx`
- Modify: `plugins/sportsball/hooks/register.test.ts`

**Interfaces:**

- Consumes: Task 1's `poll`, `syncPolls`, `startPolls`, `teamKey`,
  `MAX_FOLLOWED`, test helpers.
- Produces: `followedTeams($)` returns distinct teams (by `teamKey`);
  `follow($, hit): Promise<string>` replies exactly `Now following
  ${name}.`, `Already following ${name}.` or `You can follow at most
  20 teams. Unfollow one first.`; module `lastToast = new Map<string,
  string>()` (game key to last toast text).

- [ ] **Step 1: Write failing tests** (each uses `harness`, `start`,
  `run`; multi-team ones wait with `settle()`):
  - `follow-team adds to the teams already followed` (replaces the
    test at line 400): store equals valkyries then bluefire, and
    `readingFor` has both keys once the bluefire route returns a game.
  - `following a team already followed says so and adds nothing`:
    text `Already following Golden State Valkyries.`; store length 1.
  - `following past the cap is refused`: store holds 20 teams; reply is
    the cap text; store length still 20.
  - `a store listing the same team twice polls it once`: urls matching
    `TEAM_ROUTE` number exactly 1 (Review Focus).
  - `each followed team polls on its own cadence`: valkyries live,
    bluefire an old finished game; `h.delays` sorted equals
    `[30_000, 300_000]`.
  - `session start staggers the followed teams`: with `followingBoth`,
    `h.staggers` equals `[500]`.
  - `unfollowing one team keeps polling the other`: with
    `followingBoth`, `unfollow-team valkyries` leaves store `[bluefire]`
    and `states.readings` with only the bluefire key.
  - `a poll that returns after its team is unfollowed is discarded`
    (replaces the test at line 577): gate the valkyries route, unfollow
    it while another team stays followed, release; `readingWrites`
    holds no valkyries game and `readingFor('basketball/golden-state-
    valkyries')` is null (Review Focus).
  - `a failing team does not disturb a live one`: bluefire answers 500,
    valkyries is live; valkyries reading has a game, bluefire has none,
    and the valkyries toast still fires on a status change.
  - `a failed first fetch for a newly followed team keeps the other
    team's reading` (replaces the test at line 1409).
  - `two followed teams in one game toast once` (Review Focus): both
    routes return the same match (same `url` and `time`); after the
    first poll change both routes to `3rd quarter` and call `start`
    again; `h.toasts` has exactly one entry.
- [ ] **Step 2: Run them; expect these to fail**, everything else to
  pass.
- [ ] **Step 3: Implement** in `register.tsx`: `followedTeams` dedupes
  by `teamKey`; `follow` appends (check already-followed, then
  `followedTeams($).length >= MAX_FOLLOWED`, then `store.set`, then
  `syncPolls`); the toast call in `poll` is skipped when
  `lastToast.get(game.key) === toast`, otherwise it records the text.
  The existing "switching to a team in a different game does not toast"
  test (line 1020) stays as is and must still pass.
- [ ] **Step 4: Run all tests; expect all pass.**
- [ ] **Step 5: Re-sync the dev-mod and commit** `sportsball: follow
  several teams at once`.

### Task 3: `/following` and unfollowing one of several

**Files:**

- Modify: `plugins/sportsball/hooks/register.tsx`
- Modify: `plugins/sportsball/hooks/register.test.ts`

**Interfaces:**

- Consumes: Task 2's `followedTeams`, `syncPolls`, `pickAction`,
  `choices`, `pickLabels`, `MAX_ASK_OPTIONS`, `TEAM_PANE`.
- Produces: command `following`; `unfollow($, team: Followed):
  Promise<string>` storing the list without `team`, calling
  `syncPolls`, replying `Stopped following ${name}.`; the `ui.select`
  hook branches on `pickAction`.

- [ ] **Step 1: Write failing tests:**
  - `following lists each team with its sport emoji`: with a football
    and a basketball team the reply is `Following 2 teams:` then one
    line per team, `⚽ ${name}` and `🏀 ${name}`, joined by newlines.
  - `following with one team uses the singular`: `Following 1 team:`.
  - `following with nothing followed points at follow-team`: reply is
    `Not following any team. Try /follow-team <team name>.`
  - `following makes no requests`: `h.urls` is empty after it runs.
  - `unfollow-team by name with several matches asks which` (via
    `h.asks`), and the answered team alone is removed.
  - `unfollow-team with no name and several follows asks which`;
    dismissal replies `No team unfollowed.` and changes nothing.
  - `unfollow-team with a name matching one of several removes just
    that team`.
  - `unfollow-team with a name matching nothing` replies `Not
    following ${name}.`
  - `unfollow-team with more than four follows opens the pane`:
    `h.panes.opened[0]` has id `sportsball-teams` and title `Teams
    you follow`; `pane.select` on an option unfollows that team, closes
    the pane and leaves `pickAction` back at `follow` (check the last
    `state.set` for `pickAction`).
  - The existing follow-pane test (line 227) must still pass.
- [ ] **Step 2: Run them; expect failures.**
- [ ] **Step 3: Implement.** Register `following` in `session.start`
  (description `List the teams you follow`). Rewrite `unfollow-team`:
  filter followed teams by the name match (all when no name); zero
  matches reply as above; one match unfollows; several ask with
  `$.ui.ask` and labels from `pickLabels(teams, teams.map(() => ''))`
  when four or fewer, else set `choices` and `pickAction` to
  `unfollow`, open the pane titled `Teams you follow`, and reply `Pick
  a team to stop following.` The `ui.select` hook reads `pickAction`
  and calls `follow` or `unfollow` for the pick (still after `await
  next(e)`), then resets `pickAction` to `follow`.
- [ ] **Step 4: Run all tests; expect all pass.**
- [ ] **Step 5: Re-sync the dev-mod and commit** `sportsball: add
  /following and unfollow one of several teams`.

### Task 4: Multi-row band

**Files:**

- Modify: `plugins/sportsball/hooks/register.tsx` (the `AbovePrompt`
  hook)
- Modify: `plugins/sportsball/hooks/register.test.ts`

**Interfaces:**

- Consumes: Task 1's `readings` atom, `MAX_BAND_ROWS`; test helpers
  `gameRows`, `mountBand`, `flatText`.
- Produces: top-level `bandRows(all: Record<string, Reading>):
  Reading[]` (readings with a game, deduplicated by `game.key` with the
  first in follow order winning, then ordered live, upcoming by
  `startsAt`, finished by `startsAt` descending); top-level
  `statusOf(data: Reading, now: number): string`, the status text the
  row used to build inline.

- [ ] **Step 1: Write failing tests** with `followingBoth` and two
  routes:
  - `the band shows one row per followed team's game, live first`: a
    live game and an upcoming one in the other order of follow; rows
    appear live then upcoming.
  - `a game between two followed teams shows once` (Review Focus).
  - `the credit sits on the last game row only`: exactly one `Link`;
    it is inside the last row's container.
  - `a stale reading dims only its own row`.
  - `more than six games show six rows and a +N more games line`:
    store with 20 teams, each route a distinct live game; six
    `gameRows`, one line whose text is `+14 more games`, one `Link`
    (Review Focus). Singular case: seven games give `+1 more game`.
  - Existing band tests (wrap, credit width, help line, empty band)
    must pass unchanged.
- [ ] **Step 2: Run them; expect failures.**
- [ ] **Step 3: Implement** `bandRows` and `statusOf`; in the hook map
  `bandRows(await read($, readings))` sliced to `MAX_BAND_ROWS` to rows
  built by the existing layout, passing "is last row" to decide whether
  the credit rides on it (full width otherwise, and the existing
  narrow-terminal fallback only for the last row). The `+N more` line is
  a dim `Text` without `wrap="wrap"`, drawn after the last game row.
  Help line and empty-band behaviour stay as they are.
- [ ] **Step 4: Run all tests; expect all pass.**
- [ ] **Step 5: Re-sync the dev-mod and commit** `sportsball: draw a row
  per followed game`.

### Task 5: Docs, version and final checks

**Files:**

- Modify: `README.md` (sportsball section, lines 58-130)
- Modify: `.claude/rules/sportsball.md`
- Modify: `plugins/sportsball/.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`

- [ ] **Step 1: README.** Invoke the `markdown` skill first. Rewrite
  the opening ("Follows one team") for several teams; update the
  `/follow-team` bullet (adds, cap of 20, already-following reply);
  add `/following`; update `/unfollow-team [name]` (asks when several
  match); mention the six-row cap and `+N more games`; update the mods
  table line ("Live scores of followed teams above the prompt").
- [ ] **Step 2: Rules file.** Replace the single-team notes: `readings`
  map and `followedTeams($)` still tells "not following" from "no game";
  per-team generation via `activePolls` (keep the checks when touching
  `poll`); `session.start` re-polls every team, `syncPolls` only
  changes the difference (a deliberate refinement of the spec's
  wording, because session start repeats in tests and on resume);
  `lastToast` dedupe; stagger; the two caps.
- [ ] **Step 3: Version.** Set 0.3.0 in `plugin.json` and the
  marketplace entry, and update both descriptions to "Follow teams and
  see their live game scores above the prompt, with /follow-team,
  /unfollow-team, /following and /sportsball".
- [ ] **Step 4: Verify, with evidence.** Run `markdownlint README.md
  .claude/rules/sportsball.md` and check the exit status is 0 (CLAUDE.md
  has predating long lines; do not lint it); `claude plugin validate .`;
  `claude plugin validate plugins/sportsball`; `claude plugin test
  plugins/sportsball`; `uv run --with pytest pytest
  plugins/sportsball/tests`. All must pass.
- [ ] **Step 5: Try it live.** Re-sync the dev-mod; with Rod, follow two
  teams, check `/following`, the band rows and `/unfollow-team`.
- [ ] **Step 6: Commit** `sportsball: document following several teams
  and bump to 0.3.0`. Then ask Rod before pushing, opening the trail
  (`entire trail create`, feature type, issue 8) or removing the spec
  and plan from the branch before merge.
