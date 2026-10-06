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
- The dev-mods copy does not track the repo. Re-sync it after editing
  or switching branches: `rsync -a --exclude '.claude-plugin/types'
  --exclude tsconfig.json --exclude tests plugins/<mod>/
  ~/.claude/dev-mods/<session-id>/<mod>/`.
- There is no toast log. A session's transcript records hook failures
  and command output only, and `claude --debug` is needed for more.
  `$.store` is a JSON file at
  `~/.claude/plugins/store/<mod>_inline-<hash>.json`, which shows what
  is followed and the cached colours.
- To learn what the hook sandbox can do (the engine typings do not say),
  put a throwaway mod in dev-mods that toasts the answer, read the
  toast, then delete the mod. That is how local timezone and `Intl`
  support were confirmed.

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

## Git and PRs

- Default branch is `main`. Branch from it and PR back into it.
- In Claude Code's Bash, redirect stdin (`</dev/null`) for `entire` and
  `gh` commands; a stray stdin read stalls them until the 120s timeout.
- The trail PR from `entire trail create` is a draft. Merge with
  `gh pr ready <n>` then `gh pr merge <n> --merge`, delete the feature
  branch locally and on the remote, and leave the local `entire/<sha>`
  checkpoint branch alone.
- README screenshots live in `docs/`, not inside a plugin folder.
- Start a trail by making the feature branch yourself (`git switch -c
  feature/<issue>-<name>`), then `entire trail create --title ... --type
  feature --body ...`. It pushes the branch and opens the trail and its
  draft PR.
- Lint Markdown with `markdownlint <file>` and check its exit status
  before committing, not after. README is clean; CLAUDE.md has a few
  long lines that predate this check.
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
