import { Fragment, useLayoutEffect, useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import type { DashboardRow, Tokens } from '../types.ts'
import { CountChart, MetricNumber, statusColors } from './charts.tsx'
import { tokenTotal } from '../fold.ts'
import { numberFormat } from './numbers.ts'
import { usedTokenKeys, type tokenHeatmap } from './data.ts'
import type { T } from './locales.ts'

export function StatusLabel({ row, t }: { row: DashboardRow; t: T }) {
  const action = row.ticket?.action
  const label = action === 'review' ? t('taskReview') : action === 'answer' ? t('taskAnswer') : action === 'delivery' ? t('taskDelivery') : t(row.status)
  return <span className="dd-status" style={{ '--dd-status-color': statusColors[row.status] } as CSSProperties}><i />{label}</span>
}

export function SessionDeck({ rows, ready, projectControl, onSelect, t }: {
  rows: DashboardRow[]; ready: boolean; projectControl: ReactNode; onSelect: (id: string) => void; t: T
}) {
  const { compact, exact } = numberFormat(t('numberLocale'))
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(rows.length / 4))
  const current = Math.min(page, pageCount - 1)
  useLayoutEffect(() => { if (page !== current) setPage(current) }, [page, current])
  return <section className="dd-feature dd-deck" aria-labelledby="dd-deck-title">
    <div className="dd-card-head">
      <div><h2 id="dd-deck-title">{t('regularSessions')}</h2><MetricNumber value={ready ? rows.length : null} unit={t('sessionsUnit')} t={t} /></div>
      {projectControl}
    </div>
    <div className="dd-deck-items">
      {rows.slice(current * 4, current * 4 + 4).map(row => {
        const project = row.project || t('noProject')
        const usage = row.usage.reported > 0 && !row.unavailable ? tokenTotal(row.usage.tokens) : null
        return <button key={row.id} className="dd-session-tile" onClick={() => onSelect(row.id)} title={row.title || row.id}>
          <span className="dd-tile-copy"><strong>{row.title || row.id}</strong><small>{project}</small></span>
          <span className="dd-tile-foot">
            <StatusLabel row={row} t={t} />
            <span className="dd-tile-tokens" title={usage === null ? t('noUsage') : exact(usage) + ' Token'}>
              {usage === null ? '—' : <>{compact(usage)} <small>Token</small></>}
            </span>
          </span>
        </button>
      })}
      {!rows.length && <div className="dd-deck-empty">{t(ready ? 'noData' : 'loading')}</div>}
    </div>
    <nav className="dd-deck-pager" aria-label={t('cardPages')}>
      <button className="dd-button" disabled={!current} onClick={() => setPage(current - 1)}>← {t('previousPage')}</button>
      <span aria-live="polite">{current + 1} / {pageCount}</span>
      <button className="dd-button" disabled={current + 1 >= pageCount} onClick={() => setPage(current + 1)}>{t('nextPage')} →</button>
    </nav>
  </section>
}

export function ActivityTrend({ tools, active, toolsTotal, activeTotal, keys, t }: {
  tools: Record<string, number>; active: Record<string, number>; toolsTotal: number; activeTotal: number; keys: string[]; t: T
}) {
  const [mode, setMode] = useState<'tools' | 'sessions'>('tools')
  const showTools = mode === 'tools'
  const label = t(showTools ? 'chartTools' : 'chartActivity')
  const unit = t(showTools ? 'countCalls' : 'sessionsUnit')
  return <section className="dd-feature dd-volume" aria-label={label}>
    <div className="dd-card-head">
      <div><h2>{label}</h2><MetricNumber value={keys.length ? (showTools ? toolsTotal : activeTotal) : null} unit={unit} t={t} /></div>
      <div className="dd-segmented" role="group" aria-label={t('trendMetric')}>
        <button aria-pressed={showTools} onClick={() => setMode('tools')}>{t('toolCalls')}</button>
        <button aria-pressed={!showTools} onClick={() => setMode('sessions')}>{t('activeSessions')}</button>
      </div>
    </div>
    <CountChart series={showTools ? tools : active} keys={keys} label={label} unit={unit} t={t} />
  </section>
}

