/** Optional UI contributions and connection subscriptions belong to the loading plugin. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply as applyHost } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import type { RemoteInjected } from '../src/client/RemoteView.tsx'
it('mounts only configured remote controls and withdraws every contribution on disposal', async () => {
  applyHost(); let connected = false, observe = () => {}
  const ctx = new Context(); await ctx.plugin(SlotRegistry)
  ctx.slots.register({ name: 'root', children: { 'shell.page': { kind: 'keyed', scope: 'root' },
    'sidebar.session.action': { kind: 'list', scope: 'root' } } } as never, () => null)
  const stop = vi.fn(), peers = vi.fn(async () => ({ ok: true, value: [] })), call = vi.fn(async () => ({ ok: true, value: { kind: 'list', items: [], observedAt: 1 } }))
  ctx.provide('remote', { remoteWorkGateway: { peers, call } } as never); ctx.provide('remote.remoteWorkGateway', {} as never)
  ctx.provide('connection', { hostDescription: { getSnapshot: () => connected ? {} : undefined,
    subscribe: (listener: () => void) => { observe = listener; return stop } } } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  const openPage = vi.fn(); ctx.provide('layout', { openPage } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  const fiber = ctx.plugin({ inject: [...inject], apply }); await fiber.await()
  const face = (ctx.slots.entries('shell.page')[0]!.inject as unknown as () => RemoteInjected)()
  await face.refresh(); observe(); connected = true; observe(); ctx.emit('connection/reset')
  const nav = (ctx.slots.entries('sidebar.session.action')[0]!.inject as () => { open(): void })(); nav.open()
  expect(openPage).toHaveBeenCalledWith('work-remote'); await face.choose('peer' as never); await face.select('submission' as never)
  call.mockResolvedValueOnce({ ok: false, error: { message: 'Denied' } } as never)
  await expect(face.command({ peer: 'peer' as never, expected: { hostId: 'host' as never, principalId: 'principal' as never },
    operation: { kind: 'stop', id: 'submission' as never } })).rejects.toThrow('Denied')
  await fiber.dispose(); expect(stop).toHaveBeenCalledOnce(); expect(ctx.slots.entries('shell.page')).toEqual([])
  expect(ctx.slots.entries('sidebar.session.action')).toEqual([]); await ctx.fiber.dispose()
})
