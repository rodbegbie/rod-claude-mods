import { expect, test } from 'claude-code/testing'

const now = Date.parse('2026-10-04T12:00:00Z')

const usage = {
  startedAt: 0,
  context: { window: 200000 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-10-04T14:13:00Z' },
    { kind: 'seven_day', percentUsed: 90, resetsAt: '2026-10-07T15:00:00Z' },
    { kind: 'spend_limit', percentUsed: 5 },
  ],
}

async function mountBand($: any, bodyColumns: number) {
  const band = await $.ui.mount({
    plugin: 'usage-bars',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns },
  })
  return JSON.stringify(await band.drawn())
}

test('draws a gauge per window with percent and time to reset', async ($, on) => {
  on('session.usage', async () => ({ value: usage }))
  on('clock.now', async () => ({ value: now }))
  on('clock.every', async () => ({ value: undefined }))
  on('session.start', async () => ({ cwd: '/tmp' }))
  on('command.register', async () => ({ value: undefined }))
  on('ui.render', async () => ({ value: null }))
  await $.session.start({ source: 'startup', cwd: '/tmp' })

  const drawn = await mountBand($, 100)

  expect(drawn).toContain('5-hour')
  expect(drawn).toContain('Weekly')
  expect(drawn).toContain('42%')
  expect(drawn).toContain('90%')
  expect(drawn).toContain('resets in 2h 13m')
  expect(drawn).toContain('resets in 3d 3h')
  expect(drawn).not.toContain('spend')
})

test('gauge is greener at 42% than at 90%', async ($, on) => {
  on('session.usage', async () => ({ value: usage }))
  on('clock.now', async () => ({ value: now }))
  on('clock.every', async () => ({ value: undefined }))
  on('session.start', async () => ({ cwd: '/tmp' }))
  on('command.register', async () => ({ value: undefined }))
  on('ui.render', async () => ({ value: null }))
  await $.session.start({ source: 'startup', cwd: '/tmp' })

  const drawn = await mountBand($, 100)
  const colours = [...drawn.matchAll(/#([0-9a-f]{2})([0-9a-f]{2})[0-9a-f]{2}/g)].map(m => [parseInt(m[1], 16), parseInt(m[2], 16)])

  expect(colours.length).toBeGreaterThan(1)
  expect(colours[0][0]).toBeLessThan(colours[colours.length - 1][0])
  expect(colours[0][1]).toBeGreaterThan(colours[colours.length - 1][1])
})

function stubs(on: any, readings: any[][], toasts: string[]) {
  let i = 0
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: readings[Math.min(i++, readings.length - 1)] } }))
  on('clock.now', async () => ({ value: now }))
  on('clock.every', async () => ({ value: undefined }))
  on('session.start', async () => ({ cwd: '/tmp' }))
  on('command.register', async () => ({ value: undefined }))
  on('ui.render', async () => ({ value: null }))
  on('ui.toast', async (_$: any, e: any) => (toasts.push(e.text), { value: undefined }))
}

const at = (five: number, week = 0) => [
  { kind: 'five_hour', percentUsed: five, resetsAt: '2026-10-04T14:13:00Z' },
  { kind: 'seven_day', percentUsed: week, resetsAt: '2026-10-07T15:00:00Z' },
]

test('toasts once per threshold crossed, silent on first reading', async ($, on) => {
  const toasts: string[] = []
  stubs(on, [at(45), at(45), at(62), at(62), at(97)], toasts)
  on('session.measure', async () => ({ changed: [] }))
  await $.session.start({ source: 'startup', cwd: '/tmp' })
  expect(toasts).toEqual([])

  await $.session.measure({ context: { window: 200000 }, rateLimits: at(45), changed: ['rateLimits'] })
  await $.session.measure({ context: { window: 200000 }, rateLimits: at(62), changed: ['rateLimits'] })
  await $.session.measure({ context: { window: 200000 }, rateLimits: at(62), changed: ['rateLimits'] })
  await $.session.measure({ context: { window: 200000 }, rateLimits: at(97), changed: ['rateLimits'] })

  expect(toasts.length).toBe(2)
  expect(toasts[0]).toContain('5-hour limit 60% used')
  expect(toasts[1]).toContain('5-hour limit 95% used')
})

test('100% shows three skulls instead of the number', async ($, on) => {
  const toasts: string[] = []
  stubs(on, [at(100)], toasts)
  await $.session.start({ source: 'startup', cwd: '/tmp' })

  const drawn = await mountBand($, 100)

  expect(drawn).toContain('💀💀💀')
  expect(drawn).not.toContain('100%')
})
