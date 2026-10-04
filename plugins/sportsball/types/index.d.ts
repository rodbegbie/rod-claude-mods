export type Followed = { sport: 'basketball'; slug: string; name: string }

export type LiveGame = {
  home: string
  away: string
  homeScore: string
  awayScore: string
  homeLogo: string
  awayLogo: string
  statusText: string
  competition: string
}

export type Reading = {
  game: LiveGame | null
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
    }
  }
}
