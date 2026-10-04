import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Bar } from '../types'

const bar = atom({ plugin: 'context-bar', key: 'bar' } as const, null)
const isOn = atom({ plugin: 'context-bar', key: 'isOn' } as const, true)

const COLOR_OVERRIDES: Record<string, string> = {
  'System prompt': '#e0a458',
  'System tools': '#4fb3a9',
}

const COLLAPSE_CONTROL_COLUMNS = 4

const percent =(n: number, of: number) => `${((n / of) * 100).toFixed(1)}%`

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)

async function refresh($: EngineInterface) {
  const { context } = await $.session.usage({ breakdown: 'summary' })
  const b = context.breakdown
  if (!b) return
  const segments = b.categories
    .filter(c => c.kind !== 'deferred' && c.tokens > 0)
    .map(c => ({ name: c.name, tokens: c.tokens, color: COLOR_OVERRIDES[c.name] ?? c.color, kind: c.kind }))
  const next: Bar = { segments, total: b.totalTokens, window: b.rawMaxTokens }
  await update($, bar, () => next)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'context-bar',
      description: 'Toggle the stacked context-window bar above the prompt',
    })
    await refresh($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($)

    return next(e)
  })

  on('command.run', { command: 'context-bar' }, async $ => {
    const now = await update($, isOn, v => !v)
    await refresh($)

    return { text: `Context bar ${now ? 'on' : 'off'}.` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const data = await read($, bar)
    if (e.props.hasSurvey || data === null || !(await read($, isOn))) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const width = Math.max(10, e.props.bodyColumns - COLLAPSE_CONTROL_COLUMNS)
    const total = data.segments.reduce((s, c) => s + c.tokens, 0) || 1

    let used = 0
    const cells = data.segments.map(c => {
      const end = Math.round(((used + c.tokens) / total) * width)
      const n = Math.max(c.tokens > 0 ? 1 : 0, end - Math.round((used / total) * width))
      used += c.tokens
      return { c, n }
    })
    const widest = cells.reduce((a, b) => (b.n > a.n ? b : a))
    widest.n += width - cells.reduce((s, { n }) => s + n, 0)

    return (
      <Box flexDirection="column">
        <Box>
          {cells.map(({ c, n }) => (
            <Text key={c.name} wrap="truncate-end" backgroundColor={c.color} dimColor={c.kind !== 'used'}>
              {' '.repeat(n)}
            </Text>
          ))}
        </Box>
        <Box flexWrap="wrap" columnGap={2}>
          {data.segments
            .filter(c => c.kind === 'used')
            .map(c => (
              <Text key={c.name} color={c.color}>
                ■ {c.name} {compact(c.tokens)}
                <Text color="gray"> {percent(c.tokens, data.window)}</Text>
              </Text>
            ))}
          <Text dimColor>
            {compact(data.total)} / {compact(data.window)}
          </Text>
          <Text color="gray">{percent(data.total, data.window)}</Text>
        </Box>
      </Box>
    )
  })
}
