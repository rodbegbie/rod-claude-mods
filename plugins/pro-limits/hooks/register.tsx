import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Usage } from '../types'

const usage = atom({ plugin: 'pro-limits', key: 'usage' } as const, null)
const isOn = atom({ plugin: 'pro-limits', key: 'isOn' } as const, true)

const WINDOWS: Record<string, string> = { five_hour: '5-hour', seven_day: 'Weekly' }

const COLLAPSE_CONTROL_COLUMNS = 4
const LABEL_COLUMNS = 9
const READOUT_COLUMNS = 24
const TICK_MS = 30_000
const TOAST_MS = 8000
const THRESHOLDS = [20, 40, 60, 80, 90, 95, 100]
const SKULLS = '💀💀'

const alerted: Record<string, number> = {}
let isPrimed = false

const GREEN = [78, 186, 101]
const AMBER = [230, 180, 60]
const RED = [224, 60, 60]

const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t))

const hex = (rgb: number[]) => `#${rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`

function gaugeColor(percent: number) {
  const p = Math.min(100, Math.max(0, percent)) / 100
  return hex(p < 0.5 ? mix(GREEN, AMBER, p * 2) : mix(AMBER, RED, (p - 0.5) * 2))
}

function untilReset(resetsAt: string | undefined, now: number) {
  if (!resetsAt) return 'reset time unknown'
  const minutes = Math.floor((Date.parse(resetsAt) - now) / 60_000)
  if (Number.isNaN(minutes)) return 'reset time unknown'
  if (minutes < 1) return 'resets in <1m'
  if (minutes < 60) return `resets in ${minutes}m`
  if (minutes < 24 * 60) return `resets in ${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `resets in ${Math.floor(minutes / (24 * 60))}d ${Math.floor((minutes % (24 * 60)) / 60)}h`
}

const crossed = (percent: number) => THRESHOLDS.filter(t => percent >= t).length

function readout(percent: number) {
  return percent >= 100 ? SKULLS : `${Math.round(percent)}%`
}

function announce($: EngineInterface, limits: Usage['limits'], now: number) {
  for (const l of limits) {
    const level = crossed(l.percentUsed)
    const isRising = level > (alerted[l.kind] ?? 0)
    alerted[l.kind] = level
    if (!isPrimed || !isRising) continue

    const name = WINDOWS[l.kind]
    $.ui.toast(
      l.percentUsed >= 100
        ? `${SKULLS} ${name} limit reached, ${untilReset(l.resetsAt, now)}`
        : `${name} limit ${THRESHOLDS[level - 1]}% used, ${untilReset(l.resetsAt, now)}`,
      { timeoutMs: TOAST_MS },
    )
  }
  if (limits.length > 0) isPrimed = true
}

async function refresh($: EngineInterface) {
  const { rateLimits } = await $.session.usage()
  const now = await $.clock.now()
  const next: Usage = {
    limits: rateLimits
      .filter(l => l.kind in WINDOWS)
      .map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
    now,
  }
  announce($, next.limits, now)
  await update($, usage, () => next)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'pro-limits',
      description: 'Toggle the 5-hour and weekly usage gauges above the prompt',
    })
    await refresh($)
    $.clock.every(TICK_MS, () => refresh($))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await refresh($)

    return next(e)
  })

  on('command.run', { command: 'pro-limits' }, async $ => {
    const now = await update($, isOn, v => !v)

    return { text: `Usage bars ${now ? 'on' : 'off'}.` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const data = await read($, usage)
    if (e.props.hasSurvey || data === null || data.limits.length === 0 || !(await read($, isOn))) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const width = Math.max(10, e.props.bodyColumns - COLLAPSE_CONTROL_COLUMNS - LABEL_COLUMNS - READOUT_COLUMNS)

    return (
      <Box flexDirection="column">
        {data.limits.map(l => {
          const percent = Math.min(100, Math.max(0, l.percentUsed))
          const filled = Math.round((percent / 100) * width)
          const color = gaugeColor(percent)

          return (
            <Box key={l.kind}>
              <Text>{WINDOWS[l.kind].padEnd(LABEL_COLUMNS)}</Text>
              <Text color={color}>{'█'.repeat(filled)}</Text>
              <Text dimColor>{'░'.repeat(width - filled)}</Text>
              <Text wrap="truncate-end">
                <Text color={color}> {readout(l.percentUsed).padStart(4)}</Text>
                <Text dimColor>  {untilReset(l.resetsAt, data.now)}</Text>
              </Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
