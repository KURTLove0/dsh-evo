/** Template contributions, callbacks, and listeners belong to their plugin lifetime. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import Registry from '@deepseek-ai/dsh-invariants'
import { apply, inject } from '../src/client/index.ts'
import type { TemplateInjected } from '../src/client/TemplateView.tsx'
import { apply as nodeApply } from '../src/index.ts'
import * as Companion from '../src/invariant.ts'

it('wires the generated Remote consumer and releases slot contributions and listeners on disposal', async () => {
  const ctx = new Context(); await ctx.plugin(SlotRegistry)
  ctx.slots.register({ name: 'root', children: { 'shell.page': { kind: 'keyed', scope: 'root' }, 'sidebar.session.action': { kind: 'list', scope: 'root' }, 'work-center.intake.templates': { kind: 'list', scope: 'root' } } } as never, () => null)
  const stop = vi.fn(), on = vi.fn((_event: string, _listener: () => void) => stop)
  const list = vi.fn(async () => ({ ok: true, value: [] }))
  const record = { id: 'template', revision: 1, archived: false, versions: [] }
  const read = vi.fn(async () => ({ ok: true, value: record }))
  const command = vi.fn(async () => ({ ok: true, value: { id: 'template', revision: 1, version: 1 } }))
  const copyWorkflow = vi.fn(async () => ({ ok: true, value: { workflowId: 'copy' } }))
  ctx.provide('remote', { $on: on, workTemplateGateway: { list, read, command, copyWorkflow,
    sources: async () => ({ ok: true, value: [] }), examples: async () => ({ ok: true, value: [] }) } } as never)
  ctx.provide('remote.workTemplateGateway', {} as never)
  ctx.provide('connection', { api: { settings: {} }, hostDescription: { getSnapshot: () => undefined, subscribe: () => () => {} } } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  const openPage = vi.fn(); ctx.provide('layout', { openPage } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  const fiber = ctx.plugin({ inject: [...inject], apply }); await fiber.await()
  const face = (ctx.slots.entries('shell.page')[0]!.inject as unknown as () => TemplateInjected)()
  await face.refresh(); await face.select('template' as never)
  expect(read).toHaveBeenCalledWith({ id: 'template' })
  const brief = { version: 1 as const, goal: 'Review', background: '', deliverables: [], acceptanceCriteria: [], constraints: '' }
  await face.command({ kind: 'save-task', name: 'Review', expectedRevision: 0, requestId: 'request' as never, brief })
  await face.copy({ id: 'template' as never, version: 1, workspaceId: 'workspace' as never, name: 'Copy', requestId: 'copy' as never })
  expect(copyWorkflow).toHaveBeenCalled()
  const nav = (ctx.slots.entries('sidebar.session.action')[0]!.inject as () => { open(): void })(); nav.open()
  face.openWork(); face.openWorkflow()
  expect(openPage.mock.calls.map(([key]) => String(key))).toEqual(['work-templates', 'work-center', 'business-workflow'])
  for (const [, listener] of on.mock.calls) listener()
  ctx.emit('connection/reset'); await face.refresh()
  command.mockResolvedValueOnce({ ok: false, error: { message: 'Refused' } } as never)
  await expect(face.command({ kind: 'save-task', name: 'Review', expectedRevision: 0, requestId: 'request' as never, brief })).rejects.toThrow('Refused')
  await fiber.dispose(); expect(stop).toHaveBeenCalledTimes(2)
  expect(ctx.slots.entries('shell.page')).toEqual([])
  expect(ctx.slots.entries('work-center.intake.templates')).toEqual([])
  await ctx.fiber.dispose()
})
it('keeps the host entry inert and disposes its package-owned companion', async () => {
  nodeApply(); const ctx = new Context(); await ctx.plugin(Registry)
  const fiber = ctx.plugin(Companion); await fiber.await()
  expect(Companion.name).toBe('client-ui-work-templates-invariant')
  await fiber.dispose(); await ctx.fiber.dispose()
})
