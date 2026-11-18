import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { writeDashboardFile } from './cache.ts'
import { dashboardPackage, defaultLayout, isPackageName, parseLayout, type DashboardLayout, type PluginCard } from './layout.ts'

interface Bundle {
  name: string
  version?: string
  installed: boolean
  enabled: boolean
  optional?: boolean
  availability?: string
  error?: unknown
  meta?: { title?: string }
  rows?: { moduleName: string; entryId?: string }[]
}
interface PluginEntry { entryId: string; moduleName: string; enabled: boolean; fiberPhase?: string }
interface Inventory {
  listBundles(): Promise<Bundle[]>
  listPlugins?(): Promise<PluginEntry[]>
}

export class LayoutStore {
  private current = defaultLayout()
  private readonly file?: string
  private ready: Promise<void>
  private pending = Promise.resolve()

  constructor(file?: string) {
    this.file = file
    this.ready = this.restore()
  }

  private async restore() {
    if (!this.file) return
    try {
      this.current = parseLayout(JSON.parse(await readFile(this.file, 'utf8'))) ?? this.current
    } catch { /* A missing or damaged layout uses the default view. */ }
  }

  async get(): Promise<DashboardLayout> { await this.ready; return this.current }

  save(layout: DashboardLayout): Promise<void> {
    const result = this.pending.then(async () => {
      await this.ready
      if (!this.file) throw Error('Dashboard profile is unavailable')
      await writeDashboardFile(this.file, layout)
      this.current = layout
    })
    this.pending = result.catch(() => {})
    return result
  }

  async dispose() { await Promise.all([this.ready, this.pending]) }
}

function cardStatus(bundle: Bundle, entries: PluginEntry[]): PluginCard['status'] {
  if (!bundle.enabled) return 'disabled'
  if (bundle.error || bundle.availability === 'missing') return 'problem'
  const primary = bundle.rows?.find(row => row.moduleName === bundle.name)?.entryId
  const owner = primary ? entries.find(row => row.entryId === primary) : entries.find(row => row.moduleName === bundle.name)
  if (!owner) return 'enabled'
  if (!owner.enabled) return 'disabled'
  if (owner.fiberPhase === 'failed') return 'problem'
  return owner.fiberPhase === 'active' ? 'active' : 'enabled'
}

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined

async function pluginMetrics(ctx: Context, id: string): Promise<PluginCard['metrics']> {
  try {
    if (id === '@missher/dsh-memory') {
      const memory = ctx.get('dshMemory') as { stats(input: object): Promise<{ active?: unknown; candidate?: unknown }> } | undefined
      const stats = await memory?.stats?.({})
      return { memoryActive: count(stats?.active), memoryCandidate: count(stats?.candidate) }
    }
    if (id === '@missher/dsh-mse-learning') {
      const learning = ctx.get('mseRebuildStatus') as { status(input: object): Promise<{ ok: boolean; view?: { entries?: unknown[] } }> } | undefined
      const status = await learning?.status?.({})
      if (status?.ok && Array.isArray(status.view?.entries)) return { learningEntries: status.view.entries.length }
    }
  } catch { /* Optional plugin statistics fall back to the real installed status. */ }
  return {}
}

async function pluginCards(ctx: Context, selected: string[]): Promise<PluginCard[]> {
  const manager = ctx.get('pluginManager') as Inventory | undefined
  if (!manager?.listBundles) return []
  const [bundles, entries] = await Promise.all([
    manager.listBundles(),
    manager.listPlugins?.().catch(() => []) ?? [],
  ])
  const visible = bundles.filter(bundle => (bundle.installed || bundle.optional && bundle.enabled)
    && bundle.name !== dashboardPackage && isPackageName(bundle.name))
  return Promise.all(visible.map(async bundle => {
    const status = cardStatus(bundle, entries)
    const title = bundle.meta?.title
    return { id: bundle.name, title: typeof title === 'string' && title !== bundle.name ? title.slice(0, 120) : undefined, version: bundle.version, status,
      metrics: selected.includes(bundle.name) && (status === 'active' || status === 'enabled') ? await pluginMetrics(ctx, bundle.name) : {} }
  }))
}

const BODY_LIMIT = 48_000
async function readLayout(req: IncomingMessage): Promise<DashboardLayout | undefined> {
  if (Number(req.headers['content-length']) > BODY_LIMIT) return
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of req) {
    length += chunk.length
    if (length > BODY_LIMIT) return
    chunks.push(chunk)
  }
  try { return parseLayout(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { return }
}

export function registerCustomization(ctx: Context, allow: (req: IncomingMessage) => boolean): void {
  const profile = ctx.get('profileContext') as { dir?: string } | undefined
  const store = new LayoutStore(profile?.dir && isAbsolute(profile.dir) ? join(profile.dir, '.dsh-dashboard', 'layout-v1.json') : undefined)
  ctx.effect(() => () => store.dispose())
  const register = (path: string, handle: (req: IncomingMessage, res: ServerResponse) => Promise<unknown>) =>
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/dsh-dashboard/api/' + path, handler: async (req, res) => {
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      if (!allow(req)) { res.writeHead(403).end('{}'); return }
      try {
        const value = await handle(req, res)
        if (!res.writableEnded) res.end(JSON.stringify(value))
      } catch { if (!res.writableEnded) res.writeHead(500).end('{}') }
    } }))
  register('layout', async (req, res) => {
    if (req.method === 'GET') return store.get()
    if (req.method !== 'PUT') { res.setHeader('Allow', 'GET, PUT'); res.writeHead(405).end('{}'); return }
    const next = await readLayout(req)
    if (!next) { res.writeHead(400).end('{}'); return }
    await store.save(next)
    return next
  })
  register('plugins', async (req, res) => {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); res.writeHead(405).end('{}'); return }
    return pluginCards(ctx, (await store.get()).plugins)
  })
}
