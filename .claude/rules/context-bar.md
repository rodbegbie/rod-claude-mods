---
paths:
  - "plugins/context-bar/**"
---

# context-bar specifics

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
