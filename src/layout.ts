export const sections = ['recent', 'usage', 'more'] as const
export const superagentPackage = '@missher/dsh-superagent'
export const dashboardPackage = '@missher/dsh-dashboard'
export type Section = typeof sections[number]
export type DashboardLayout = { version: 1; sections: Section[]; plugins: string[] }
export type PluginStatus = 'active' | 'disabled' | 'enabled' | 'problem'
export type PluginMetric = 'memoryActive' | 'memoryCandidate' | 'learningEntries'
export interface PluginCard {
  id: string
  title?: string
  version?: string
  status: PluginStatus
  metrics: Partial<Record<PluginMetric, number>>
}

export const defaultLayout = (): DashboardLayout => ({ version: 1, sections: [...sections], plugins: [superagentPackage] })
export const isPackageName = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 214 && /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(value)

export function parseLayout(value: unknown): DashboardLayout | undefined {
  if (!value || typeof value !== 'object') return
  const { version, sections: visible, plugins } = value as Partial<DashboardLayout>
  if (version !== 1 || !Array.isArray(visible) || !visible.every(key => sections.includes(key))
    || !Array.isArray(plugins) || plugins.length > 128 || !plugins.every(isPackageName)) return
  return { version, sections: [...new Set(visible)], plugins: [...new Set(plugins)].filter(id => id !== dashboardPackage) }
}
