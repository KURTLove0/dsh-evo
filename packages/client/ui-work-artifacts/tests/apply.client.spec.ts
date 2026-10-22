/** Optional artifact slots and Remote subscriptions follow their owning plugin lifetime. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import type { ArtifactInjected } from '../src/client/ArtifactView.tsx'
it('registers metadata-only navigation and releases every optional contribution on disposal', async () => {
  const ctx = new Context(); await ctx.plugin(SlotRegistry)
  ctx.slots.register({ name: 'root', children: { 'shell.page': { kind: 'keyed', scope: 'root' },
    'sidebar.session.action': { kind: 'list', scope: 'root' }, 'work-center.delivery.artifacts': { kind: 'list', scope: 'root' } } } as never, () => null)
  const stop = vi.fn(), stopConnection = vi.fn(), on = vi.fn((_event: string, _listener: () => void) => stop)
  const query = vi.fn(async () => ({ ok: true, value: { items: [], observedAt: 1 } }))
  const read = vi.fn(async () => ({ ok: true, value: {} }))
  const register = vi.fn(async () => ({ ok: true, value: { id: 'artifact', version: 1 } }))
  const inspectCurrent = vi.fn(async () => ({ ok: true, value: { id: 'artifact', version: 1, observedAt: 1, state: 'missing' } }))
  ctx.provide('remote', { $on: on, workArtifactGateway: { query, read, register, inspectCurrent,
    options: async () => ({ ok: true, value: { pageSize: 25, maxFileBytes: 100 } }) } } as never)
  ctx.provide('remote.workArtifactGateway', {} as never)
  ctx.provide('connection', { api: { settings: {} }, hostDescription: { getSnapshot: () => undefined, subscribe: () => stopConnection } } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  const openPage = vi.fn(), closePage = vi.fn(), open = vi.fn()
  ctx.provide('layout', { openPage, closePage } as never); ctx.provide('sessions', { open } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  const fiber = ctx.plugin({ inject: [...inject], apply }); await fiber.await()
  const face = (ctx.slots.entries('shell.page')[0]!.inject as unknown as () => ArtifactInjected)()
  await face.refresh(); expect(inspectCurrent).not.toHaveBeenCalled()
  const nav = (ctx.slots.entries('sidebar.session.action')[0]!.inject as () => { open(): void })()
  nav.open(); face.openWork(); face.openRegistered({ id: 'artifact' as never, version: 1 }); face.openSession('session' as never)
  expect(openPage.mock.calls.map(([key]) => String(key))).toEqual(['work-artifacts', 'work-center', 'work-artifacts'])
  expect(open).toHaveBeenCalledWith('session'); expect(closePage).toHaveBeenCalled()
  await face.select('artifact' as never, 1); await face.inspect()
  expect(inspectCurrent).toHaveBeenCalledWith({ id: 'artifact', version: 1 })
  register.mockResolvedValueOnce({ ok: false, error: { message: 'Refused' } } as never)
  await expect(face.register({ path: 'report', expectedVersion: 0, requestId: 'request' as never,
    source: { kind: 'current-file', ref: { kind: 'agent', id: 'run' as never } } })).rejects.toThrow('Refused')
  for (const [, listener] of on.mock.calls) listener()
  ctx.emit('connection/reset'); await face.refresh()
  await fiber.dispose(); expect(stop).toHaveBeenCalledTimes(4); expect(stopConnection).toHaveBeenCalledOnce()
  expect(ctx.slots.entries('shell.page')).toEqual([]); expect(ctx.slots.entries('work-center.delivery.artifacts')).toEqual([])
  await ctx.fiber.dispose()
})
