# rod-claude-mods

Rod Begbie's mods for Claude Code, published as a plugin marketplace.

## Install

Add the marketplace, then install the mods you want:

```text
/plugin marketplace add rodbegbie/rod-claude-mods
/plugin install context-bar@rod-claude-mods
/plugin install pro-limits@rod-claude-mods
/plugin install sportsball@rod-claude-mods
```

To try the marketplace from a local checkout, point at the folder instead:

```text
/plugin marketplace add /path/to/rod-claude-mods
```

## Mods

| Mod | What it does |
| --- | --- |
| [context-bar](plugins/context-bar) | Stacked context-window bar above the prompt |
| [pro-limits](plugins/pro-limits) | 5-hour and weekly usage-limit gauges above the prompt |
| [sportsball](plugins/sportsball) | Live scores of followed teams above the prompt |

### context-bar

Draws the context window as a stacked bar above the prompt, with one
colour per category as in `/context`. A legend underneath lists each
category's tokens and share of the window, then the total.

Toggle it with `/context-bar`. It starts on, and refreshes at session
start and after every turn.

### pro-limits

Draws one gauge per subscription limit (5-hour and weekly) above the
prompt. Each bar shifts from green through amber to red as you approach
the limit, followed by the percentage used and the time until that window
resets. Windows only appear once Claude has reported them, so nothing
shows on API-key accounts.

![The pro-limits gauges above the prompt: the 5-hour limit at 13% in
green and the weekly limit at 85% in red-orange](docs/pro-limits.png)

A toast pops up each time a window passes 20%, 40%, 60%, 80%, 90% or
95%. Hit 100% and the percentage turns into two skulls. Readings seen
at session start never toast, only crossings after that.

Toggle it with `/pro-limits`. It starts on, refreshes whenever a limit
moves a whole point, and ticks every 30 seconds to keep the countdown
honest.

### sportsball

Follows as many teams as you like (up to 20) and draws their live games
above the prompt, one row per game: a sport emoji, both team names, the
score, the game status and the competition, on a single line. A game
between two teams you follow shows once. Rows are ordered live games
first, then games about to start, then games that have just ended. The
band shows at most 6 rows, with a dim `+2 more games` line when there are
others. A "Powered by SportScore" credit, linking to sportscore.com, sits
at the right of the last game row, and drops to a row of its own
underneath only when the terminal is too narrow for both.

A team with no live game shows a game that starts within the next 2
hours (`Starts 1:30 PM (in 1h 40m)` in your local time, no score) or
ended within the last 2 hours (the final score and `Full time`).
SportScore gives no end time, so a game counts as ended its start time
plus a typical length: 2 hours for football and 2.5 hours for basketball.
The band is empty when no team has such a game. Until you follow a team,
it shows a line of help pointing at `/follow-team` instead.

![The sportsball band above the prompt: Scotland 0 - 0 Slovenia, 1st
half 13', UEFA Nations League, with the SportScore credit at the
right](docs/sportsball.png)

- `/follow-team <name>` adds a team to those you follow, for example
  `/follow-team golden state valkyries` or `/follow-team club atletico
  tigre`. It searches basketball and football together. If the name
  matches more than one team, even exactly, it asks which. Each choice
  shows a sport emoji, the team name and the league of its latest game
  (left off when the lookup fails or the team has no games). Up to four
  teams are offered in a question dialog. More than that opens a pane
  with a list, so none are cut off. Dismissing either follows nothing
  and keeps the teams you already follow. A name that matches a single
  team is followed straight away. A team you already follow says so, and
  following past 20 teams is refused. A team is left out, and named in
  the reply, when SportScore's lookup for it returns a different team,
  as it does for Rangers F.C. (Glasgow).
- `/following` lists the teams you follow, one per line with its sport
  emoji. It needs no network.
- `/unfollow-team [name]` stops following a team. With one team, or a
  name that matches one team, it unfollows at once. Otherwise it asks
  which, in a question dialog for up to four teams and a pane with a
  list for more.
- `/sportsball` shows or hides the band. The teams you follow are kept
  across sessions either way.

A toast appears when a followed game moves to a new period (for example
"Half time" or "4th quarter") and at full time, each with the score.
In football, a change of score also toasts (`Goal 60' (Matias Lopez)`, or
`Score change` if a goal is ruled out), with the match minute and the
scorer's name when SportScore has them.
Basketball scores change too often, so only periods toast there.
The first reading after a load is silent, so starting Claude mid-game
doesn't toast. `/sportsball` off mutes toasts without losing track.

![A sportsball toast: Goal 32' (Ryan Christie): Scotland 1 - 0
Slovenia](docs/sportsball-goal.png)

Football games also show the match minute next to the status, for
example `2nd half 84'`. It comes from a second request per poll, so a
failed lookup just leaves the minute off.

Each team is polled on its own schedule: every 30 seconds while its game
is live, every minute while one is about to start, and every 5 minutes
otherwise. If a poll fails, that team's last score stays on screen,
dimmed, for up to 10 minutes, and the other teams carry on. Basketball and
football are supported.

Scores come from the [SportScore](https://sportscore.com) public API,
which asks for a visible "Powered by SportScore" link, hence the credit
row. Terminals without hyperlink support show the URL next to the name.

Team names are coloured from their logos. To do that the mod runs a
short Python 3 script (standard library only) on your machine, once per
logo, and caches the result. This is optional: without `python3` the
names simply draw in the default colour. Two things to know about it:

- It fetches the logo itself, outside the host's web-fetch policy.
- It needs a terminal session, because mods cannot run commands from
  other surfaces.

On a Mac without the Command Line Tools the mod skips the script rather
than trigger the install dialog.

## Adding a mod

Each mod lives in its own folder under `plugins/` and is listed in
`.claude-plugin/marketplace.json`. Check the lot with:

```bash
claude plugin validate .
claude plugin validate plugins/<mod-name>
claude plugin test plugins/<mod-name>
```
