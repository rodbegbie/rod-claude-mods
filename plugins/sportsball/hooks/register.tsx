import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Followed, LiveGame, Reading, Sport } from '../types'

const isOn = atom({ plugin: 'sportsball', key: 'isOn' } as const, true)
const reading = atom({ plugin: 'sportsball', key: 'reading' } as const, null)
const colours = atom({ plugin: 'sportsball', key: 'colours' } as const, {})

const SEARCH_URL = 'https://sportscore.com/api/v1/search/'
const TEAM_URL = 'https://sportscore.com/api/v1/team/'
const MATCH_URL = 'https://sportscore.com/api/v1/match/'
const MIN_NAME_LENGTH = 2
const LIVE_POLL_MS = 30_000
const IDLE_POLL_MS = 300_000
const STALE_MS = 10 * 60_000
const TOAST_MS = 8000
const HELPER_TIMEOUT_MS = 15_000
const MIN_LUMINANCE = 0.35
const HEX_COLOUR = /^#[0-9a-f]{6}$/
const MATCH_MINUTE = /^\d+(\+\d*)?$/
const COLLAPSE_CONTROL_COLUMNS = 4
const MIN_BAND_COLUMNS = 10
const CREDIT_COLUMNS = 22
const MIN_GAME_COLUMNS = 20
const SEPARATOR = ' · '
const SPORTSCORE_URL = 'https://sportscore.com'
const SPORTS: Sport[] = ['basketball', 'football']
const SPORT_EMOJI: Record<Sport, string> = { basketball: '🏀', football: '⚽' }
const HAS_LIVE_MINUTE: Record<Sport, boolean> = { basketball: false, football: true }

let pendingPoll: { cancel: () => void } | null = null
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

async function searchTeams($: EngineInterface, name: string): Promise<TeamHit[] | null> {
  const hits: TeamHit[] = []
  for (const sport of SPORTS) {
    const found = await searchSport($, name, sport)
    if (found === null) return null
    hits.push(...found)
  }

  return hits
}

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
    competition: text(m.competition),
  }
}

type Games = { live: LiveGame | null; finished: LiveGame[] }

async function fetchLiveMinute($: EngineInterface, sport: Sport, url: string): Promise<string> {
  const slug = url.split('/').filter(Boolean)[2]
  if (!slug) return ''
  try {
    const response = await $.http.fetch(`${MATCH_URL}?sport=${sport}&slug=${encodeURIComponent(slug)}`)
    if (!response.ok) return ''
    const minute = (JSON.parse(response.text) as { match?: { live_minute?: unknown } }).match?.live_minute
    const printed = typeof minute === 'string' || typeof minute === 'number' ? String(minute).trim() : ''

    return MATCH_MINUTE.test(printed) ? printed : ''
  } catch {
    return ''
  }
}

async function fetchGames($: EngineInterface, team: Followed): Promise<Games | 'error'> {
  try {
    const response = await $.http.fetch(`${TEAM_URL}?sport=${team.sport}&slug=${encodeURIComponent(team.slug)}&limit=50`)
    if (!response.ok) return 'error'
    const matches = (JSON.parse(response.text) as { matches?: unknown }).matches
    if (!Array.isArray(matches)) return 'error'
    const live = matches.find(m => m?.status === 'live')

    const minute = live && HAS_LIVE_MINUTE[team.sport] ? await fetchLiveMinute($, team.sport, text(live.url)) : ''

    return {
      live: live ? { ...toLiveGame(live), minute } : null,
      finished: matches.filter(m => m?.status === 'finished').map(toLiveGame),
    }
  } catch {
    return 'error'
  }
}

function scoreline(sport: Sport, label: string, game: LiveGame): string {
  return `${SPORT_EMOJI[sport]} ${label}: ${game.home} ${game.homeScore} - ${game.awayScore} ${game.away}`
}

