import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-workspace'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { IncomingMessage } from 'node:http'
import { basename, sep } from 'node:path'
import { addUsage, calendar, foldSession, readTicket, statusOf, tokenKeys, tokenTotal, zeroTokens, zeroUsage } from './fold.ts'
import type { DashboardRow, FoldedSession, Snapshot, Ticket, Tokens } from './types.ts'

export const name = 'missher-dashboard'
export const inject = ['agents', 'sessionPersistence', 'workspaceRegistry', 'webServer']

export function allowedRequest(req: Pick<IncomingMessage, 'headers'>, port: number): boolean {
  const host = req.headers.host
  return (host === `127.0.0.1:${port}` || host === `localhost:${port}`) && req.headers['x-dsh-dashboard'] === '1'
    && (req.headers.origin === undefined || req.headers.origin === `http://${host}`)
}

class DashboardReader {
  private cache = new Map<string, { revision: string; row: FoldedSession }>()
  private failed = new Set<string>()
  private tickets: Ticket[] = []
  private superagent: Snapshot['superagent'] = 'unavailable'
  private scan?: Promise<void>
  private lastScan = 0
  private totalSessions = 0
  private scanned = 0
  private readError = false
  private lifetime = new AbortController()
  private timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  private ctx: Context
  constructor(ctx: Context) { this.ctx = ctx }
  dispose() { this.lifetime.abort(); this.cache.clear() }

