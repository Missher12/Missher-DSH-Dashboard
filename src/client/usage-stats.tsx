import { memo, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent } from 'react'
import type { UsageHistory } from '../types.ts'
import type { T } from './locales.ts'
import { numberFormat } from './numbers.ts'
import { particles, usageModel, type ParticleMode, type UsageModel } from './usage-model.ts'

const paletteKey = 'dsh.usage-statistics.particle-color.v1'
const presets = [['','themeColor'],['#8b6ccf','violetColor'],['#447fcb','blueColor'],['#369f97','tealColor'],['#c69749','amberColor'],['#ca758f','roseColor']] as const
let fallback = ''
const readColor = () => {
  try { const value = localStorage.getItem(paletteKey) ?? ''; return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '' } catch { return fallback }
}
const subscribe = (notify: () => void) => { window.addEventListener('storage', notify); return () => window.removeEventListener('storage', notify) }
const chooseColor = (value: string) => {
  fallback = value
  try { if (value) localStorage.setItem(paletteKey, value); else localStorage.removeItem(paletteKey) } catch { /* Renderer storage may be unavailable. */ }
  window.dispatchEvent(new StorageEvent('storage', { key: paletteKey, newValue: value || null }))
}
function Palette({ color, t }: { color: string; t: T }) {
  const input = useRef<HTMLInputElement>(null), isPreset = presets.some(([hex]) => hex === color)
  return <span className="dd-usage-palette">
    <span aria-hidden="true" className="dd-usage-swatches"><i/><i/><i/></span><span aria-hidden="true">{t('colorMenu')}</span>
    <svg viewBox="0 0 16 16" width="10" height="10" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
    <select aria-label={t('particleColor')} value={isPreset ? color : 'current'} onChange={e => {
      if (e.target.value === 'custom') input.current?.click(); else chooseColor(e.target.value)
    }}>
      {presets.map(([hex,key])=><option key={key} value={hex}>{t(key)}</option>)}
      {!isPreset && <option value="current">{color}</option>}<option value="custom">{t('customColor')}</option>
    </select>
    <input ref={input} type="color" tabIndex={-1} aria-label={t('customColor')} value={color || '#4d6bfe'} onChange={e=>chooseColor(e.target.value)}/>
  </span>
}

