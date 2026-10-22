/** Slot ownership, lazy reads, source invalidation, and probe-only recovery on reconnect. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { apply as localeApply, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import Registry from '@deepseek-ai/dsh-invariants'
import { apply, inject } from '../src/client/index.ts'
import type { HealthInjected } from '../src/client/HealthPage.tsx'
import { apply as nodeApply } from '../src/index.ts'
import * as Companion from '../src/invariant.ts'
import type { HealthProbeRecord, HealthProbeRequest } from '@deepseek-ai/dsh-api-remotes/client'

it('mounts lazily, opens existing repair surfaces, reads owned probe events, and releases every registration', async () => {
  const ctx = new Context(); await ctx.plugin(SlotRegistry)
  ctx.slots.register({ name: 'root', children: { 'shell.page': { kind: 'keyed', scope: 'root' }, 'sidebar.footer.action': { kind: 'list', scope: 'root' } } } as never, () => null)
  const handlers = new Map<string, (...args: never[]) => void>()
  const stop = vi.fn()
  const on = vi.fn((event: string, listener: (...args: never[]) => void) => { handlers.set(event, listener); return stop })
  const request: HealthProbeRequest = { id: 'probe' as never, agentId: 'agent' as never, expectedRevision: 1, workspaceId: 'workspace' as never, serverName: 'crm' }
  const record: HealthProbeRecord = { ...request, status: 'running', startedAt: 1 }
  const choices = vi.fn(async () => ({ ok: true, value: [] }))
  const check = vi.fn(async () => ({ ok: true, value: { checkedAt: 1, items: [] } }))
  const startProbe = vi.fn(async () => ({ ok: true, value: record }))
  const readProbe = vi.fn(async () => ({ ok: true, value: { ...record, status: 'connected', checkedAt: 2, cleanup: 'closed' } }))
  const cancelProbe = vi.fn(async () => ({ ok: true, value: { ...record, status: 'cancelled', checkedAt: 2, cleanup: 'closed' } }))
  ctx.provide('remote', { $on: on, capabilityHealthGateway: { choices, check, startProbe, readProbe, cancelProbe } } as never)
  ctx.provide('remote.capabilityHealthGateway', {} as never)
  ctx.provide('connection', { hostDescription: { getSnapshot: () => undefined, subscribe: () => () => {} } } as never)
  const openPage = vi.fn(), closePage = vi.fn(), openSettings = vi.fn()
  ctx.provide('layout', { openPage, closePage } as never)
  ctx.provide('settingsPanel', { open: openSettings } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: localeApply }).await()
  const fiber = ctx.plugin({ inject: [...inject], apply }); await fiber.await()
  const face = (ctx.slots.entries('shell.page')[0]!.inject as unknown as () => HealthInjected)()
  expect(choices).not.toHaveBeenCalled()
  for (const [event, handler] of handlers) if (event !== 'capability-health/probe-changed') handler()
  ctx.emit('connection/reset')
  expect(choices).not.toHaveBeenCalled(); expect(startProbe).not.toHaveBeenCalled()
  const nav = (ctx.slots.entries('sidebar.footer.action')[0]!.inject as () => { open(): void })()
  nav.open(); expect(openPage).toHaveBeenCalledWith('capability-health')
  await face.load(); await face.check({ kind: 'global' })
  expect(face.hooks.health.getSnapshot().report?.checkedAt).toBe(1)
  handlers.get('settings/document-updated')!()
  expect(face.hooks.health.getSnapshot().stale).toBe(true)
  await vi.waitFor(() => { expect(choices).toHaveBeenCalledTimes(2) })
  face.invalidate()
  await face.start(request)
  handlers.get('capability-health/probe-changed')!(request.id as never)
  await vi.waitFor(() => { expect(readProbe).toHaveBeenCalledWith({ id: request.id }) })
  await face.recover(); await face.cancel(request.id)
  ctx.emit('connection/reset')
  await vi.waitFor(() => { expect(readProbe.mock.calls.length).toBeGreaterThan(2) })
  expect(startProbe).toHaveBeenCalledOnce()
  for (const target of ['agents', 'workspace', 'models', 'runtimes', 'settings'] as const) face.repair(target)
  expect(openPage).toHaveBeenLastCalledWith('agents'); expect(closePage).toHaveBeenCalledOnce()
  expect(openSettings.mock.calls.map(([section]) => String(section))).toEqual(['models', 'runtimes', 'general'])
  check.mockResolvedValueOnce({ ok: false, error: { message: 'Check refused' } } as never)
  await face.check({ kind: 'global' })
  expect(face.hooks.health.getSnapshot().error).toBe('Check refused')
  await fiber.dispose()
  expect(stop).toHaveBeenCalledTimes(6)
  expect(ctx.slots.entries('shell.page')).toEqual([]); expect(ctx.slots.entries('sidebar.footer.action')).toEqual([])
  await ctx.fiber.dispose()
})
it('keeps the host entry inert and its browser invariant companion independently disposable', async () => {
  nodeApply()
  const ctx = new Context()
  try {
    await ctx.plugin(Registry)
    const fiber = ctx.plugin(Companion); await fiber.await()
    expect(Companion.name).toBe('client-ui-capability-health-invariant')
    await fiber.dispose()
    await ctx.plugin(Companion).await()
  } finally { await ctx.fiber.dispose() }
})
