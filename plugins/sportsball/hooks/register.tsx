import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Choice, Followed, LiveGame, Phase, Reading, Sport } from '../types'

const isOn = atom({ plugin: 'sportsball', key: 'isOn' } as const, true)
const reading = atom({ plugin: 'sportsball', key: 'reading' } as const, null)
const colours = atom({ plugin: 'sportsball', key: 'colours' } as const, {})
const choices = atom({ plugin: 'sportsball', key: 'choices' } as const, [])

const SEARCH_URL = 'https://sportscore.com/api/v1/search/'
const TEAM_URL = 'https://sportscore.com/api/v1/team/'
const MATCH_URL = 'https://sportscore.com/api/v1/match/'
const MIN_NAME_LENGTH = 2
const MAX_ASK_OPTIONS = 4
const TEAM_PANE = 'sportsball-teams'
const TEAM_SELECT = 'team'
const LIVE_POLL_MS = 30_000
const UPCOMING_POLL_MS = 60_000
const IDLE_POLL_MS = 300_000
const STALE_MS = 10 * 60_000
const WINDOW_MS = 2 * 60 * 60_000
const MINUTE_MS = 60_000
const LATE_START_GRACE_MS = 30 * MINUTE_MS
const TOAST_MS = 8000
const HELPER_TIMEOUT_MS = 15_000
const MIN_LUMINANCE = 0.35
const HEX_COLOUR = /^#[0-9a-f]{6}$/
const MATCH_MINUTE = /^\d+(\+\d*)?$/
const COLLAPSE_CONTROL_COLUMNS = 4
const MIN_BAND_COLUMNS = 10
const CREDIT_MAX_COLUMNS = 22
const CREDIT_MIN_COLUMNS = 11
const MIN_GAME_COLUMNS = 60
const SEPARATOR = ' · '
const SPORTSCORE_URL = 'https://sportscore.com'
const FOLLOW_HELP = '🏀⚽ Sportsball: not following a team. Try /follow-team <team name> to see its live score here.'
const SPORTS: Sport[] = ['basketball', 'football']
const SPORT_EMOJI: Record<Sport, string> = { basketball: '🏀', football: '⚽' }
const HAS_LIVE_MINUTE: Record<Sport, boolean> = { basketball: false, football: true }
const TOAST_ON_SCORE: Record<Sport, boolean> = { basketball: false, football: true }
const GAME_LENGTH_MS: Record<Sport, number> = { basketball: 150 * MINUTE_MS, football: 120 * MINUTE_MS }

let pendingPoll: { cancel: () => void } | null = null
let pollGeneration = 0
let helperUsable: boolean | null = null
const attemptedLogos = new Set<string>()

