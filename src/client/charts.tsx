import { useId, useState, type ReactNode } from 'react'
import { tokenKeys, tokenTotal, zeroTokens } from '../fold.ts'
import type { DashboardRow, Status, Tokens } from '../types.ts'
import type { T } from './locales.ts'
import { tokenBands, tokenDistribution } from './data.ts'

export const compact = (n: number): string => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
export const exact = (n: number): string => new Intl.NumberFormat().format(n)
export const statusOrder: Status[] = ['running', 'approval', 'attention', 'queued', 'blocked', 'error', 'paused', 'idle', 'complete', 'stopped', 'unknown']
export const statusColors: Record<Status, string> = { running: 'var(--dd-green)', approval: 'var(--dd-red)', attention: 'var(--dd-red)', queued: 'var(--dd-purple)', blocked: 'var(--dd-red)', error: 'var(--dd-red)', paused: 'var(--dd-muted)', idle: 'var(--dd-blue)', complete: 'var(--dd-green)', stopped: 'var(--dd-muted)', unknown: 'var(--dd-red)' }
const tokenColors = { uncachedInput: 'var(--dd-blue)', cacheRead: 'var(--dd-teal)', cacheWrite: 'var(--dd-purple)', output: 'var(--dd-amber)' }
export function Empty({ t }: { t: T }) { return <div className="dd-empty">{t('noData')}</div> }

export function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1)
  const points = values.map((value, i) => `${i / Math.max(values.length - 1, 1) * 100},${22 - value / max * 20}`).join(' ')
  return <svg className="dd-mini dd-sparkline" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">{values.length > 0 && <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}</svg>
}

export function MiniProgress({ value, total }: { value: number; total: number }) {
  return <div className="dd-mini dd-mini-progress" aria-hidden="true" style={{ visibility: total ? 'visible' : 'hidden' }}><i style={{ width: `${total ? Math.min(100, value / total * 100) : 0}%` }} /></div>
}

export function TokenMixChart({ tokens, t }: { tokens: Tokens; t: T }) {
  const total = tokenTotal(tokens)
  if (!total) return <Empty t={t} />
  return <div className="dd-token-mix">
    <div className="dd-mix-bar" role="img" aria-label={tokenKeys.map(key => `${t(key)} ${exact(tokens[key])}`).join(' · ')}>
      {tokenKeys.map(key => <span key={key} style={{ width: `${tokens[key] / total * 100}%`, background: tokenColors[key] }} title={`${t(key)} ${exact(tokens[key])}`} />)}
    </div>
    <div className="dd-mix-legend">{tokenKeys.map(key => <div key={key} title={exact(tokens[key])}><span><i style={{ background: tokenColors[key] }} />{t(key)}</span><strong>{compact(tokens[key])}</strong><small>{(tokens[key] / total * 100).toFixed(1)}%</small></div>)}</div>
  </div>
}

const shortTime = (key: string) => key.includes('T') ? key.slice(-2) + ':00' : key.slice(5)

function Plot({ keys, max, bars = false, children }: { keys: string[]; max: number; bars?: boolean; children: ReactNode }) {
  const last = keys.length - 1
  const tickCount = keys.length === 7 ? 7 : Math.min(5, keys.length)
  const ticks = Array.from({ length: tickCount }, (_, i) => Math.round(i * last / Math.max(1, tickCount - 1)))
  return <div className="dd-plot">
    <div className="dd-y-axis" aria-hidden="true">{[1, .5, 0].map(fraction => <span key={fraction}>{compact(max * fraction)}</span>)}</div>
    <div className="dd-plot-field">{children}</div>
    <div className="dd-x-axis" aria-hidden="true">{ticks.map(index => {
      const percent = bars ? (index + .5) / keys.length : index / Math.max(1, last)
      return <span key={index} data-edge={index === 0 ? 'first' : index === last ? 'last' : undefined} style={{ left: String(percent * 100) + '%' }}>{shortTime(keys[index])}</span>
    })}</div>
  </div>
}

export function CountChart({ series, keys, label, t }: { series: Record<string, number>; keys: string[]; label: string; t: T }) {
  const [hover, setHover] = useState<string | null>(null)
  if (!keys.length) return <Empty t={t} />
  const values = keys.map(key => series[key] ?? 0)
  const max = Math.max(2, Math.ceil(Math.max(...values) / 2) * 2)
  return <>
    <Plot keys={keys} max={max} bars>
      <div className="dd-columns" role="group" aria-label={label}>
        {keys.map((key, index) => <button key={key} className="dd-column" aria-label={shortTime(key) + ' · ' + label + ' ' + exact(values[index])}
          onFocus={() => setHover(key)} onBlur={() => setHover(null)} onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover(null)} onClick={() => setHover(key)}>
          <span style={{ height: String(values[index] / max * 100) + '%' }} />
        </button>)}
      </div>
    </Plot>
    <div className="dd-chart-readout">{hover && keys.includes(hover) ? shortTime(hover) + ' · ' + label + ' ' + exact(series[hover] ?? 0) : null}</div>
  </>
}

