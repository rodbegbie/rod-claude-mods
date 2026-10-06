export type Sport = 'basketball' | 'football'

export type Followed = { sport: Sport; slug: string; name: string }

export type Choice = Followed & { label: string }

export type LiveGame = {
  key: string
  home: string
  away: string
  homeScore: string
  awayScore: string
  homeLogo: string
  awayLogo: string
  statusText: string
  minute: string
  scorer: string
  competition: string
  startsAt: number
}

export type Phase = 'live' | 'upcoming' | 'finished'

export type Reading = {
  game: LiveGame | null
  phase: Phase | null
  sport: Followed['sport']
  slug: string
  followedSide: 'home' | 'away' | null
  isStale: boolean
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    sportsball: {
      reading: Reading | null
      isOn: boolean
      colours: Record<string, string>
      choices: Choice[]
    }
  }
}