  private async readTickets(): Promise<void> {
    const tickets = new Map<string, Ticket>()
    try {
      for (const state of ['open', 'ended']) {
        let offset: number | null = 0
        while (offset !== null) {
          const response = await fetch(`http://127.0.0.1:${this.ctx.webServer.port}/orchestrator/api/tickets?state=${state}&offset=${offset}&limit=1000`, {
            headers: { 'x-orchestrator-request': '1' }, signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(8000)]) })
          if (!response.ok) throw new Error('Superagent unavailable')
          const page = await response.json() as { items: unknown[]; next_offset: number | null }
          if (!Array.isArray(page.items)) throw new Error('Invalid task page')
          for (const item of page.items) { const ticket = readTicket(item); if (ticket) tickets.set(ticket.id, ticket) }
          const next = page.next_offset
          if (next !== null && (!Number.isSafeInteger(next) || next <= offset)) throw new Error('Invalid task cursor')
          offset = next
        }
      }
      this.tickets = [...tickets.values()]; this.superagent = 'available'
    } catch { this.superagent = this.tickets.length ? 'partial' : 'unavailable' }
  }

  private async refresh(): Promise<void> {
    const signal = this.lifetime.signal
    const ticketRead = this.readTickets()
    try {
      const stored = await this.ctx.sessionPersistence.list({ signal })
      const live = new Map(this.ctx.agents.list().map(agent => [String(agent.id), agent]))
      const entries = new Map(stored.map(item => [String(item.header.id), { header: item.header, revision: String(item.revision) }]))
      for (const [id, agent] of live) entries.set(id, { header: agent.session.header, revision: `live:${agent.session.seq}` })
      this.totalSessions = entries.size; this.scanned = 0
      const queue = [...entries.values()].sort((a, b) => Number(live.has(String(b.header.id))) - Number(live.has(String(a.header.id))) || b.header.createdAt - a.header.createdAt)
      const worker = async () => {
        while (queue.length && !signal.aborted) {
          const entry = queue.shift()!, id = String(entry.header.id)
          try {
            const previous = this.cache.get(id), agent = this.ctx.agents.get(entry.header.id)
            const revision = agent ? `live:${agent.session.header.createdAt}:${agent.session.seq}` : `${entry.header.createdAt}:${entry.revision}`
            if (previous?.revision !== revision || this.failed.has(id)) {
              let row: FoldedSession
              if (agent) row = foldSession(agent.session.header, agent.session.snapshotEvents(), this.timeZone, agent.session.inheritedEventCount)
              else {
                const handle = await this.ctx.sessionPersistence.open(entry.header.id, 'read', { signal })
                try { row = foldSession(handle.header, (await handle.read(0, undefined, { signal })).events, this.timeZone, handle.inheritedEventCount) }
                finally { await handle.close() }
              }
              if (!signal.aborted) this.cache.set(id, { revision, row })
            }
            this.failed.delete(id)
          } catch {
            if (signal.aborted) break
            this.failed.add(id)
            if (!this.cache.has(id)) this.cache.set(id, { revision: '', row: foldSession(entry.header, [], this.timeZone) })
          }
          this.scanned++
          // Give the host's active conversations a chance to run between folds.
          await new Promise(resolve => setTimeout(resolve, 0))
        }
      }
      await Promise.all([worker(), worker()])
      for (const id of this.cache.keys()) if (!entries.has(id)) { this.cache.delete(id); this.failed.delete(id) }
      this.readError = false
    } catch { if (!signal.aborted) this.readError = true }
    await ticketRead
  }

  snapshot(days: number): Snapshot & { readError: boolean } {
    if (!this.scan && Date.now() - this.lastScan >= 4000 && !this.lifetime.signal.aborted) {
      this.lastScan = Date.now()
      this.scan = this.refresh().finally(() => { this.scan = undefined })
    }
    const now = Date.now(), today = calendar(this.timeZone)(now).slice(0, 10)
    const fromDate = new Date(Date.parse(`${today}T12:00:00Z`) - (days - 1) * 86400000).toISOString().slice(0, 10)
    const workspaces = this.ctx.workspaceRegistry.list().slice().sort((a, b) => b.path.length - a.path.length)
    const archived = new Set<string>(this.ctx.workspaceRegistry.archivedSessionIds)
    const tickets = new Map(this.tickets.filter(t => t.sessionId).map(t => [t.sessionId, t]))
    const rows: DashboardRow[] = []
    const projectOf = (id: string, cwd: string) => {
      const ws = workspaces.find(ws => ws.sessionIds.includes(id as SessionId)) ?? workspaces.find(ws => cwd === ws.path || cwd.startsWith(`${ws.path}${sep}`))
      return ws ? { projectId: String(ws.id), project: ws.title || basename(ws.path) } : { projectId: cwd || '__none', project: cwd ? basename(cwd) || cwd : '' }
    }
    const makeRow = (row: FoldedSession, ticket?: Ticket): DashboardRow => {
      const usage = zeroUsage(), series: Record<string, Tokens> = {}
      for (const [hour, value] of Object.entries(row.hours)) {
        const date = hour.slice(0, 10)
        if (date < fromDate || date > today) continue
        addUsage(usage, value)
        const key = days === 1 ? hour : date, bucket = series[key] ??= zeroTokens()
        for (const k of tokenKeys) bucket[k] += value.tokens[k]
      }
      const agent = this.ctx.agents.get(row.id as SessionId), running = agent?.status === 'running'
      const { hours, lifetime, ...facts } = row
      const cwd = row.cwd || ticket?.directory || ''
      return { ...facts, cwd, title: ticket?.title || row.title, updatedAt: Math.max(row.updatedAt, ticket?.updatedAt ?? 0),
        ...projectOf(row.id, cwd), kind: ticket || ['dsh-superagent-worker', 'dsh-superagent-router'].includes(row.agentPreset ?? '') ? 'superagent' : row.origin === 'subagent' ? 'subagent' : 'session',
        status: this.failed.has(row.id) && !agent ? 'unknown' : statusOf(row, running, ticket), running, live: !!agent, archived: archived.has(row.id), ticket,
        lifetimeTokens: lifetime.missing && !lifetime.reported ? null : tokenTotal(lifetime.tokens), usage, series,
        ...(this.failed.has(row.id) ? { unavailable: true } : {}) }
    }
    for (const { row } of this.cache.values()) rows.push(makeRow(row, tickets.get(row.id)))
    for (const ticket of this.tickets) {
      if (ticket.sessionId && this.cache.has(ticket.sessionId)) continue
      const id = ticket.sessionId || `ticket:${ticket.id}`
      const row = makeRow(foldSession({ id, createdAt: ticket.updatedAt, cwd: ticket.directory }, [], this.timeZone), ticket)
      row.lifetimeTokens = null
      if (ticket.sessionId) row.unavailable = true
      rows.push(row)
    }
    return { generatedAt: now, timeZone: this.timeZone, today, fromDate, days, scanned: this.scanned, totalSessions: this.totalSessions,
      failedSessions: this.failed.size, scanning: !!this.scan && (this.totalSessions === 0 || this.scanned < this.totalSessions), superagent: this.superagent, rows, readError: this.readError }
  }
}

export function apply(ctx: Context): void {
  const reader = new DashboardReader(ctx)
  ctx.effect(() => () => reader.dispose())
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/dsh-dashboard/api/snapshot', handler: (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    if (!allowedRequest(req, ctx.webServer.port ?? -1)) { res.writeHead(403); res.end('{"error":"Forbidden"}'); return }
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); res.writeHead(405); res.end('{"error":"Read only"}'); return }
    const days = Number(new URL(req.url!, 'http://localhost').searchParams.get('days') ?? 1)
    if (![1, 7, 30].includes(days)) { res.writeHead(400); res.end('{"error":"Invalid range"}'); return }
    try { const payload = JSON.stringify(reader.snapshot(days)); res.writeHead(200); res.end(payload) }
    catch { if (!res.headersSent) res.writeHead(500); res.end('{"error":"Snapshot unavailable"}') }
  } }))
}
