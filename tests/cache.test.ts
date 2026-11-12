import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
function reader(dir: string, sessions: ReturnType<typeof session>[], gate = Promise.resolve()) {
  return new DashboardReader({
    get: (key: string) => key === 'profileContext' ? { dir } : undefined,
    agents: { list: () => [], get: () => undefined },
    workspaceRegistry: { list: () => [], archivedSessionIds: [] }, webServer: { port: 0 },
    sessionPersistence: {
      list: async () => { await gate; return sessions },
      open: async (id: string) => {
        const item = sessions.find(item => item.header.id === id)!
        return { header: item.header, inheritedEventCount: 0, read: async () => ({ events: item.events }), close: async () => {} }
      },
    },
  } as unknown as Context)
}
async function settled(value: DashboardReader) {
  for (let i = 0; i < 200; i++) {
    const snapshot = await value.snapshot(7)
    if (!snapshot.scanning) return snapshot
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Dashboard scan did not settle')
}

test('restart displays saved statistics before scanning, then replaces changed and deleted sessions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-dashboard-'))
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const first = reader(dir, [session('kept', 30), session('deleted', 20)])
  let reopened: DashboardReader | undefined
  try {
    assert.equal((await settled(first)).rows.length, 2)
    await first.dispose()
    reopened = reader(dir, [session('kept', 90)], gate)
    const cached = await reopened.snapshot(7)
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
