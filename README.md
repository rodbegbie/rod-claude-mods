# rod-claude-mods

Rod Begbie's mods for Claude Code, published as a plugin marketplace.

## Install

Add the marketplace, then install the mods you want:

```text
/plugin marketplace add rodbegbie/rod-claude-mods
/plugin install context-bar@rod-claude-mods
/plugin install pro-limits@rod-claude-mods
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

A toast pops up each time a window passes 20%, 40%, 60%, 80%, 90% or
95%. Hit 100% and the percentage turns into two skulls. Readings seen
at session start never toast, only crossings after that.

Toggle it with `/pro-limits`. It starts on, refreshes whenever a limit
moves a whole point, and ticks every 30 seconds to keep the countdown
honest.

## Adding a mod

Each mod lives in its own folder under `plugins/` and is listed in
`.claude-plugin/marketplace.json`. Check the lot with:

```bash
claude plugin validate .
claude plugin validate plugins/<mod-name>
claude plugin test plugins/<mod-name>
```
