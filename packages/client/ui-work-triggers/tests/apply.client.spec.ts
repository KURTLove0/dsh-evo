/** Optional trigger slots and Remote subscriptions follow their owning plugin lifetime. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply as applyHost } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import type { TriggerInjected } from '../src/client/TriggerView.tsx'
it('registers metadata-only navigation and releases every optional contribution on disposal', async () => {
  applyHost()
  let connected = false, observeConnection = () => {}
  const ctx = new Context(); await ctx.plugin(SlotRegistry)
  ctx.slots.register({ name: 'root', children: { 'shell.page': { kind: 'keyed', scope: 'root' },
    'sidebar.session.action': { kind: 'list', scope: 'root' }, 'work-center.delivery.triggers': { kind: 'list', scope: 'root' } } } as never, () => null)
  const stop = vi.fn(), stopConnection = vi.fn(), on = vi.fn((_event: string, _listener: () => void) => stop)
  const query = vi.fn(async () => ({ ok: true, value: { items: [], observedAt: 1 } }))
  const read = vi.fn(async () => ({ ok: true, value: {} }))
  const command = vi.fn(async () => ({ ok: true, value: { id: 'trigger', revision: 1 } }))
  const prepare = vi.fn(async () => ({ ok: true, value: { name: 'Prepared' } }))
  ctx.provide('remote', { $on: on, workTriggerGateway: { query, read, command, prepare,
    options: async () => ({ ok: true, value: { minIntervalMs: 100, pollIntervalMs: 20, maxOccurrences: 10 } }) },
  workCenterGateway: { detail: async () => ({ ok: true, value: { sessionId: 'original' } }) } } as never)
  ctx.provide('remote.workCenterGateway', {} as never)
  ctx.provide('remote.workTriggerGateway', {} as never)
  ctx.provide('connection', { api: { settings: {} }, hostDescription: { getSnapshot: () => connected ? {} : undefined, subscribe: (listener: () => void) => { observeConnection = listener; return stopConnection } } } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  const openPage = vi.fn(), closePage = vi.fn(), open = vi.fn()
  ctx.provide('layout', { openPage, closePage } as never); ctx.provide('sessions', { open } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  const fiber = ctx.plugin({ inject: [...inject], apply }); await fiber.await()
  const face = (ctx.slots.entries('shell.page')[0]!.inject as unknown as () => TriggerInjected)()
  await face.refresh(); await face.query({ text: 'filter' })
  observeConnection(); connected = true; observeConnection()
  const nav = (ctx.slots.entries('sidebar.session.action')[0]!.inject as () => { open(): void })()
  nav.open(); face.openWork(); face.prepare({ kind: 'agent', id: 'run' as never }); face.openSession('session' as never)
  await face.openRun({ kind: 'agent', id: 'run' as never })
  expect(open).toHaveBeenCalledWith('original'); expect(closePage).toHaveBeenCalled()
  await face.select('trigger' as never)
  command.mockResolvedValueOnce({ ok: false, error: { message: 'Refused' } } as never)
  await expect(face.command({ kind: 'acknowledge', id: 'trigger' as never, noticeId: 'notice' as never })).rejects.toThrow('Refused')
  for (const [, listener] of on.mock.calls) listener()
  ctx.emit('connection/reset'); await face.refresh()
  await fiber.dispose(); expect(stop).toHaveBeenCalledTimes(1); expect(stopConnection).toHaveBeenCalledOnce()
  expect(ctx.slots.entries('shell.page')).toEqual([]); expect(ctx.slots.entries('work-center.delivery.triggers')).toEqual([])
  await ctx.fiber.dispose()
})