export const LOGO_COLOUR_SCRIPT = String.raw`
import struct
import sys
import urllib.request
import zlib

MAX_BYTES = 2 * 1024 * 1024
MAX_PIXELS = 16 * 1024 * 1024
MAX_SAMPLES = 40000
TIMEOUT = 10
MIN_SATURATION = 0.25
MIN_VALUE = 48
SIGNATURE = b"\x89PNG\r\n\x1a\n"


def check_url(url):
    if not url.startswith("https://"):
        raise ValueError("https only")


class HttpsOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url):
    check_url(url)
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; sportsball)"})
    with urllib.request.build_opener(HttpsOnly).open(request, timeout=TIMEOUT) as response:
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("too large")
    return data


def unfilter(raw, height, stride, bpp):
    rows = []
    prev = bytearray(stride)
    pos = 0
    for _ in range(height):
        kind = raw[pos]
        line = bytearray(raw[pos + 1 : pos + 1 + stride])
        pos += stride + 1
        if kind == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 255
        elif kind == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif kind == 3:
            for i in range(stride):
                left = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + (left + prev[i]) // 2) & 255
        elif kind == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                predicted = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[i] = (line[i] + predicted) & 255
        elif kind != 0:
            raise ValueError("bad filter")
        rows.append(line)
        prev = line
    return rows


def decode(png):
    if png[:8] != SIGNATURE:
        raise ValueError("not a png")
    pos = 8
    header = None
    idat = []
    while pos + 8 <= len(png):
        length, kind = struct.unpack(">I4s", png[pos : pos + 8])
        body = png[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            header = struct.unpack(">IIBBBBB", body)
        elif kind == b"IDAT":
            idat.append(body)
        elif kind == b"IEND":
            break
    if header is None:
        raise ValueError("no header")
    width, height, depth, colour_type, _, _, interlace = header
    if depth != 8 or colour_type not in (2, 6) or interlace != 0:
        raise ValueError("unsupported png")
    if width < 1 or height < 1 or width * height > MAX_PIXELS:
        raise ValueError("bad size")
    channels = 3 if colour_type == 2 else 4
    stride = width * channels
    expected = height * (stride + 1)
    raw = zlib.decompressobj().decompress(b"".join(idat), expected + 1)
    if len(raw) != expected:
        raise ValueError("bad data")
    return width, height, channels, unfilter(raw, height, stride, channels)


def dominant_colour(png):
    width, height, channels, rows = decode(png)
    step = max(1, int((width * height / MAX_SAMPLES) ** 0.5))
    bins = {}
    for y in range(0, height, step):
        row = rows[y]
        for x in range(0, width, step):
            i = x * channels
            r, g, b = row[i], row[i + 1], row[i + 2]
            if channels == 4 and row[i + 3] < 128:
                continue
            high = max(r, g, b)
            if high < MIN_VALUE or (high - min(r, g, b)) / high < MIN_SATURATION:
                continue
            entry = bins.setdefault((r >> 4, g >> 4, b >> 4), [0, 0, 0, 0])
            entry[0] += 1
            entry[1] += r
            entry[2] += g
            entry[3] += b
    if not bins:
        raise ValueError("no colour")
    count, r, g, b = max(bins.values(), key=lambda entry: entry[0])
    return "#%02x%02x%02x" % (r // count, g // count, b // count)


def main():
    try:
        print(dominant_colour(fetch(sys.argv[1])))
    except Exception as error:
        print(error, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
`

type TeamHit = { sport: Sport; slug: string; name: string }

function isNamed(value: unknown): value is { slug: string; name: string } {
  const hit = value as { slug?: unknown; name?: unknown } | null
  return typeof hit?.slug === 'string' && typeof hit?.name === 'string'
}

async function searchSport($: EngineInterface, name: string, sport: Sport): Promise<TeamHit[] | null> {
  try {
    const response = await $.http.fetch(`${SEARCH_URL}?q=${encodeURIComponent(name)}&sport=${sport}`)
    if (!response.ok) return null
    const teams = (JSON.parse(response.text) as { teams?: unknown }).teams
    return Array.isArray(teams) ? teams.filter(isNamed).map(team => ({ sport, slug: team.slug, name: team.name })) : null
  } catch {
    return null
  }
}

function distinctTeams(hits: TeamHit[]): TeamHit[] {
  const seen = new Set<string>()

  return hits.filter(hit => {
    const key = `${hit.sport}/${hit.slug}`
    if (seen.has(key)) return false
    seen.add(key)

    return true
  })
}

async function searchTeams($: EngineInterface, name: string): Promise<TeamHit[] | null> {
  const hits: TeamHit[] = []
  for (const sport of SPORTS) {
    const found = await searchSport($, name, sport)
    if (found === null) return null
    hits.push(...found)
  }

  return distinctTeams(hits)
}

type Lookup = { league: string; isOtherTeam: boolean }

async function lookupTeam($: EngineInterface, hit: TeamHit): Promise<Lookup> {
  const unknown: Lookup = { league: '', isOtherTeam: false }
  try {
    const response = await $.http.fetch(`${TEAM_URL}?sport=${hit.sport}&slug=${encodeURIComponent(hit.slug)}&limit=1`)
    if (!response.ok) return unknown
    const body = JSON.parse(response.text) as { team?: { name?: unknown }; matches?: unknown }
    const resolved = body.team?.name

    return {
      league: Array.isArray(body.matches) ? text(body.matches[0]?.competition) : '',
      isOtherTeam: typeof resolved === 'string' && resolved.trim() !== hit.name.trim(),
    }
  } catch {
    return unknown
  }
}

