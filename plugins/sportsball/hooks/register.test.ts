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

const searchRoutes = (basketball: object[], football: object[] = []): Record<string, Route> => ({
  '&sport=basketball': { body: searchBody(basketball) },
  '&sport=football': { body: searchBody(football) },
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
    inits: [] as any[],
    gate: undefined as Promise<void> | undefined,
  }
  on('process.run', async (_$: any, e: any) => {
    proc.calls.push(e.argv)
    proc.inits.push(e.init)
    const done = (exitCode: number, stdout = '') => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'xcode-select') {
      if (proc.xcodeRejects) throw new Error('ENOENT')
      return done(proc.xcodeExit)
    }
    await proc.gate
    const out = proc.outputs[e.argv[e.argv.length - 1]]
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
  on('clock.after', (_$: any, e: any) => (e.ms === 0 ? Promise.resolve({ value: undefined }) : (delays.push(e.ms), new Promise(() => {}))))
  on('clock.now', async () => ({ value: clock.now }))
  const toasts: { text: string; timeoutMs?: number }[] = []
  on('ui.toast', async (_$: any, e: any) => (toasts.push({ text: e.text, timeoutMs: e.timeoutMs }), { value: undefined }))
  on('ui.render', async () => ({ type: 'Text', children: ['ENGINE'] }))
  const asks = {
    calls: [] as { question: string; labels: string[] }[],
    answer: undefined as string | undefined,
  }
  on('tool.call', async (_$: any, e: any) => {
    const [asked] = e.questions
    asks.calls.push({ question: asked.question, labels: asked.options.map((o: any) => o.label) })
    if (asks.answer === undefined) return { deny: 'dismissed' }
    return { result: { questions: e.questions, answers: { [asked.question]: asks.answer } } }
  })
  return { store, urls, delays, clock, proc, toasts, asks }
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

const leagueRoute = (slug: string, competition: string): Record<string, Route> => ({
  [`slug=${slug}&limit=1`]: { body: { sport: 'basketball', team: { slug }, count: 1, matches: [{ competition }] } },
})

test('follow-team with several hits asks which, naming each team league, and follows the pick', async ($, on) => {
  const h = harness(on, {
    ...searchRoutes([valkyries, bluefire]),
    ...leagueRoute(valkyries.slug, 'WNBA'),
    ...leagueRoute(bluefire.slug, 'Pro Women'),
  })
  h.asks.answer = '🏀 Bluefire Valkyries (W) · Pro Women'
  await start($)

  const { text } = await run($, 'follow-team', 'valkyries')

  expect(h.asks.calls).toHaveLength(1)
  expect(h.asks.calls[0].labels).toEqual(['🏀 Golden State Valkyries · WNBA', '🏀 Bluefire Valkyries (W) · Pro Women'])
  expect(text).toContain('Now following Bluefire Valkyries (W)')
  expect(h.store.get('followed')).toEqual([{ sport: 'basketball', ...bluefire }])
})

test('an exact name match still asks when other teams match too', async ($, on) => {
  const atletico = { name: 'Atletico', slug: 'atletico' }
  const aguada = { name: 'Atletico Aguada', slug: 'atletico-aguada' }
  const h = harness(on, searchRoutes([atletico, aguada]))
  h.asks.answer = '🏀 Atletico Aguada'
  await start($)

  const { text } = await run($, 'follow-team', 'atletico')

  expect(h.asks.calls[0].labels).toEqual(['🏀 Atletico', '🏀 Atletico Aguada'])
  expect(text).toContain('Now following Atletico Aguada')
})

test('a team whose league lookup fails is offered by sport and name alone', async ($, on) => {
  const h = harness(on, { ...searchRoutes([valkyries, bluefire]), ...leagueRoute(valkyries.slug, 'WNBA') })
  await start($)

  await run($, 'follow-team', 'valkyries')

  expect(h.asks.calls[0].labels).toEqual(['🏀 Golden State Valkyries · WNBA', '🏀 Bluefire Valkyries (W)'])
})

test('hits repeating a sport and slug are one team', async ($, on) => {
  const h = harness(on, { ...searchRoutes([], [tigre, tigre, { name: 'Tigre B', slug: 'tigre-b' }]) })
  h.asks.answer = '⚽ Tigre B'
  await start($)

  await run($, 'follow-team', 'tigre')

  expect(h.asks.calls[0].labels).toEqual([`⚽ ${tigre.name}`, '⚽ Tigre B'])
})

test('a search that finds one team twice follows it without asking', async ($, on) => {
  const h = harness(on, { ...searchRoutes([], [tigre, tigre]) })
  await start($)

  const { text } = await run($, 'follow-team', 'tigre')

  expect(h.asks.calls).toHaveLength(0)
  expect(text).toContain(`Now following ${tigre.name}`)
})

test('different teams with the same label are told apart by their slug', async ($, on) => {
  const first = { name: 'Atletico Basket U20', slug: 'atletico-basket-u20' }
  const second = { name: 'Atletico Basket U20', slug: 'atletico-basket-u20-2' }
  const h = harness(on, searchRoutes([first, second]))
  h.asks.answer = '🏀 Atletico Basket U20 (atletico-basket-u20-2)'
  await start($)

  await run($, 'follow-team', 'atletico basket')

  expect(h.asks.calls[0].labels).toEqual(['🏀 Atletico Basket U20 (atletico-basket-u20)', '🏀 Atletico Basket U20 (atletico-basket-u20-2)'])
  expect(h.store.get('followed')).toEqual([{ sport: 'basketball', ...second }])
})

test('dismissing the team question follows nothing and keeps the current team', async ($, on) => {
  const h = harness(on, searchRoutes([valkyries, bluefire]), followingValkyries)
  await start($)

  const { text } = await run($, 'follow-team', 'valkyries')

  expect(text).toBe('No team followed.')
  expect(h.store.get('followed')).toEqual(followingValkyries.followed)
})

test('free text that matches no team label follows nothing', async ($, on) => {
  const h = harness(on, searchRoutes([valkyries, bluefire]))
  h.asks.answer = 'the other one'
  await start($)

  const { text } = await run($, 'follow-team', 'valkyries')

  expect(text).toBe('No team followed.')
  expect(h.store.get('followed')).toBeUndefined()
})

test('follow-team with one hit follows it and stores the team', async ($, on) => {
  const h = harness(on, { ...searchRoutes([valkyries]) })
  await start($)

  const { text } = await run($, 'follow-team', 'golden state valkyries')

  expect(text).toContain('Now following Golden State Valkyries')
  expect(h.store.get('followed')).toEqual([{ sport: 'basketball', ...valkyries }])
  expect(h.urls[0]).toContain('q=golden%20state%20valkyries')
  expect(h.urls[0]).toContain('sport=basketball')
})

test('follow-team encodes ampersands in the search', async ($, on) => {
  const h = harness(on, { ...searchRoutes([]) })
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
  const h = harness(on, { ...searchRoutes([]) })
  await start($)

  const { text } = await run($, 'follow-team', 'nonsense')

  expect(text).toContain('No team matched "nonsense"')
  expect(h.store.get('followed')).toBeUndefined()
})

test('follow-team reports a failed lookup and stores nothing', async ($, on) => {
  const h = harness(on, { '&sport=basketball': { status: 500, body: 'oops' }, '&sport=football': { status: 500, body: 'oops' } })
  await start($)

  const { text } = await run($, 'follow-team', 'valkyries')

  expect(text).toContain("Couldn't look up")
  expect(h.store.get('followed')).toBeUndefined()
})

test('follow-team replaces the team already followed', async ($, on) => {
  const h = harness(
    on,
    { ...searchRoutes([bluefire]) },
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
  expect(h.urls[0]).toContain('limit=50')
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
      ...searchRoutes([bluefire]),
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

const until = async (done: () => boolean) => {
  for (let i = 0; i < 200 && !done(); i++) await new Promise(resolve => setTimeout(resolve, 5))
}
const settle = () => new Promise(resolve => setTimeout(resolve, 40))

test('a live game runs the colour helper once per logo and caches the colours', async ($, on) => {
  const h = harness(on, liveSchedule(), followingValkyries)
  h.proc.outputs[HOME_LOGO] = { exitCode: 0, stdout: '#b896d4\n' }
  h.proc.outputs[AWAY_LOGO] = { exitCode: 0, stdout: '#bc945a\n' }

  await start($)
  await until(() => h.store.has('colours'))

  const calls = helperCalls(h)
  expect(calls.map((argv: readonly string[]) => argv[argv.length - 1]).sort()).toEqual([AWAY_LOGO, HOME_LOGO].sort())
  expect(calls[0].slice(0, 3)).toEqual(['python3', '-I', '-c'])
  expect(calls[0][3]).toContain('dominant_colour')
  expect(h.proc.inits.filter(Boolean).every((init: any) => init.cwd === '/')).toBe(true)
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
    await until(() => h.store.has('colours'))
    await start($)
    await settle()

    expect(h.store.get('colours')).toEqual({ [AWAY_LOGO]: '#bc945a' })
    expect(helperCalls(h).filter((argv: readonly string[]) => argv[argv.length - 1] === logo)).toHaveLength(1)
  })
}

test('empty and missing logo URLs make no helper call', async ($, on) => {
  const { away_logo: _dropped, ...noAwayLogo } = liveMatch
  const h = harness(on, { [TEAM_ROUTE]: { body: schedule({ ...noAwayLogo, home_logo: '' }) } }, followingValkyries)

  await start($)
  await settle()

  expect(h.proc.calls).toEqual([])
})

test('non-https logo URLs make no helper call', async ($, on) => {
  const h = harness(on, liveSchedule({ home_logo: 'http://img.example/plain.png', away_logo: 'file:///etc/passwd' }), followingValkyries)

  await start($)
  await settle()

  expect(h.proc.calls).toEqual([])
})

test('xcode-select failing means the helper is never run', async ($, on) => {
  const h = harness(on, liveSchedule({ home_logo: 'https://img.example/x1.png', away_logo: 'https://img.example/x2.png' }), followingValkyries)
  h.proc.xcodeExit = 1

  await start($)
  await settle()

  expect(helperCalls(h)).toEqual([])
})

test('xcode-select being absent does not stop the helper', async ($, on) => {
  const h = harness(on, liveSchedule({ home_logo: 'https://img.example/y1.png', away_logo: 'https://img.example/y2.png' }), followingValkyries)
  h.proc.xcodeRejects = true
  h.proc.outputs['https://img.example/y1.png'] = { exitCode: 0, stdout: '#b896d4' }

  await start($)
  await until(() => h.store.has('colours'))

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
  await until(() => h.store.has('colours'))

  const colours = h.store.get('colours') as Record<string, string>
  expect(luminance(colours[dark])).toBeGreaterThanOrEqual(0.35)
  expect(colours[dark]).not.toBe('#101040')
  expect(colours[light]).toBe('#e0c050')
})

type Node = { type?: string; props?: Record<string, any>; children?: (Node | string)[] }

const walk = (node: Node | string): Node[] => (typeof node === 'string' ? [] : [node, ...(node.children ?? []).flatMap(walk)])
const flatText = (node: Node | string): string => (typeof node === 'string' ? node : (node.children ?? []).map(flatText).join(''))
const textNode = (tree: Node, text: string) => walk(tree).find(n => n.type === 'Text' && n.children?.includes(text))

async function mountBand($: any, bodyColumns = 100, hasSurvey = false): Promise<Node> {
  const band = await $.ui.mount({
    plugin: 'sportsball',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey, isWorking: false, maxRows: 10, bodyColumns },
  })
  return band.drawn()
}

const colouredLogos = { colours: { [HOME_LOGO]: '#b896d4', [AWAY_LOGO]: '#bc945a' } }

const truncatingRows = (tree: Node) => walk(tree).filter(n => n.props?.wrap === 'truncate-end')
const gameRow = (tree: Node) => truncatingRows(tree)[0]
const links = (tree: Node) => walk(tree).filter(n => n.type === 'Link')

test('the game row starts with the sport emoji and carries no attribution', async ($, on) => {
  harness(on, liveSchedule(), { ...followingValkyries, ...colouredLogos })
  await start($)

  const tree = await mountBand($)

  expect(flatText(gameRow(tree))).toBe('🏀 Golden State Valkyries 34 - 31 Las Vegas Aces · Half time · WNBA')
})

test('the attribution is a link to SportScore', async ($, on) => {
  harness(on, liveSchedule(), { ...followingValkyries, ...colouredLogos })
  await start($)

  const tree = await mountBand($)

  expect(links(tree)).toHaveLength(1)
  expect(links(tree)[0].props?.href).toBe('https://sportscore.com')
  expect(flatText(links(tree)[0])).toBe('SportScore')
})

test('with room, the attribution shares the game row and is right-aligned', async ($, on) => {
  harness(on, liveSchedule(), { ...followingValkyries, ...colouredLogos })
  await start($)

  const tree = await mountBand($, 100)

  const [game, credit] = tree.children as Node[]
  expect(tree.props?.flexDirection).not.toBe('column')
  expect(tree.children).toHaveLength(2)
  expect([game.props?.width, credit.props?.width]).toEqual([74, 22])
  expect(credit.props?.justifyContent).toBe('flex-end')
  expect(flatText(credit)).toBe('Powered by SportScore')
  expect(walk(game).some(n => n.type === 'Link')).toBe(false)
  expect(links(tree)).toHaveLength(1)
})

test('a competition other than the WNBA is shown in full', async ($, on) => {
  harness(on, liveSchedule({ competition: 'NBA Cup' }), { ...followingValkyries, ...colouredLogos })
  await start($)

  expect(flatText(await mountBand($))).toContain('· NBA Cup')
})

test('team names carry their cached logo colours', async ($, on) => {
  harness(on, liveSchedule(), { ...followingValkyries, ...colouredLogos })
  await start($)

  const tree = await mountBand($)

  expect(textNode(tree, 'Golden State Valkyries')?.props?.color).toBe('#b896d4')
  expect(textNode(tree, 'Las Vegas Aces')?.props?.color).toBe('#bc945a')
})

test('a team without a cached colour draws with no colour', async ($, on) => {
  const h = harness(on, liveSchedule(), followingValkyries)
  h.proc.xcodeExit = 1
  await start($)

  const tree = await mountBand($)

  expect(textNode(tree, 'Golden State Valkyries')).toBeDefined()
  expect(textNode(tree, 'Golden State Valkyries')?.props?.color).toBeUndefined()
})

test('only the followed team score is bold', async ($, on) => {
  harness(on, liveSchedule(), { ...followingValkyries, ...colouredLogos })
  await start($)

  const tree = await mountBand($)

  expect(textNode(tree, '34')?.props?.bold).toBe(true)
  expect(textNode(tree, '31')?.props?.bold).toBeFalsy()
})

test('a stale reading is drawn dimmed and a fresh one is not', async ($, on) => {
  const routes: Record<string, Route> = liveSchedule()
  harness(on, routes, { ...followingValkyries, ...colouredLogos })
  await start($)
  const isDim = (tree: Node) => walk(tree).find(n => n.props?.wrap === 'truncate-end')?.props?.dimColor === true
  expect(isDim(await mountBand($))).toBe(false)
  routes[TEAM_ROUTE] = { status: 500, body: 'oops' }

  await start($)

  expect(isDim(await mountBand($))).toBe(true)
})

test('the band stays out of the way when there is nothing to show', async ($, on) => {
  harness(on, liveSchedule(), { ...followingValkyries, ...colouredLogos })
  await start($)
  expect(flatText(await mountBand($))).toContain('Half time')

  expect(flatText(await mountBand($, 100, true))).toBe('ENGINE')
  await run($, 'sportsball')
  expect(flatText(await mountBand($))).toBe('ENGINE')
})

test('no followed team and no live game both leave the engine drawing', async ($, on) => {
  harness(on, {})
  await start($)

  expect(flatText(await mountBand($))).toBe('ENGINE')
})

test('no live game leaves the engine drawing', async ($, on) => {
  harness(on, { [TEAM_ROUTE]: { body: schedule(finishedMatch) } }, followingValkyries)
  await start($)

  expect(flatText(await mountBand($))).toBe('ENGINE')
})

test('too narrow for both, the attribution drops to its own right-aligned row below', async ($, on) => {
  harness(on, liveSchedule(), { ...followingValkyries, ...colouredLogos })
  await start($)

  const tree = await mountBand($, 30)

  const [game, credit] = tree.children as Node[]
  expect(tree.props?.flexDirection).toBe('column')
  expect([game.props?.width, credit.props?.width]).toEqual([26, 26])
  expect(credit.props?.justifyContent).toBe('flex-end')
  expect(flatText(gameRow(tree))).toContain('Golden State Valkyries')
  expect(links(tree)).toHaveLength(1)
  const tiny = await mountBand($, 6)
  expect((tiny.children as Node[]).map(n => n.props?.width)).toEqual([10, 10])
})

test('the attribution stays on the game row down to 20 columns for the game, then drops below', async ($, on) => {
  harness(on, liveSchedule(), { ...followingValkyries, ...colouredLogos })
  await start($)

  expect((await mountBand($, 46)).props?.flexDirection).not.toBe('column')
  expect((await mountBand($, 45)).props?.flexDirection).toBe('column')
})

const inPlay = (statusText: string, home = '34', away = '31') => ({ ...liveMatch, status_text: statusText, home_score: home, away_score: away })
const settled = { ...liveMatch, status: 'finished', status_text: 'Finished', home_score: '77', away_score: '73' }

function toastRig(on: any, first: object[]) {
  const routes: Record<string, Route> = { [TEAM_ROUTE]: { body: schedule(...first) } }
  const h = harness(on, routes, { ...followingValkyries, ...colouredLogos })
  const next = (...matches: object[]) => (routes[TEAM_ROUTE] = { body: schedule(...matches) })
  return { h, next, routes }
}

test('the first reading after a load is silent', async ($, on) => {
  const { h } = toastRig(on, [inPlay('Half time')])

  await start($)

  expect(h.toasts).toEqual([])
})

test('a change of period toasts the new status with the score', async ($, on) => {
  const { h, next } = toastRig(on, [inPlay('Half time')])
  await start($)
  next(inPlay('3rd quarter', '40', '38'))

  await start($)

  expect(h.toasts).toEqual([{ text: '🏀 3rd quarter: Golden State Valkyries 40 - 38 Las Vegas Aces', timeoutMs: 8000 }])
})

test('a score change within the same period is silent', async ($, on) => {
  const { h, next } = toastRig(on, [inPlay('3rd quarter', '40', '38')])
  await start($)
  next(inPlay('3rd quarter', '44', '38'))

  await start($)

  expect(h.toasts).toEqual([])
})

test('full time toasts the final score when the game on screen finishes', async ($, on) => {
  const { h, next } = toastRig(on, [inPlay('4th quarter', '75', '73')])
  await start($)
  next(settled)

  await start($)

  expect(h.toasts).toEqual([{ text: '🏀 Full time: Golden State Valkyries 77 - 73 Las Vegas Aces', timeoutMs: 8000 }])
  expect((await readingOf($)).game).toBeNull()
})

test('an older finished match at the same URL is not mistaken for full time', async ($, on) => {
  const { h, next } = toastRig(on, [inPlay('4th quarter')])
  await start($)
  next({ ...settled, time: '2026-10-01T01:00:00+00:00' })

  await start($)

  expect(h.toasts).toEqual([])
})

test('a game that disappears without finishing is silent', async ($, on) => {
  const { h, next } = toastRig(on, [inPlay('4th quarter')])
  await start($)
  next()

  await start($)

  expect(h.toasts).toEqual([])
  expect((await readingOf($)).game).toBeNull()
})

test('toggled off mutes toasts but keeps tracking, so only later changes toast', async ($, on) => {
  const { h, next } = toastRig(on, [inPlay('Half time')])
  await start($)
  await run($, 'sportsball')
  next(inPlay('3rd quarter'))
  await start($)
  expect(h.toasts).toEqual([])

  await run($, 'sportsball')
  next(inPlay('4th quarter'))
  await start($)

  expect(h.toasts.map(toast => toast.text)).toEqual(['🏀 4th quarter: Golden State Valkyries 34 - 31 Las Vegas Aces'])
})

test('a failed poll toasts nothing, and recovery with the same status stays silent', async ($, on) => {
  const { h, routes } = toastRig(on, [inPlay('Half time')])
  await start($)
  const good = routes[TEAM_ROUTE]
  routes[TEAM_ROUTE] = { status: 500, body: 'oops' }
  await start($)
  routes[TEAM_ROUTE] = good

  await start($)

  expect(h.toasts).toEqual([])
})

test('switching to a team in a different game does not toast', async ($, on) => {
  const other = { ...inPlay('3rd quarter'), url: '/basketball/match/bluefire-game/', time: '2026-10-04T22:00:00+00:00' }
  const routes: Record<string, Route> = {
    [TEAM_ROUTE]: { body: schedule(inPlay('Half time')) },
    'slug=bluefire-valkyries-w': { body: schedule(other) },
    ...searchRoutes([bluefire]),
  }
  const h = harness(on, routes, { ...followingValkyries, ...colouredLogos })
  await start($)

  await run($, 'follow-team', 'bluefire')

  expect(h.toasts).toEqual([])
})

const atlanta = { name: 'Atletico Atlanta', slug: 'atletico-atlanta' }
const tigre = { name: 'Club Atletico Tigre', slug: 'club-atletico-tigre' }
const footballMatch = {
  home: 'Atletico Rafaela',
  away: 'Atletico Atlanta',
  home_logo: 'https://img.example/rafaela.png',
  away_logo: 'https://img.example/atlanta.png',
  home_score: '1',
  away_score: '2',
  status: 'live',
  status_text: '2nd half',
  time: '2026-10-04T20:30:00+00:00',
  competition: 'ARG Primera Nacional',
  url: '/football/match/atletico-rafaela-vs-atletico-atlanta/dn1m1ghlp05zmoe/',
}

test('follow-team searches basketball then football', async ($, on) => {
  const h = harness(on, searchRoutes([], [atlanta]))
  await start($)

  await run($, 'follow-team', 'atletico atlanta')

  expect(h.urls[0]).toContain('/api/v1/search/?q=atletico%20atlanta&sport=basketball')
  expect(h.urls[1]).toContain('/api/v1/search/?q=atletico%20atlanta&sport=football')
  expect(h.urls[2]).toContain('/api/v1/team/?sport=football&slug=atletico-atlanta')
})

test('follow-team follows a football team and records its sport', async ($, on) => {
  const h = harness(on, searchRoutes([], [atlanta]))
  await start($)

  const { text } = await run($, 'follow-team', 'atletico atlanta')

  expect(text).toContain('Now following Atletico Atlanta')
  expect(h.store.get('followed')).toEqual([{ sport: 'football', ...atlanta }])
})

test('hits from both sports are offered with their sport emoji', async ($, on) => {
  const h = harness(on, searchRoutes([valkyries], [tigre]))
  await start($)

  await run($, 'follow-team', 'x1')

  expect(h.asks.calls[0].labels).toEqual(['🏀 Golden State Valkyries', '⚽ Club Atletico Tigre'])
  expect(h.store.get('followed')).toBeUndefined()
})

test('a failed football search fails the whole lookup', async ($, on) => {
  const h = harness(on, { '&sport=basketball': { body: searchBody([valkyries]) }, '&sport=football': { status: 500, body: 'oops' } })
  await start($)

  const { text } = await run($, 'follow-team', 'valkyries')

  expect(text).toContain("Couldn't look up")
  expect(h.store.get('followed')).toBeUndefined()
})

test('a followed football team is polled as football and drawn with the football emoji', async ($, on) => {
  const h = harness(
    on,
    { 'slug=atletico-atlanta': { body: schedule(footballMatch) } },
    { followed: [{ sport: 'football', ...atlanta }], colours: { 'https://img.example/rafaela.png': '#aa0000', 'https://img.example/atlanta.png': '#0000aa' } },
  )

  await start($)

  expect(h.urls[0]).toContain('sport=football&slug=atletico-atlanta&limit=50')
  expect(flatText(gameRow(await mountBand($)))).toBe('⚽ Atletico Rafaela 1 - 2 Atletico Atlanta · 2nd half · ARG Primera Nacional')
  expect((await readingOf($)).followedSide).toBe('away')
})

test('football period changes and full time toast with the football emoji', async ($, on) => {
  const routes: Record<string, Route> = { 'slug=atletico-atlanta': { body: schedule(footballMatch) } }
  const h = harness(on, routes, { followed: [{ sport: 'football', ...atlanta }] })
  await start($)
  routes['slug=atletico-atlanta'] = { body: schedule({ ...footballMatch, status_text: 'Half time' }) }
  await start($)
  routes['slug=atletico-atlanta'] = { body: schedule({ ...footballMatch, status: 'finished', status_text: 'Finished', home_score: '1', away_score: '3' }) }

  await start($)

  expect(h.toasts.map(toast => toast.text)).toEqual([
    '⚽ Half time: Atletico Rafaela 1 - 2 Atletico Atlanta',
    '⚽ Full time: Atletico Rafaela 1 - 3 Atletico Atlanta',
  ])
})

const MATCH_ROUTE = '/api/v1/match/'
const detail = (live_minute: unknown) => ({ body: { sport: 'football', match: { ...footballMatch, live_minute } } })
const footballHarness = (on: any, routes: Record<string, Route>) => {
  routes['slug=atletico-atlanta'] = { body: schedule(footballMatch) }
  return harness(on, routes, { followed: [{ sport: 'football', ...atlanta }] })
}

test('a live football game shows its minute next to the status', async ($, on) => {
  const h = footballHarness(on, { [MATCH_ROUTE]: detail('84') })

  await start($)

  expect(h.urls.find(url => url.includes(MATCH_ROUTE))).toContain('/api/v1/match/?sport=football&slug=atletico-rafaela-vs-atletico-atlanta')
  expect(flatText(gameRow(await mountBand($)))).toBe("⚽ Atletico Rafaela 1 - 2 Atletico Atlanta · 2nd half 84' · ARG Primera Nacional")
})

test('the minute follows the latest poll', async ($, on) => {
  const routes: Record<string, Route> = { [MATCH_ROUTE]: detail('84') }
  footballHarness(on, routes)
  await start($)
  routes[MATCH_ROUTE] = detail('85')

  await start($)

  expect(flatText(gameRow(await mountBand($)))).toContain("2nd half 85'")
})

for (const [label, minute] of [['null', null], ['empty', ''], ['missing', undefined]] as const) {
  test(`a ${label} live_minute shows just the status`, async ($, on) => {
    footballHarness(on, { [MATCH_ROUTE]: detail(minute) })

    await start($)

    expect(flatText(gameRow(await mountBand($)))).toContain('· 2nd half ·')
  })
}

test('a failed minute lookup still shows the score and is not a stale reading', async ($, on) => {
  footballHarness(on, { [MATCH_ROUTE]: { status: 500, body: 'oops' } })

  await start($)

  expect(flatText(gameRow(await mountBand($)))).toContain('· 2nd half ·')
  expect((await readingOf($)).isStale).toBe(false)
})

test('basketball makes no match-detail request', async ($, on) => {
  const h = harness(on, { [TEAM_ROUTE]: { body: schedule(liveMatch) }, [MATCH_ROUTE]: detail('9') }, followingValkyries)

  await start($)

  expect(h.urls.some(url => url.includes(MATCH_ROUTE))).toBe(false)
})

test('a changing minute alone never toasts', async ($, on) => {
  const routes: Record<string, Route> = { [MATCH_ROUTE]: detail('84') }
  const h = footballHarness(on, routes)
  await start($)
  routes[MATCH_ROUTE] = detail('85')

  await start($)

  expect(h.toasts).toEqual([])
})

test("half time's live_minute of HT is not drawn as a minute", async ($, on) => {
  const routes: Record<string, Route> = { [MATCH_ROUTE]: detail('HT') }
  footballHarness(on, routes)
  routes['slug=atletico-atlanta'] = { body: schedule({ ...footballMatch, status_text: 'Half time' }) }

  await start($)

  const row = flatText(gameRow(await mountBand($)))
  expect(row).toContain('· Half time ·')
  expect(row).not.toContain('HT')
})

for (const [label, minute, shown] of [['stoppage time', '45+2', "45+2'"], ['stoppage time with no number yet', '90+', "90+'"], ['first-half stoppage time', '45+', "45+'"], ['padded digits', ' 67 ', "67'"], ['a number', 90, "90'"]] as const) {
  test(`${label} is drawn as a minute`, async ($, on) => {
    footballHarness(on, { [MATCH_ROUTE]: detail(minute) })

    await start($)

    expect(flatText(gameRow(await mountBand($)))).toContain(`2nd half ${shown}`)
  })
}

for (const word of ['FT', 'ET', 'Break']) {
  test(`a live_minute of ${word} is not drawn`, async ($, on) => {
    footballHarness(on, { [MATCH_ROUTE]: detail(word) })

    await start($)

    expect(flatText(gameRow(await mountBand($)))).toContain('· 2nd half ·')
  })
}

const footballScoreRig = (on: any, first: { home?: string; away?: string; minute?: string | null; statusText?: string }) => {
  const routes: Record<string, Route> = {}
  const set = (next: { home?: string; away?: string; minute?: string | null; statusText?: string }) => {
    routes['slug=atletico-atlanta'] = {
      body: schedule({ ...footballMatch, home_score: next.home ?? '1', away_score: next.away ?? '2', status_text: next.statusText ?? '2nd half' }),
    }
    routes[MATCH_ROUTE] = detail(next.minute === undefined ? null : next.minute)
  }
  set(first)
  const h = harness(on, routes, { followed: [{ sport: 'football', ...atlanta }] })
  return { h, set }
}

test('a football goal toasts the new score with the minute', async ($, on) => {
  const { h, set } = footballScoreRig(on, { minute: '59' })
  await start($)
  set({ away: '3', minute: '60' })

  await start($)

  expect(h.toasts).toEqual([{ text: "⚽ Goal 60': Atletico Rafaela 1 - 3 Atletico Atlanta", timeoutMs: 8000 }])
})

test('a football goal toast has no minute when there is none', async ($, on) => {
  const { h, set } = footballScoreRig(on, { minute: null })
  await start($)
  set({ home: '2', minute: null })

  await start($)

  expect(h.toasts.map(toast => toast.text)).toEqual(['⚽ Goal: Atletico Rafaela 2 - 2 Atletico Atlanta'])
})

test('a score that goes down is a score change, not a goal', async ($, on) => {
  const { h, set } = footballScoreRig(on, { away: '3', minute: '70' })
  await start($)
  set({ away: '2', minute: '72' })

  await start($)

  expect(h.toasts.map(toast => toast.text)).toEqual(["⚽ Score change 72': Atletico Rafaela 1 - 2 Atletico Atlanta"])
})

test('a goal and a new period in one poll give one toast, labelled by the period', async ($, on) => {
  const { h, set } = footballScoreRig(on, { minute: '45+' })
  await start($)
  set({ away: '3', statusText: 'Half time', minute: 'HT' })

  await start($)

  expect(h.toasts.map(toast => toast.text)).toEqual(['⚽ Half time: Atletico Rafaela 1 - 3 Atletico Atlanta'])
})

test('a football period toast includes the minute when there is one', async ($, on) => {
  const { h, set } = footballScoreRig(on, { statusText: 'Half time', minute: 'HT' })
  await start($)
  set({ statusText: '2nd half', minute: '46' })

  await start($)

  expect(h.toasts.map(toast => toast.text)).toEqual(["⚽ 2nd half 46': Atletico Rafaela 1 - 2 Atletico Atlanta"])
})

test('an unchanged football score stays silent as the minute ticks', async ($, on) => {
  const { h, set } = footballScoreRig(on, { minute: '59' })
  await start($)
  set({ minute: '60' })

  await start($)

  expect(h.toasts).toEqual([])
})

test('a basketball score change still stays silent', async ($, on) => {
  const { h, next } = toastRig(on, [inPlay('3rd quarter', '40', '38')])
  await start($)
  next(inPlay('3rd quarter', '43', '38'))

  await start($)

  expect(h.toasts).toEqual([])
})

test('a failed first fetch after switching teams does not keep the previous team scoreboard', async ($, on) => {
  const routes: Record<string, Route> = {
    [TEAM_ROUTE]: { body: schedule(liveMatch) },
    'slug=atletico-atlanta': { status: 500, body: 'oops' },
    ...searchRoutes([], [atlanta]),
  }
  harness(on, routes, { ...followingValkyries, ...colouredLogos })
  await start($)
  expect((await readingOf($)).game.home).toBe('Golden State Valkyries')

  await run($, 'follow-team', 'atletico atlanta')

  expect(await readingOf($)).toBeNull()
})

test('a failed fetch for the same team still keeps its last reading, dimmed', async ($, on) => {
  const routes: Record<string, Route> = { [TEAM_ROUTE]: { body: schedule(liveMatch) } }
  harness(on, routes, { ...followingValkyries, ...colouredLogos })
  await start($)
  routes[TEAM_ROUTE] = { status: 500, body: 'oops' }

  await start($)

  expect((await readingOf($)).game.home).toBe('Golden State Valkyries')
  expect((await readingOf($)).isStale).toBe(true)
})

test('an older poll that finishes after a newer one for the same team is discarded', async ($, on) => {
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>(resolve => (release = resolve))
  const fetching = new Promise<void>(resolve => (entered = resolve))
  const routes: Record<string, Route> = { [TEAM_ROUTE]: { body: schedule(inPlay('3rd quarter', '10', '0')) } }
  const h = harness(on, routes, { ...followingValkyries, ...colouredLogos })
  await start($)
  routes[TEAM_ROUTE] = { body: schedule(inPlay('3rd quarter', '12', '0')), gate, onFetch: entered }
  const older = start($)
  await fetching
  routes[TEAM_ROUTE] = { body: schedule(inPlay('4th quarter', '14', '0')) }

  await start($)
  release()
  await older

  expect((await readingOf($)).game.statusText).toBe('4th quarter')
  expect(readingWrites.map(r => r?.game?.statusText)).toEqual(['3rd quarter', '4th quarter'])
  expect(h.toasts.map(toast => toast.text)).toEqual(['🏀 4th quarter: Golden State Valkyries 14 - 0 Las Vegas Aces'])
  expect(h.delays).toEqual([30_000, 30_000])
})

test('a poll is discarded when the followed team changes sport but keeps its slug', async ($, on) => {
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>(resolve => (release = resolve))
  const fetching = new Promise<void>(resolve => (entered = resolve))
  const h = harness(on, { [TEAM_ROUTE]: { body: schedule(liveMatch), gate, onFetch: entered } }, followingValkyries)

  const starting = start($)
  await fetching
  h.store.set('followed', [{ sport: 'football', ...valkyries }])
  release()
  await starting

  expect(readingWrites.filter(r => r?.game)).toEqual([])
})
