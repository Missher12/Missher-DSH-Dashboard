import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { addUsage, calendar, tokenKeys, tokenTotal, zeroTokens, zeroUsage } from '../fold.ts'
import type { ReactNode } from 'react'
import type { Snapshot, Tokens, DashboardRow } from '../types.ts'
import { TokenChart, Sparkline, MiniProgress } from './charts.tsx'
import { acceptSnapshot, attentionStates, retainRowOrder, type SnapshotData } from './data.ts'
import { RecentSessions } from './board.tsx'
import type { T } from './locales.ts'
import { numberFormat } from './numbers.ts'
import { UsageStatistics } from './usage-stats.tsx'
import { PluginCards, useLayoutPreference, usePluginCards } from './customize.tsx'
import { useGlassRefraction } from './glass.tsx'
import { superagentPackage, type DashboardLayout, type PluginCard } from '../layout.ts'

const completedGoal = (row: DashboardRow) => row.ticket ? row.ticket.stage === 'ended' && ['completed', 'merged'].includes(row.ticket.outcome ?? '') : row.goal?.phase === 'complete'
// Reopening a panel or a visited range can paint immediately while fresh data is fetched.
const snapshots = new Map<number, SnapshotData>()
type AppProps = { t: T; openSession: (id: string) => Promise<void>; openPlugin?: (id: string) => void }
const date = (time: number, timeZone?: string) => new Intl.DateTimeFormat(undefined, { timeZone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(time)
function Ratio({ done, total }: { done: number; total: number }) {
  return total ? <>{done}<small> / {total}</small></> : <>—</>
}
function Summary({ label, value, hint, tone, children }: {
  label: string; value: ReactNode; hint: string; tone?: 'running' | 'attention'; children?: ReactNode
}) {
  return <div className="dd-stat" title={hint}>
    <span className="dd-stat-label">{tone && <i className={'dd-dot-' + tone} />}{label}</span>
    <strong className="dd-stat-value">{value}</strong>{children}<span className="dd-stat-hint">{hint}</span>
  </div>
}
export function App({ t, openSession, openPlugin }: AppProps) {
  const layout = useLayoutPreference()
  const toolbarGlass = useGlassRefraction()
  const selectedCards = layout.plugins.filter(id => id !== superagentPackage)
  const inventory = usePluginCards(selectedCards)
  const cards = selectedCards.flatMap(id => inventory?.filter(card => card.id === id) ?? [])
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(() => snapshots.get(7) ?? null)
  const [days, setDays] = useState(7), [archived, setArchived] = useState(false)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const request = useRef<AbortController | null>(null), manual = useRef(false), timer = useRef<ReturnType<typeof setTimeout>>()
  const refreshSnapshot = useCallback(async function run(force = false) {
    if (force ? manual.current : request.current) return
    if (force) {
      request.current?.abort()
      manual.current = true
      setBusy(true)
    }
    clearTimeout(timer.current)
    const controller = new AbortController()
    request.current = controller
    let delay = 5000
    try {
      const response = await fetch(`/dsh-dashboard/api/snapshot?days=${days}${force ? '&refresh=1' : ''}`, { headers: { 'x-dsh-dashboard': '1' }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) })
      if (!response.ok) throw new Error('Snapshot request failed')
      const next = await response.json() as SnapshotData
      if (!Array.isArray(next.rows)) throw new Error('Invalid snapshot')
      if (request.current !== controller) return
      setSnapshot(previous => { const accepted = acceptSnapshot(previous, next); snapshots.set(days, accepted); return accepted })
      setError('')
      if (next.scanning) delay = 250
      else {
        manual.current = false
        setBusy(false)
      }
    } catch {
      if (request.current === controller) {
        setError('readFailed')
        manual.current = false
        setBusy(false)
      }
    } finally {
      if (request.current === controller) {
        request.current = null
        timer.current = setTimeout(() => { if (document.visibilityState === 'visible') void run() }, delay)
      }
    }
  }, [days])
  useEffect(() => {
    manual.current = false
    setBusy(false)
    void refreshSnapshot()
    const visible = () => { if (document.visibilityState === 'visible') void refreshSnapshot() }
    document.addEventListener('visibilitychange', visible)
    return () => { clearTimeout(timer.current); request.current?.abort(); request.current = null; document.removeEventListener('visibilitychange', visible) }
  }, [refreshSnapshot])
  const refresh = useCallback(() => { void refreshSnapshot(true) }, [refreshSnapshot])
  const rangePending = !!snapshot && snapshot.days !== days
  const notice = [error || snapshot?.readError ? t('readFailed') : '', snapshot?.cacheError ? t('cacheSaveFailed') : '', snapshot?.failedSessions ? `${t('partial')} · ${snapshot.failedSessions}` : ''].filter(Boolean).join(' · ')
  let latest: ReactNode = t('loading')
  if (!rangePending && snapshot?.dataReady) {
    latest = <>{t(snapshot.cachedAt ? 'cachedResult' : 'lastRefresh')} {date(snapshot.generatedAt, snapshot.timeZone)}
      <span className="dd-refresh-state">{snapshot.scanning ? t('backgroundRefresh') : ''}</span></>
  } else if (!rangePending && snapshot?.scanning) {
    latest = <>{t('scanning')} {snapshot.scanned}/{snapshot.totalSessions || '…'}</>
  }
  const renderHeader = (projectControl: ReactNode) => (<header className="dd-header">
      <div className="dd-heading">
        <h1>{t('panel')}</h1>
        <div className="dd-meta"><span role={notice ? 'alert' : 'status'} className={notice ? 'dd-error' : undefined} title={notice || snapshot?.timeZone}>{notice || latest}</span></div>
      </div>
      <div ref={toolbarGlass.ref} className="dd-controls dd-toolbar" role="group" aria-label={t('panel')}>
        {toolbarGlass.optics}{projectControl}
        <label className="dd-check"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />{t('showArchived')}</label>
        <div className="dd-segmented dd-range" role="group" aria-label={t('range')}>
          {([1, 7, 30] as const).map(value => <button key={value} type="button" aria-pressed={days === value} onClick={() => {
            setDays(value)
            setSnapshot(snapshots.get(value) ?? snapshot)
          }}>{t(value === 1 ? 'today' : value === 7 ? 'week' : 'month')}</button>)}
        </div>
        <button type="button" className="dd-button dd-toolbar-refresh" aria-label={t('refresh')} title={t('refresh')}
          onClick={refresh} disabled={busy} aria-busy={busy}><svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true"><path d="M12.8 6A5 5 0 1 0 13 9M13 2v4H9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
      </div>
    </header>)
  return <main className="dd-page" aria-busy={!snapshot || !snapshot.dataReady && snapshot.scanning || rangePending}>
    <SessionSection renderHeader={renderHeader} refresh={refresh} busy={busy} snapshot={snapshot} archived={archived} t={t}
      openSession={openSession} openPlugin={openPlugin} layout={layout} cards={cards} />
  </main>
}
function SessionSection({ snapshot, archived, t, openSession, openPlugin, refresh, busy, renderHeader, layout, cards }: AppProps & {
  snapshot: Snapshot | null; archived: boolean; refresh: () => void; busy: boolean; renderHeader: (project: ReactNode) => ReactNode
  layout: DashboardLayout; cards: PluginCard[]
}) {
  const [project, setProject] = useState('')
  const [projectLabel, setProjectLabel] = useState('')
  const [error, setError] = useState(false)
  const rowOrder = useRef<string[]>([])
  const selectProject = (id: string) => { setProject(id); setProjectLabel(data.projects.get(id) ?? projectLabel) }
  const actualDays = snapshot?.days ?? 7
  const data = useMemo(() => {
    const hourOf = calendar(snapshot?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
    const rows = (snapshot?.rows ?? []).filter(row => {
      const inRange = hourOf(row.updatedAt).slice(0, 10) >= (snapshot?.fromDate ?? '')
      return (archived || !row.archived) && (inRange || row.running || attentionStates.has(row.status) || row.status === 'queued' || row.goal?.phase === 'active')
        && (row.title || row.running || row.goal || row.ticket || row.unavailable || row.usage.reported || row.usage.missing)
    })
    const regular = retainRowOrder(rows.filter(row => row.kind !== 'superagent'), rowOrder.current)
    const scoped = regular.filter(row => !project || row.projectId === project)
    const projects = new Map(regular.map(row => [row.projectId, row.project || t('noProject')]))
    const usage = zeroUsage(), series: Record<string, Tokens> = {}
    for (const row of scoped) {
      if (row.unavailable) continue
      addUsage(usage, row.usage)
      for (const [key, tokens] of Object.entries(row.series)) { const bucket = series[key] ??= zeroTokens(); for (const k of tokenKeys) bucket[k] += tokens[k] }
    }
    const goals = scoped.filter(r => r.goal || r.ticket)
    const complete = goals.filter(completedGoal).length
    const superagentRows = rows.filter(row => row.kind === 'superagent'), superagentUsage = zeroUsage(), superagentSeries: Record<string, number> = {}
    for (const row of superagentRows) {
      if (row.unavailable) continue
      addUsage(superagentUsage, row.usage)
      for (const [key, tokens] of Object.entries(row.series)) superagentSeries[key] = (superagentSeries[key] ?? 0) + tokenTotal(tokens)
    }
    const superagentGoals = superagentRows.filter(row => row.goal || row.ticket)
    const superagent = { rows: superagentRows, usage: superagentUsage, series: superagentSeries, goals: superagentGoals, complete: superagentGoals.filter(completedGoal).length }
    return { regular, scoped, projects, usage, series, goals, complete, superagent }
  }, [snapshot, project, archived, t])
  useLayoutEffect(() => { rowOrder.current = data.regular.map(row => row.id) }, [data.regular])
  const keys = useMemo(() => {
    if (!snapshot) return []
    if (actualDays === 1) return Array.from({ length: 24 }, (_, i) => `${snapshot.today}T${String(i).padStart(2, '0')}`)
    return Array.from({ length: actualDays }, (_, i) => new Date(Date.parse(`${snapshot.fromDate}T12:00:00Z`) + i * 86400000).toISOString().slice(0, 10))
  }, [snapshot?.today, snapshot?.fromDate, actualDays])
  const selectSession = async (id: string) => {
    try { await openSession(id) } catch { setError(true) }
  }
  const rangeLabel = t(actualDays === 1 ? 'today' : actualDays === 7 ? 'week' : 'month')
  const { compact } = numberFormat(t('numberLocale'))
  const title = t('regularSessions'), superagent = data.superagent
  const superagentReady = layout.plugins.includes(superagentPackage) && (snapshot?.superagent === 'available' || snapshot?.superagent === 'partial')
  const showRecent = layout.sections.includes('recent')
  const promptTokens = data.usage.tokens.uncachedInput + data.usage.tokens.cacheRead + data.usage.tokens.cacheWrite
  return <div className="dd-overview">
    {renderHeader(
      <label className="dd-select">
        <span className="dd-visually-hidden">{title} · {t('project')}</span>
        <select id="dd-project" value={project} onChange={event => selectProject(event.target.value)}>
          <option value="">{t('allProjects')}</option>
          {project && !data.projects.has(project) && <option value={project}>{projectLabel || project}</option>}
          {[...data.projects].sort((a, b) => a[1].localeCompare(b[1])).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>)}
    {error && <p className="dd-notice dd-error" role="alert">{t('openError')}</p>}
    <section className="dd-stats" aria-label={t('sessionOverview')}>
      <Summary tone="running" label={t('running')} value={snapshot ? <>{data.scoped.filter(r=>r.running).length}<small> / {data.scoped.length}</small></> : '—'} hint={t('liveNow')} />
      <Summary label={t('completed')} value={<Ratio done={data.complete} total={data.goals.length}/>} hint={t('goalsCount')}><MiniProgress value={data.complete} total={data.goals.length}/></Summary>
      <Summary tone="attention" label={t('needAttention')} value={snapshot ? String(data.scoped.filter(r=>attentionStates.has(r.status)).length) : '—'} hint={t('liveNow')} />
      <Summary label={t('cache')} value={data.usage.reported && promptTokens ? numberFormat(t('numberLocale')).percent(data.usage.tokens.cacheRead/promptTokens) : '—'} hint={t('cacheRatio')}>
        {data.usage.reported > 0 && promptTokens > 0 && <MiniProgress value={data.usage.tokens.cacheRead} total={promptTokens} />}
      </Summary>
    </section>
    <div className={showRecent ? 'dd-board' : 'dd-board dd-without-recent'}>
      <TokenChart series={data.series} keys={keys} tokens={data.usage.tokens} reported={data.usage.reported} t={t} />
      {showRecent && <RecentSessions rows={data.scoped} ready={!!snapshot} onSelect={selectSession} t={t} />}
      {layout.sections.includes('usage') && <UsageStatistics history={snapshot?.usageHistory} today={snapshot?.today} zone={snapshot?.timeZone} project={project} archived={archived} t={t} refresh={refresh} busy={busy} />}
    </div>
    {superagentReady && <section className="dd-superagent" aria-labelledby="dd-superagent-title">
      <div className="dd-section-head"><h2 id="dd-superagent-title">{t('superagent')}</h2><span>{rangeLabel}</span></div>
      <div className="dd-superagent-cards">
        <Summary tone="running" label={t('running')} value={String(superagent.rows.filter(row => row.running).length)} hint={t('liveNow')} />
        <Summary tone="attention" label={t('needAttention')} value={String(superagent.rows.filter(row => attentionStates.has(row.status)).length)} hint={t('liveNow')} />
        <Summary label={t('taskCompleted')} value={<Ratio done={superagent.complete} total={superagent.goals.length} />} hint={t('goalsCount')}><MiniProgress ring value={superagent.complete} total={superagent.goals.length} /></Summary>
        <Summary label={t('tokens')} value={superagent.usage.reported ? compact(tokenTotal(superagent.usage.tokens)) : '—'} hint={t('reportedOnly')}><Sparkline values={superagent.usage.reported ? keys.map(key => superagent.series[key] ?? 0) : []} /></Summary>
      </div>
      <p className="dd-source-notice" role="status">{snapshot?.superagent === 'partial' ? t('sourcePartial') : '\u00a0'}</p>
    </section>}
    <PluginCards cards={cards} openPlugin={openPlugin} t={t} />
  </div>
}
