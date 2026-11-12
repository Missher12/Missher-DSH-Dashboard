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
  humanDays?: string[] // Absent in caches written before 0.3.3.
}
export interface Ticket {
  id: string; sessionId: string; title: string; directory: string; updatedAt: number
  stage: string; action?: string; outcome?: string; summary: string
}
export interface DashboardRow extends Omit<FoldedSession, 'hours' | 'lifetime' | 'humanDays'> {
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
  activeHours: string[]
  hourlyTokens: Record<string, number>
  series: Record<string, Tokens>
  toolsSeries: Record<string, number>
  unavailable?: boolean
}
export interface UsageHistory {
  projectId: string
  archived: boolean
  days: Record<string, number>
  hours: (number | null)[]
  humanDays: string[] | null
  longestMs: number | null
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
  usageHistory: UsageHistory[]
}
