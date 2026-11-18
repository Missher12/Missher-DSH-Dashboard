import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { createServer, type RequestListener } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import { DashboardReader } from '../src/index.ts'
import { calendar, type LogEvent } from '../src/fold.ts'

const at = Date.now()
const session = (id: string, input: number): { header: { id: string; createdAt: number }; revision: string; events: LogEvent[] } => ({
  header: { id, createdAt: at - 1000 }, revision: 'same-token-in-different-hosts',
  events: [
    { seq: 0, time: at, type: 'session/title', data: { title: id } },
    { seq: 1, time: at, type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: input, outputTokens: 5 } } },
  ] satisfies LogEvent[],
})
function reader(dir: string, sessions: ReturnType<typeof session>[], gate = Promise.resolve(), archivedSessionIds: string[] = [],
  source?: { port: number; lifetime?: AbortSignal }, onList?: () => void) {
  return new DashboardReader({
    get: (key: string) => key === 'profileContext' ? { dir } : key === 'orchestrator' && source?.lifetime ? source : undefined,
    agents: { list: () => [], get: () => undefined },
    workspaceRegistry: { list: () => [], archivedSessionIds }, webServer: { port: source?.port ?? 0 },
    sessionPersistence: {
      list: async () => { onList?.(); await gate; return sessions },
      open: async (id: string) => {
        const item = sessions.find(item => item.header.id === id)!
        return { header: item.header, inheritedEventCount: 0, read: async () => ({ events: item.events }), close: async () => {} }
      },
    },
  } as unknown as Context)
}
async function settled(value: DashboardReader, ready: (snapshot: Awaited<ReturnType<DashboardReader['snapshot']>>) => boolean = snapshot => !snapshot.scanning) {
  for (let i = 0; i < 200; i++) {
    const snapshot = await value.snapshot(7)
    if (ready(snapshot)) return snapshot
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Dashboard scan did not settle')
}

async function ticketServer(handler: RequestListener) {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { port: (server.address() as AddressInfo).port, close: () => new Promise<void>(resolve => server.close(() => resolve())) }
}

test('polling reports a slow scan as finished before starting another scan', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-dashboard-'))
  let now = at, scans = 0
  t.mock.method(Date, 'now', () => now)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const host = reader(dir, [session('plain', 30)], gate, [], undefined, () => { scans++ })
  try {
    assert.equal((await host.snapshot(7)).scanning, true)
    now += 5000
    assert.equal((await host.snapshot(7)).scanning, true)
    assert.equal(scans, 1)
    release()

    const finished = await settled(host)
    assert.equal(finished.rows[0].usage.tokens.uncachedInput, 30)
    assert.equal(scans, 1, 'completion of a slow scan must still be visible to the next poll')

    const manual = await Promise.all([host.snapshot(7, true), host.snapshot(30, true)])
    assert.ok(manual.every(snapshot => snapshot.scanning))
    assert.equal(scans, 2, 'manual refresh bypasses the interval and shares a scan already in progress')
    await settled(host)
    assert.equal(scans, 2)
  } finally { release(); await host.dispose(); await rm(dir, { recursive: true, force: true }) }
})

test('a slow SuperAgent page cannot hold session totals or their cache and stopping it hides task rows', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-dashboard-'))
  const source = new AbortController()
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const server = await ticketServer(async (req, res) => {
    const open = new URL(req.url!, 'http://localhost').searchParams.get('state') === 'open'
    if (!open) await held
    const items = open ? [{ id: 'blocked', title: 'Waiting', stage: 'person', action: 'blocked', updatedAt: new Date(at).toISOString() }] : []
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ items, next_offset: null }))
  })
  const host = reader(dir, [session('plain', 30)], Promise.resolve(), [], { port: server.port, lifetime: source.signal })
  try {
    const fresh = await settled(host)
    assert.equal(fresh.rows[0].usage.tokens.uncachedInput, 30)
    assert.equal(fresh.superagent, 'unavailable')
    const saved = JSON.parse(await readFile(join(dir, '.dsh-dashboard', 'cache-v1.json'), 'utf8'))
    assert.equal(saved.rows[0].id, 'plain')
    release()
    const withTask = await settled(host, snapshot => snapshot.superagent === 'available')
    assert.equal(withTask.rows.find(row => row.id === 'ticket:blocked')?.status, 'blocked')
    source.abort()
    const stopped = await host.snapshot(7)
    assert.equal(stopped.superagent, 'unavailable')
    assert.deepEqual(stopped.rows.map(row => row.id), ['plain'])
  } finally {
    release()
    await host.dispose(); await server.close(); await rm(dir, { recursive: true, force: true })
  }
})

