export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Usage = { limits: Limit[]; now: number }

declare module 'claude-code' {
  interface PluginState {
    'pro-limits': { usage: Usage | null; isOn: boolean }
  }
}
