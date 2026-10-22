/** Page/navigation registration, read-only reconnects, and lifetime cleanup through real slot services. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply as hostApply } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import type { KnowledgeInjected } from '../src/client/KnowledgeView.tsx'
it('registers optional page/navigation and disposes all contributions without repeating pending commands', async () => {
  hostApply()
  const ctx = new Context(); await ctx.plugin(SlotRegistry)
  ctx.slots.register({ name: 'root', children: { 'shell.page': { kind: 'keyed', scope: 'root' }, 'sidebar.session.action': { kind: 'list', scope: 'root' } } } as never, () => null)
  const source = { id: 'source', workspaceId: 'workspace', workspacePath: '/project', path: 'source.md', enabled: true, revision: 1, versions: [] }
  const options = vi.fn(async () => ({ ok: true, value: { maxSources: 64, maxVersions: 20, maxFileBytes: 100,
    maxQueryBytes: 512, maxHits: 5 } }))
  const sources = vi.fn(async () => ({ ok: true, value: [source] })), register = vi.fn(async () => ({ ok: true, value: source }))
  const index = vi.fn(async () => ({ ok: true, value: { source, attempt: { state: 'ready', version: 1, completedAt: 1 } } }))
  const setEnabled = vi.fn(async () => ({ ok: true, value: source }))
  const search = vi.fn(async () => ({ ok: true, value: { hits: [], more: false, current: [], excluded: [], observedAt: 1 } }))
  const read = vi.fn(async () => ({ ok: true, value: {} }))
  ctx.provide('remote', { workKnowledgeGateway: { options, sources, register, index, setEnabled, search, read } } as never)
  ctx.provide('remote.workKnowledgeGateway', {} as never)
  let connected = true, changed: () => void = () => {}
  const stop = vi.fn(), openPage = vi.fn()
  ctx.provide('connection', { api: { settings: {} }, hostDescription: { getSnapshot: () => connected ? {} : undefined,
    subscribe: (listener: () => void) => { changed = listener; return stop } } } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  ctx.provide('workspaces', {} as never); ctx.provide('layout', { openPage } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  const fiber = ctx.plugin({ inject: [...inject], apply }); await fiber.await()
  const face = (ctx.slots.entries('shell.page')[0]!.inject as unknown as () => KnowledgeInjected)()
  await face.select('workspace' as never); await face.refresh()
  const navigation = (ctx.slots.entries('sidebar.session.action')[0]!.inject as () => { open(): void })()
  navigation.open(); expect(openPage).toHaveBeenCalledWith('work-knowledge')
  await face.search('material', 2); await face.read({ sourceId: 'source' as never, version: 1, textSha256: 'digest', startLine: 1, endLine: 2 }); face.clearPreview()
  await face.command({ kind: 'register', request: { id: 'source' as never, workspaceId: 'workspace' as never, path: 'source.md' } })
  await face.command({ kind: 'index', request: { id: 'source' as never, expectedRevision: 1, requestId: 'index' as never } })
  await face.command({ kind: 'setEnabled', request: { id: 'source' as never, expectedRevision: 1, enabled: false } })
  register.mockResolvedValueOnce({ ok: false, error: { message: 'Response lost' } } as never)
  await face.command({ kind: 'register', request: { id: 'other' as never, workspaceId: 'workspace' as never, path: 'other.md' } })
  expect(face.hooks.knowledge.getSnapshot().writeError).toBe('Response lost')
  const writes = register.mock.calls.length
  connected = false; changed(); connected = true; changed(); ctx.emit('connection/reset'); await face.refresh()
  expect(register).toHaveBeenCalledTimes(writes); expect(search).toHaveBeenCalledOnce(); expect(read).toHaveBeenCalledOnce()
  face.discard(); expect(face.hooks.knowledge.getSnapshot().pending).toBeUndefined()
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const clipboard = { writeText: vi.fn(async (_text: string) => {}) }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard } })
  try { await face.copy('Exact citation'); expect(clipboard.writeText).toHaveBeenCalledWith('Exact citation') }
  finally { if (originalNavigator === undefined) Reflect.deleteProperty(globalThis, 'navigator'); else Object.defineProperty(globalThis, 'navigator', originalNavigator) }
  await fiber.dispose(); expect(stop).toHaveBeenCalledOnce()
  expect(ctx.slots.entries('shell.page')).toEqual([]); expect(ctx.slots.entries('sidebar.session.action')).toEqual([])
  await ctx.fiber.dispose()
})