function pickLabels(hits: TeamHit[], leagues: string[]): string[] {
  const labels = hits.map((hit, i) => [`${SPORT_EMOJI[hit.sport]} ${hit.name}`, leagues[i]].filter(Boolean).join(SEPARATOR))

  return labels.map((label, i) => (labels.indexOf(label) === labels.lastIndexOf(label) ? label : `${label} (${hits[i].slug})`))
}

async function follow($: EngineInterface, hit: TeamHit): Promise<string> {
  await $.store.set('followed', [{ sport: hit.sport, slug: hit.slug, name: hit.name }])
  await poll($)

  return `Now following ${hit.name}.`
}

const choiceValue = (choice: TeamHit) => `${choice.sport}/${choice.slug}`

async function followedTeams($: EngineInterface): Promise<Followed[]> {
  const stored = await $.store.get('followed')
  if (!Array.isArray(stored)) return []
  return stored.filter(item => isNamed(item) && SPORTS.includes((item as Followed).sport))
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')

function score(value: unknown): string {
  const trimmed = String(value ?? '').trim()
  return trimmed === '' ? '0' : trimmed
}

function toLiveGame(m: Record<string, unknown>): LiveGame {
  return {
    key: `${text(m.url)}|${text(m.time)}`,
    home: text(m.home),
    away: text(m.away),
    homeScore: score(m.home_score),
    awayScore: score(m.away_score),
    homeLogo: text(m.home_logo),
    awayLogo: text(m.away_logo),
    statusText: text(m.status_text),
    minute: '',
    scorer: '',
    competition: text(m.competition),
    startsAt: Date.parse(text(m.time)),
  }
}

type Games = { live: LiveGame | null; upcoming: LiveGame[]; finished: LiveGame[] }

type Pick = { game: LiveGame; phase: Phase }

function pickGame(games: Games, sport: Sport, now: number): Pick | null {
  if (games.live) return { game: games.live, phase: 'live' }
  const soon = games.upcoming
    .filter(game => game.startsAt >= now - LATE_START_GRACE_MS && game.startsAt <= now + WINDOW_MS)
    .sort((a, b) => a.startsAt - b.startsAt)[0]
  if (soon) return { game: soon, phase: 'upcoming' }
  const recent = games.finished
    .filter(game => game.startsAt + GAME_LENGTH_MS[sport] >= now - WINDOW_MS)
    .sort((a, b) => b.startsAt - a.startsAt)[0]

  return recent ? { game: recent, phase: 'finished' } : null
}

type MatchDetail = { minute: string; scorer: string }

const NO_DETAIL: MatchDetail = { minute: '', scorer: '' }

function scorerOf(incidents: unknown, game: LiveGame): string {
  if (!Array.isArray(incidents)) return ''
  const goal = incidents.findLast(
    i => i?.is_goal === true && Number(i.home_score) === Number(game.homeScore) && Number(i.away_score) === Number(game.awayScore),
  )

  return typeof goal?.player === 'string' ? goal.player.trim() : ''
}

async function fetchMatchDetail($: EngineInterface, sport: Sport, game: LiveGame, url: string): Promise<MatchDetail> {
  const slug = url.split('/').filter(Boolean)[2]
  if (!slug) return NO_DETAIL
  try {
    const response = await $.http.fetch(`${MATCH_URL}?sport=${sport}&slug=${encodeURIComponent(slug)}`)
    if (!response.ok) return NO_DETAIL
    const match = (JSON.parse(response.text) as { match?: { live_minute?: unknown; incidents?: unknown } }).match
    const minute = match?.live_minute
    const printed = typeof minute === 'string' || typeof minute === 'number' ? String(minute).trim() : ''

    return { minute: MATCH_MINUTE.test(printed) ? printed : '', scorer: scorerOf(match?.incidents, game) }
  } catch {
    return NO_DETAIL
  }
}

async function fetchGames($: EngineInterface, team: Followed): Promise<Games | 'error'> {
  try {
    const response = await $.http.fetch(`${TEAM_URL}?sport=${team.sport}&slug=${encodeURIComponent(team.slug)}&limit=50`)
    if (!response.ok) return 'error'
    const matches = (JSON.parse(response.text) as { matches?: unknown }).matches
    if (!Array.isArray(matches)) return 'error'
    const live = matches.find(m => m?.status === 'live')

    const game = live ? toLiveGame(live) : null
    const detail = live && game && HAS_LIVE_MINUTE[team.sport] ? await fetchMatchDetail($, team.sport, game, text(live.url)) : NO_DETAIL

    return {
      live: game ? { ...game, ...detail } : null,
      upcoming: matches.filter(m => m?.status === 'upcoming').map(toLiveGame),
      finished: matches.filter(m => m?.status === 'finished').map(toLiveGame),
    }
  } catch {
    return 'error'
  }
}

function scoreline(sport: Sport, label: string, game: LiveGame): string {
  return `${SPORT_EMOJI[sport]} ${label}: ${game.home} ${game.homeScore} - ${game.awayScore} ${game.away}`
}

function withMinute(label: string, game: LiveGame): string {
  return game.minute === '' ? label : `${label} ${game.minute}'`
}

function hasScored(before: LiveGame, after: LiveGame): boolean {
  return Number(after.homeScore) > Number(before.homeScore) || Number(after.awayScore) > Number(before.awayScore)
}

function goalLabel(game: LiveGame): string {
  const label = withMinute('Goal', game)

  return game.scorer === '' ? label : `${label} (${game.scorer})`
}

function announcement(sport: Sport, previous: Reading | null, games: Games): string | null {
  const before = previous?.game
  if (!before || previous.phase !== 'live') return null
  const live = games.live
  if (live?.key === before.key) {
    if (live.statusText !== before.statusText) return scoreline(sport, withMinute(live.statusText, live), live)
    const scoreChanged = live.homeScore !== before.homeScore || live.awayScore !== before.awayScore
    if (TOAST_ON_SCORE[sport] && scoreChanged) {
      return scoreline(sport, hasScored(before, live) ? goalLabel(live) : withMinute('Score change', live), live)
    }

    return null
  }
  const final = games.finished.find(game => game.key === before.key)

  return final ? scoreline(sport, 'Full time', final) : null
}

function nextReading(result: Pick | null | 'error', team: Followed, previous: Reading | null, now: number): Reading | null {
  const carried = previous?.sport === team.sport && previous.slug === team.slug ? previous : null
  if (result === 'error') {
    if (!carried?.game) return carried
    if (now - carried.at > STALE_MS) {
      return { game: null, phase: null, sport: team.sport, slug: team.slug, followedSide: null, isStale: false, at: now }
    }
    return { ...carried, isStale: true }
  }
  const game = result?.game ?? null
  const followedSide = game?.home === team.name ? 'home' : game?.away === team.name ? 'away' : null
  return { game, phase: result?.phase ?? null, sport: team.sport, slug: team.slug, followedSide, isStale: false, at: now }
}

function shortCompetition(name: string): string {
  return name === "Women's National Basketball Association" ? 'WNBA' : name
}

function lightened(hex: string): string {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  if (luminance >= MIN_LUMINANCE) return hex
  const mix = (MIN_LUMINANCE - luminance) / (1 - luminance)
  const toward = (c: number) => Math.min(255, Math.ceil(c + (255 - c) * mix)).toString(16).padStart(2, '0')

  return `#${toward(r)}${toward(g)}${toward(b)}`
}

async function helperAvailable($: EngineInterface): Promise<boolean> {
  if (helperUsable !== null) return helperUsable
  try {
    helperUsable = (await $.process.run(['xcode-select', '-p'], { cwd: '/', timeoutMs: 5000 })).exitCode === 0
  } catch {
    helperUsable = true
  }

  return helperUsable
}

async function logoColour($: EngineInterface, url: string): Promise<string | null> {
  try {
    const result = await $.process.run(['python3', '-I', '-c', LOGO_COLOUR_SCRIPT, url], { cwd: '/', timeoutMs: HELPER_TIMEOUT_MS })
    const printed = result.stdout.trim()

    return result.exitCode === 0 && HEX_COLOUR.test(printed) ? lightened(printed) : null
  } catch {
    return null
  }
}

async function loadColours($: EngineInterface): Promise<void> {
  const stored = await $.store.get('colours')
  const entries = stored && typeof stored === 'object' ? Object.entries(stored) : []
  const valid = entries.filter(([url, colour]) => typeof colour === 'string' && HEX_COLOUR.test(colour) && url.startsWith('https://'))
  await update($, colours, () => Object.fromEntries(valid) as Record<string, string>)
}

async function ensureColours($: EngineInterface, game: LiveGame): Promise<void> {
  const known = await read($, colours)
  const wanted = [...new Set([game.homeLogo, game.awayLogo])].filter(
    url => url.startsWith('https://') && !(url in known) && !attemptedLogos.has(url),
  )
  wanted.forEach(url => attemptedLogos.add(url))
  if (wanted.length === 0 || !(await helperAvailable($))) return
  for (const url of wanted) {
    const colour = await logoColour($, url)
    if (colour === null) continue
    const all = await update($, colours, current => ({ ...current, [url]: colour }))
    await $.store.set('colours', all)
  }
}

function pollDelay(phase: Phase | null): number {
  if (phase === 'live') return LIVE_POLL_MS
  if (phase === 'upcoming') return UPCOMING_POLL_MS

  return IDLE_POLL_MS
}

function kickOffTime(startsAt: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(startsAt))
}