function announcement(sport: Sport, previous: Reading | null, games: Games): string | null {
  const before = previous?.game
  if (!before) return null
  if (games.live?.key === before.key) {
    return games.live.statusText !== before.statusText ? scoreline(sport, games.live.statusText, games.live) : null
  }
  const final = games.finished.find(game => game.key === before.key)

  return final ? scoreline(sport, 'Full time', final) : null
}

function nextReading(result: LiveGame | null | 'error', team: Followed, previous: Reading | null, now: number): Reading | null {
  if (result === 'error') {
    if (!previous?.game) return previous
    if (now - previous.at > STALE_MS) return { game: null, sport: team.sport, followedSide: null, isStale: false, at: now }
    return { ...previous, isStale: true }
  }
  const followedSide = result?.home === team.name ? 'home' : result?.away === team.name ? 'away' : null
  return { game: result, sport: team.sport, followedSide, isStale: false, at: now }
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

async function poll($: EngineInterface): Promise<void> {
  pendingPoll?.cancel()
  pendingPoll = null
  const [team] = await followedTeams($)
  if (!team) {
    await update($, reading, () => null)
    return
  }
  const games = await fetchGames($, team)
  const [current] = await followedTeams($)
  if (current?.slug !== team.slug) return
  const now = await $.clock.now()
  const previous = await read($, reading)
  const next = nextReading(games === 'error' ? 'error' : games.live, team, previous, now)
  await update($, reading, () => next)
  if (games !== 'error' && (await read($, isOn))) {
    const toast = announcement(team.sport, previous, games)
    if (toast) $.ui.toast(toast, { timeoutMs: TOAST_MS })
  }
  pendingPoll = $.clock.after(next?.game ? LIVE_POLL_MS : IDLE_POLL_MS, () => poll($))
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
    const exact = hits.filter(h => h.name.toLowerCase() === name.toLowerCase())
    const chosen = hits.length === 1 ? hits : exact.length === 1 ? exact : null
    if (chosen === null) {
      return { text: `Several teams match "${name}": ${hits.map(h => `${SPORT_EMOJI[h.sport]} ${h.name}`).join(', ')}. Try a more specific name.` }
    }
    const [hit] = chosen
    await $.store.set('followed', [{ sport: hit.sport, slug: hit.slug, name: hit.name }])
    await poll($)

    return { text: `Now following ${hit.name}.` }
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
    if (e.props.hasSurvey || !data?.game || !(await read($, isOn))) return next(e)
    const known = await read($, colours)
    const { Box, Text, Link } = $.ui.resolve(e)
    const { game, followedSide } = data
    const width = Math.max(MIN_BAND_COLUMNS, e.props.bodyColumns - COLLAPSE_CONTROL_COLUMNS)

    const status = game.minute === '' ? game.statusText : `${game.statusText} ${game.minute}'`
    const gameText = (
      <Text wrap="truncate-end" dimColor={data.isStale}>
        {SPORT_EMOJI[data.sport]}{' '}
        <Text color={known[game.homeLogo]}>{game.home}</Text>
        {' '}
        <Text bold={followedSide === 'home'}>{game.homeScore}</Text>
        {' - '}
        <Text bold={followedSide === 'away'}>{game.awayScore}</Text>
        {' '}
        <Text color={known[game.awayLogo]}>{game.away}</Text>
        {SEPARATOR}
        {status}
        {SEPARATOR}
        {shortCompetition(game.competition)}
      </Text>
    )
    const credit = (
      <Text wrap="truncate-end" dimColor>
        Powered by <Link href={SPORTSCORE_URL}>SportScore</Link>
      </Text>
    )

    if (width - CREDIT_COLUMNS >= MIN_GAME_COLUMNS) {
      return (
        <Box>
          <Box width={width - CREDIT_COLUMNS}>{gameText}</Box>
          <Box width={CREDIT_COLUMNS} justifyContent="flex-end">{credit}</Box>
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
