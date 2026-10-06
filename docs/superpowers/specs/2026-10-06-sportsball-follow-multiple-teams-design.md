# Sportsball: follow multiple teams

GitHub issue: #8, "Support the user following multiple teams".

## Goal

A user can follow many teams across sports, for example Heart of
Midlothian, Scotland's men's and women's teams, Golden State Warriors
and Golden State Valkyries. Every followed team's game is monitored,
shown above the prompt and toasted, as the single followed team is
today. The user can see what they follow, so they know what to
unfollow.

## Decisions

- Each followed team has its own poll loop (approach B). A shared loop
  would put every idle team on the 30-second live cadence as soon as
  one game went live, which would exhaust SportScore's budget of about
  10,000 requests a day per IP. A single scheduler with per-team due
  times was rejected because it would rewrite the generation and stale
  checks that the existing code and tests already rely on.
- The band applies today's rules to each team: a game that is live,
  starts within 2 hours, or finished within the last 2 hours gets a row.
- `/following` is a new command. `/follow-team` adds a team instead of
  replacing the current one.

## State and polling

- The `followed` store key is already an array of `Followed`, so a
  stored single team keeps working with no migration.
- `/follow-team` appends. A team already followed is not added twice.
  Follows are capped at 20 (`MAX_FOLLOWED`) to protect the API budget,
  and following past the cap replies with the limit.
- The `reading` atom becomes `readings: Record<string, Reading>`, keyed
  `sport/slug` (the key `choiceValue` already builds). The rename makes
  any stale reference fail at type-check. `types/index.d.ts` changes to
  match.
- `pendingPoll` and `pollGeneration` become maps keyed by team.
  `poll($, team)` is today's `poll` for one team. The re-check after the
  fetch asks whether the team is still in the followed list, where it
  now compares against the first entry. Each team keeps its own timer,
  delay, stale handling and generation guard.
- `syncPolls($)` runs at session start and after any follow or unfollow.
  It starts a loop for each team that lacks one, with starts staggered
  about 500 ms apart so 20 follows don't send 20 requests at once. It
  cancels the loops of teams no longer followed and drops their
  readings. Following one team starts only that team's poll.
- Toasts: `announcement` already runs per team against that team's
  previous reading and needs no change. A map from game key to last
  toast text stops the same toast showing twice when the user follows
  both teams in one game.
- `ensureColours` is per game and stays as it is.

## Commands

- `/follow-team <name>` keeps its search and picker. Following a team
  already followed replies "Already following X". At the cap it replies
  with the limit.
- `/following` lists the followed teams one per line, each with its
  sport emoji. With none followed it points at `/follow-team`. It reads
  only the store, so it works offline. It is registered in
  `session.start` with the other commands.
- `/unfollow-team [name]`:
  - With a name, it matches name or slug case-insensitively among the
    followed teams. One match unfollows it, several matches ask which,
    and no match replies "Not following X".
  - With no name, a single follow is dropped, as today. Several follows
    ask which, using `$.ui.ask` for four or fewer and the existing pane
    above that.
  - The pane's `ui.select` hook currently always follows. A `pickAction`
    atom (`follow` or `unfollow`) tells it what a pick means, and the
    pane title changes to match.

## The band

- One row per game across all readings, deduplicated by game key, so a
  game between two followed teams appears once. The first reading to
  claim the game supplies the bold followed-side score.
- Order: live first, then upcoming by kick-off, then finished by most
  recent start.
- Each row keeps today's layout, including dimming when stale. The
  "Powered by SportScore" credit sits on the last row only. Earlier
  rows use the full width.
- The band shows at most 6 rows (`MAX_BAND_ROWS`). A dim `+N more games`
  line follows when games are hidden.
- With nothing followed, the help line shows as today. With followed
  teams and no game in range, the band is empty as today.

## Errors

- A failed poll affects only that team. It shows its last game dimmed
  for up to 10 minutes, as today, and the other teams carry on.
- `/following` and `/unfollow-team` read only the store.
- A malformed stored entry is dropped by the existing `followedTeams`
  filter.

## Testing

Tests are written first, in `register.test.ts`.

- The existing single-team tests move to the `readings` map and should
  otherwise pass unchanged. That confirms the per-team loop reused the
  logic faithfully.
- New tests cover:
  - following a second team keeps the first, and a duplicate is not
    added;
  - the follow cap;
  - separate cadences for one live team and one idle team;
  - unfollowing cancels only that team's timer and clears only its
    reading;
  - a shared game shows one row and toasts once;
  - row order, and the credit on the last row only;
  - the `+N more games` line;
  - `/following` output;
  - unfollow by name, with several matches, and with no argument and
    several follows, through both `ask` and the pane;
  - staggered starts at session start.
- The Python logo-colour tests are unchanged.

## Docs and delivery

- Update the sportsball section of the README: multiple teams,
  `/following`, the follow cap and the row limit. Check it with
  `markdownlint` before committing.
- Update `.claude/rules/sportsball.md`, which assumes one team in the
  `reading` and `followedTeams($)` notes. Record the per-team generation
  rule there.
- Bump the version to 0.3.0 in `plugin.json` and in the marketplace
  entry together, because `/follow-team` now adds instead of replacing.
- Work on `feature/8-follow-multiple-teams`, opened as a trail with
  `entire trail create`, and merge with a merge commit.

## Out of scope

- Unfollow all.
- Reordering teams.
- Per-team mute.
- A pane for managing follows.
