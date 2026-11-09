import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { tokenKeys } from './fold.ts'
import type { FoldedSession, Snapshot, Ticket } from './types.ts'

export interface SavedDashboard {
  version: 1
  timeZone: string
  updatedAt: number
  rows: FoldedSession[]
  tickets: Ticket[]
  superagent: Snapshot['superagent']
}
const object = (v: any): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v)
const count = (v: any) => Number.isSafeInteger(v) && v >= 0
const optionalText = (v: any) => v === undefined || typeof v === 'string'
const usage = (v: any) => object(v) && object(v.tokens) && tokenKeys.every(k => count(v.tokens[k]))
  && ['reported', 'missing', 'toolCalls', 'turns', 'durationMs'].every(k => count(v[k]))
function row(v: any): boolean {
  return object(v) && typeof v.id === 'string' && !!v.id && typeof v.title === 'string' && typeof v.cwd === 'string'
    && count(v.createdAt) && count(v.updatedAt) && typeof v.openTurn === 'boolean' && count(v.approvals)
    && ['parentId', 'agentPreset', 'lastTurn', 'model'].every(k => optionalText(v[k]))
    && (v.origin === undefined || v.origin === 'subagent')
    && Array.isArray(v.pendingTools) && v.pendingTools.every((x: any) => typeof x === 'string')
    && (v.todos === null || Array.isArray(v.todos) && v.todos.every((x: any) => object(x) && typeof x.content === 'string' && ['pending', 'in_progress', 'completed'].includes(x.status)))
    && (v.goal === undefined || object(v.goal) && typeof v.goal.objective === 'string' && ['active', 'paused', 'blocked', 'complete'].includes(v.goal.phase)
      && count(v.goal.rounds) && (v.goal.maxRounds === undefined || count(v.goal.maxRounds)) && optionalText(v.goal.reason))
    && Array.isArray(v.activity) && v.activity.every((x: any) => object(x) && count(x.at) && typeof x.type === 'string' && optionalText(x.detail))
    && usage(v.lifetime) && object(v.hours) && Object.entries(v.hours).every(([key, value]) => /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(key) && usage(value))
}
function ticket(v: any): boolean {
  return object(v) && ['id', 'sessionId', 'title', 'directory', 'stage', 'summary'].every(k => typeof v[k] === 'string')
    && count(v.updatedAt) && ['action', 'outcome'].every(k => optionalText(v[k]))
}
export async function loadCache(file: string, timeZone: string): Promise<SavedDashboard | undefined> {
  try {
    const value = JSON.parse(await readFile(file, 'utf8'))
    if (object(value) && value.version === 1 && value.timeZone === timeZone && count(value.updatedAt)
      && Array.isArray(value.rows) && value.rows.every(row) && new Set(value.rows.map((r: FoldedSession) => r.id)).size === value.rows.length
      && Array.isArray(value.tickets) && value.tickets.every(ticket) && ['available', 'partial', 'unavailable'].includes(value.superagent)) return value as SavedDashboard
  } catch { /* Missing, incompatible or damaged derived data is rebuilt from the host. */ }
}
export async function saveCache(file: string, value: SavedDashboard): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
    await rename(temporary, file)
  } finally { await rm(temporary, { force: true }) }
}
