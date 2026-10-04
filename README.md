# rod-claude-mods

Rod Begbie's mods for Claude Code, published as a plugin marketplace.

## Install

Add the marketplace, then install the mods you want:

```text
/plugin marketplace add <github-owner>/rod-claude-mods
/plugin install context-bar@rod-claude-mods
```

To try the marketplace from a local checkout, point at the folder instead:

```text
/plugin marketplace add /path/to/rod-claude-mods
```

## Mods

| Mod | What it does |
| --- | --- |
| [context-bar](plugins/context-bar) | Stacked context-window bar above the prompt |

### context-bar

Draws the context window as a stacked bar above the prompt, with one
colour per category as in `/context`. A legend underneath lists each
category's tokens and share of the window, then the total.

Toggle it with `/context-bar`. It starts on, and refreshes at session
start and after every turn.

## Adding a mod

Each mod lives in its own folder under `plugins/` and is listed in
`.claude-plugin/marketplace.json`. Check the lot with:

```bash
claude plugin validate .
claude plugin validate plugins/<mod-name>
claude plugin test plugins/<mod-name>
```
