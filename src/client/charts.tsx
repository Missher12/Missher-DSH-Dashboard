import { useId, useState, type ReactNode, type CSSProperties } from 'react'
import { tokenTotal, zeroTokens } from '../fold.ts'
import type { DashboardRow, Status, Tokens } from '../types.ts'
import type { T } from './locales.ts'
import { tokenBands, tokenDistribution, usedTokenKeys } from './data.ts'
import { axisMaximum, numberFormat } from './numbers.ts'
import { curvePath } from './curve.ts'

export function MetricNumber({ value, unit, t }: { value: number | null; unit: string; t: T }) {
  if (value === null) return <strong className="dd-big">—</strong>
  const format = numberFormat(t('numberLocale'))
  const { number, scale } = format.parts(value)
  return <strong className="dd-big" title={format.exact(value) + ' ' + unit}>
    {number}<small>{[scale, unit].filter(Boolean).join(' ')}</small>
  </strong>
}

export const statusOrder: Status[] = ['running', 'approval', 'attention', 'queued', 'blocked', 'error', 'paused', 'idle', 'complete', 'stopped', 'unknown']
export const statusColors: Record<Status, string> = { running: 'var(--dd-green)', approval: 'var(--dd-red)', attention: 'var(--dd-red)', queued: 'var(--dd-purple)', blocked: 'var(--dd-red)', error: 'var(--dd-red)', paused: 'var(--dd-muted)', idle: 'var(--dd-blue)', complete: 'var(--dd-green)', stopped: 'var(--dd-muted)', unknown: 'var(--dd-red)' }
const tokenColors = { uncachedInput: 'var(--dd-blue)', cacheRead: 'var(--dd-teal)', cacheWrite: 'var(--dd-purple)', output: 'var(--dd-amber)' }
export function Empty({ t }: { t: T }) { return <div className="dd-empty">{t('noData')}</div> }

export function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1)
  const path = curvePath(values.map((value, i) => [i / Math.max(values.length - 1, 1) * 100, 22 - value / max * 20]))
  return <svg className="dd-mini dd-sparkline" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">{path && <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}</svg>
}

export function MiniProgress({ value, total, ring = false }: { value: number; total: number; ring?: boolean }) {
  const amount = total ? Math.min(100, value / total * 100) : 0
  if (ring) return <span className="dd-mini-ring" aria-hidden="true" style={{visibility:total?'visible':'hidden','--dd-progress':amount+'%'} as CSSProperties}><b>{Math.round(amount)}%</b></span>
  return <span className="dd-completion" aria-hidden="true" style={{ visibility: total ? 'visible' : 'hidden' }}>
    <small>{Math.round(amount)}%</small><span className="dd-mini-progress"><i style={{ width: amount + '%' }} /></span>
  </span>
}

export function TokenMixChart({ tokens, reported, t }: { tokens: Tokens; reported: number; t: T }) {
  const { compact, exact, percent } = numberFormat(t('numberLocale'))
  const total = tokenTotal(tokens)
  if (!total) return <div className="dd-empty">{reported ? '0 Token' : t('noUsage')}</div>
  const used = usedTokenKeys(tokens)
  return <div className="dd-token-mix">
    <div className="dd-mix-bar" role="img" aria-label={used.map(key => `${t(key)} ${exact(tokens[key])}`).join(' · ')}>
      {used.map(key => <span key={key} style={{ width: `${tokens[key] / total * 100}%`, background: tokenColors[key] }} title={`${t(key)} ${exact(tokens[key])}`} />)}
    </div>
    <div className="dd-mix-legend">{used.map(key => <div key={key} title={exact(tokens[key])}><span><i style={{ background: tokenColors[key] }} />{t(key)}</span><strong>{compact(tokens[key])}</strong><small>{percent(tokens[key] / total)}</small></div>)}</div>
  </div>
}

const shortTime = (key: string) => key.includes('T') ? key.slice(-2) + ':00' : key.slice(5)

function Plot({ keys, max, bars = false, children, t }: { keys: string[]; max: number; bars?: boolean; children: ReactNode; t: T }) {
  const { compact } = numberFormat(t('numberLocale'))
  const last = keys.length - 1
  const tickCount = keys.length === 7 ? 7 : Math.min(5, keys.length)
  const ticks = Array.from({ length: tickCount }, (_, i) => Math.round(i * last / Math.max(1, tickCount - 1)))
  return <div className="dd-plot">
    <div className="dd-y-axis" aria-hidden="true">{[1, .5, 0].map(fraction => <span key={fraction}>{compact(max * fraction)}</span>)}</div>
    <div className="dd-plot-field">{children}</div>
    <div className="dd-x-axis" aria-hidden="true">{ticks.map(index => {
      const percent = bars ? (index + .5) / keys.length : index / Math.max(1, last)
      return <span key={index} data-edge={bars ? undefined : index === 0 ? 'first' : index === last ? 'last' : undefined} style={{ left: String(percent * 100) + '%' }}>{shortTime(keys[index])}</span>
    })}</div>
  </div>
}

