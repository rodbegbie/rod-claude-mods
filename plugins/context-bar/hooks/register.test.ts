import { expect, test } from 'claude-code/testing'

const usage = {
  startedAt: 0,
  context: {
    window: 200000,
    breakdown: {
      categories: [
        { name: 'System prompt', tokens: 3000, color: 'promptBorder', isDeferred: false, kind: 'used' },
        { name: 'Messages', tokens: 7000, color: 'permission', isDeferred: false, kind: 'used' },
        { name: 'Free space', tokens: 190000, color: 'inactive', isDeferred: false, kind: 'free' },
      ],
      totalTokens: 10000,
      maxTokens: 200000,
      rawMaxTokens: 200000,
      autocompactSource: 'model-default',
      percentage: 5,
      gridRows: [],
      model: 'test',
    },
  },
}

test('draws one coloured segment per category', async ($, on) => {
  on('session.usage', async () => ({ value: usage }))
  on('ui.render', async () => ({ value: null }))
  on('session.start', async () => ({ cwd: '/tmp' }))
  on('command.register', async () => ({ value: undefined }))
  await $.session.start({ source: 'startup', cwd: '/tmp' })

  const band = await $.ui.mount({
    plugin: 'context-bar',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 },
  })
  const drawn = JSON.stringify(await band.drawn())

  expect(drawn).not.toContain('promptBorder')
  expect(drawn).toContain('#e0a458')
  expect(drawn).toContain('1.5%')
  expect(drawn).toContain('3.5%')
  expect(drawn).toContain('permission')
  expect(drawn).toContain('inactive')
})

test('bar cells add up to the band width less the collapse control', async ($, on) => {
  on('session.usage', async () => ({ value: usage }))
  on('session.start', async () => ({ cwd: '/tmp' }))
  on('command.register', async () => ({ value: undefined }))
  on('ui.render', async () => ({ value: null }))
  await $.session.start({ source: 'startup', cwd: '/tmp' })

  for (const bodyColumns of [40, 77, 120, 183]) {
    const band = await $.ui.mount({
      plugin: 'context-bar',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns },
    })
    const drawn = (await band.drawn()) as { children: { children: { children: string[] }[] }[] }
    const cells = drawn.children[0].children.reduce((sum, t) => sum + t.children[0].length, 0)

    expect(cells).toBe(bodyColumns - 4)
  }
})
