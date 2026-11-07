import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { addUsage, calendar, tokenKeys, tokenTotal, zeroTokens, zeroUsage } from '../fold.ts'
import type { DashboardRow, Snapshot, Status, Tokens } from '../types.ts'
import { compact, exact, ProgressChart, RankingChart, StateChart, statusOrder, TokenChart } from './charts.tsx'
import type { T, zh } from './locales.ts'

const attentionStates = new Set<Status>(['approval', 'attention', 'blocked', 'error', 'unknown'])
const priority = (row: DashboardRow) => row.running ? 0 : attentionStates.has(row.status) ? 1 : row.status === 'queued' ? 2 : 3
const rowTitle = (row: DashboardRow) => row.title || row.id
const completedGoal = (row: DashboardRow) => row.ticket ? row.ticket.stage === 'ended' && ['completed', 'merged'].includes(row.ticket.outcome ?? '') : row.goal?.phase === 'complete'
const PAGE_SIZE = 10
type AppProps = { t: T; openSession: (id: string) => Promise<void> }
const date = (time: number, timeZone?: string) => new Intl.DateTimeFormat(undefined, { timeZone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(time)
function StatusLabel({ row, t }: { row: DashboardRow; t: T }) {
  const label = row.ticket?.action === 'review' ? t('taskReview') : row.ticket?.action === 'answer' ? t('taskAnswer') : row.ticket?.action === 'delivery' ? t('taskDelivery') : t(row.status)
  return <span className={`dd-status dd-status-${row.status}`}><i />{label}</span>
}
function Summary({ label, value, hint, onClick }: { label: string; value: string; hint: string; onClick?: () => void }) {
  return <div className="dd-stat">{onClick ? <button onClick={onClick}><span>{label}</span><strong>{value}</strong></button> : <><span>{label}</span><strong>{value}</strong></>}<small>{hint}</small></div>
}
export function App({ t, openSession }: AppProps) {
  const [snapshot, setSnapshot] = useState<(Snapshot & { readError?: boolean }) | null>(null)
  const [days, setDays] = useState(7), [archived, setArchived] = useState(false)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const request = useRef<AbortController | null>(null), generation = useRef(0)
  const refresh = useCallback(async () => {
    if (request.current) return
    const controller = new AbortController(), version = generation.current; request.current = controller; setBusy(true)
    try {
      const response = await fetch(`/dsh-dashboard/api/snapshot?days=${days}`, { headers: { 'x-dsh-dashboard': '1' }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) })
      if (!response.ok) throw new Error('Snapshot request failed')
      const next = await response.json() as Snapshot
      if (!Array.isArray(next.rows)) throw new Error('Invalid snapshot')
      if (!controller.signal.aborted && version === generation.current) { setSnapshot(next); setError('') }
    } catch { if (!controller.signal.aborted && version === generation.current) setError('readFailed') }
    finally { if (request.current === controller) request.current = null; if (version === generation.current) setBusy(false) }
  }, [days])
  useEffect(() => {
    generation.current++; request.current?.abort(); request.current = null
    void refresh()
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 5000)
    const visible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', visible)
    return () => { generation.current++; clearInterval(interval); request.current?.abort(); request.current = null; document.removeEventListener('visibilitychange', visible) }
  }, [refresh])
  return <main className="dd-page">
    <header className="dd-header"><div><h1>{t('panel')}</h1><p>{t('subtitle')}</p></div><div className="dd-controls">
      <label className="dd-visually-hidden" htmlFor="dd-range">{t('range')}</label><select id="dd-range" value={days} onChange={event => setDays(Number(event.target.value))}><option value={1}>{t('today')}</option><option value={7}>{t('week')}</option><option value={30}>{t('month')}</option></select>
      <button className="dd-button" onClick={() => void refresh()} disabled={busy}>{t('refresh')}</button>
    </div></header>
    <div className="dd-meta"><span role="status">{snapshot ? <>{snapshot.scanning && <>{t('scanning')} {snapshot.scanned} / {snapshot.totalSessions} · </>}{snapshot.timeZone} · {t('lastRefresh')} {date(snapshot.generatedAt, snapshot.timeZone)}</> : t('loading')}</span><label className="dd-check"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />{t('showArchived')}</label></div>
    {(error || snapshot?.readError) && <p className="dd-notice dd-error" role="alert">{t('readFailed')}</p>}
    {!!snapshot?.failedSessions && <p className="dd-notice">{t('partial')} · {snapshot.failedSessions}</p>}
    <SessionSection snapshot={snapshot} archived={archived} t={t} openSession={openSession} />
    <footer className="dd-footer"><p>{t('note')}</p></footer>
  </main>
}
function SessionSection({ snapshot, archived, t, openSession }: AppProps & { snapshot: Snapshot | null; archived: boolean }) {
  const [project, setProject] = useState(''), [status, setStatus] = useState<string>('all'), [search, setSearch] = useState(''), [rank, setRank] = useState<'session' | 'project'>('session')
  const [expanded, setExpanded] = useState<string | null>(null), [page, setPage] = useState(0), [error, setError] = useState('')
  const [listHeight, setListHeight] = useState<number>()
  const [scrollTarget, setScrollTarget] = useState<{ id?: string } | null>(null)
  const table = useRef<HTMLElement | null>(null), list = useRef<HTMLDivElement | null>(null)
  const resetList = () => { setPage(0); setExpanded(null) }
  const selectProject = (id: string) => { setProject(id); resetList() }
  const actualDays = snapshot?.days ?? 7
  useLayoutEffect(() => { setPage(0); setExpanded(null) }, [actualDays, archived])
  const data = useMemo(() => {
    const hourOf = calendar(snapshot?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
    const rows = (snapshot?.rows ?? []).filter(row => {
      const inRange = hourOf(row.updatedAt).slice(0, 10) >= (snapshot?.fromDate ?? '')
      return (archived || !row.archived) && (inRange || row.running || attentionStates.has(row.status) || row.status === 'queued' || row.goal?.phase === 'active')
        && (row.title || row.running || row.goal || row.ticket || row.unavailable || row.usage.reported || row.usage.missing)
    })
    const regular = rows.filter(row => row.kind !== 'superagent')
    const scoped = regular.filter(row => !project || row.projectId === project)
    const projects = new Map(regular.map(row => [row.projectId, row.project || t('noProject')]))
    const usage = zeroUsage(), series: Record<string, Tokens> = {}
    for (const row of scoped) {
      addUsage(usage, row.usage)
      for (const [key, tokens] of Object.entries(row.series)) { const bucket = series[key] ??= zeroTokens(); for (const k of tokenKeys) bucket[k] += tokens[k] }
    }
    const query = search.trim().toLocaleLowerCase()
    const filtered = scoped.filter(row => (status === 'all' || (status === 'attention' ? attentionStates.has(row.status) : status === 'running' ? row.running : row.status === status))
      && (!query || `${row.title} ${row.id} ${row.project} ${row.goal?.objective ?? ''}`.toLocaleLowerCase().includes(query)))
      .sort((a, b) => priority(a) - priority(b) || b.updatedAt - a.updatedAt)
    const goals = scoped.filter(r => r.goal || r.ticket)
    const complete = goals.filter(completedGoal).length
    const todos = scoped.flatMap(row => row.todos ?? []), done = todos.filter(todo => todo.status === 'completed').length
    const superagentRows = rows.filter(row => row.kind === 'superagent'), superagentUsage = zeroUsage()
    for (const row of superagentRows) addUsage(superagentUsage, row.usage)
    const superagentGoals = superagentRows.filter(row => row.goal || row.ticket)
    const superagent = { rows: superagentRows, usage: superagentUsage, goals: superagentGoals, complete: superagentGoals.filter(completedGoal).length }
    return { scoped, projects, usage, series, filtered, goals, complete, todos, done, superagent }
  }, [snapshot, project, archived, search, status, t])
  const keys = useMemo(() => {
    if (!snapshot) return []
    if (actualDays === 1) return Array.from({ length: 24 }, (_, i) => `${snapshot.today}T${String(i).padStart(2, '0')}`)
    return Array.from({ length: actualDays }, (_, i) => new Date(Date.parse(`${snapshot.fromDate}T12:00:00Z`) + i * 86400000).toISOString().slice(0, 10))
  }, [snapshot?.today, snapshot?.fromDate, actualDays])
  const input = data.usage.tokens.uncachedInput + data.usage.tokens.cacheRead + data.usage.tokens.cacheWrite
  const selectSession = (id: string) => { setStatus('all'); setSearch(''); setExpanded(id); const index = data.scoped.slice().sort((a, b) => priority(a) - priority(b) || b.updatedAt - a.updatedAt).findIndex(r => r.id === id); setPage(Math.max(0, Math.floor(index / PAGE_SIZE))); setScrollTarget({ id }) }
  const selectStatus = (value: string, reveal = true) => { setStatus(value); resetList(); if (reveal) setScrollTarget({}) }
  const pageCount = Math.max(1, Math.ceil(data.filtered.length / PAGE_SIZE)), currentPage = Math.min(page, pageCount - 1)
  useLayoutEffect(() => {
    if (expanded) return
    // Reserve the collapsed table's height across filtering and paging, never a detail row's height.
    const height = list.current?.querySelector('table')?.getBoundingClientRect().height
    if (height) setListHeight(previous => Math.max(previous ?? 0, height))
  }, [data.filtered, currentPage, expanded])
  useLayoutEffect(() => {
    if (!scrollTarget) return
    const target = scrollTarget.id ? document.getElementById(`dd-detail-${scrollTarget.id}`) ?? table.current : table.current
    const page = target?.closest<HTMLElement>('.dd-page')
    if (!target || !page) return
    // scrollIntoView also scrolls the host's clipped ancestors, including its native webview.
    const top = page.scrollTop + target.getBoundingClientRect().top - page.getBoundingClientRect().top - page.clientTop - 16
    page.scrollTo({ top: Math.max(0, Math.min(top, page.scrollHeight - page.clientHeight)), behavior: 'instant' })
  }, [scrollTarget])
  const changePage = (value: number) => { setPage(value); setExpanded(null) }
  const go = async (id: string) => { try { await openSession(id) } catch { setError('openError') } }
  const rangeLabel = t(actualDays === 1 ? 'today' : actualDays === 7 ? 'week' : 'month')
  const title = t('regularSessions'), superagent = data.superagent
  const superagentReady = snapshot && !snapshot.scanning && snapshot.superagent !== 'unavailable'
  return <div className="dd-overview">
    <header className="dd-section-head"><h2>{title} <small>{data.scoped.length}</small></h2><div className="dd-controls">
      <label className="dd-visually-hidden" htmlFor="dd-project">{title} · {t('project')}</label><select id="dd-project" value={project} onChange={event => selectProject(event.target.value)}><option value="">{t('allProjects')}</option>{[...data.projects].sort((a, b) => a[1].localeCompare(b[1])).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
    </div></header>
    {error && <p className="dd-notice dd-error" role="alert">{t('openError')}</p>}
    <section className="dd-stats" aria-label={`${title} · ${t('subtitle')}`}>
      <Summary label={t('running')} value={String(data.scoped.filter(r => r.running).length)} hint={t('liveNow')} onClick={() => selectStatus('running')} />
      <Summary label={t('needAttention')} value={String(data.scoped.filter(r => attentionStates.has(r.status)).length)} hint={t('liveNow')} onClick={() => selectStatus('attention')} />
      <Summary label={t('completed')} value={data.goals.length ? `${data.complete} / ${data.goals.length}` : '—'} hint={t('goalsCount')} />
      <Summary label={t('tokens')} value={compact(tokenTotal(data.usage.tokens))} hint={`${rangeLabel} · ${t('reportedOnly')}`} />
      <Summary label={t('checklist')} value={data.todos.length ? `${data.done} / ${data.todos.length}` : '—'} hint={t('items')} />
      <Summary label={t('cache')} value={input ? `${(data.usage.tokens.cacheRead / input * 100).toFixed(1)}%` : '—'} hint={rangeLabel} />
    </section>
    <section className="dd-superagent" aria-labelledby="dd-superagent-title">
      <div className="dd-section-head"><h2 id="dd-superagent-title">{t('superagent')}</h2><span>{t('allProjects')} · {rangeLabel}</span></div>
      <div className="dd-superagent-cards">
        <Summary label={t('running')} value={superagentReady ? String(superagent.rows.filter(row => row.running).length) : '—'} hint={t('liveNow')} />
        <Summary label={t('needAttention')} value={superagentReady ? String(superagent.rows.filter(row => attentionStates.has(row.status)).length) : '—'} hint={t('liveNow')} />
        <Summary label={t('taskCompleted')} value={superagentReady && superagent.goals.length ? `${superagent.complete} / ${superagent.goals.length}` : '—'} hint={t('goalsCount')} />
        <Summary label={t('tokens')} value={superagentReady ? compact(tokenTotal(superagent.usage.tokens)) : '—'} hint={t('reportedOnly')} />
      </div>
      {snapshot?.superagent === 'partial' && <p className="dd-notice">{t('sourcePartial')}</p>}
      {snapshot?.superagent === 'unavailable' && !snapshot.scanning && <p className="dd-notice">{t('sourceUnavailable')}</p>}
    </section>
    <div className="dd-chart-grid">
      <section className="dd-chart dd-trend"><div className="dd-section-head"><h3>{t('chartTokens')}</h3><span>{rangeLabel}</span></div><TokenChart key={actualDays} series={data.series} keys={keys} t={t} /></section>
      <section className="dd-chart"><div className="dd-section-head"><h3>{t('chartStatus')}</h3><span>{data.scoped.length}</span></div><p className="dd-caption">{t('chartStatusHint')}</p><StateChart rows={data.scoped} t={t} onSelect={selectStatus} /></section>
      <section className="dd-chart"><div className="dd-section-head"><h3>{t('chartProgress')}</h3></div><p className="dd-caption">{t('chartProgressHint')}</p><ProgressChart rows={data.scoped} t={t} onSelect={selectSession} /></section>
      <section className="dd-chart"><div className="dd-section-head"><h3>{t('chartRanking')}</h3><div className="dd-segmented"><button aria-pressed={rank === 'session'} onClick={() => setRank('session')}>{t('bySession')}</button><button aria-pressed={rank === 'project'} onClick={() => setRank('project')}>{t('byProject')}</button></div></div><RankingChart rows={data.scoped} t={t} mode={rank} onSelect={id => rank === 'session' ? selectSession(id) : selectProject(id)} /></section>
    </div>
    <section ref={table} className="dd-sessions"><div className="dd-section-head"><h3>{t('sessions')} <small>{data.filtered.length}</small></h3><div className="dd-controls"><label className="dd-visually-hidden" htmlFor="dd-search">{title} · {t('search')}</label><input id="dd-search" type="search" value={search} placeholder={t('search')} onChange={event => { setSearch(event.target.value); resetList() }} /><label className="dd-visually-hidden" htmlFor="dd-status">{title} · {t('status')}</label><select id="dd-status" value={status} onChange={event => selectStatus(event.target.value, false)}><option value="all">{t('all')}</option><option value="attention">{t('needAttention')}</option>{statusOrder.filter(s => s !== 'attention').map(s => <option key={s} value={s}>{t(s)}</option>)}</select></div></div>
      <div ref={list} className="dd-table-scroll dd-session-list" style={{ minHeight: listHeight }}><table className="dd-session-table"><thead><tr><th>{t('session')}</th><th>{t('status')}</th><th>{t('progress')}</th><th>{t('tokens')}</th><th>{t('toolCalls')}</th><th>{t('updated')}</th></tr></thead><tbody>
        {data.filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(row => <Fragment key={row.id}><tr className={expanded === row.id ? 'dd-selected' : ''}><td><button className="dd-title-button" onClick={() => setExpanded(id => id === row.id ? null : row.id)} aria-expanded={expanded === row.id} aria-controls={`dd-detail-${row.id}`}><span aria-hidden>{expanded === row.id ? '▾' : '▸'}</span><span><strong title={rowTitle(row)}>{rowTitle(row)}</strong><small>{row.project || t('noProject')} · {t(row.kind)}{row.archived ? ` · ${t('archived')}` : ''}</small></span></button></td><td><StatusLabel row={row} t={t} /></td><td>{row.todos?.length ? `${row.todos.filter(x => x.status === 'completed').length} / ${row.todos.length}` : row.goal ? t(row.goal.phase === 'active' ? 'active' : row.goal.phase) : '—'}</td><td title={exact(tokenTotal(row.usage.tokens))}>{row.unavailable ? '—' : compact(tokenTotal(row.usage.tokens))}</td><td>{row.unavailable ? '—' : exact(row.usage.toolCalls)}</td><td>{date(row.updatedAt, snapshot?.timeZone)}</td></tr>
          {expanded === row.id && <tr id={`dd-detail-${row.id}`}><td colSpan={6}><div className="dd-detail">
            <div className="dd-detail-head"><code>{row.id}</code>{row.id.startsWith('ticket:') ? <span>{t('noSession')}</span> : <button className="dd-button" onClick={() => void go(row.id)}>{t('openSession')}</button>}</div>
            {row.unavailable && <p className="dd-error">{t('partial')}</p>}
            <dl className="dd-facts"><div><dt>{t('directory')}</dt><dd>{row.cwd || '—'}</dd></div><div><dt>{t('model')}</dt><dd>{row.model || '—'}</dd></div><div><dt>{t('lifetimeTokens')}</dt><dd>{row.lifetimeTokens === null ? '—' : exact(row.lifetimeTokens)}</dd></div><div><dt>{t('duration')}</dt><dd>{(row.usage.durationMs / 60000).toFixed(1)} min</dd></div></dl>
            <div className="dd-detail-grid"><div><h4>{t('goal')}</h4>{row.goal ? <><p className="dd-objective">{row.goal.objective}</p><p className="dd-caption">{t(row.goal.phase)} · {t('rounds')} {row.goal.rounds} / {row.goal.maxRounds}</p>{row.goal.reason && <p className="dd-error">{row.goal.reason}</p>}</> : <p className="dd-caption">{t('noGoal')}</p>}
              <h4>{t('checklist')}</h4>{row.todos?.length ? <ul className="dd-todos">{row.todos.map((todo, i) => <li key={i}><span className={`dd-todo-icon dd-todo-${todo.status}`} aria-label={todo.status === 'completed' ? t('complete') : t(todo.status)}>{todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '◐' : '○'}</span>{todo.content}</li>)}</ul> : <p className="dd-caption">{t('noChecklist')}</p>}
              {row.ticket?.summary && <><h4>{t('taskSummary')}</h4><p className="dd-objective">{row.ticket.summary}</p></>}
            </div><div><h4>{t('tokens')} · {rangeLabel}</h4><dl className="dd-token-details">{tokenKeys.map(key => <div key={key}><dt>{t(key)}</dt><dd>{exact(row.usage.tokens[key])}</dd></div>)}</dl>
              <h4>{t('latestActivity')}</h4>{row.running && row.pendingTools.length > 0 && <p className="dd-caption">{t('toolsRunning')} · {row.pendingTools.join(', ')}</p>}<ul className="dd-activity">{row.activity.map((item, i) => <li key={i}><time>{date(item.at, snapshot?.timeZone)}</time><span>{t(`event.${item.type}` as keyof typeof zh)}{item.detail && <small> · {item.detail}</small>}</span></li>)}</ul>{!row.activity.length && <p className="dd-caption">{t('noActivity')}</p>}
            </div></div>
          </div></td></tr>}
        </Fragment>)}
        {!data.filtered.length && <tr><td colSpan={6} className="dd-empty">{snapshot?.scanning ? t('loading') : t('noData')}</td></tr>}
      </tbody></table></div>
      <nav className="dd-pagination" style={{ visibility: pageCount > 1 ? 'visible' : 'hidden' }} aria-label={`${title} · ${t('pagination')}`}><span>{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, data.filtered.length)} / {data.filtered.length}</span><button className="dd-button" disabled={currentPage === 0} onClick={() => changePage(currentPage - 1)}>{t('previousPage')}</button><span aria-live="polite">{currentPage + 1} / {pageCount}</span><button className="dd-button" disabled={currentPage + 1 === pageCount} onClick={() => changePage(currentPage + 1)}>{t('nextPage')}</button></nav>
    </section>
  </div>
}
