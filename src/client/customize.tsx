import { useEffect, useState } from 'react'
import { defaultLayout, parseLayout, superagentPackage, type DashboardLayout, type PluginCard } from '../layout.ts'
import type { T } from './locales.ts'

async function request(path: 'layout' | 'plugins', signal: AbortSignal): Promise<unknown> {
  const response = await fetch('/dsh-dashboard/api/' + path, {
    headers: { 'x-dsh-dashboard': '1' }, signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
  })
  if (!response.ok) throw Error('Dashboard layout request failed')
  return response.json()
}

let savedLayout: DashboardLayout | undefined
export function useLayoutPreference() {
  const [layout, setLayout] = useState(savedLayout ?? defaultLayout)
  useEffect(() => {
    const controller = new AbortController()
    request('layout', controller.signal).then(value => {
      const loaded = parseLayout(value)
      if (loaded && !controller.signal.aborted) {
        savedLayout = loaded
        setLayout(loaded)
      }
    }).catch(() => { /* Keep the last layout while the host reloads. */ })
    return () => controller.abort()
  }, [])
  return layout
}

let savedCards: PluginCard[] | null = null
export function usePluginCards(selected: string[]) {
  const [cards, setCards] = useState(savedCards)
  const selection = selected.join(',')
  useEffect(() => {
    if (!selection) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        const value = await request('plugins', controller.signal)
        if (Array.isArray(value) && !controller.signal.aborted) {
          savedCards = value
          setCards(value)
        }
      } catch { /* Keep the last cards until the next update. */ }
      if (!controller.signal.aborted) timer = setTimeout(load, 30000)
    }
    void load()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [selection])
  return cards
}

const statusLabel = { active: 'pluginActive', disabled: 'pluginDisabled', enabled: 'pluginEnabled', problem: 'pluginProblem' } as const
const pluginNames = new Map([
  [superagentPackage, 'SuperAgent'],
  ['@missher/dsh-memory', 'DSH Memory'],
  ['@missher/dsh-mse-learning', 'MSE Learning'],
])
const pluginName = (card: PluginCard): string => card.title || pluginNames.get(card.id)
  || card.id.split('/').at(-1)!.replace(/^dsh-/, '').split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')

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
