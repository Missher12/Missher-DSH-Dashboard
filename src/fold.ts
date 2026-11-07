// Provider-bucket and retry attribution adapted from @missher/dsh-usage-statistics (MIT).
// Read-only: never append events, activate agents, or retain message/tool argument bodies.
import type { Activity, FoldedSession, Goal, Status, Ticket, Tokens, Usage } from './types.ts'

/** Event data is validated by the owning DSH persistence service. Optional fields remain checked here. */
export interface LogEvent { seq: number; time: number; type: string; data: any }
export interface Header { id: string; createdAt: number; cwd?: string; parentSession?: string; origin?: 'subagent'; isSeeded?: boolean; agentPreset?: string }
export const tokenKeys = ['uncachedInput', 'cacheRead', 'cacheWrite', 'output'] as const
export const zeroTokens = (): Tokens => ({ uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 })
export const zeroUsage = (): Usage => ({ tokens: zeroTokens(), reported: 0, missing: 0, toolCalls: 0, turns: 0, durationMs: 0 })
export const tokenTotal = (tokens: Tokens): number => tokenKeys.reduce((n, key) => n + tokens[key], 0)
export function addUsage(target: Usage, value: Usage): void {
  for (const key of tokenKeys) target.tokens[key] += value.tokens[key]
  target.reported += value.reported; target.missing += value.missing
  target.toolCalls += value.toolCalls; target.turns += value.turns; target.durationMs += value.durationMs
}
export function calendar(timeZone: string) {
  const f = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
  return (time: number) => {
    const parts = Object.fromEntries(f.formatToParts(time).map(p => [p.type, p.value]))
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}`
  }
}
function buckets(value: any): Tokens | undefined {
  if (!value || typeof value !== 'object') return
  const t = { uncachedInput: value.inputTokens, output: value.outputTokens, cacheRead: value.cacheReadTokens ?? 0, cacheWrite: value.cacheWriteTokens ?? 0 }
  if (tokenKeys.every(key => Number.isSafeInteger(t[key]) && t[key] >= 0) && Number.isSafeInteger(tokenTotal(t))) return t
}
function usageOf(event: LogEvent): unknown {
  if (event.type === 'assistant/message' && event.data.usage !== undefined) return event.data.usage
  const stream = Array.isArray(event.data.stream) ? event.data.stream : []
  for (let i = stream.length - 1; i >= 0; i--) if (stream[i]?.type === 'chunk' && stream[i]?.chunk?.type === 'usage') return stream[i].chunk.usage
}

export function foldSession(header: Header, events: readonly LogEvent[], timeZone: string, inheritedEventCount = 0): FoldedSession {
  const localHour = calendar(timeZone)
  const row: FoldedSession = { id: header.id, title: '', cwd: header.cwd ?? '', createdAt: header.createdAt,
    updatedAt: header.createdAt, origin: header.origin, parentId: header.parentSession, agentPreset: header.agentPreset, todos: null,
    openTurn: false, approvals: 0, pendingTools: [], activity: [], lifetime: zeroUsage(), hours: {} }
  const hour = (at: number): Usage => row.hours[localHour(at)] ??= zeroUsage()
  const samples = new Map<string, { at: number; tokens?: Tokens }>()
  const attempts = new Map<string, number>(), turns = new Map<number, number>()
  const approvals = new Set<string>(), tools = new Map<string, string>()
  let goalId: string | undefined
  const activity = (event: LogEvent, detail?: string) => {
    row.activity.push({ at: event.time, type: event.type, ...(detail ? { detail: detail.slice(0, 180) } : {}) })
    if (row.activity.length > 8) row.activity.shift()
  }
  for (const event of events) {
    const d = event.data, type = event.type
    // Identity/routing may be inherited, usage and task ownership may not.
    if (type === 'session/title' && typeof d.title === 'string') row.title = d.title.slice(0, 400)
    if (type === 'working-directory/change' && typeof d.cwd === 'string') row.cwd = d.cwd
    if (type === 'request/header' && d.header?.config) row.model = `${d.header.config.provider}/${d.header.config.model}`
    if (event.seq < inheritedEventCount) continue
    row.updatedAt = Math.max(row.updatedAt, event.time)
    if (type === 'user/message' && d.source?.kind === 'user') {
      if (!row.title) row.title = (Array.isArray(d.content) ? d.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ') : '').slice(0, 100)
      activity(event)
    } else if (type === 'turn/start') {
      row.openTurn = true; row.lastTurn = undefined; turns.set(d.turn, event.time); approvals.clear(); tools.clear(); activity(event)
    } else if (type === 'turn/end') {
      row.openTurn = false; row.lastTurn = d.reason?.kind; approvals.clear(); tools.clear()
      const start = turns.get(d.turn); turns.delete(d.turn)
      if (start !== undefined && event.time >= start) { hour(event.time).turns++; hour(event.time).durationMs += event.time - start }
      activity(event, row.lastTurn)
    } else if (type === 'approval/asked') { approvals.add(d.id); activity(event, d.toolName)
    } else if (type === 'approval/decided') { approvals.delete(d.id); activity(event, d.outcome)
    } else if (type === 'tool/call') { tools.set(d.callId, d.name); hour(event.time).toolCalls++; activity(event, d.name)
    } else if (type === 'tool/ptc-dispatch-start') { hour(event.time).toolCalls++; activity(event, d.name)
    } else if (type === 'tool/result') { tools.delete(d.message?.toolCallId); if (d.message?.isError) activity(event, 'error')
    } else if (type === 'todo/write' && Array.isArray(d.todos)) {
      row.todos = d.todos.filter((v: any) => typeof v.content === 'string' && ['pending', 'in_progress', 'completed'].includes(v.status)).map((v: any) => ({ content: v.content.slice(0, 600), status: v.status }))
    } else if (type === 'goal/change') {
      if (d.operation === 'clear') { row.goal = undefined; goalId = undefined }
      else if (d.goal && ['active', 'paused', 'blocked', 'complete'].includes(d.goal.phase)) {
        const goal = d.goal; goalId = goal.id
        row.goal = { objective: String(goal.objective).slice(0, 2000), phase: goal.phase, rounds: d.roundsStarted ?? 0,
          maxRounds: goal.maxGoalRounds, reason: goal.blockedReason?.message }
      }
      activity(event, row.goal?.phase ?? 'clear')
    } else if (type === 'user/message' && d.source?.kind === 'goal' && d.source.goalId === goalId && row.goal) {
      row.goal.rounds = Math.max(row.goal.rounds, d.source.round ?? 0)
    }
    const step = `${d.turn}:${d.step}`
    if (type === 'llm/retry-started') attempts.set(step, (attempts.get(step) ?? 0) + 1)
    if (type === 'assistant/message' || type === 'assistant/attempt') {
      const key = `${step}:${attempts.get(step) ?? 0}`, tokens = buckets(usageOf(event))
      // The settled message can repeat an attempt's usage; retain only one sample per attempt.
      if (tokens || !samples.has(key)) samples.set(key, { at: event.time, tokens })
    }
  }
  let accepted = 0
  for (const sample of samples.values()) {
    const usage = hour(sample.at)
    if (!sample.tokens || !Number.isSafeInteger(accepted + tokenTotal(sample.tokens))) { usage.missing++; continue }
    accepted += tokenTotal(sample.tokens); usage.reported++
    for (const key of tokenKeys) usage.tokens[key] += sample.tokens[key]
  }
  for (const usage of Object.values(row.hours)) addUsage(row.lifetime, usage)
  row.approvals = approvals.size; row.pendingTools = [...new Set(tools.values())]; row.activity.reverse()
  return row
}

export function statusOf(row: Pick<FoldedSession, 'goal' | 'openTurn' | 'lastTurn' | 'approvals'>, running: boolean, ticket?: Ticket): Status {
  if (running && row.approvals) return 'approval'
  if (running) return 'running'
  if (ticket) {
    if (ticket.stage === 'person') return ticket.action === 'failed' ? 'error' : ticket.action === 'blocked' ? 'blocked' : 'attention'
    if (ticket.stage === 'working') return ticket.action === 'queued' ? 'queued' : 'unknown'
    if (ticket.stage === 'ended') return ['completed', 'merged'].includes(ticket.outcome ?? '') ? 'complete' : 'stopped'
  }
  if (row.goal?.phase === 'complete') return 'complete'
  if (row.goal?.phase === 'paused') return 'paused'
  if (row.goal?.phase === 'blocked' || row.lastTurn === 'blocked') return 'blocked'
  if (row.lastTurn === 'error' || row.lastTurn === 'max-tokens') return 'error'
  if (row.openTurn || row.lastTurn === 'interrupted') return 'unknown'
  return 'idle'
}

/** Only public read API fields are retained; neither prompts nor tool arguments enter snapshots. */
export function readTicket(value: any): Ticket | undefined {
  if (!value || typeof value.id !== 'string' || typeof value.stage !== 'string') return
  return { id: value.id, sessionId: typeof value.sessionId === 'string' ? value.sessionId : '', title: String(value.title ?? '').slice(0, 400),
    directory: typeof value.directory === 'string' ? value.directory : '', updatedAt: Date.parse(value.updatedAt) || 0,
    stage: value.stage, action: value.action, outcome: value.ended?.outcome, summary: String(value.summary ?? '').slice(0, 1500) }
}