export function UsageHeatmap({ heat, tokens, t }: {
  heat: ReturnType<typeof tokenHeatmap>; tokens: Tokens; t: T
}) {
  const { exact, compact } = numberFormat(t('numberLocale'))
  const weekdays = t('weekdayNames').split('|')
  const [focused, setFocused] = useState(0)
  const [reading, setReading] = useState<number | null>(null)
  const peak = Math.max(0, ...heat.cells.map(value => value ?? 0))
  const describe = (index: number) => {
    const value = heat.cells[index]
    return weekdays[Math.floor(index / 24)] + ' ' + String(index % 24).padStart(2, '0') + ':00 · ' + (value === null ? t('noUsage') : exact(value) + ' Token')
  }
  const move = (event: KeyboardEvent<HTMLButtonElement>, cell: number) => {
    const rowStart = Math.floor(cell / 24) * 24
    let next: number
    switch (event.key) {
      case 'ArrowLeft': next = Math.max(rowStart, cell - 1); break
      case 'ArrowRight': next = Math.min(rowStart + 23, cell + 1); break
      case 'ArrowUp': next = Math.max(cell % 24, cell - 24); break
      case 'ArrowDown': next = Math.min(144 + cell % 24, cell + 24); break
      case 'Home': next = rowStart; break
      case 'End': next = rowStart + 23; break
      default: return
    }
    event.preventDefault()
    event.currentTarget.closest('.dd-heat-grid')?.querySelector<HTMLButtonElement>('[data-cell="' + next + '"]')?.focus({ preventScroll: true })
  }
  return <section className="dd-feature dd-heat-card" aria-labelledby="dd-heat-title">
    <div className="dd-card-head"><div><h2 id="dd-heat-title" title={t('heatHint')}>{t('heatTitle')}</h2>
      <MetricNumber value={heat.total} unit="Token" t={t} /></div>
    </div>
    <dl className="dd-heat-facts">{usedTokenKeys(tokens).map(key =>
      <div key={key}><dt>{t(key)}</dt><dd title={exact(tokens[key]) + ' Token'}>{compact(tokens[key])}</dd></div>)}</dl>
    <div className="dd-heat-grid" role="group" aria-label={t('heatHint')} onMouseLeave={() => setReading(null)}>
      {weekdays.map((name, day) => <Fragment key={name}>
        <span className="dd-heat-day">{name}</span>
        {heat.cells.slice(day * 24, day * 24 + 24).map((count, hour) => {
          const cell = day * 24 + hour
          const level = count === null ? 'missing' : count === 0 ? 0 : Math.ceil(Math.sqrt(count / peak) * 4)
          return <button key={cell} type="button" className={'dd-heat-cell dd-heat-' + level} data-cell={cell}
            aria-label={describe(cell)} title={describe(cell)} tabIndex={cell === focused ? 0 : -1}
            onFocus={() => { setFocused(cell); setReading(cell) }} onBlur={() => setReading(null)}
            onMouseEnter={() => setReading(cell)} onClick={() => setReading(cell)} onKeyDown={event => move(event, cell)} />
        })}
      </Fragment>)}
      {[0, 6, 12, 18, 23].map(hour => <span key={hour} className="dd-heat-hour" style={{ gridColumn: hour + 2 }}>{String(hour).padStart(2, '0')}</span>)}
    </div>
    <div className="dd-heat-foot"><span>{reading !== null ? describe(reading) : peak ? t('peak') + ' · ' + describe(heat.cells.indexOf(peak)) : heat.total === null ? t('noUsage') : '0 Token'}</span><span className="dd-heat-scale" aria-hidden="true">{t('less')}{[0,1,2,3,4].map(n => <i key={n} className={'dd-heat-' + n} />)}{t('more')}</span></div>
  </section>
}