test('standalone sessions restore from cache without querying an optional source', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-dashboard-'))
  let requests = 0
  const server = await ticketServer((_req, res) => { requests++; res.writeHead(404).end() })
  const host = reader(dir, [session('plain', 40)], Promise.resolve(), [], { port: server.port })
  try {
    assert.equal((await settled(host)).rows[0].usage.tokens.uncachedInput, 40)
    const file = join(dir, '.dsh-dashboard', 'cache-v1.json')
    const cache = JSON.parse(await readFile(file, 'utf8'))
    // An invalid optional record cannot invalidate the otherwise intact sessions cache.
    cache.tickets = [{ id: 'old' }]
    cache.superagent = 'available'
    await writeFile(file, JSON.stringify(cache))
    const reopened = reader(dir, [session('plain', 40)], Promise.resolve(), [], { port: server.port })
    try {
      const restored = await reopened.snapshot(7)
      assert.ok(restored.cachedAt)
      assert.deepEqual(restored.rows.map(row => row.id), ['plain'])
      assert.equal(restored.superagent, 'unavailable')
      await settled(reopened)
      assert.equal(requests, 0)
    } finally { await reopened.dispose() }
  } finally { await host.dispose(); await server.close(); await rm(dir, { recursive: true, force: true }) }
})

test('restart displays saved statistics before scanning, then replaces changed and deleted sessions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-dashboard-'))
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const first = reader(dir, [session('kept', 30), session('deleted', 20)])
  let reopened: DashboardReader | undefined
  try {
    assert.equal((await settled(first)).rows.length, 2)
    await first.dispose()
    const file = join(dir, '.dsh-dashboard', 'cache-v1.json'), old = JSON.parse(await readFile(file, 'utf8'))
    for (const row of old.rows) delete row.humanDays // 0.3.2 cache has the Token data but no chat-day evidence.
    await writeFile(file, JSON.stringify(old))
    reopened = reader(dir, [session('kept', 90)], gate)
    const cached = await reopened.snapshot(7)
    assert.equal(cached.usageHistory[0].humanDays, null)
    assert.equal(cached.usageHistory[0].days[cached.today], 60)
    assert.equal(cached.rows.length, 2, 'saved rows must be visible before slow history listing finishes')
    assert.equal(cached.rows.find(row => row.id === 'kept')?.usage.tokens.uncachedInput, 30)
    assert.deepEqual(Object.values(cached.rows.find(row => row.id === 'kept')!.hourlyTokens), [35], 'hourly usage is available directly from the existing cache')
    assert.equal(cached.scanning, true)
    assert.equal(cached.cachedAt, cached.generatedAt)
    assert.ok(cached.cachedAt)
    release()
    const fresh = await settled(reopened)
    assert.deepEqual(fresh.rows.map(row => row.id), ['kept'])
    assert.equal(fresh.rows[0].usage.tokens.uncachedInput, 90, 'revisions from a previous host must not bypass validation')
    assert.deepEqual(Object.values(fresh.rows[0].hourlyTokens), [95])
    assert.deepEqual(fresh.usageHistory[0].humanDays, [])
    assert.equal(fresh.usageHistory[0].days[fresh.today], 95)
    assert.equal(fresh.cachedAt, undefined)
  } finally {
    release(); await first.dispose(); await reopened?.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('the snapshot preserves the reported hour before collapsing the trend into daily totals', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-dashboard-'))
  const item = session('hourly', 1), hour = calendar(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const stamp = (offset: number) => at - offset * 3_600_000
  item.events = [4, 3, 2, 1].map((offset, turn) => ({
    seq: turn, time: stamp(offset), type: 'assistant/message', data: { turn, step: 0, usage: [
      { inputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 3, outputTokens: 2 },
      { inputTokens: 0, outputTokens: 0 }, undefined, { inputTokens: -1, outputTokens: 2 },
    ][turn] },
  }))
  const current = reader(dir, [item])
  try {
    const [row] = (await settled(current)).rows
    assert.equal(row.usage.reported, 2)
    assert.equal(row.usage.missing, 2)
    assert.deepEqual(row.hourlyTokens, { [hour(stamp(4))]: 35, [hour(stamp(3))]: 0 })
    assert.ok(row.activeHours.includes(hour(stamp(1))), 'an unreported request is still activity, not billed tokens')
  } finally { await current.dispose(); await rm(dir, { recursive: true, force: true }) }
})

test('history survives the page date range, excludes SuperAgent and groups archive and project independently', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-dashboard-'))
  const old = session('old', 41), archived = session('archived', 15), worker = session('worker', 1000), current = session('current', 4)
  const stamp = at - 500 * 86400000, hour = calendar(Intl.DateTimeFormat().resolvedOptions().timeZone)
  Object.assign(old.header, {createdAt:stamp-1,cwd:'/one'}); Object.assign(archived.header, {cwd:'/one'}); Object.assign(worker.header,{agentPreset:'dsh-superagent-worker'})
  old.events.forEach(e=>{e.time=stamp});old.events.push({seq:2,time:stamp,type:'user/message',data:{source:{kind:'user'}}},
    {seq:3,time:at,type:'user/message',data:{source:{kind:'goal'}}})
  const host = reader(dir,[old,archived,worker,current],Promise.resolve(),['archived'])
  try {
    const snapshot = await settled(host), cut = await host.snapshot(1)
    const select = (projectId:string,archived:boolean)=>cut.usageHistory.find(g=>g.projectId===projectId&&g.archived===archived)!
    assert.equal(cut.rows.find(r=>r.id==='old')?.usage.reported,0)
    assert.deepEqual(select('/one',false).days,{[hour(stamp).slice(0,10)]:46})
    assert.deepEqual(select('/one',false).humanDays,[hour(stamp).slice(0,10)])
    assert.equal(select('/one',true).days[cut.today],20)
    assert.equal(select('__none',false).days[cut.today],9)
    assert.equal(select('__none',false).hours[Number(hour(at).slice(11))],9)
    assert.deepEqual(snapshot.usageHistory,cut.usageHistory)
  } finally { await host.dispose(); await rm(dir,{recursive:true,force:true}) }
})

