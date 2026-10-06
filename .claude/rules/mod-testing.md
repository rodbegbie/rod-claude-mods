---
paths:
  - "plugins/**/*.test.ts"
  - "plugins/**/tests/**"
---

# Testing quirks

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
- Register each event stub once per test. A second `on('session.usage', ...)`
  fails with "registered twice", so for a changing reading, stub with a
  getter over a mutable variable rather than a call-counted list (call
  order through `session.start` and `session.measure` is not obvious).
- If a mod answers `ui.render` with `next(e)` (nothing to draw), a
  `ui.render` stub returning `{ value: null }` fails with "not a tree
  element". Assert on state or toasts instead of mounting in that case.
- A test's `$` has no `state` noun. To read a mod's state, register
  `on('state.set', (_$, e, next) => (seen[e.key] = e.value, next(e)))`
  and assert on what was written. Assert on the whole write history when
  a stale write could be masked by a later one.
- A `ui.render` stub answers with the tree itself, not `{ value }`. Use
  a distinctive stub tree to tell `next(e)` from the mod's own drawing.
- An `on('clock.after', ...)` stub that resolves makes the kit fire the
  callback at once, in the background. Return a promise that never
  resolves, and record `e.ms`, to assert on the delay without firing.
  sportsball resolves only `ms === 0`, its way of moving work off the
  hook path, so tests wait for that work with a short polling loop.
- A throwing `ui.render` hook is swallowed and the engine draws its own
  tree, which looks like `next(e)` to a test.
- The test runner has no `test.each`; loop and call `test` instead.
- sportsball's fixtures hang off a fixed `now` (2026-10-04T21:00Z). Make
  start times with `at(minutes)`. A fixture starting within hours of
  `now` counts as an upcoming or recent game, so a "no game" case needs
  an old `time` (as `finishedMatch` has). Tests run in the machine's
  timezone, so build the expected kick-off text with the same
  `Intl.DateTimeFormat` (`localTime`), never a literal.
- `on(...)` stubs must all be registered before the test first calls
  `$`, so one test cannot build two harnesses. To change what the API
  returns between polls, mutate the route (sportsball's `rig(...)`
  returns a `next(...)` for this).
- Capture toasts with `on('ui.toast', ...)` and drive `session.measure` and
  `command.run` directly with `$.session.measure(...)` and
  `$.command.run(...)`.