export function DistributionChart({ rows, t }: { rows: DashboardRow[]; t: T }) {
  const counts = tokenDistribution(rows), total = counts.reduce((sum, count) => sum + count, 0), max = Math.max(...counts, 1)
  if (!total) return <Empty t={t} />
  return <div className="dd-bar-list dd-distribution">{counts.map((count, i) => {
    const label = i === 0 ? `< ${compact(tokenBands[1])}` : i === tokenBands.length - 1 ? `≥ ${compact(tokenBands[i])}` : `${compact(tokenBands[i])} – < ${compact(tokenBands[i + 1])}`
    return <div key={i} className="dd-bar-row" title={`${label} tokens · ${count} ${t('sessionsUnit')} · ${(count / total * 100).toFixed(1)}%`}><span className="dd-bar-label">{label}</span><strong>{count} <small>{t('sessionsUnit')}</small></strong><span className="dd-rank-track"><span style={{ width: `${count / max * 100}%` }} /></span></div>
  })}</div>
}

export function TokenChart({ series, keys, t }: { series: Record<string, Tokens>; keys: string[]; t: T }) {
  const [hidden, setHidden] = useState<string[]>([])
  const [hover, setHover] = useState<string | null>(null)
  const fillId = useId()
  const active = tokenKeys.filter(key => !hidden.includes(key))
  const points = keys.map(key => series[key] ?? zeroTokens())
  const totals = points.map(point => active.reduce((sum, key) => sum + point[key], 0))
  const total = totals.reduce((sum, value) => sum + value, 0)
  const max = Math.max(1, ...totals)
  const x = (index: number) => index * 500 / Math.max(1, keys.length - 1)
  const y = (value: number) => 97 - 94 * value / max
  // The curve stays between adjacent samples, including when a period has no usage.
  const segments = totals.map((value, index) => {
    if (!index) return 'M0,' + y(value)
    const mid = (x(index - 1) + x(index)) / 2
    return 'C' + mid + ',' + y(totals[index - 1]) + ' ' + mid + ',' + y(value) + ' ' + x(index) + ',' + y(value)
  }).join(' ')
  const hovered = hover === null ? -1 : keys.indexOf(hover)
  return <section className="dd-feature dd-token-line" aria-labelledby="dd-line-title">
    <div className="dd-card-head"><div><h2 id="dd-line-title">{t('chartTokens')}</h2><strong className="dd-big" title={exact(total)}>{keys.length ? compact(total) : '—'}</strong></div>
      <details className="dd-data"><summary>{t('chartData')}</summary><div className="dd-table-scroll"><table>
        <thead><tr><th>{t('time')}</th>{tokenKeys.map(key => <th key={key}>{t(key)}</th>)}</tr></thead>
        <tbody>{keys.map((key, i) => <tr key={key}><th>{shortTime(key)}</th>{tokenKeys.map(type => <td key={type}>{exact(points[i][type])}</td>)}</tr>)}</tbody>
      </table></div></details>
    </div>
    <div className="dd-legend dd-token-legend">{tokenKeys.map(key => <button key={key} aria-pressed={!hidden.includes(key)}
      onClick={() => setHidden(list => list.includes(key) ? list.filter(value => value !== key) : [...list, key])}><i />{t(key)}</button>)}</div>
    {keys.length ? <Plot keys={keys} max={max}>
      <svg className="dd-line-plot" viewBox="0 0 500 100" preserveAspectRatio="none" role="group" aria-label={t('chartTokens')}>
        <defs><linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop stopColor="var(--dd-lime)" stopOpacity=".36" /><stop offset="1" stopColor="var(--dd-lime)" stopOpacity=".05" /></linearGradient></defs>
        <path d={segments + ' L500,100 L0,100Z'} fill={'url(#' + fillId + ')'} />
        <path d={segments} fill="none" stroke="var(--dd-lime-line)" strokeWidth="2.3" vectorEffect="non-scaling-stroke" />
        {hovered >= 0 && <line x1={x(hovered)} x2={x(hovered)} y1="0" y2="100" className="dd-crosshair" vectorEffect="non-scaling-stroke" />}
        {keys.map((key, index) => {
          const half = 250 / Math.max(1, keys.length - 1)
          const left = Math.max(0, x(index) - half)
          return <rect key={key} x={left} y="0" width={Math.min(500, x(index) + half) - left} height="100" fill="transparent" tabIndex={0}
            aria-label={key + ' · ' + exact(totals[index]) + ' tokens'} onFocus={() => setHover(key)} onBlur={() => setHover(null)}
            onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover(null)} onClick={() => setHover(key)}><title>{key + ' · ' + exact(totals[index]) + ' tokens'}</title></rect>
        })}
      </svg>
    </Plot> : <Empty t={t} />}
    <div className="dd-chart-readout">{hovered >= 0 ? shortTime(keys[hovered]) + ' · ' + exact(totals[hovered]) + ' tokens' : null}</div>
  </section>
}

