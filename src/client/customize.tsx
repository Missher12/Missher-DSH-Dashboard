import { useEffect, useRef, useState, type FormEvent } from 'react'
import { defaultLayout, parseLayout, sections, superagentPackage, type DashboardLayout, type PluginCard, type Section } from '../layout.ts'
import type { T } from './locales.ts'

async function request(path: 'layout' | 'plugins', init: RequestInit = {}): Promise<unknown> {
  const response = await fetch('/dsh-dashboard/api/' + path, {
    ...init, headers: { 'x-dsh-dashboard': '1', ...init.headers },
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
  })
  if (!response.ok) throw Error('Dashboard customization request failed')
  return response.json()
}

let savedLayout: DashboardLayout | undefined
export function useLayoutPreference() {
  const [layout, setLayout] = useState(savedLayout ?? defaultLayout)
  const [available, setAvailable] = useState(!!savedLayout)
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const currentWrite = useRef(0)
  useEffect(() => {
    const controller = new AbortController()
    const startedBeforeWrite = currentWrite.current
    request('layout', { signal: controller.signal }).then(value => {
      const loaded = parseLayout(value)
      if (!loaded) throw Error('Invalid dashboard layout')
      if (!controller.signal.aborted && startedBeforeWrite === currentWrite.current) {
        savedLayout = loaded
        setLayout(loaded)
        setAvailable(true)
        setLoadError(false)
      }
    }).catch(() => { if (!controller.signal.aborted) setLoadError(true) })
    return () => controller.abort()
  }, [attempt])
  return { layout, available, loadError, retry: () => setAttempt(value => value + 1),
    save: async (next: DashboardLayout) => {
      currentWrite.current++
      const saved = parseLayout(await request('layout', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) }))
      if (!saved) throw Error('Invalid saved layout')
      savedLayout = saved
      setLayout(saved)
    } }
}

let savedCards: PluginCard[] | null = null
export function usePluginCards(enabled: boolean, selected: string[]) {
  const [cards, setCards] = useState(savedCards)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const selection = selected.join(',')
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        const value = await request('plugins', { signal: controller.signal })
        if (!Array.isArray(value)) throw Error('Invalid dashboard plugin list')
        if (!controller.signal.aborted) {
          savedCards = value
          setCards(value)
          setError(false)
        }
      } catch { if (!controller.signal.aborted) setError(true) }
      if (!controller.signal.aborted) timer = setTimeout(load, 30000)
    }
    void load()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [enabled, selection, attempt])
  return { cards, error, retry: () => setAttempt(value => value + 1) }
}

const sectionLabel: Record<Section, 'recentSessions' | 'heatTitle' | 'moreStats'> = {
  recent: 'recentSessions', usage: 'heatTitle', more: 'moreStats',
}
const statusLabel = { active: 'pluginActive', disabled: 'pluginDisabled', enabled: 'pluginEnabled', problem: 'pluginProblem' } as const
const pluginNames = new Map([
  [superagentPackage, 'SuperAgent'],
  ['@missher/dsh-memory', 'DSH Memory'],
  ['@missher/dsh-mse-learning', 'MSE Learning'],
])
const pluginName = (card: PluginCard): string => card.title || pluginNames.get(card.id)
  || card.id.split('/').at(-1)!.replace(/^dsh-/, '').split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
const toggle = <T,>(list: T[], value: T): T[] => list.includes(value) ? list.filter(item => item !== value) : [...list, value]

