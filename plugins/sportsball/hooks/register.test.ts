import { expect, test } from 'claude-code/testing'

const now = Date.parse('2026-10-04T21:00:00Z')

const valkyries = { name: 'Golden State Valkyries', slug: 'golden-state-valkyries' }
const bluefire = { name: 'Bluefire Valkyries (W)', slug: 'bluefire-valkyries-w' }

const searchBody = (teams: object[]) => ({
  sport: 'basketball',
  query: 'x',
  teams,
  competitions: [],
  players: [],
})

type Route = { status?: number; body: unknown }

function harness(on: any, routes: Record<string, Route>, initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial))
  const urls: string[] = []
  on('http.fetch', async (_$: any, e: any) => {
    urls.push(e.url)
    const hit = Object.entries(routes).find(([part]) => e.url.includes(part))?.[1]
    const status = hit ? (hit.status ?? 200) : 404
    const text = hit ? (typeof hit.body === 'string' ? hit.body : JSON.stringify(hit.body)) : ''
    return { value: { status, ok: status >= 200 && status < 300, headers: {}, text } }
  })
  on('store.get', async (_$: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', async (_$: any, e: any) => (store.set(e.key, JSON.parse(JSON.stringify(e.value))), { value: undefined }))
  on('store.delete', async (_$: any, e: any) => (store.delete(e.key), { value: undefined }))
  on('session.start', async () => ({ cwd: '/tmp' }))
  on('command.register', async () => ({ value: undefined }))
  on('clock.after', async () => ({ value: undefined }))
  on('clock.now', async () => ({ value: now }))
  on('ui.render', async () => ({ value: null }))
  return { store, urls }
}

const start = ($: any) => $.session.start({ source: 'startup', cwd: '/tmp' })
const run = ($: any, command: string, args = '') => $.command.run({ command, args })

test('follow-team with several hits lists them and follows nothing', async ($, on) => {
  const h = harness(on, { '/api/v1/search/': { body: searchBody([valkyries, bluefire]) } })
  await start($)

  const { text } = await run($, 'follow-team', 'valkyries')

  expect(text).toContain('Golden State Valkyries')
  expect(text).toContain('Bluefire Valkyries (W)')
  expect(h.store.get('followed')).toBeUndefined()
})

test('follow-team with one hit follows it and stores the team', async ($, on) => {
  const h = harness(on, { '/api/v1/search/': { body: searchBody([valkyries]) } })
  await start($)

  const { text } = await run($, 'follow-team', 'golden state valkyries')

  expect(text).toContain('Now following Golden State Valkyries')
  expect(h.store.get('followed')).toEqual([{ sport: 'basketball', ...valkyries }])
  expect(h.urls[0]).toContain('q=golden%20state%20valkyries')
  expect(h.urls[0]).toContain('sport=basketball')
})

test('follow-team encodes ampersands in the search', async ($, on) => {
  const h = harness(on, { '/api/v1/search/': { body: searchBody([]) } })
  await start($)

  await run($, 'follow-team', 'ben & jerry')

  expect(h.urls[0]).toContain('q=ben%20%26%20jerry')
})

for (const args of ['', ' ', 'a']) {
  test(`follow-team ${JSON.stringify(args)} replies with usage and makes no request`, async ($, on) => {
    const h = harness(on, {})
    await start($)

    const { text } = await run($, 'follow-team', args)

    expect(text).toContain('Usage: /follow-team')
    expect(h.urls).toEqual([])
  })
}

test('follow-team with no hits says nothing matched', async ($, on) => {
  const h = harness(on, { '/api/v1/search/': { body: searchBody([]) } })
  await start($)

  const { text } = await run($, 'follow-team', 'nonsense')

  expect(text).toContain('No team matched "nonsense"')
  expect(h.store.get('followed')).toBeUndefined()
})

test('follow-team reports a failed lookup and stores nothing', async ($, on) => {
  const h = harness(on, { '/api/v1/search/': { status: 500, body: 'oops' } })
  await start($)

  const { text } = await run($, 'follow-team', 'valkyries')

  expect(text).toContain("Couldn't look up")
  expect(h.store.get('followed')).toBeUndefined()
})

test('follow-team replaces the team already followed', async ($, on) => {
  const h = harness(
    on,
    { '/api/v1/search/': { body: searchBody([bluefire]) } },
    { followed: [{ sport: 'basketball', ...valkyries }] },
  )
  await start($)

  await run($, 'follow-team', 'bluefire')

  expect(h.store.get('followed')).toEqual([{ sport: 'basketball', ...bluefire }])
})

test('unfollow-team clears the followed team', async ($, on) => {
  const h = harness(on, {}, { followed: [{ sport: 'basketball', ...valkyries }] })
  await start($)

  const { text } = await run($, 'unfollow-team')

  expect(text).toContain('Stopped following Golden State Valkyries')
  expect(h.store.get('followed')).toEqual([])
})

test('unfollow-team with a different name keeps the team', async ($, on) => {
  const h = harness(on, {}, { followed: [{ sport: 'basketball', ...valkyries }] })
  await start($)

  const { text } = await run($, 'unfollow-team', 'Aces')

  expect(text).toContain('Not following Aces')
  expect(h.store.get('followed')).toEqual([{ sport: 'basketball', ...valkyries }])
})

test('unfollow-team with a matching name unfollows', async ($, on) => {
  const h = harness(on, {}, { followed: [{ sport: 'basketball', ...valkyries }] })
  await start($)

  await run($, 'unfollow-team', 'valkyries')

  expect(h.store.get('followed')).toEqual([])
})

test('unfollow-team with nothing followed says so', async ($, on) => {
  harness(on, {})
  await start($)

  const { text } = await run($, 'unfollow-team')

  expect(text).toContain('Not following any team')
})

test('sportsball toggles the band on and off', async ($, on) => {
  harness(on, {})
  await start($)

  expect((await run($, 'sportsball')).text).toBe('Sportsball off.')
  expect((await run($, 'sportsball')).text).toBe('Sportsball on.')
})

test('a team stored before the session started is still followed', async ($, on) => {
  harness(on, {}, { followed: [{ sport: 'basketball', ...valkyries }] })
  await start($)

  const { text } = await run($, 'unfollow-team')

  expect(text).toContain('Golden State Valkyries')
})

test('garbage in the store counts as nothing followed', async ($, on) => {
  harness(on, {}, { followed: 'not a list' })
  await start($)

  const { text } = await run($, 'unfollow-team')

  expect(text).toContain('Not following any team')
})
