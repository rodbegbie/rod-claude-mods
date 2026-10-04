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

type Route = { status?: number; body: unknown; gate?: Promise<void>; onFetch?: () => void }

let states: Record<string, any> = {}
let readingWrites: any[] = []

function harness(on: any, routes: Record<string, Route>, initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial))
  const urls: string[] = []
  const delays: number[] = []
  const clock = { now }
  states = {}
  readingWrites = []
  on('state.set', async (_$: any, e: any, next: any) => {
    states[e.key] = e.value
    if (e.key === 'reading') readingWrites.push(e.value)
    return next(e)
  })
  on('http.fetch', async (_$: any, e: any) => {
    urls.push(e.url)
    const hit = Object.entries(routes).find(([part]) => e.url.includes(part))?.[1]
    hit?.onFetch?.()
    await hit?.gate
    const status = hit ? (hit.status ?? 200) : 404
    const text = hit ? (typeof hit.body === 'string' ? hit.body : JSON.stringify(hit.body)) : ''
    return { value: { status, ok: status >= 200 && status < 300, headers: {}, text } }
  })
  on('store.get', async (_$: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', async (_$: any, e: any) => (store.set(e.key, JSON.parse(JSON.stringify(e.value))), { value: undefined }))
  on('store.delete', async (_$: any, e: any) => (store.delete(e.key), { value: undefined }))
  on('session.start', async () => ({ cwd: '/tmp' }))
  on('command.register', async () => ({ value: undefined }))
  on('clock.after', async (_$: any, e: any) => (delays.push(e.ms), { value: undefined }))
  on('clock.now', async () => ({ value: clock.now }))
  on('ui.render', async () => ({ value: null }))
  return { store, urls, delays, clock }
}

const liveMatch = {
  home: 'Golden State Valkyries',
  away: 'Las Vegas Aces',
  home_logo: 'https://img.example/valkyries.png',
  away_logo: 'https://img.example/aces.png',
  home_score: '34',
  away_score: '31',
  status: 'live',
  status_text: 'Half time',
  time: '2026-10-04T20:00:00+00:00',
  competition: "Women's National Basketball Association",
  url: '/basketball/match/las-vegas-aces-vs-golden-state-valkyries/',
}
const finishedMatch = { ...liveMatch, home: 'Golden State Valkyries', away: 'Dallas Wings', status: 'finished', status_text: 'Finished', home_score: '77', away_score: '73' }

const schedule = (...matches: object[]) => ({ sport: 'basketball', team: valkyries, count: matches.length, matches })
const followingValkyries = { followed: [{ sport: 'basketball', ...valkyries }] }
const TEAM_ROUTE = 'slug=golden-state-valkyries'

const readingOf = async (_$: any) => states.reading ?? null

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

test('a live game is read, flagged for the followed side, and polled every 30 seconds', async ($, on) => {
  const h = harness(on, { [TEAM_ROUTE]: { body: schedule(finishedMatch, liveMatch) } }, followingValkyries)

  await start($)

  const reading = await readingOf($)
  expect(reading.game).toMatchObject({
    home: 'Golden State Valkyries',
    away: 'Las Vegas Aces',
    homeScore: '34',
    awayScore: '31',
    statusText: 'Half time',
    homeLogo: 'https://img.example/valkyries.png',
  })
  expect(reading.followedSide).toBe('home')
  expect(reading.isStale).toBe(false)
  expect(h.delays).toEqual([30_000])
  expect(h.urls[0]).toContain('/api/v1/team/')
  expect(h.urls[0]).toContain('limit=10')
})

test('no live game clears the reading and polls every 5 minutes', async ($, on) => {
  const h = harness(on, { [TEAM_ROUTE]: { body: schedule(finishedMatch) } }, followingValkyries)

  await start($)

  expect((await readingOf($)).game).toBeNull()
  expect(h.delays).toEqual([300_000])
})

test('the followed side is away when the followed team plays away', async ($, on) => {
  const awayMatch = { ...liveMatch, home: 'Las Vegas Aces', away: 'Golden State Valkyries' }
  harness(on, { [TEAM_ROUTE]: { body: schedule(awayMatch) } }, followingValkyries)

  await start($)

  expect((await readingOf($)).followedSide).toBe('away')
})

test('nothing followed makes no request and schedules no poll', async ($, on) => {
  const h = harness(on, {})

  await start($)

  expect(h.urls).toEqual([])
  expect(h.delays).toEqual([])
  expect(await readingOf($)).toBeNull()
})

test('a failed poll keeps the last good game and marks it stale', async ($, on) => {
  const routes: Record<string, Route> = { [TEAM_ROUTE]: { body: schedule(liveMatch) } }
  harness(on, routes, followingValkyries)
  await start($)
  routes[TEAM_ROUTE] = { status: 500, body: 'oops' }

  await start($)

  const reading = await readingOf($)
  expect(reading.game.homeScore).toBe('34')
  expect(reading.isStale).toBe(true)
})

test('a stale reading older than 10 minutes is dropped', async ($, on) => {
  const routes: Record<string, Route> = { [TEAM_ROUTE]: { body: schedule(liveMatch) } }
  const h = harness(on, routes, followingValkyries)
  await start($)
  routes[TEAM_ROUTE] = { status: 500, body: 'oops' }
  h.clock.now = now + 11 * 60_000

  await start($)

  expect((await readingOf($)).game).toBeNull()
})

test('blank or missing scores read as 0', async ($, on) => {
  const { away_score: _dropped, ...noAwayScore } = liveMatch
  harness(on, { [TEAM_ROUTE]: { body: schedule({ ...noAwayScore, home_score: '' }) } }, followingValkyries)

  await start($)

  expect((await readingOf($)).game).toMatchObject({ homeScore: '0', awayScore: '0' })
})

test('a poll that returns after unfollow-team is discarded', async ($, on) => {
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>(resolve => (release = resolve))
  const fetching = new Promise<void>(resolve => (entered = resolve))
  harness(on, { [TEAM_ROUTE]: { body: schedule(liveMatch), gate, onFetch: entered } }, followingValkyries)

  const starting = start($)
  await fetching
  await run($, 'unfollow-team')
  release()
  await starting

  expect(readingWrites.filter(r => r?.game)).toEqual([])
  expect(await readingOf($)).toBeNull()
})

test('a poll that returns after switching teams is discarded', async ($, on) => {
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>(resolve => (release = resolve))
  const fetching = new Promise<void>(resolve => (entered = resolve))
  harness(
    on,
    {
      [TEAM_ROUTE]: { body: schedule(liveMatch), gate, onFetch: entered },
      'slug=bluefire-valkyries-w': { body: schedule(finishedMatch) },
      '/api/v1/search/': { body: searchBody([bluefire]) },
    },
    followingValkyries,
  )

  const starting = start($)
  await fetching
  await run($, 'follow-team', 'bluefire')
  release()
  await starting

  expect(readingWrites.filter(r => r?.game)).toEqual([])
  expect((await readingOf($)).game).toBeNull()
})