export function Customize({ layout, cards, inventoryError, retryInventory, onSave, onDismiss, t }: {
  layout: DashboardLayout; cards: PluginCard[] | null; inventoryError: boolean; retryInventory: () => void
  onSave: (value: DashboardLayout) => Promise<void>; onDismiss: () => void; t: T
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(layout)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState(false)
  useEffect(() => {
    const element = dialog.current!
    const trigger = document.activeElement
    element.showModal()
    return () => {
      element.close()
      if (trigger instanceof HTMLElement) trigger.focus({ preventScroll: true })
    }
  }, [])
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setFailure(false)
    try { await onSave(draft); onDismiss() } catch { setFailure(true); setBusy(false) }
  }
  const entries = [...(cards ?? [])].sort((a, b) => pluginName(a).localeCompare(pluginName(b), t('numberLocale')))
  return <dialog ref={dialog} className="dd-customize" aria-labelledby="dd-customize-title" onCancel={event => {
    event.preventDefault()
    if (!busy) onDismiss()
  }}>
    <form onSubmit={save}>
      <header className="dd-customize-head"><h2 id="dd-customize-title">{t('customize')}</h2></header>
      <div className="dd-customize-body">
        <fieldset disabled={busy}>
          <legend>{t('dashboardContent')}</legend>
          {sections.map(key => <label className="dd-choice" key={key}>
            <span>{t(sectionLabel[key])}</span><input type="checkbox" checked={draft.sections.includes(key)}
              onChange={() => setDraft(value => ({ ...value, sections: toggle(value.sections, key) }))} />
          </label>)}
        </fieldset>
        <fieldset disabled={busy}>
          <legend>{t('pluginCards')}</legend>
          {entries.map(card => <label className="dd-choice" key={card.id}>
            <span title={card.id}>{pluginName(card)}<small>{t(statusLabel[card.status])}</small></span>
            <input type="checkbox" checked={draft.plugins.includes(card.id)}
              onChange={() => setDraft(value => ({ ...value, plugins: toggle(value.plugins, card.id) }))} />
          </label>)}
          {inventoryError ? <div className="dd-choice"><span>{t('pluginListFailed')}</span><button type="button" className="dd-button" onClick={retryInventory}>{t('retry')}</button></div>
            : !cards ? <p className="dd-choice" role="status">{t('loadingPlugins')}</p>
              : !entries.length ? <p className="dd-choice">{t('noInstalledPlugins')}</p> : null}
        </fieldset>
      </div>
      <footer className="dd-customize-actions">
        {failure && <span className="dd-error" role="alert">{t('layoutSaveFailed')}</span>}
        <button type="button" className="dd-button" disabled={busy} onClick={onDismiss}>{t('cancel')}</button>
        <button className="dd-button dd-save-layout" disabled={busy}>{t(busy ? 'saving' : 'save')}</button>
      </footer>
    </form>
  </dialog>
}

export function PluginCards({ cards, openPlugin, t }: { cards: PluginCard[]; openPlugin?: (id: string) => void; t: T }) {
  if (!cards.length) return null
  const number = new Intl.NumberFormat(t('numberLocale'))
  return <section className="dd-plugin-overview" aria-labelledby="dd-plugin-overview-title">
    <h2 id="dd-plugin-overview-title">{t('pluginCards')}</h2>
    <div className="dd-plugin-grid">
      {cards.map(card => {
        const values = (['memoryActive', 'memoryCandidate', 'learningEntries'] as const).filter(key => card.metrics[key] !== undefined)
        return <article className="dd-plugin-card" key={card.id} data-plugin={card.id}>
          <div className="dd-plugin-head">
            <h3 title={card.id}>{pluginName(card)}</h3>
            <span className="dd-plugin-status" data-status={card.status}><i />{t(statusLabel[card.status])}</span>
          </div>
          {values.length > 0 && <dl>{values.map(key => <div key={key}><dd>{number.format(card.metrics[key]!)}</dd><dt>{t(key)}</dt></div>)}</dl>}
          <div className="dd-plugin-foot">
            <span>{card.version ? 'v' + card.version : ''}</span>
            {openPlugin && <button type="button" className="dd-button" aria-label={t('pluginDetails') + ' ' + pluginName(card)} onClick={() => openPlugin(card.id)}>{t('pluginDetails')}</button>}
          </div>
        </article>
      })}
    </div>
  </section>
}
