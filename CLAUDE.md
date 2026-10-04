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

## Entire

`.entire/runners/*.json` configures Entire trail runners (prompt runners
that score the trail on push) with prompts written for this repo's layout.
If the layout conventions above change, update those prompts to match.