export function StateChart({ rows, t, onSelect }: { rows: DashboardRow[]; t: T; onSelect: (status: Status) => void }) {
  const counts = statusOrder.map(status => ({ status, count: rows.filter(r => r.status === status).length })).filter(r => r.count)
  let offset = 0
  return rows.length ? <div className="dd-state-chart"><svg viewBox="0 0 200 200" role="img" aria-label={t('chartStatus')}>
    {counts.map(({ status, count }) => { const size = count / rows.length * 100, start = offset; offset += size; return <circle key={status} cx="100" cy="100" r="71" pathLength="100" fill="none" stroke={statusColors[status]} strokeWidth="21" strokeDasharray={`${size} ${100 - size}`} strokeDashoffset={-start} transform="rotate(-90 100 100)"><title>{t(status)} {count}</title></circle> })}
    <text x="100" y="100" textAnchor="middle" className="dd-donut-value">{rows.length}</text><text x="100" y="123" textAnchor="middle">{t('sessionsUnit')}</text>
  </svg><div className="dd-state-legend">{counts.map(({ status, count }) => <button key={status} onClick={() => onSelect(status)}><i style={{ background: statusColors[status] }} /><span>{t(status)}</span><strong>{count}</strong></button>)}</div></div> : <Empty t={t} />
}

export function ProgressChart({ rows, t, onSelect }: { rows: DashboardRow[]; t: T; onSelect: (id: string) => void }) {
  const shown = rows.filter(r => r.todos?.length).sort((a, b) => Number(b.running) - Number(a.running) || b.updatedAt - a.updatedAt).slice(0, 6)
  return shown.length ? <><div className="dd-legend dd-plain">{(['completed', 'in_progress', 'pending'] as const).map((s, i) => <span key={s}><i className={`dd-progress-${i}`} />{s === 'completed' ? t('complete') : t(s)}</span>)}</div>
    <div className="dd-bar-list">{shown.map(row => {
      const counts = ['completed', 'in_progress', 'pending'].map(s => row.todos!.filter(i => i.status === s).length)
      return <button key={row.id} onClick={() => onSelect(row.id)} className="dd-bar-row"><span className="dd-bar-label" title={row.title}>{row.title || row.id}</span><strong>{counts[0]} / {row.todos!.length}</strong><span className="dd-progress-track" aria-label={`${counts[0]} / ${row.todos!.length}`}>
        {counts.map((n, i) => <span key={i} className={`dd-progress-${i}`} style={{ width: `${n / row.todos!.length * 100}%` }} />)}
      </span></button>
    })}</div></> : <div className="dd-empty">{t('noChecklist')}</div>
}

export function RankingChart({ rows, t, mode, onSelect }: { rows: DashboardRow[]; t: T; mode: 'session' | 'project'; onSelect: (id: string) => void }) {
  const items = new Map<string, { id: string; name: string; tokens: number }>()
  for (const row of rows) {
    const id = mode === 'session' ? row.id : row.projectId, name = mode === 'session' ? row.title || row.id : row.project || t('noProject')
    const item = items.get(id) ?? { id, name, tokens: 0 }; item.tokens += tokenTotal(row.usage.tokens); items.set(id, item)
  }
  const ranked = [...items.values()].filter(r => r.tokens > 0).sort((a, b) => b.tokens - a.tokens).slice(0, 6), max = ranked[0]?.tokens ?? 1
  return ranked.length ? <div className="dd-bar-list dd-rank-list">{ranked.map((item, i) => <button key={item.id} className="dd-bar-row" onClick={() => onSelect(item.id)}><span className="dd-bar-label" title={item.name}><em>{i + 1}</em>{item.name}</span><strong title={exact(item.tokens)}>{compact(item.tokens)}</strong><span className="dd-rank-track"><span style={{ width: `${item.tokens / max * 100}%` }} /></span></button>)}</div> : <Empty t={t} />
}
