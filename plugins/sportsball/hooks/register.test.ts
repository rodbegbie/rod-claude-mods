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
  const proc = {
    xcodeExit: 0,
    xcodeRejects: false,
    outputs: {} as Record<string, { exitCode?: number; stdout?: string; rejects?: boolean }>,
    calls: [] as (readonly string[])[],
  }
  on('process.run', async (_$: any, e: any) => {
    proc.calls.push(e.argv)
    const done = (exitCode: number, stdout = '') => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'xcode-select') {
      if (proc.xcodeRejects) throw new Error('ENOENT')
      return done(proc.xcodeExit)
    }
    const out = proc.outputs[e.argv[3]]
    if (out?.rejects) throw new Error('boom')
    return done(out?.exitCode ?? 1, out?.stdout ?? '')
  })
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
  on('clock.after', (_$: any, e: any) => (delays.push(e.ms), new Promise(() => {})))
  on('clock.now', async () => ({ value: clock.now }))
  on('ui.render', async () => ({ value: null }))
  return { store, urls, delays, clock, proc }
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

const HOME_LOGO = 'https://img.example/valkyries.png'
const AWAY_LOGO = 'https://img.example/aces.png'
const liveSchedule = (patch: object = {}) => ({ [TEAM_ROUTE]: { body: schedule({ ...liveMatch, ...patch }) } })
const helperCalls = (h: any) => h.proc.calls.filter((argv: readonly string[]) => argv[0] === 'python3')
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

test('a live game runs the colour helper once per logo and caches the colours', async ($, on) => {
  const h = harness(on, liveSchedule(), followingValkyries)
  h.proc.outputs[HOME_LOGO] = { exitCode: 0, stdout: '#b896d4\n' }
  h.proc.outputs[AWAY_LOGO] = { exitCode: 0, stdout: '#bc945a\n' }

  await start($)

  const calls = helperCalls(h)
  expect(calls.map((argv: readonly string[]) => argv[3]).sort()).toEqual([AWAY_LOGO, HOME_LOGO].sort())
  expect(calls[0][0]).toBe('python3')
  expect(calls[0][1]).toBe('-c')
  expect(calls[0][2]).toContain('dominant_colour')
  expect(h.store.get('colours')).toEqual({ [HOME_LOGO]: '#b896d4', [AWAY_LOGO]: '#bc945a' })
  expect(states.colours).toEqual({ [HOME_LOGO]: '#b896d4', [AWAY_LOGO]: '#bc945a' })
})

test('colours cached in the store are loaded and not fetched again', async ($, on) => {
  const h = harness(on, liveSchedule(), {
    ...followingValkyries,
    colours: { [HOME_LOGO]: '#b896d4', [AWAY_LOGO]: '#bc945a' },
  })

  await start($)

  expect(h.proc.calls).toEqual([])
  expect(states.colours).toEqual({ [HOME_LOGO]: '#b896d4', [AWAY_LOGO]: '#bc945a' })
})

for (const [label, output] of [
  ['a non-zero exit', { exitCode: 1, stdout: '' }],
  ['a rejection', { rejects: true }],
  ['output that is not a colour', { exitCode: 0, stdout: 'purple' }],
] as const) {
  test(`${label} leaves the neutral colour and is not retried`, async ($, on) => {
    const h = harness(on, liveSchedule({ home_logo: 'https://img.example/f-' + label.length + '.png' }), followingValkyries)
    const logo = 'https://img.example/f-' + label.length + '.png'
    h.proc.outputs[logo] = output
    h.proc.outputs[AWAY_LOGO] = { exitCode: 0, stdout: '#bc945a' }

    await start($)
    await start($)

    expect(h.store.get('colours')).toEqual({ [AWAY_LOGO]: '#bc945a' })
    expect(helperCalls(h).filter((argv: readonly string[]) => argv[3] === logo)).toHaveLength(1)
  })
}

test('empty and missing logo URLs make no helper call', async ($, on) => {
  const { away_logo: _dropped, ...noAwayLogo } = liveMatch
  const h = harness(on, { [TEAM_ROUTE]: { body: schedule({ ...noAwayLogo, home_logo: '' }) } }, followingValkyries)

  await start($)

  expect(h.proc.calls).toEqual([])
})

test('non-https logo URLs make no helper call', async ($, on) => {
  const h = harness(on, liveSchedule({ home_logo: 'http://img.example/plain.png', away_logo: 'file:///etc/passwd' }), followingValkyries)

  await start($)

  expect(h.proc.calls).toEqual([])
})

test('xcode-select failing means the helper is never run', async ($, on) => {
  const h = harness(on, liveSchedule({ home_logo: 'https://img.example/x1.png', away_logo: 'https://img.example/x2.png' }), followingValkyries)
  h.proc.xcodeExit = 1

  await start($)

  expect(helperCalls(h)).toEqual([])
})

test('xcode-select being absent does not stop the helper', async ($, on) => {
  const h = harness(on, liveSchedule({ home_logo: 'https://img.example/y1.png', away_logo: 'https://img.example/y2.png' }), followingValkyries)
  h.proc.xcodeRejects = true
  h.proc.outputs['https://img.example/y1.png'] = { exitCode: 0, stdout: '#b896d4' }

  await start($)

  expect(helperCalls(h).length).toBeGreaterThan(0)
  expect(h.store.get('colours')).toEqual({ 'https://img.example/y1.png': '#b896d4' })
})

test('a dark logo colour is lightened to a readable luminance and a light one is left alone', async ($, on) => {
  const dark = 'https://img.example/navy.png'
  const light = 'https://img.example/gold.png'
  const h = harness(on, liveSchedule({ home_logo: dark, away_logo: light }), followingValkyries)
  h.proc.outputs[dark] = { exitCode: 0, stdout: '#101040' }
  h.proc.outputs[light] = { exitCode: 0, stdout: '#e0c050' }

  await start($)

  const colours = h.store.get('colours') as Record<string, string>
  expect(luminance(colours[dark])).toBeGreaterThanOrEqual(0.35)
  expect(colours[dark]).not.toBe('#101040')
  expect(colours[light]).toBe('#e0c050')
})
