import { useState } from 'react'
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

export function CountChart({ series, keys, label, t }: { series: Record<string, number>; keys: string[]; label: string; t: T }) {
  const [hover, setHover] = useState<number | null>(null)
  if (!keys.length) return <Empty t={t} />
  const values = keys.map(key => series[key] ?? 0), max = Math.max(4, Math.ceil(Math.max(...values) / 4) * 4)
  const W = 500, H = 180, left = 40, right = 10, top = 12, bottom = 28, height = H - top - bottom, step = (W - left - right) / keys.length
  const short = (key: string) => key.includes('T') ? `${key.slice(-2)}:00` : key.slice(5)
  return <>
    <svg viewBox={`0 0 ${W} ${H}`} className="dd-area dd-count-chart" role="img" aria-label={label}>
      {[0, .5, 1].map(r => <g key={r}><line x1={left} x2={W - right} y1={top + height * (1 - r)} y2={top + height * (1 - r)} className="dd-gridline" /><text x={left - 8} y={top + height * (1 - r) + 4} textAnchor="end">{compact(max * r)}</text></g>)}
      {keys.map((key, i) => <g key={key}><rect x={left + i * step + step * .18} y={top + height * (1 - values[i] / max)} width={step * .64} height={height * values[i] / max} rx="2" fill="var(--dd-blue)" opacity={hover === i ? 1 : .72} />
        <rect x={left + i * step} y={top} width={step} height={height} fill="transparent" tabIndex={0} aria-label={`${key} · ${label} ${exact(values[i])}`} onFocus={() => setHover(i)} onBlur={() => setHover(null)} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}><title>{short(key)} · {exact(values[i])}</title></rect>
        {(i % Math.max(1, Math.ceil(keys.length / 6)) === 0 || i === keys.length - 1) && <text x={left + (i + .5) * step} y={H - 6} textAnchor="middle">{short(key)}</text>}
      </g>)}
    </svg>
    <div className="dd-chart-readout">{hover !== null ? `${short(keys[hover])} · ${exact(values[hover])}` : '\u00a0'}</div>
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
  const [hidden, setHidden] = useState<string[]>([]), [hover, setHover] = useState<number | null>(null)
  if (!keys.length) return <Empty t={t} />
  const active = tokenKeys.filter(k => !hidden.includes(k)), points = keys.map(k => series[k] ?? zeroTokens())
  const totals = points.map(p => active.reduce((sum, k) => sum + p[k], 0)), max = Math.max(...totals, 1)
  const W = 650, H = 212, left = 48, right = 12, top = 12, bottom = 27, width = W - left - right, height = H - top - bottom
  const x = (i: number) => left + width * i / Math.max(keys.length - 1, 1), y = (v: number) => top + height * (1 - v / max)
  let baseline = points.map(() => 0)
  const layers = active.map(k => {
    const low = baseline, high = points.map((p, i) => low[i] + p[k]); baseline = high
    return { k, path: `M${high.map((v, i) => `${x(i)},${y(v)}`).join(' L')} L${low.map((_, i) => `${x(low.length - 1 - i)},${y(low[low.length - 1 - i])}`).join(' L')}Z` }
  })
  const short = (key: string) => key.includes('T') ? `${key.slice(-2)}:00` : key.slice(5)
  return <>
    <div className="dd-legend">{tokenKeys.map(k => <button key={k} aria-pressed={!hidden.includes(k)} onClick={() => setHidden(h => h.includes(k) ? h.filter(v => v !== k) : [...h, k])}><i style={{ background: tokenColors[k] }} />{t(k)}</button>)}</div>
    <svg viewBox={`0 0 ${W} ${H}`} className="dd-area" role="img" aria-label={t('chartTokens')}>
      {[0, .25, .5, .75, 1].map(r => <g key={r}><line x1={left} x2={W - right} y1={y(max * r)} y2={y(max * r)} className="dd-gridline" /><text x={left - 9} y={y(max * r) + 4} textAnchor="end">{compact(max * r)}</text></g>)}
      {layers.map(({ k, path }) => <path key={k} d={path} fill={tokenColors[k]} opacity=".8" />)}
      {keys.map((key, i) => i % Math.max(1, Math.ceil(keys.length / 7)) === 0 || i === keys.length - 1 ? <text key={key} x={x(i)} y={H - 7} textAnchor={i === 0 ? 'start' : i === keys.length - 1 ? 'end' : 'middle'}>{short(key)}</text> : null)}
      {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={top} y2={H - bottom} className="dd-crosshair" />}
      {points.map((p, i) => <rect key={keys[i]} x={Math.max(left, x(i) - width / (keys.length - 1) / 2)} y={top} width={width / Math.max(keys.length - 1, 1) / (i === 0 || i === points.length - 1 ? 2 : 1)} height={height}
        fill="transparent" tabIndex={0} aria-label={`${keys[i]} · ${exact(tokenTotal(p))} tokens`} onFocus={() => setHover(i)} onBlur={() => setHover(null)} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}><title>{keys[i]} · {tokenKeys.map(k => `${t(k)} ${exact(p[k])}`).join(' · ')}</title></rect>)}
    </svg>
    <div className="dd-chart-readout">{hover !== null ? `${short(keys[hover])} · ${tokenKeys.map(k => `${t(k)} ${compact(points[hover][k])}`).join(' · ')}` : `${t('total')} ${exact(points.reduce((s, p) => s + tokenTotal(p), 0))} tokens`}</div>
    <details className="dd-data"><summary>{t('chartData')}</summary><div className="dd-table-scroll"><table><thead><tr><th>{t('time')}</th>{tokenKeys.map(k => <th key={k}>{t(k)}</th>)}</tr></thead><tbody>{keys.map((k, i) => <tr key={k}><th>{short(k)}</th>{tokenKeys.map(b => <td key={b}>{exact(points[i][b])}</td>)}</tr>)}</tbody></table></div></details>
  </>
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
