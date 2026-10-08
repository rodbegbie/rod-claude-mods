---
paths:
  - "plugins/sportsball/**"
---

# sportsball specifics

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
- The same `/api/v1/match/` response carries `incidents`, each with
  `is_goal`, `player`, and the match score after it (`home_score`,
  `away_score`). The goal toast names `player` of the last goal incident
  whose score equals the schedule's current score, so an incidents list
  that lags the score names nobody rather than the previous scorer.
  Real data has shown a goal with an empty `player` (Fijian National
  League) and an incidents list one goal behind the score, and both
  give the plain toast. Own goals, penalties and a disallowed goal's
  shape are still unverified.
- `readings` holds one `Reading` per followed team, keyed `sport/slug`
  (`teamKey`). A team with no reading, or one whose `game` is null, has
  no game in range, and `phase` (`live`, `upcoming` or `finished`) is
  null with it. The "not following a team" help in the band checks
  `followedTeams($)`, not `readings`, to tell nothing followed from
  nothing to show.
- `pickGame` chooses what the band shows: a live game, else the soonest
  upcoming one, else the latest finished one. Upcoming means starting
  within 2 hours, or up to `LATE_START_GRACE_MS` (30 minutes) past its
  start. Finished means start plus `GAME_LENGTH_MS` (football 2 hours,
  basketball 2.5) within the last 2 hours. The API has only the start
  `time`, never an end time, hence the estimate.
- SportScore leaves postponed fixtures as `upcoming` for ever: a
  "Delayed" game from 2025-10-20 was still listed in 2026. The grace's
  lower bound is what stops it showing as "Starting now" and hiding the
  real next game.
- `announcement` only runs when the previous reading was `live`.
  Without that, a finished game left on show toasts "Full time" on every
  poll. `pollDelay` is 30 seconds live, 60 seconds upcoming (the
  countdown and the hand-off to live), 5 minutes otherwise.
- An upcoming game reads `Starts 1:30 PM (in 1h 40m)`, in the user's
  timezone and locale through `Intl.DateTimeFormat(undefined, ...)`; the
  hook sandbox has both. The countdown is worked out at render from
  `$.clock.now()`, so it moves only when the band redraws. Past the
  start time it drops the countdown.
- The game row and the help text use `wrap="wrap"`, not `truncate-end`,
  so a long matchup continues on a second row. Tests find the game row
  by `wrap === 'wrap'`.
- A `ui.select` hook must `await next(e)` before it closes the pane.
  The engine holds an `onSelect` handle only while the pane is drawn,
  so closing first makes `next(e)` throw "no handler is held under
  handle N". The test stubs don't model handle lifetimes, so only a
  live pick shows it.
- `/follow-team` searches every sport in `SPORTS` (one request each, in
  order) and fails the whole lookup if any request fails. A sport needs
  an entry in `SPORTS`, `SPORT_EMOJI` and `GAME_LENGTH_MS`, and a `Sport`
  member in `types/index.d.ts`.
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
- The search API is alphabetical by name with no sort option, caps at 8
  hits per sport (20 with `limit=20` or more, which is the ceiling), and
  ignores `page` and `offset`. Every word must appear in the name and
  punctuation counts: `rangers f.c.` finds Rangers F.C., `rangers fc`
  does not.
- `/api/v1/team/` resolves by slug alone and ignores the id in a hit's
  `url`, and some slugs clash: the search's "Rangers F.C." (`rangers-fc`)
  resolves to "Ranger's FC" in Andorra, and basketball's `rangers-fc`
  to a Chilean team. `lookupTeam` compares the resolved `team.name` with
  the hit's name and leaves a mismatch out of the picker; a failed
  lookup counts as no mismatch. Across 83 live hits only that one
  differed, so the exact comparison has not hidden a real team.
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
  right-aligned on the last game row. The game text keeps
  `MIN_GAME_COLUMNS` (60) and the credit gets what is left, 11 to 22
  columns, wrapping to two lines when narrow. It drops to its own row
  below only when it would get under 11.
- A game is identified by `LiveGame.key`, its match `url` plus start
  `time`: the same fixture URL is reused for repeat matchups between two
  teams, so the URL alone would confuse them. Toasts fire when a followed
  game's `status_text` changes or it turns up as `finished`, and in
  sports flagged in `TOAST_ON_SCORE` (football) when the score changes.
  A status change and a score change in one poll give one toast, labelled
  by the status. The minute alone never toasts. There is no clock in
  `status_text`.
- Each followed team has its own poll loop. `poll($, team)` takes a
  generation from a module counter and records it in `activePolls` under
  the team's key; only the run whose generation is still there may
  publish, toast and schedule, so an older fetch finishing late is
  discarded, and the team is re-checked against `followedTeams($)` too.
  The counter is global, not per team, so a refollowed team never
  matches an old poll. A reading is only carried over as stale for the
  same sport and slug. Keep these checks if you touch `poll` or
  `nextReading`.
- `session.start` runs `startPolls`, which re-polls every followed team
  (the first awaited, the rest staggered `STAGGER_MS` apart) and stops
  the loops and readings of teams no longer followed. Tests call
  `start` repeatedly to force a fresh poll, so it must not skip a team
  that already has a loop. Follow and unfollow run `syncPolls`, which
  only starts missing loops (staggered the same way) and drops removed
  teams. A team waiting on its stagger timer counts as active: it is
  marked in `activePolls` and its timer sits in `pendingPolls`, so
  `syncPolls` skips it and a repeat `startPolls` cancels and replaces the
  timer instead of fetching twice. A poll that ends without scheduling
  its next run (its team is no longer followed, or it threw) clears its
  own `activePolls` key in a `finally`, so nothing blocks a restart. The
  first poll in `pollStaggered` is caught like the staggered ones, so a
  failure cannot escape `session.start` or `/follow-team`.
- A failed fetch doubles that team's next delay for each consecutive
  error (`errorCounts`), capped at `IDLE_POLL_MS`, and a success resets
  it. Without it a blown budget (HTTP 429) would be retried every 30 or
  60 seconds by every followed team. Module variables
  reset when the mod hot-reloads but `$.state` does not, so
  `dropUnfollowed` also drops readings with no loop.
- Followed teams are capped at `MAX_FOLLOWED` (20) to protect the API
  budget: each idle team costs 288 requests a day. A team that plays
  costs about 620 more that day (football: 120 upcoming polls, 240 live
  polls of two requests each, about 24 finished polls; basketball about
  420). With 20 followed, roughly 7 playing the same day reaches the
  ~10,000 a day allowance. These are estimates from the poll cadences,
  not measured against SportScore's counter. `followedTeams($)`
  drops duplicates by `teamKey`, so a hand-edited store polls a team
  once, but it does not truncate a list over the cap.
- Two followed teams in one game poll separately, so both see the same
  change. `lastToast` (game key to last toast text) stops the second
  from toasting again.
- `bandRows` makes one row per game (the first reading published wins a
  shared game, so which side is bold can vary), ordered live, then
  upcoming by start, then finished by latest start. Live rows keep the
  order their readings were first published, not follow order. The
  band shows `MAX_BAND_ROWS` (6) rows, the credit rides on the last
  game row, and a dim `+N more games` line follows when games are
  hidden. With one row and nothing hidden the hook
  returns the row itself, not a wrapper, because the layout tests
  assert that tree shape.
- The `sportsball-teams` pane serves both follow and unfollow picks,
  told apart by the `pickAction` atom. The follow-team pane branch and
  the unfollow-team pane branch each set it before opening, because
  dismissing a pane leaves it set.
