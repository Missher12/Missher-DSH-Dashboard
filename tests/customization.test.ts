import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { LayoutStore } from '../src/customization.ts'
import { defaultLayout, parseLayout } from '../src/layout.ts'

test('a customized layout survives reopening and queued writes retain the latest selection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-dashboard-layout-'))
  const file = join(dir, 'layout-v1.json')
  const store = new LayoutStore(file)
  try {
    assert.deepEqual(await store.get(), defaultLayout())
    const chosen = parseLayout({ version: 1, sections: ['usage'], plugins: ['@example/first', '@example/second'] })!
    await Promise.all([store.save({ ...chosen, plugins: ['@example/second'] }), store.save(chosen)])
    const reopened = new LayoutStore(file)
    assert.deepEqual(await reopened.get(), chosen)
    await reopened.save({ version: 1, sections: [], plugins: [] })
    assert.deepEqual(await new LayoutStore(file).get(), { version: 1, sections: [], plugins: [] })
  } finally { await store.dispose(); await rm(dir, { recursive: true, force: true }) }
})

test('invalid preferences are refused and a failed write leaves the current layout intact', async () => {
  assert.equal(parseLayout({ version: 1, sections: ['wrong'], plugins: [] }), undefined)
  assert.equal(parseLayout({ version: 1, sections: [], plugins: ['../private'] }), undefined)
  const store = new LayoutStore()
  await assert.rejects(store.save({ version: 1, sections: [], plugins: [] }))
  assert.deepEqual(await store.get(), defaultLayout())
})
