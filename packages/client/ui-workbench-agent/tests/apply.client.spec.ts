/** Slot, locale, and event contributions disappear with the owning browser plugin. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import type { AgentPageInjected } from '../src/client/AgentPage.tsx'
import { apply as nodeApply } from '../src/index.ts'
import * as Invariant from '../src/invariant.ts'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

it('mounts navigation, coalesces directory updates, and unwinds every registration', async () => {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry)
  ctx.slots.register({ name: 'root', children: {
    'shell.page': { kind: 'keyed', scope: 'root' },
    'sidebar.session.action': { kind: 'list', scope: 'root' },
  } } as never, () => null)
  const stopRemote = vi.fn()
  const onRemote = vi.fn((_event: string, _listener: () => void) => stopRemote)
  const snapshot = vi.fn(async () => ({ ok: true, value: { agents: [], runs: [], workloads: [], defaultConcurrency: 6, maxConcurrency: 8, runtime: { id: 'harness', available: true } } }))
  const command = vi.fn(async () => ({ ok: true, value: { agentId: 'agent' } }))
  const runtimes = vi.fn(async () => ({ ok: true, value: [] }))
  const capabilities = vi.fn(async () => ({ ok: true, value: { skills: [] } }))
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  ctx.provide('remote', { $on: onRemote, workbenchAgentGateway: { snapshot, command, capabilities, runtimes } } as never)
  ctx.provide('remote.workbenchAgentGateway', {} as never)
  const openPage = vi.fn(), closePage = vi.fn(), open = vi.fn()
  ctx.provide('layout', { openPage, closePage } as never)
  ctx.provide('sessions', { open } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const nav = (ctx.slots.entries('sidebar.session.action')[0]!.inject as () => { openAgents(): void })()
  nav.openAgents()
  expect(openPage).toHaveBeenCalledWith('agents')
  const face = (ctx.slots.entries('shell.page')[0]!.inject as unknown as () => AgentPageInjected)()
  await face.refresh()
  expect(await face.runtimes()).toEqual([])
  expect(await face.capabilities('workspace' as never)).toEqual({ skills: [] })
  expect(capabilities).toHaveBeenCalledWith({ workspaceId: 'workspace' })
  await face.select('agent' as never)
  await face.command({ kind: 'copy', id: 'agent' as never, name: 'Copy' })
  expect(snapshot).toHaveBeenCalledTimes(3)
  onRemote.mock.calls.find(([event]) => event === 'workbench-agent/changed')?.[1]()
  await face.refresh()
  expect(snapshot.mock.calls.length).toBeGreaterThan(3)
  command.mockImplementationOnce(async () => ({ ok: false, error: { message: 'Remote refused' } }) as never)
  await expect(face.command({ kind: 'stop', runId: 'missing' as never })).rejects.toThrow('Remote refused')
  face.openSession('session' as never)
  face.closePage()
  expect(open).toHaveBeenCalledWith('session')
  expect(closePage).toHaveBeenCalledTimes(2)
  const refreshed = snapshot.mock.calls.length
  ctx.emit('connection/reset')
  await vi.waitFor(() => { expect(snapshot.mock.calls.length).toBeGreaterThan(refreshed) })
  await fiber.dispose()
  expect(stopRemote).toHaveBeenCalled()
  expect(ctx.slots.entries('shell.page')).toEqual([])
  expect(ctx.slots.entries('sidebar.session.action')).toEqual([])
  const before = snapshot.mock.calls.length
  ctx.emit('connection/reset')
  await face.refresh()
  expect(snapshot).toHaveBeenCalledTimes(before)
  await ctx.fiber.dispose()
})

describe('node half', () => {
  it('registers no host UI behavior', () => { nodeApply() })
  it('releases its invariant ownership on disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = ctx.plugin(Invariant)
    await fiber.await()
    expect(Invariant.name).toBe('client-ui-workbench-agent-invariant')
    await fiber.dispose()
    await ctx.plugin(Invariant).await()
    await ctx.fiber.dispose()
  })
})