function TrendReadout({ keys, values, hover, unit, t }: { keys: string[]; values: number[]; hover: string | null; unit: string; t: T }) {
  const { compact, exact } = numberFormat(t('numberLocale'))
  const selected = hover === null ? -1 : keys.indexOf(hover)
  const peak = Math.max(0, ...values)
  const index = selected >= 0 ? selected : peak ? values.indexOf(peak) : -1
  return <div className="dd-chart-readout">{index >= 0 && <>
    <span>{selected >= 0 ? shortTime(keys[index]) : t('peak')}</span>
    <strong title={exact(values[index])}>{selected >= 0 ? exact(values[index]) : compact(values[index])} {unit}</strong>
    {selected < 0 && <time>{shortTime(keys[index])}</time>}
  </>}</div>
}

export function CountChart({ series, keys, label, unit, t }: { series: Record<string, number>; keys: string[]; label: string; unit: string; t: T }) {
  const [hover, setHover] = useState<string | null>(null)
  if (!keys.length) return <Empty t={t} />
  const { compact, exact } = numberFormat(t('numberLocale'))
  const values = keys.map(key => series[key] ?? 0)
  const max = axisMaximum(Math.max(...values))
  return <>
    <Plot keys={keys} max={max} bars t={t}>
      <div className="dd-columns" role="group" aria-label={label}>
        {keys.map((key, index) => {
          const value = values[index]
          const height = String(value / max * 100) + '%'
          return <button key={key} className="dd-column" aria-label={shortTime(key) + ' · ' + label + ' ' + exact(value)}
            onFocus={() => setHover(key)} onBlur={() => setHover(null)} onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover(null)} onClick={() => setHover(key)}>
            <i className="dd-bar-fill" style={{ height }} />
            {keys.length <= 7 && value > 0 && <span className="dd-bar-value" data-inside={value / max >= .88} style={{ bottom: value / max >= .88 ? 'calc(' + height + ' - 16px)' : 'calc(' + height + ' + 3px)' }}>{compact(value)}</span>}
          </button>
        })}
      </div>
    </Plot>
    <TrendReadout keys={keys} values={values} hover={hover} unit={unit} t={t} />
  </>
}

export function DistributionChart({ rows, t }: { rows: DashboardRow[]; t: T }) {
  const { compact } = numberFormat(t('numberLocale'))
  const counts = tokenDistribution(rows), total = counts.reduce((sum, count) => sum + count, 0), max = Math.max(...counts, 1)
  if (!total) return <Empty t={t} />
  return <div className="dd-bar-list dd-distribution">{counts.map((count, i) => {
    const label = i === 0 ? `< ${compact(tokenBands[1])}` : i === tokenBands.length - 1 ? `≥ ${compact(tokenBands[i])}` : `${compact(tokenBands[i])} – < ${compact(tokenBands[i + 1])}`
    return <div key={i} className="dd-bar-row" title={`${label} tokens · ${count} ${t('sessionsUnit')} · ${(count / total * 100).toFixed(1)}%`}><span className="dd-bar-label">{label}</span><strong>{count} <small>{t('sessionsUnit')}</small></strong><span className="dd-rank-track"><span style={{ width: `${count / max * 100}%` }} /></span></div>
  })}</div>
}

