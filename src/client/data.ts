import type { DashboardRow, Snapshot, Status } from '../types.ts'
import { tokenTotal } from '../fold.ts'

export type SnapshotData = Snapshot & { readError?: boolean; dataReady?: boolean }
export const attentionStates = new Set<Status>(['approval', 'attention', 'blocked', 'error', 'unknown'])
const priority = (row: DashboardRow) => row.running ? 0 : attentionStates.has(row.status) ? 1 : row.status === 'queued' ? 2 : 3

/** Keep a complete view while the next scan is still replacing individual rows. */
export function acceptSnapshot(previous: SnapshotData | null, next: SnapshotData): SnapshotData {
  if (previous?.days === next.days && previous.timeZone === next.timeZone && (previous.dataReady || previous.cachedAt) && next.scanning) {
    return { ...next, rows: previous.rows, superagent: previous.superagent, failedSessions: previous.failedSessions,
      generatedAt: previous.generatedAt, today: previous.today, fromDate: previous.fromDate, dataReady: true }
  }
  return { ...next, dataReady: !next.scanning || !!next.cachedAt }
}

/** Existing rows keep their places; new rows join at the end, in normal priority order. */
export function retainRowOrder(rows: DashboardRow[], ids: string[]): DashboardRow[] {
  const positions = new Map(ids.map((id, i) => [id, i]))
  return rows.slice().sort((a, b) => {
    const left = positions.get(a.id), right = positions.get(b.id)
    if (left !== undefined || right !== undefined) return (left ?? Infinity) - (right ?? Infinity)
    return priority(a) - priority(b) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)
  })
}

export function activityCounts(rows: DashboardRow[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const row of rows) {
    if (row.unavailable) continue
    for (const key of Object.keys(row.series)) counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

/** Hours already use the host time zone. A session counts once per weekday/hour cell across the selected period. */
export function activityHeatmap(rows: DashboardRow[]) {
  const cells = Array<number>(7 * 24).fill(0)
  const dates = new Map<string, number>()
  const hours = new Set<string>()
  let sessions = 0
  for (const row of rows) {
    if (row.unavailable || !row.activeHours?.length) continue
    sessions++
    const visited = new Set<number>()
    for (const hour of row.activeHours) {
      hours.add(hour)
      const day = hour.slice(0, 10)
      let weekday = dates.get(day)
      if (weekday === undefined) {
        weekday = (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7
        dates.set(day, weekday)
      }
      visited.add(weekday * 24 + Number(hour.slice(11)))
    }
    for (const cell of visited) cells[cell]++
  }
  return { cells, sessions, days: dates.size, hours: hours.size }
}

export const tokenBands = [0, 10_000, 100_000, 1_000_000, 10_000_000]
export function tokenDistribution(rows: DashboardRow[]): number[] {
  const counts = tokenBands.map(() => 0)
  for (const row of rows) {
    if (row.unavailable || !row.usage.reported) continue
    const tokens = tokenTotal(row.usage.tokens)
    const index = tokenBands.findIndex((_, i) => i === tokenBands.length - 1 || tokens < tokenBands[i + 1])
    counts[index]++
  }
  return counts
}
