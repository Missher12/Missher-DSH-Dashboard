import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acceptSnapshot, activityCounts, activityHeatmap, retainRowOrder, tokenDistribution } from '../src/client/data.ts'
import { foldSession, zeroUsage } from '../src/fold.ts'
import { axisMaximum, numberFormat } from '../src/client/numbers.ts'
import type { DashboardRow, Snapshot } from '../src/types.ts'

function row(id: string, tokens = 100, updatedAt = 100): DashboardRow {
  const usage = zeroUsage(); usage.reported = 1; usage.tokens.uncachedInput = tokens
  return { ...foldSession({ id, createdAt: 1 }, [], 'UTC'), updatedAt, title: id, status: 'idle', running: false, live: false, archived: false,
    project: 'Project', projectId: 'p', kind: 'session', lifetimeTokens: tokens, usage, activeHours: [], series: { '2026-11-10': { ...usage.tokens } }, toolsSeries: {} }
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

test('heatmap counts distinct sessions across weeks using the recorded local date and hour', () => {
  const first = { ...row('a'), activeHours: ['2026-11-02T00', '2026-11-09T00', '2026-11-08T23'] }
  const second = { ...row('b'), activeHours: ['2026-11-09T00'] }
  const heat = activityHeatmap([first, second, row('empty'), { ...second, unavailable: true }])
  assert.equal(heat.cells[0], 2)
  assert.equal(heat.cells[167], 1)
  assert.equal(heat.cells.reduce((sum, value) => sum + value, 0), 3)
  assert.deepEqual([heat.sessions, heat.days, heat.hours], [2, 3, 3])
})

test('dashboard figures use the UI language and rounded axes without clipping the peak', () => {
  const zh = numberFormat('zh-CN'), en = numberFormat('en-US')
  assert.equal(zh.compact(9_876), '9,876')
  assert.deepEqual(zh.parts(105_234_567), { number: '1.05', scale: '亿' })
  assert.deepEqual(en.parts(105_234_567), { number: '105', scale: 'M' })
  assert.equal(zh.exact(105_234_567), '105,234,567')
  assert.equal(axisMaximum(72_823_471), 80_000_000)
  assert.equal(axisMaximum(499), 500)
  for (const peak of [0, 1, 7, 2001, 9999, 10_001, 99_999_999]) {
    const maximum = axisMaximum(peak)
    assert.ok(maximum >= peak && maximum > 0 && Number.isInteger(maximum / 2))
  }
})
