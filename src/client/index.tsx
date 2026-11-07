import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SidebarPanelIconOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { App } from './app.tsx'
import { en, zh, type T } from './locales.ts'
import css from './style.css'
type ClientContext = Omit<Context, 'sessions'> & { sessions: ISessions }
const PANEL = 'dsh-dashboard' as MainPanelId
function Icon({ size }: SidebarPanelIconOwnerProps) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4h6v7H4zM14 4h6v4h-6zM4 15h6v5H4zM14 12h6v8h-6z" /></svg> }
export const inject = ['slots', 'locale', 'sessions', 'uiWorkspace']
export function apply(ctx: ClientContext) {
  ctx.effect(() => ctx.locale.register('dshDashboard', { zh, en }), 'dashboard dictionaries')
  ctx.effect(() => { const element = document.createElement('style'); element.textContent = css; document.head.append(element); return () => element.remove() })
  const t = ctx.locale.bind('dshDashboard') as T
  const openSession = async (id: string) => {
    if (ctx.sessions.list.getSnapshot().phase !== 'ready' || !ctx.sessions.list.getSnapshot().byId[id]) await ctx.sessions.refresh()
    const list = ctx.sessions.list.getSnapshot()
    if (list.phase !== 'ready' || !list.byId[id]) throw new Error('Session unavailable')
    ctx.uiWorkspace.openSession(id as SessionId)
  }
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL, locale: 'dshDashboard', inject: () => ({}) },
    (props: { t: T }) => <App t={props.t} openSession={openSession} />))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 11, label: () => t('panel'), locale: 'dshDashboard' }, Icon))
}
