# sportsball: design

A Claude Code mod that follows a sports team and shows its live game score
in a band above the prompt.

## Goal

Rod names a team. If that team has a live game, a one-row band above the
prompt shows the score, game status and competition, with each team's name
in a colour taken from its logo. With no live game, nothing is drawn.

Success: the Golden State Valkyries WNBA playoff game shows a live, updating
score above the prompt, and the band disappears when the game ends.

Out of scope for v1: following several teams, toasts, a pane, sports other
than basketball. The design leaves room for each.

## Data source

SportScore public API, `https://sportscore.com`. Anonymous, no key, about
10,000 requests per day per IP, about 15 requests per second. The terms
require a visible "Powered by SportScore" backlink wherever the data is
shown.

Verified by probing the live API on 2026-10-04:

- `GET /api/v1/search/?q=<text>&sport=basketball` returns `teams[]` with
  `name`, `slug`, `logo`, `url`. "valkyries" returns two teams: Golden State
  Valkyries and Bluefire Valkyries (W).
- `GET /api/v1/team/?sport=basketball&slug=<slug>&limit=<n>` returns the
  team's recent and upcoming `matches[]`.
- A match has `home`, `away`, `home_logo`, `away_logo`, `home_score`,
  `away_score`, `status` (`live`, `finished`, `upcoming`), `status_text`
  (for example "Half time"), `time`, `competition`, `url`.
- Scores are strings, although the OpenAPI spec says integer.
- There is no quarter or clock field. `status_text` is the only game-state
  text.
- `/api/v1/fixtures/` is limited to one UTC calendar day, so it would drop a
  game that crosses midnight UTC. The mod uses `/api/v1/team/` instead.

## Mod layout

A new folder `plugins/sportsball/`, following `pro-limits`:

- `.claude-plugin/plugin.json`, naming `types/index.d.ts`.
- `hooks/hooks.json`: `{ "modules": ["./register.tsx"] }`.
- `hooks/register.tsx`: the hooks module.
- `hooks/register.test.ts`: tests.
- `types/index.d.ts`: `PluginState` keys under `sportsball`.

Also: a marketplace entry, a README table row, matching `version` values,
and a `sportsball specifics` section in `CLAUDE.md`.

## Commands

| Command | Behaviour |
| --- | --- |
| `/follow-team <name>` | Search for the team and follow it. |
| `/unfollow-team [name]` | Stop following. A name, if given, must match the followed team. |
| `/sportsball` | Toggle the band on and off. The followed team is kept. |

`/follow-team` rules:

- One search hit: follow it.
- Several hits: follow nothing, reply with the candidates, ask for a more
  specific name.
- No hits: say so.
- Following replaces any current team. State holds a list of one, so
  multi-team support adds code without a data migration.

The followed team (`{ sport, slug, name }`) and the colour cache live in
`$.store`, so they survive across sessions. The on/off flag and the latest
reading are atoms, as in `pro-limits`.

## Polling

- A `$.clock.every` tick calls `$.http.fetch` on `/api/v1/team/` and picks
  the first match with `status == "live"`.
- The tick is 30 seconds while a game is live and 5 minutes otherwise. The
  interval is chosen after each reading.
- `session.start` and `/follow-team` also trigger an immediate poll.
- On a network error, a non-2xx status or unparseable JSON, the mod keeps
  the last good reading and marks it stale (dimmed). It shows no toast.
- A stale reading older than 10 minutes is dropped.

## Band

One row, `wrap="truncate-end"`, reserving `COLLAPSE_CONTROL_COLUMNS` as
`context-bar` and `pro-limits` do:

<!-- markdownlint-disable MD013 -->

```text
Golden State Valkyries 34 - 31 Las Vegas Aces · Half time · WNBA · via SportScore
```

<!-- markdownlint-enable MD013 -->

- Each team name is drawn in that team's logo colour. The followed team's
  score is bold.
- The competition shortens "Women's National Basketball Association" to
  "WNBA" and shows any other name in full.
- "via SportScore" is dimmed and is the attribution.
- With the toggle off, no followed team, no live game, or a survey showing
  (`e.props.hasSurvey`), the hook answers `next(e)`.

## Team colour

`$.http.fetch` returns text only, and the module has no DOM, Node or image
decoder, so a PNG cannot be read in the module. A short Python 3 helper,
run with `$.process.run(["python3", "-c", SCRIPT, url])`, does it with the
standard library alone (`urllib`, `zlib`, `struct`). It must work on any
machine, so it is built to fail safe.

Helper behaviour:

- Accepts only an `https://` URL. The URL comes from API data, so the mod
  checks the scheme before the call and the script checks it again (urllib
  would otherwise follow `file:`).
- Reads at most 2 MB, with a 10-second timeout.
- Decodes non-interlaced, 8-bit, colour type 2 (RGB) or 6 (RGBA) PNGs. The
  four logos probed were all 8-bit RGBA, non-interlaced. Anything else exits
  non-zero.
- Samples at most about 40,000 pixels. Skips transparent pixels
  (alpha below 128) and low-saturation pixels (white, black, greys).
- Buckets the rest into 4-bit-per-channel bins, takes the most frequent bin,
  and prints the mean colour of its pixels as `#rrggbb`.
- The mod lightens any colour below a minimum luminance so a navy logo stays
  readable on a dark terminal.

Mod behaviour:

- Colours are keyed by logo URL, so the opponent's colour is found the same
  way. They are fetched when a live game is first seen, not at follow time.
  The band uses a neutral colour until the result arrives.
- A success is cached in `$.store` permanently.
- Any failure (no `python3`, a non-zero exit, a timeout, bad output) leaves
  the neutral colour. It is remembered for the session only and not
  retried until the next session, so a broken helper cannot run on every
  poll.
- On macOS without the Command Line Tools, `/usr/bin/python3` is a stub that
  can open an install dialog. The plan must settle a guard for this, such as
  checking `xcode-select -p` first where the platform is detectable. If no
  reliable guard exists, the cost is documented in the README.

Known trade-off: the helper makes its own network request, outside
`$.http.fetch`, so a host web-fetch policy or
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` does not govern it. `$.process`
is also CLI only. Both are acceptable because the helper only affects a
cosmetic colour and fails safe, but the README should say so.

## Testing

`claude plugin test plugins/sportsball`, using the stubbing rules in
`CLAUDE.md`. Stubs for `http.fetch` return the real response shapes captured
above. Cases:

- Live game draws the expected tree: team names, string scores parsed,
  status text, shortened competition, attribution.
- No live game, toggle off, no followed team: `next(e)`.
- `/follow-team` with one hit, several hits and no hits.
- `/unfollow-team` with and without a matching name.
- A fetch error keeps the last reading, marked stale.
- Poll interval is 30 seconds when live and 5 minutes otherwise.
- Colour: a cached colour is used and not re-fetched; a failed helper gives
  the neutral colour and is not retried; a non-`https` logo URL is refused.

The Python helper gets its own tests against small generated PNGs: RGBA,
RGB, interlaced (must fail), and an all-grey image (must fail). Then
`claude plugin validate plugins/sportsball`, and a live run against the
current Valkyries game while it is on.

## Open points for the plan

- The exact `$.store` API and how `$.process.run` is permitted in the tests.
- The macOS `python3` stub guard.
- Whether the helper script lives inline in `register.tsx` or is a separate
  file the mod can reach, given the module has no filesystem access of its
  own.
