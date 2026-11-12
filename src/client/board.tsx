import { useLayoutEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { DashboardRow } from '../types.ts'
import { CountChart, MetricNumber, statusColors } from './charts.tsx'
import { tokenTotal } from '../fold.ts'
import { numberFormat } from './numbers.ts'
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
