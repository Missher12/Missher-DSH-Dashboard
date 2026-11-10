import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acceptSnapshot, activityCounts, retainRowOrder, tokenDistribution } from '../src/client/data.ts'
import { foldSession, zeroUsage } from '../src/fold.ts'
import type { DashboardRow, Snapshot } from '../src/types.ts'

function row(id: string, tokens = 100, updatedAt = 100): DashboardRow {
  const usage = zeroUsage(); usage.reported = 1; usage.tokens.uncachedInput = tokens
  return { ...foldSession({ id, createdAt: 1 }, [], 'UTC'), updatedAt, title: id, status: 'idle', running: false, live: false, archived: false,
    project: 'Project', projectId: 'p', kind: 'session', lifetimeTokens: tokens, usage, series: { '2026-11-10': { ...usage.tokens } }, toolsSeries: {} }
}
const snapshot = (rows: DashboardRow[], scanning = false): Snapshot => ({ days: 7, generatedAt: 100, timeZone: 'UTC', today: '2026-11-10', fromDate: '2026-11-04', scanned: 0, totalSessions: rows.length, failedSessions: 0, scanning, superagent: 'available', rows })

test('background batches keep the complete charts until a finished update arrives', () => {
  const saved = acceptSnapshot(null, { ...snapshot([row('a'), row('b')], true), cachedAt: 90 })
  const partial = acceptSnapshot(saved, snapshot([row('a', 200)], true))
  const again = acceptSnapshot(partial, snapshot([row('a', 300)], true))
  assert.deepEqual(again.rows.map(r => r.usage.tokens.uncachedInput), [100, 100])
  const complete = acceptSnapshot(again, snapshot([row('a', 300)]))
  assert.equal(complete.rows.length, 1)
  assert.equal(complete.rows[0].usage.tokens.uncachedInput, 300)
  assert.equal(acceptSnapshot(complete, { ...snapshot([row('today')], true), days: 1 }).rows[0].id, 'today')
})

test('background status changes and new sessions do not reshuffle the current page', () => {
  const original = Array.from({ length: 25 }, (_, i) => row(String(i), 100, 100 - i))
  const updated = [row('new', 500, 1000), ...original.map(r => r.id === '24' ? { ...r, status: 'running' as const, running: true, updatedAt: 2000 } : r)]
  const ordered = retainRowOrder(updated, original.map(r => r.id))
  assert.deepEqual(ordered.slice(10, 20).map(r => r.id), ['10', '11', '12', '13', '14', '15', '16', '17', '18', '19'])
  assert.equal(ordered[24].running, true)
  assert.equal(ordered[25].id, 'new')
})

test('activity counts distinct sessions per bucket and token bands use valid recorded usage', () => {
  const rows = [row('a', 0), row('b', 9_999), row('c', 10_000), row('d', 100_000), row('e', 1_000_000), row('f', 10_000_000)]
  rows[0].series['2026-11-09'] = rows[0].usage.tokens
  assert.deepEqual(activityCounts(rows), { '2026-11-10': 6, '2026-11-09': 1 })
  const missing = row('missing'); missing.usage.reported = 0
  assert.deepEqual(tokenDistribution([...rows, missing, { ...row('unreadable'), unavailable: true }]), [2, 1, 1, 1, 1])
})
