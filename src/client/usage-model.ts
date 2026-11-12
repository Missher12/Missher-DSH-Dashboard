// Calendar alignment, particle intensity and streaks follow @missher/dsh-usage-statistics (MIT).
import type { UsageHistory } from '../types.ts'

const DAY = 86_400_000
const dateOf = (day: number) => new Date(day * DAY).toISOString().slice(0, 10)
const numberOf = (day: string) => Date.parse(day + 'T00:00:00Z') / DAY
const add = (a: number | null, b: number | null) => b === null ? a : (a ?? 0) + b
export type ParticleMode = 'daily' | 'weekly' | 'cumulative'

export function usageModel(history: UsageHistory[], today: string, project: string, archived: boolean) {
  const daily = new Map<string, number>(), human = new Set<string>(), hours = Array<number | null>(24).fill(null)
  let longestMs: number | null = null, knownDays = true
  for (const group of history) {
    if (project && project !== group.projectId || group.archived && !archived) continue
    for (const [day, value] of Object.entries(group.days)) daily.set(day, (daily.get(day) ?? 0) + value)
    group.hours.forEach((value, h) => { hours[h] = add(hours[h], value) })
    if (group.longestMs !== null) longestMs = Math.max(longestMs ?? 0, group.longestMs)
    if (group.humanDays) for (const day of group.humanDays) human.add(day)
    else knownDays = false
  }
  const end = numberOf(today), start = end - new Date(end * DAY).getUTCDay() - 52 * 7, first = dateOf(start)
  let total: number | null = null, peak: number | null = null, baseline: number | null = null
  for (const [day, value] of daily) {
    total = add(total, value); peak = Math.max(peak ?? 0, value)
    if (day < first) baseline = add(baseline, value)
  }
  let longest = 0, run = 0, prev = -Infinity
  for (const date of [...human].sort()) {
    const day = numberOf(date)
    run = day === prev + 1 ? run + 1 : 1; longest = Math.max(longest, run); prev = day
  }
  const days = Array.from({length: 53 * 7}, (_, i) => { const date = dateOf(start + i); return { date, value: daily.get(date) ?? null } })
  return { today, hours, days, baseline, total, peak, longestMs, current: knownDays ? (prev === end || prev === end - 1 ? run : 0) : null, longest: knownDays ? longest : null }
}
export type UsageModel = ReturnType<typeof usageModel>

/** A week always occupies the same seven positions. Totals without a provider receipt stay absent. */
export function particles(model: UsageModel, mode: ParticleMode) {
  let running = model.baseline
  const weeks = Array.from({length: 53}, (_, i) => {
    const days = model.days.slice(i * 7, i * 7 + 7), weekly = days.reduce((n, d) => add(n, d.value), null as number | null)
    running = add(running, weekly)
    return { days, weekly, cumulative: running }
  })
  const max = mode === 'daily' ? Math.max(0, ...model.days.map(d => d.value ?? 0))
    : Math.max(0, ...weeks.map(w => (mode === 'weekly' ? w.weekly : w.cumulative) ?? 0))
  return weeks.flatMap(({ days, weekly, cumulative }) => days.map(({date, value}, index) => {
    const tokens = mode === 'daily' ? value : mode === 'weekly' ? weekly : cumulative
    const ratio = tokens && max ? tokens / max : 0
    const height = mode === 'weekly' && ratio ? Math.ceil(7 * Math.log1p(tokens!) / Math.log1p(max)) : Math.ceil(7 * ratio)
    const level = mode === 'daily' || index >= 7 - height ? Math.ceil(5 * ratio) : 0
    return { date, value:tokens, level, from:mode === 'daily' ? date : days[0].date, to:mode === 'daily' ? date : days[6].date > model.today ? model.today : days[6].date }
  }))
}
