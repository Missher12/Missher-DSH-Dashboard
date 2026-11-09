export type Status = 'running' | 'approval' | 'attention' | 'queued' | 'idle' | 'paused' | 'blocked' | 'error' | 'complete' | 'stopped' | 'unknown'
export type TokenKey = 'uncachedInput' | 'cacheRead' | 'cacheWrite' | 'output'
export type Tokens = Record<TokenKey, number>
export interface Usage {
  tokens: Tokens
  reported: number
  missing: number
  toolCalls: number
  turns: number
  durationMs: number
}
export interface Todo { content: string; status: 'pending' | 'in_progress' | 'completed' }
export interface Goal { objective: string; phase: 'active' | 'paused' | 'blocked' | 'complete'; rounds: number; maxRounds: number; reason?: string }
export interface Activity { at: number; type: string; detail?: string }
export interface FoldedSession {
  id: string
  title: string
  cwd: string
  createdAt: number
  updatedAt: number
  origin?: 'subagent'
  parentId?: string
  agentPreset?: string
  goal?: Goal
  todos: Todo[] | null
  lastTurn?: string
  openTurn: boolean
  approvals: number
  pendingTools: string[]
  model?: string
  activity: Activity[]
  lifetime: Usage
  hours: Record<string, Usage>
}
export interface Ticket {
  id: string; sessionId: string; title: string; directory: string; updatedAt: number
  stage: string; action?: string; outcome?: string; summary: string
}
export interface DashboardRow extends Omit<FoldedSession, 'hours' | 'lifetime'> {
  status: Status
  running: boolean
  live: boolean
  archived: boolean
  project: string
  projectId: string
  kind: 'session' | 'subagent' | 'superagent'
  ticket?: Ticket
  lifetimeTokens: number | null
  usage: Usage
  series: Record<string, Tokens>
  toolsSeries: Record<string, number>
  unavailable?: boolean
}
export interface Snapshot {
  generatedAt: number
  cachedAt?: number
  cacheError?: boolean
  timeZone: string
  today: string
  fromDate: string
  days: number
  scanned: number
  totalSessions: number
  failedSessions: number
  scanning: boolean
  superagent: 'available' | 'unavailable' | 'partial'
  rows: DashboardRow[]
}
