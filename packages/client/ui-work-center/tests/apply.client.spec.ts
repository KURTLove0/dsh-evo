/** Work Center contributions and transport listeners belong to their plugin lifetime. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { apply, inject } from '../src/client/index.ts'
import type { WorkCenterInjected } from '../src/client/WorkCenterPage.tsx'
import { createWorkCenterViewStore } from '../src/client/view-store.ts'
import { apply as nodeApply } from '../src/index.ts'
import * as Invariant from '../src/invariant.ts'
import type { TaskBrief, WorkDetail } from '@deepseek-ai/dsh-api-remotes/client'

it('registers remote-backed actions, refreshes owner events, and releases navigation and listeners on unload', async () => {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry)
  ctx.slots.register({ name: 'root', children: { 'shell.page': { kind: 'keyed', scope: 'root' }, 'sidebar.session.action': { kind: 'list', scope: 'root' } } } as never, () => null)
  const stop = vi.fn()
  const on = vi.fn((_event: string, _listener: () => void) => stop)
  const page = { items: [], failures: [], observedAt: 1 }
  const ref = { kind: 'agent', id: 'run' }
  const query = vi.fn(async () => ({ ok: true, value: page }))
  const detail = vi.fn(async () => ({ ok: true, value: { ref } }))
  const diagnose = vi.fn(async () => ({ ok: true, value: { ref, observedAt: 1, status: 'failed', sources: [], findings: [], retry: { kind: 'agent', agentId: 'agent', task: 'Original' } } }))
  const command = vi.fn(async () => ({ ok: true, value: { ref } }))
  const submit = vi.fn(async () => ({ ok: true, value: { agentId: 'agent', runId: 'run' } }))
  const preflight = vi.fn(async () => ({ ok: true, value: { checkedAt: 1, agentRevision: 1, issues: [], mcp: [] } }))
  const revisionBrief = vi.fn(async (request: { brief: TaskBrief }) => ({ ok: true, value: request.brief }))
  ctx.provide('connection', { api: { settings: {} }, hostDescription: { getSnapshot: () => undefined, subscribe: () => () => {} } } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  ctx.provide('remote', { $on: on, workCenterGateway: { query, detail, diagnose, command, revisionBrief, executors: async () => ({ ok: true, value: [] }), options: async () => ({ ok: true, value: { pageSize: 2 } }) }, workbenchAgentGateway: { command: submit, preflight } } as never)
  ctx.provide('remote.workCenterGateway', {} as never)
  ctx.provide('remote.workbenchAgentGateway', {} as never)
  const openPage = vi.fn(), closePage = vi.fn(), open = vi.fn()
  const openSettings = vi.fn()
  ctx.provide('settingsPanel', { open: openSettings } as never)
  ctx.provide('layout', { openPage, closePage } as never)
  const sessions: { byId: Record<string, { id: string; pendingInteraction?: string }> } = { byId: {} }
  let onSessions: (() => void) | undefined
  const stopSessions = vi.fn()
  ctx.provide('sessions', { open, list: { getSnapshot: () => sessions, subscribe: (listener: () => void) => { onSessions = listener; return stopSessions } } } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const nav = (ctx.slots.entries('sidebar.session.action')[0]!.inject as () => { openWorkCenter(): void })()
  nav.openWorkCenter()
  expect(openPage).toHaveBeenCalledWith('work-center')
  const face = (ctx.slots.entries('shell.page')[0]!.inject as unknown as () => WorkCenterInjected)()
  await face.refresh()
  await face.query({ state: 'active' })
  await face.more()
  await face.select({ kind: 'agent', id: 'run' as never })
  expect(detail).toHaveBeenCalledWith(ref)
  await face.diagnose(); expect(diagnose).toHaveBeenCalledWith(ref)
  for (const target of ['health', 'workflow', 'models', 'runtimes'] as const) face.repair(target)
  expect(openSettings.mock.calls.map(([section]) => String(section))).toEqual(['models', 'runtimes'])
  const brief = { version: 1 as const, goal: 'Task', background: '', deliverables: [], acceptanceCriteria: [], constraints: '' }
  await face.check({ id: 'agent' as never, workspaceId: 'workspace' as never, brief }, { ref: { kind: 'agent', id: 'run' as never }, reviewRevision: 1 })
  expect(revisionBrief).toHaveBeenCalled()
  face.invalidateCheck()
  await face.submit({ kind: 'submit-task', id: 'agent' as never, workspaceId: 'workspace' as never, expectedRevision: 1, requestId: 'request' as never, brief })
  await face.command({ kind: 'revise-agent', ref: { kind: 'agent', id: 'run' as never }, reviewRevision: 1, agentRevision: 1, requestId: 'revision' as never, brief })
  for (const [, listener] of on.mock.calls) listener()
  await face.refresh()
  sessions.byId = { pending: { id: 'pending', pendingInteraction: 'question' }, idle: { id: 'idle' } }
  onSessions!()
  await vi.waitFor(() => { expect(query).toHaveBeenCalledWith(expect.objectContaining({ attentionSessionIds: ['pending'] })) })
  const before = query.mock.calls.length
  ctx.emit('connection/reset')
  await vi.waitFor(() => { expect(query.mock.calls.length).toBeGreaterThan(before) })
  command.mockImplementationOnce(async () => ({ ok: false, error: { message: 'Refused' } }) as never)
  await expect(face.command({ kind: 'decide-workflow', ref: { kind: 'workflow', id: 'flow' as never }, attemptId: 'attempt' as never, approve: false })).rejects.toThrow('Refused')
  face.configure(); face.openSession('session' as never)
  expect(openPage).toHaveBeenLastCalledWith('agents'); expect(open).toHaveBeenCalledWith('session'); expect(closePage).toHaveBeenCalledOnce()
  await fiber.dispose()
  expect(stop).toHaveBeenCalledTimes(3)
  expect(stopSessions).toHaveBeenCalledOnce()
  expect(ctx.slots.entries('shell.page')).toEqual([])
  expect(ctx.slots.entries('sidebar.session.action')).toEqual([])
  await ctx.fiber.dispose()
})

describe('draft ownership', () => {
  it('retains a newer draft when an earlier request is acknowledged and clears only the matching request', () => {
    const view = createWorkCenterViewStore().create()
    view.actions.field('goal', 'First task'); view.actions.prepare('first')
    view.actions.field('goal', 'Second task'); view.actions.prepare('second')
    view.actions.submitted('first')
    expect(view.store.getSnapshot().fields.goal).toBe('Second task')
    view.actions.submitted('second')
    expect(view.store.getSnapshot().fields.goal).toBe('')
  })
  it('requires an agent and its committed review before preparing a revision, and preserves optional brief defaults', () => {
    const view = createWorkCenterViewStore().create()
    const detail: WorkDetail = { ref: { kind: 'agent', id: 'run' as never }, name: 'Original task', sessionId: 'session' as never, workspaceId: 'workspace' as never, status: 'completed' }
    view.actions.revise(detail)
    view.actions.revise({ ...detail, ref: { kind: 'workflow', id: 'flow' as never } })
    view.actions.revise({ ...detail, agentId: 'agent' as never })
    expect(view.store.getSnapshot().revision).toBeNull()
    view.actions.revise({ ...detail, agentId: 'agent' as never, review: { ref: detail.ref, version: 'version' as never, revision: 1, decisionId: 'decision' as never, decision: 'changes-requested', reason: 'Fix', reviewedAt: 1, actor: 'local-operator', delivery: { version: 'version' as never, outputs: [], criteria: [], artifacts: [], evidence: 'recorded-response' } } })
    expect(view.store.getSnapshot().fields).toMatchObject({ goal: 'Original task', background: '', deliverables: '', criteria: '', constraints: '' })
    view.actions.clear()
    expect(view.store.getSnapshot().revision).toBeNull()
  })
})

it('keeps the host entry inert and releases the UI companion ownership', async () => {
  nodeApply()
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  const fiber = ctx.plugin(Invariant)
  await fiber.await()
  expect(Invariant.name).toBe('client-ui-work-center-invariant')
  await fiber.dispose()
  await ctx.plugin(Invariant).await()
  await ctx.fiber.dispose()
})
it('retains the exact retry draft until its matching acknowledgment or explicit discard', () => {
  const view = createWorkCenterViewStore().create()
  const first = { kind: 'retry-agent' as const, ref: { kind: 'agent' as const, id: 'one' as never }, requestId: 'first' as never, expectedRevision: 1 }
  const second = { ...first, requestId: 'second' as never }
  view.actions.retrySubmitted()
  expect(view.store.getSnapshot().retry).toBeNull()
  view.actions.retry(first); view.actions.retrySubmitted(); view.actions.retry(second)
  expect(view.store.getSnapshot().retry).toEqual({ request: first, submitted: true })
  view.actions.retryClear('second')
  expect(view.store.getSnapshot().retry?.request).toEqual(first)
  view.actions.retryClear()
  expect(view.store.getSnapshot().retry).toBeNull()
})
