import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acceptSnapshot, activityCounts, retainRowOrder, tokenDistribution } from '../src/client/data.ts'
import { foldSession, zeroUsage } from '../src/fold.ts'
import { axisMaximum, numberFormat } from '../src/client/numbers.ts'
import { particles, usageModel } from '../src/client/usage-model.ts'
import type { DashboardRow, Snapshot, UsageHistory } from '../src/types.ts'

function row(id: string, tokens = 100, updatedAt = 100): DashboardRow {
  const usage = zeroUsage(); usage.reported = 1; usage.tokens.uncachedInput = tokens
  return { ...foldSession({ id, createdAt: 1 }, [], 'UTC'), updatedAt, title: id, status: 'idle', running: false, live: false, archived: false,
    project: 'Project', projectId: 'p', kind: 'session', lifetimeTokens: tokens, usage, activeHours: [], hourlyTokens: {}, series: { '2026-11-10': { ...usage.tokens } }, toolsSeries: {} }
}
const snapshot = (rows: DashboardRow[], scanning = false): Snapshot => ({ days: 7, generatedAt: 100, timeZone: 'UTC', today: '2026-11-10', fromDate: '2026-11-04', scanned: 0, totalSessions: rows.length, failedSessions: 0, scanning, superagent: 'available', usageHistory: [], rows })

test('background batches keep the complete charts until a finished update arrives', () => {
  const saved = acceptSnapshot(null, { ...snapshot([row('a'), row('b')], true), cachedAt: 90 })
  const partial = acceptSnapshot(saved, snapshot([row('a', 200)], true))
  assert.strictEqual(partial.usageHistory, saved.usageHistory)
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

test('usage statistics merge matching project histories, retain known zeroes, and count actual chat streaks', () => {
  const today = '2026-11-12', blankHours = () => Array<number | null>(24).fill(null)
  const base: UsageHistory = { projectId:'a', archived:false, days:{'2025-05-01':500,'2026-11-09':0,'2026-11-10':10,'2026-11-12':25},
    hours:blankHours(), humanDays:['2026-11-09','2026-11-10','2026-11-11'], longestMs:180000 }
  base.hours[3]=25; base.hours[5]=0
  const archive = {...base, archived:true, days:{'2026-11-12':100}, hours:blankHours(), humanDays:[today]}
  const other = {...base, projectId:'b', days:{'2026-11-12':3}, hours:blankHours(), humanDays:[], longestMs:360000}
  const primary = usageModel([base,archive,other],today,'a',false)
  assert.deepEqual([primary.total,primary.peak,primary.baseline,primary.hours[3],primary.hours[4],primary.hours[5],primary.current,primary.longest,primary.longestMs], [535,500,500,25,null,0,3,3,180000])
  assert.equal(usageModel([base,archive,other],today,'',true).total,638)
  assert.equal(usageModel([base,archive],today,'a',true).current,4)
  assert.equal(usageModel([base,{...other,humanDays:null}],today,'',false).current,null)
  assert.equal(usageModel([],today,'',false).total,null)
  const daily=particles(primary,'daily'), weekly=particles(primary,'weekly'), cumulative=particles(primary,'cumulative')
  assert.equal(daily.length,371); assert.equal(new Date(daily[0].date+'T00:00Z').getUTCDay(),0)
  assert.deepEqual(daily.map(c=>c.date),weekly.map(c=>c.date))
  assert.equal(daily.find(c=>c.date==='2026-11-09')?.value,0)
  assert.equal(daily.find(c=>c.date==='2026-11-11')?.value,null)
  assert.equal(weekly.find(c=>c.date==='2026-11-11')?.value,35)
  assert.equal(cumulative[0].value,500)
  assert.equal(cumulative.at(-1)?.value,535);assert.equal(cumulative.at(-1)?.to,today)
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