function startLabel(startsAt: number, now: number): string {
  const label = `Starts ${kickOffTime(startsAt)}`
  const minutes = Math.ceil((startsAt - now) / MINUTE_MS)
  if (minutes <= 0) return label
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${label} (in ${rest}m)`

  return rest === 0 ? `${label} (in ${hours}h)` : `${label} (in ${hours}h ${rest}m)`
}

async function poll($: EngineInterface): Promise<void> {
  const generation = ++pollGeneration
  const isLatest = () => generation === pollGeneration
  pendingPoll?.cancel()
  pendingPoll = null
  const [team] = await followedTeams($)
  if (!team) {
    await update($, reading, () => null)
    return
  }
  const games = await fetchGames($, team)
  const [current] = await followedTeams($)
  const now = await $.clock.now()
  const previous = await read($, reading)
  if (!isLatest() || current?.slug !== team.slug || current.sport !== team.sport) return
  const next = nextReading(games === 'error' ? 'error' : pickGame(games, team.sport, now), team, previous, now)
  await update($, reading, () => next)
  if (!isLatest()) return
  if (games !== 'error' && (await read($, isOn)) && isLatest()) {
    const toast = announcement(team.sport, previous, games)
    if (toast) $.ui.toast(toast, { timeoutMs: TOAST_MS })
  }
  if (!isLatest()) return
  pendingPoll?.cancel()
  pendingPoll = $.clock.after(pollDelay(next?.phase ?? null), () => poll($))
  if (next?.game) {
    const game = next.game
    $.clock.after(0, () => void ensureColours($, game).catch(() => {}))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'follow-team',
      description: 'Follow a team and show its live score above the prompt',
      argumentHint: '<team name>',
    })
    await $.command.register({
      name: 'unfollow-team',
      description: 'Stop following the team shown above the prompt',
      argumentHint: '[team name]',
    })
    await $.command.register({
      name: 'sportsball',
      description: 'Show or hide the live score above the prompt',
    })
    await loadColours($)
    await poll($)

    return next(e)
  })

  on('command.run', { command: 'follow-team' }, async ($, e) => {
    const name = e.args.trim()
    if (name.length < MIN_NAME_LENGTH) {
      return { text: 'Usage: /follow-team <team name> (at least 2 characters)' }
    }
    const hits = await searchTeams($, name)
    if (hits === null) return { text: "Couldn't look up that team just now. Try again shortly." }
    if (hits.length === 0) return { text: `No team matched "${name}".` }
    const lookups = await Promise.all(hits.map(h => lookupTeam($, h)))
    const offered = hits.filter((_, i) => !lookups[i].isOtherTeam)
    const skipped = hits.filter((_, i) => lookups[i].isOtherTeam).map(h => h.name)
    const skippedNote = skipped.length > 0 ? ` Left out because SportScore's lookup returns a different team: ${skipped.join(', ')}.` : ''
    if (offered.length === 0) return { text: `Can't follow ${skipped.join(', ')}: SportScore's lookup returns a different team.` }
    if (offered.length === 1) return { text: `${await follow($, offered[0])}${skippedNote}` }

    const labels = pickLabels(offered, lookups.filter(l => !l.isOtherTeam).map(l => l.league))
    if (offered.length > MAX_ASK_OPTIONS) {
      await update($, choices, () => offered.map((h, i): Choice => ({ ...h, label: labels[i] })))
      await $.ui.open({ id: TEAM_PANE, title: `Teams matching "${name}"`, focus: true, closeOnEscape: true })

      return { text: `Pick a team from the list.${skippedNote}` }
    }
    const answer = await $.ui.ask(`Which team matches "${name}"?${skippedNote}`, { options: labels, header: 'Team' }).catch(() => null)
    const picked = offered.find((_, i) => labels[i] === answer)

    return { text: picked ? await follow($, picked) : 'No team followed.' }
  })

  on('ui.render', { component: 'Pane', requestId: TEAM_PANE }, async ($, e) => {
    const { Box, Select } = $.ui.resolve(e)
    const options = (await read($, choices)).map(choice => ({ value: choiceValue(choice), label: choice.label }))

    return (
      <Box flexDirection="column">
        {options.length > 0 && <Select key={TEAM_SELECT} autoFocus options={options} onSelect={() => {}} />}
      </Box>
    )
  })

  on('ui.select', { element: TEAM_SELECT }, async ($, e, next) => {
    const result = await next(e)
    const picked = (await read($, choices)).find(choice => choiceValue(choice) === e.value)
    if (picked) {
      await update($, choices, () => [])
      await $.ui.close({ id: TEAM_PANE })
      $.ui.toast(await follow($, picked))
    }

    return result
  })

  on('command.run', { command: 'unfollow-team' }, async ($, e) => {
    const [team] = await followedTeams($)
    if (!team) return { text: 'Not following any team.' }
    const name = e.args.trim()
    if (name && !`${team.name} ${team.slug}`.toLowerCase().includes(name.toLowerCase())) {
      return { text: `Not following ${name}.` }
    }
    await $.store.set('followed', [])
    await poll($)

    return { text: `Stopped following ${team.name}.` }
  })

  on('command.run', { command: 'sportsball' }, async $ => {
    const now = await update($, isOn, v => !v)

    return { text: `Sportsball ${now ? 'on' : 'off'}.` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const data = await read($, reading)
    if (e.props.hasSurvey || !(await read($, isOn))) return next(e)
    const { Box, Text, Link } = $.ui.resolve(e)
    if (!data?.game) {
      if ((await followedTeams($)).length > 0) return next(e)

      return <Text wrap="wrap" dimColor>{FOLLOW_HELP}</Text>
    }
    const known = await read($, colours)
    const { game, followedSide } = data
    const width = Math.max(MIN_BAND_COLUMNS, e.props.bodyColumns - COLLAPSE_CONTROL_COLUMNS)

    const isUpcoming = data.phase === 'upcoming'
    const status =
      data.phase === 'upcoming'
        ? startLabel(game.startsAt, await $.clock.now())
        : data.phase === 'finished'
          ? 'Full time'
          : game.minute === ''
            ? game.statusText
            : `${game.statusText} ${game.minute}'`
    const gameText = (
      <Text wrap="wrap" dimColor={data.isStale}>
        {SPORT_EMOJI[data.sport]}{' '}
        <Text color={known[game.homeLogo]}>{game.home}</Text>
        {' '}
        {isUpcoming ? '' : <Text bold={followedSide === 'home'}>{game.homeScore}</Text>}
        {isUpcoming ? 'v' : ' - '}
        {isUpcoming ? '' : <Text bold={followedSide === 'away'}>{game.awayScore}</Text>}
        {' '}
        <Text color={known[game.awayLogo]}>{game.away}</Text>
        {SEPARATOR}
        {status}
        {SEPARATOR}
        {shortCompetition(game.competition)}
      </Text>
    )
    const credit = (
      <Text wrap="wrap" dimColor>
        Powered by <Link href={SPORTSCORE_URL}>SportScore</Link>
      </Text>
    )

    const creditColumns = Math.min(CREDIT_MAX_COLUMNS, width - MIN_GAME_COLUMNS)
    if (creditColumns >= CREDIT_MIN_COLUMNS) {
      return (
        <Box>
          <Box width={width - creditColumns}>{gameText}</Box>
          <Box width={creditColumns} justifyContent="flex-end">{credit}</Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box width={width}>{gameText}</Box>
        <Box width={width} justifyContent="flex-end">{credit}</Box>
      </Box>
    )
  })
}