const modes = ['daily','weekly','cumulative'] as const
const clock = (h: number) => String(h).padStart(2,'0') + ':00'
function moveCell(e: KeyboardEvent<HTMLButtonElement>, index: number, count: number, columns: boolean) {
  const offset: Record<string,number> = columns ? {ArrowLeft:-7,ArrowRight:7,ArrowUp:-1,ArrowDown:1} : {ArrowLeft:-1,ArrowRight:1}
  const next = e.key==='Home' ? 0 : e.key==='End' ? count-1 : e.key in offset ? Math.min(count-1, Math.max(0, index+offset[e.key])) : undefined
  if (next === undefined) return
  e.preventDefault()
  e.currentTarget.parentElement?.querySelector<HTMLButtonElement>('[data-index="'+next+'"]')?.focus({preventScroll:true})
}
function duration(ms: number | null, zh: boolean) {
  if (ms === null) return '—'
  const minutes = Math.floor(ms / 60000), hours = Math.floor(minutes / 60)
  if (hours >= 24) return Math.floor(hours / 24) + (zh ? '天 ' : 'd ') + hours % 24 + (zh ? '时' : 'h')
  if (hours) return hours + (zh ? '时 ' : 'h ') + minutes % 60 + (zh ? '分' : 'm')
  return minutes + (zh ? '分' : 'm')
}
function ParticleChart({model, t, palette}: { model: UsageModel | null; t: T; palette: string }) {
  const [mode, setMode] = useState<ParticleMode>('daily'), [cursor,setCursor] = useState<number | null>(null)
  const [hover,setHover] = useState<number | null>(null), [pinned,setPinned] = useState<number | null>(null)
  const locale = t('numberLocale'), {exact} = numberFormat(locale)
  const cells = useMemo(()=>model ? particles(model,mode) : [],[model,mode])
  const months = useMemo(()=>{
    if (!model) return []
    const fmt = new Intl.DateTimeFormat(locale,{month:'short',timeZone:'UTC'})
    return model.days.filter((day,i)=>!i || day.date.slice(0,7)!==model.days[i-1].date.slice(0,7)).slice(-12)
      .map(day=>({ date:day.date, name:fmt.format(new Date(day.date+'T00:00:00Z')) }))
  },[model,locale])
  const choose = (m: ParticleMode) => { setMode(m); setHover(null); setPinned(null) }
  const caption = (v: (typeof cells)[number]) => (mode==='daily' ? v.date : mode==='weekly' ? v.from+' – '+v.to : t('through')+' '+v.to) + ' · ' + (v.value === null ? t('noUsage') : exact(v.value)+' Token')
  const reading = hover ?? pinned, shown = reading !== null ? cells[reading] : null
  const column = Math.floor((reading ?? 0)/7), selected = cursor ?? cells.findIndex(v=>v.date===model?.today)
  return <div className="dd-usage-activity">
    <div className="dd-usage-row"><div className="dd-usage-title"><h3>{t('tokenActivity')}</h3><Palette color={palette} t={t}/></div>
      <div className="dd-usage-tabs" role="tablist" aria-label={t('tokenActivity')}>{modes.map((m,i)=><button type="button" role="tab" key={m} id={'dd-usage-'+m}
        aria-controls="dd-particle-panel" aria-selected={mode===m} tabIndex={mode===m?0:-1} onClick={()=>choose(m)} onKeyDown={e=>{
          const j=e.key==='ArrowLeft'?(i+2)%3:e.key==='ArrowRight'?(i+1)%3:e.key==='Home'?0:e.key==='End'?2:-1
          if(j>=0){e.preventDefault();choose(modes[j]);e.currentTarget.parentElement?.querySelectorAll('button')[j]?.focus({preventScroll:true})}
        }}>{t(m)}</button>)}</div>
    </div>
    <div id="dd-particle-panel" role="tabpanel" aria-labelledby={'dd-usage-'+mode} className="dd-particle-panel">
      {shown && <div className="dd-particle-tip" role="tooltip" data-edge={column<8?'left':column>44?'right':'middle'} style={{left:((column+.5)/53*100)+'%'}}>{caption(shown)}</div>}
      <div className="dd-particles" aria-label={t('particleRange')} role="group" onMouseLeave={()=>setHover(null)}>
        {model ? cells.map((v,i)=><button type="button" className="dd-particle" data-date={v.date} data-index={i} data-level={v.level} data-tokens={v.value??undefined} key={v.date}
          tabIndex={i===selected?0:-1} aria-label={caption(v)} onMouseEnter={()=>setHover(i)} onFocus={()=>{setCursor(i);setHover(i)}} onBlur={()=>setHover(null)}
          onClick={()=>setPinned(prev=>prev===i?null:i)} onKeyDown={e=>{if(e.key==='Escape'){setPinned(null);setHover(null)}else moveCell(e,i,371,true)}}/>)
          : Array.from({length:371},(_,i)=><i key={i} className="dd-particle" aria-hidden="true"/>)}
      </div>
      <div className="dd-usage-months" aria-hidden="true">{months.map(m=><span key={m.date}>{m.name}</span>)}</div>
    </div>
  </div>
}
function Hourly({model,t,refresh,busy,zone}: {model: UsageModel | null; t:T; refresh:()=>void; busy:boolean; zone?:string}) {
  const [focus,setFocus] = useState(0), [hover,setHover]=useState<number|null>(null), [pinned,setPinned]=useState<number|null>(null)
  const {compact,exact}=numberFormat(t('numberLocale')), values=model?.hours ?? Array<number|null>(24).fill(null)
  const max=Math.max(0,...values.map(v=>v??0)), total=values.reduce<number|null>((n,v)=>v===null?n:(n??0)+v,null)
  const hourLabel=(h:number)=>clock(h)+'–'+clock(h+1)+' · '+(values[h]===null?t('noUsage'):exact(values[h]!)+' Token')
  const reading=hover??pinned, readout=reading!==null?hourLabel(reading):max ? t('peak')+' '+hourLabel(values.indexOf(max)) : total===null?t('noUsage'):'0 Token'
  return <section className="dd-usage-hourly" aria-label={t('hourActivity')}>
    <div className="dd-usage-row"><div className="dd-usage-title"><h3>{t('hourActivity')}</h3><small>{t('today')} · {model?.today.slice(5).replace('-','/') ?? '—'}</small></div>
      <div className="dd-hour-meta"><small>{t('dayTotal')}</small> <strong title={total!==null?exact(total)+' Token':undefined}>{total===null?'—':compact(total)}</strong> {total!==null && <small>Token</small>}
        <button type="button" aria-label={t('refresh')} title={t('refresh')} disabled={busy} onClick={refresh}><svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true"><path d="M12.8 6A5 5 0 1 0 13 9M13 2v4H9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
      </div></div>
    <div className="dd-hour-plot"><div className="dd-hour-guide" aria-hidden="true"><span>{max?compact(max):''}</span><span>0</span></div>
      <div className="dd-hour-bars" role="group" aria-label={t('hourActivity')} onMouseLeave={()=>setHover(null)}>
        {values.map((v,h)=><button type="button" key={h} data-index={h} data-tokens={v??undefined} data-peak={!!max&&v===max||undefined} tabIndex={focus===h?0:-1}
          aria-label={hourLabel(h)} title={hourLabel(h)} onMouseEnter={()=>setHover(h)} onFocus={()=>{setFocus(h);setHover(h)}} onBlur={()=>setHover(null)}
          onClick={()=>setPinned(prev=>prev===h?null:h)} onKeyDown={e=>{if(e.key==='Escape'){setHover(null);setPinned(null)}else moveCell(e,h,24,false)}}>
          {v!==null && <i data-zero={v===0||undefined} style={{height:max?v/max*100+'%':'0%'}}/>}</button>)}
      </div><div className="dd-hour-axis" aria-hidden="true">{values.map((_,i)=><span key={i}>{i%3===0||i===23?clock(i).slice(0,2):''}</span>)}</div>
    </div>
    <div className="dd-hour-foot"><span>{readout}</span><span>{zone}</span></div>
  </section>
}
export const UsageStatistics = memo(function UsageStatistics({history,today,project,archived,zone,t,refresh,busy}: {
  history?: UsageHistory[]; today?:string; project:string; archived:boolean; zone?:string; t:T; refresh:()=>void; busy:boolean
}) {
  const model=useMemo(()=>history&&today?usageModel(history,today,project,archived):null,[history,today,project,archived])
  const palette=useSyncExternalStore(subscribe,readColor), locale=t('numberLocale'), {compact,exact}=numberFormat(locale)
  const metrics = [
    [t('totalTokens'),model?.total,compact],[t('peakDaily'),model?.peak,compact],[t('longestSession'),model?.longestMs,(v:number)=>duration(v,locale==='zh-CN')],
    [t('currentStreak'),model?.current,exact],[t('longestStreak'),model?.longest,exact]
  ] as const
  return <section className="dd-feature dd-usage-card" aria-labelledby="dd-usage-title" style={{'--du-accent':palette||'var(--dsw-alias-state-business-primary,#4d6bfe)'} as CSSProperties}>
    <div className="dd-card-head"><h2 id="dd-usage-title">{t('heatTitle')}</h2><small>{t('allHistory')}</small></div>
    <dl className="dd-usage-metrics">{metrics.map(([label,v,format],i)=><div key={label}><dt title={label}>{label}</dt><dd title={v==null?undefined:i<2?exact(v)+' Token':format(v)}>{v==null?'—':format(v)}</dd></div>)}</dl>
    <ParticleChart model={model} t={t} palette={palette}/>
    <Hourly model={model} t={t} refresh={refresh} busy={busy} zone={zone}/>
  </section>
})