export function TokenChart({ series, keys, tokens, reported, t }: { series: Record<string, Tokens>; keys: string[]; tokens: Tokens; reported: number; t: T }) {
  const { exact } = numberFormat(t('numberLocale'))
  const [hidden, setHidden] = useState<string[]>([])
  const [hover, setHover] = useState<string | null>(null)
  const fillId = useId()
  const used = usedTokenKeys(tokens)
  const active = used.filter(key => !hidden.includes(key))
  const points = keys.map(key => series[key] ?? zeroTokens())
  const totals = points.map(point => active.reduce((sum, key) => sum + point[key], 0))
  const total = totals.reduce((sum, value) => sum + value, 0)
  const max = axisMaximum(Math.max(0, ...totals))
  const x = (index: number) => index * 500 / Math.max(1, keys.length - 1)
  const y = (value: number) => 100 - 100 * value / max
  const segments = curvePath(totals.map((value, index) => [x(index), y(value)]))
  const hovered = hover === null ? -1 : keys.indexOf(hover)
  const marker = hovered >= 0 ? hovered : totals.indexOf(Math.max(...totals))
  return <section className="dd-feature dd-token-line" aria-labelledby="dd-line-title">
    <div className="dd-card-head"><div><h2 id="dd-line-title">{t('chartTokens')}</h2><MetricNumber value={reported ? total : null} unit="Token" t={t} /></div>
      {used.length > 0 && <details className="dd-data"><summary>{t('chartData')}</summary><div className="dd-table-scroll"><table>
        <thead><tr><th>{t('time')}</th>{used.map(key => <th key={key}>{t(key)}</th>)}</tr></thead>
        <tbody>{keys.map((key, i) => <tr key={key}><th>{shortTime(key)}</th>{used.map(type => <td key={type}>{exact(points[i][type])}</td>)}</tr>)}</tbody>
      </table></div></details>}
    </div>
    <div className="dd-legend dd-token-legend">{used.map(key => <button key={key} disabled={!reported} aria-pressed={!hidden.includes(key)}
      onClick={() => setHidden(list => list.includes(key) ? list.filter(value => value !== key) : [...list, key])}><i style={{ background: tokenColors[key] }} />{t(key)}</button>)}</div>
    {reported > 0 && keys.length ? <Plot keys={keys} max={max} t={t}>
      <svg className="dd-line-plot" viewBox="0 0 500 100" preserveAspectRatio="none" role="group" aria-label={t('chartTokens')}>
        <defs><linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop stopColor="var(--dd-accent)" stopOpacity=".22" /><stop offset="1" stopColor="var(--dd-accent)" stopOpacity=".008" /></linearGradient></defs>
        <path d={segments + ' L500,100 L0,100Z'} fill={'url(#' + fillId + ')'} />
        <path d={segments} fill="none" stroke="var(--dd-accent)" strokeWidth="2.6" vectorEffect="non-scaling-stroke" />
        {marker >= 0 && <line x1={x(marker)} x2={x(marker)} y1="0" y2="100" className="dd-crosshair" vectorEffect="non-scaling-stroke" />}
        {keys.map((key, index) => {
          const half = 250 / Math.max(1, keys.length - 1)
          const left = Math.max(0, x(index) - half)
          return <rect key={key} x={left} y="0" width={Math.min(500, x(index) + half) - left} height="100" fill="transparent" tabIndex={0}
            aria-label={key + ' · ' + exact(totals[index]) + ' tokens'} onFocus={() => setHover(key)} onBlur={() => setHover(null)}
            onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover(null)} onClick={() => setHover(key)}><title>{key + ' · ' + exact(totals[index]) + ' tokens'}</title></rect>
        })}
      </svg>
    </Plot> : <div className="dd-empty">{keys.length ? t('noUsage') : t('loading')}</div>}
    <TrendReadout keys={keys} values={totals} hover={reported ? hover : null} unit="Token" t={t} />
  </section>
}

export function StateChart({ rows, t }: { rows: DashboardRow[]; t: T }) {
  const counts = statusOrder.map(status => ({ status, count: rows.filter(r => r.status === status).length })).filter(r => r.count)
  let offset = 0
  return rows.length ? <div className="dd-state-chart"><svg viewBox="0 0 200 200" role="img" aria-label={t('chartStatus')}>
    {counts.map(({ status, count }) => { const size = count / rows.length * 100, start = offset; offset += size; return <circle key={status} cx="100" cy="100" r="71" pathLength="100" fill="none" stroke={statusColors[status]} strokeWidth="21" strokeDasharray={`${size} ${100 - size}`} strokeDashoffset={-start} transform="rotate(-90 100 100)"><title>{t(status)} {count}</title></circle> })}
    <text x="100" y="100" textAnchor="middle" className="dd-donut-value">{rows.length}</text><text x="100" y="123" textAnchor="middle">{t('sessionsUnit')}</text>
  </svg><div className="dd-state-legend">{counts.map(({ status, count }) => <div key={status}><i style={{ background: statusColors[status] }} /><span>{t(status)}</span><strong>{count}</strong></div>)}</div></div> : <Empty t={t} />
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
  const { compact, exact } = numberFormat(t('numberLocale'))
  const items = new Map<string, { id: string; name: string; tokens: number }>()
  for (const row of rows) {
    if (row.unavailable || !row.usage.reported) continue
    const id = mode === 'session' ? row.id : row.projectId, name = mode === 'session' ? row.title || row.id : row.project || t('noProject')
    const item = items.get(id) ?? { id, name, tokens: 0 }; item.tokens += tokenTotal(row.usage.tokens); items.set(id, item)
  }
  const ranked = [...items.values()].filter(r => r.tokens > 0).sort((a, b) => b.tokens - a.tokens).slice(0, 6), max = ranked[0]?.tokens ?? 1
  return ranked.length ? <div className="dd-bar-list dd-rank-list">{ranked.map((item, i) => <button key={item.id} className="dd-bar-row" onClick={() => onSelect(item.id)}><span className="dd-bar-label" title={item.name}><em>{i + 1}</em>{item.name}</span><strong title={exact(item.tokens)}>{compact(item.tokens)}</strong><span className="dd-rank-track"><span style={{ width: `${item.tokens / max * 100}%` }} /></span></button>)}</div> : <Empty t={t} />
}
