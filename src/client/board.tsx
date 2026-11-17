import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { DashboardRow } from '../types.ts'
import { CountChart, MetricNumber, statusColors } from './charts.tsx'
import type { T } from './locales.ts'
import { attentionStates } from './data.ts'

export function StatusLabel({ row, t }: { row: DashboardRow; t: T }) {
  const action = row.ticket?.action
  const label = action === 'review' ? t('taskReview') : action === 'answer' ? t('taskAnswer') : action === 'delivery' ? t('taskDelivery') : t(row.status)
  return <span className="dd-status" style={{ '--dd-status-color': statusColors[row.status] } as CSSProperties}><i />{label}</span>
}

export function RecentSessions({ rows, ready, onSelect, t }: {
  rows: DashboardRow[]; ready: boolean; onSelect: (id: string) => void; t: T
}) {
  return <section className="dd-feature dd-recent" aria-labelledby="dd-recent-title">
    <div className="dd-card-head"><h2 id="dd-recent-title">{t('recentSessions')}</h2><span className="dd-count">{ready ? rows.length : '—'}</span></div>
    <div className="dd-recent-list">
      {rows.slice(0,4).map(row => <button key={row.id} onClick={()=>onSelect(row.id)} title={row.title || row.id}>
        <span className="dd-recent-icon" style={{'--dd-status-color':statusColors[row.status]} as CSSProperties}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {row.running ? <path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z"/> : attentionStates.has(row.status) ? <><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/></> : <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>}
          </svg>
        </span>
        <span className="dd-recent-copy"><strong>{row.title || row.id}</strong><small>{row.project || t('noProject')}</small></span>
        <StatusLabel row={row} t={t}/>
      </button>)}
      {!rows.length && <span className="dd-recent-empty">{t(ready?'noData':'loading')}</span>}
    </div>
    <div className="dd-recent-foot"><span><i style={{background:'var(--dd-green)'}}/>{t('running')} {rows.filter(r=>r.running).length}</span><span><i style={{background:'var(--dd-red)'}}/>{t('needAttention')} {rows.filter(r=>attentionStates.has(r.status)).length}</span></div>
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
