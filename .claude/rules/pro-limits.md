---
paths:
  - "plugins/pro-limits/**"
---

# pro-limits specifics

- Reads `rateLimits` from `$.session.usage()` (`kind` is `five_hour` or
  `seven_day`; `percentUsed`, optional `resetsAt`). It is empty off a
  subscription, so the band draws nothing then.
- Threshold toasts are silent on the first non-empty reading after a
  load or reload, because module variables reset on hot reload and
  `session.start` re-primes them. Toggling off mutes toasts but keeps
  tracking levels, so toggling back on never replays them.
- Readout width is `READOUT_COLUMNS` (24). The 100% easter egg is two
  emoji, each two columns wide, so it fits the same space as `100%`.
