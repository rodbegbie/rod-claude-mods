export type Segment = { name: string; tokens: number; color: string; kind: 'used' | 'free' | 'buffer' | 'deferred' }
export type Bar = { segments: Segment[]; total: number; window: number }

declare module 'claude-code' {
  interface PluginState {
    'context-bar': { bar: Bar | null; isOn: boolean }
  }
}