test('damaged or incompatible cache falls back to history and repairs the saved result', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-dashboard-'))
  const file = join(dir, '.dsh-dashboard', 'cache-v1.json')
  try {
    await mkdir(join(dir, '.dsh-dashboard'))
    for (const invalid of ['{broken', JSON.stringify({ version: 99, rows: [] }), JSON.stringify({ version: 1, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, updatedAt: at, rows: [{}], tickets: [], superagent: 'unavailable' })]) {
      await writeFile(file, invalid)
      const current = reader(dir, [session('recovered', 45)])
      try {
        const fresh = await settled(current)
        assert.equal(fresh.rows[0].usage.tokens.uncachedInput, 45)
        assert.equal(fresh.cacheError, false)
        assert.equal(JSON.parse(await readFile(file, 'utf8')).rows[0].id, 'recovered')
      } finally { await current.dispose() }
    }
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('unwritable cache keeps live statistics available and reports that restart caching failed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-dashboard-'))
  await writeFile(join(dir, '.dsh-dashboard'), 'This file blocks directory creation')
  const current = reader(dir, [session('visible', 60)])
  try {
    const fresh = await settled(current)
    assert.equal(fresh.rows[0].usage.tokens.uncachedInput, 60)
    assert.equal(fresh.cacheError, true)
    assert.equal(fresh.readError, false)
  } finally { await current.dispose(); await rm(dir, { recursive: true, force: true }) }
})
