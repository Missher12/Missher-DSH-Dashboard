import type { DashboardRow, Snapshot, Status, Tokens } from '../types.ts'
import { tokenKeys, tokenTotal } from '../fold.ts'

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

export const usedTokenKeys = (tokens: Tokens) => tokenKeys.filter(key => tokens[key] > 0)

/** The keys are host-local hours. Null means no provider report; a reported zero stays zero. */
export function tokenHeatmap(rows: DashboardRow[]) {
  const cells = Array<number | null>(7 * 24).fill(null)
  const weekdays = new Map<string, number>()
  let total: number | null = null
  for (const row of rows) {
    if (row.unavailable || !row.usage.reported) continue
    for (const [hour, tokens] of Object.entries(row.hourlyTokens ?? {})) {
      const day = hour.slice(0, 10)
      let weekday = weekdays.get(day)
      if (weekday === undefined) {
        weekday = (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7
        weekdays.set(day, weekday)
      }
      const cell = weekday * 24 + Number(hour.slice(11))
      cells[cell] = (cells[cell] ?? 0) + tokens
      total = (total ?? 0) + tokens
    }
  }
  return { cells, total }
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
