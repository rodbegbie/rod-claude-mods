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
| [sportsball](plugins/sportsball) | Live score of a followed team above the prompt |

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

Follows one team and draws its live game above the prompt: a sport
emoji, both team names, the score, the game status and the competition,
on a single line. A "Powered by SportScore" credit, linking to
sportscore.com, sits at the right of that row. It appears once, on the
last game row, however many teams are shown, and drops to a row of its
own underneath only when the terminal is too narrow for both. The band is
empty when the team has no live game.

<!-- screenshot placeholder -->

- `/follow-team <name>` follows a team, for example
  `/follow-team golden state valkyries`. If the name matches several
  teams it lists them and follows none, so try a more specific name.
- `/unfollow-team [name]` stops following.
- `/sportsball` shows or hides the band. The followed team is kept
  across sessions either way.

A toast appears when the game moves to a new period (for example
"Half time" or "4th quarter") and at full time, each with the score.
The first reading after a load is silent, so starting Claude mid-game
doesn't toast. `/sportsball` off mutes toasts without losing track.

It polls every 30 seconds while a game is live and every 5 minutes
otherwise. If a poll fails, the last score stays on screen, dimmed, for
up to 10 minutes. Basketball only for now.

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
