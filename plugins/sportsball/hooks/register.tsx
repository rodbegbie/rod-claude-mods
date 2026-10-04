import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Followed } from '../types'

const isOn = atom({ plugin: 'sportsball', key: 'isOn' } as const, true)

const SEARCH_URL = 'https://sportscore.com/api/v1/search/'
const MIN_NAME_LENGTH = 2

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

type TeamHit = { slug: string; name: string }

function isTeamHit(value: unknown): value is TeamHit {
  const hit = value as TeamHit | null
  return typeof hit?.slug === 'string' && typeof hit?.name === 'string'
}

async function searchTeams($: EngineInterface, name: string): Promise<TeamHit[] | null> {
  try {
    const response = await $.http.fetch(`${SEARCH_URL}?q=${encodeURIComponent(name)}&sport=basketball`)
    if (!response.ok) return null
    const teams = (JSON.parse(response.text) as { teams?: unknown }).teams
    return Array.isArray(teams) ? teams.filter(isTeamHit) : null
  } catch {
    return null
  }
}

async function followedTeams($: EngineInterface): Promise<Followed[]> {
  const stored = await $.store.get('followed')
  if (!Array.isArray(stored)) return []
  return stored.filter(item => isTeamHit(item) && (item as Followed).sport === 'basketball')
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
    if (hits.length > 1) {
      return { text: `Several teams match "${name}": ${hits.map(h => h.name).join(', ')}. Try a more specific name.` }
    }
    const [hit] = hits
    await $.store.set('followed', [{ sport: 'basketball', slug: hit.slug, name: hit.name }])

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

    return { text: `Stopped following ${team.name}.` }
  })

  on('command.run', { command: 'sportsball' }, async $ => {
    const now = await update($, isOn, v => !v)

    return { text: `Sportsball ${now ? 'on' : 'off'}.` }
  })
}
