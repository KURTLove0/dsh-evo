/** Review failure modes and source-query semantics with real domain storage and filesystem evidence. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as Domain from '@deepseek-ai/dsh-storage-domain'
import FsLocal from '@deepseek-ai/dsh-fs-local'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as Center from '../src/index.ts'
import * as Companion from '../src/invariant.ts'
import { WorkCenterGateway } from '../src/gateway.ts'
import type { AgentRunSummary, AgentRunQuery, TaskBrief } from '@deepseek-ai/dsh-workbench-agent/types'
import type { WorkflowRun } from '@deepseek-ai/dsh-business-workflow/workbench-types'
import type { WorkCommand, WorkReference } from '../src/types.ts'

const contexts: Context[] = [], roots: string[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
const ref: Extract<WorkReference, { kind: 'agent' }> = { kind: 'agent', id: 'same' as never }
const flowRef: Extract<WorkReference, { kind: 'workflow' }> = { kind: 'workflow', id: 'same' as never }
const brief: TaskBrief = { version: 1, goal: 'Write report', background: '', deliverables: [], acceptanceCriteria: ['Cite sources'], constraints: '' }
async function boot(config: Partial<Center.Config> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-center-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(JsonStorage, { root: join(root, 'storage') })
  await ctx.plugin(Domain, { backend: 'json' })
  await ctx.plugin(FsLocal)
  const run: AgentRunSummary = { id: ref.id, agentId: 'agent' as never, agentName: 'Reporter', workspaceId: 'workspace' as never, sessionId: 'session' as never, prompt: 'Task', status: 'completed', createdAt: 1, updatedAt: 2, settledSeq: 2, submission: { id: 'submission' as never, agentRevision: 1, brief } }
  const workflow: WorkflowRun = { id: flowRef.id, workflowId: 'workflow' as never, workspaceId: run.workspaceId, sessionId: 'flow-session' as never, mode: 'execution', status: 'succeeded', seq: 1, createdAt: 1, updatedAt: 2, inputs: { report: 'Original input' }, outputs: { report: 'Workflow delivery' }, attempts: [], execution: { provider: 'mock', model: 'mock', subagentProvider: 'mock' }, version: { id: 'publication' as never, number: 1, revision: 1, createdAt: 1, definition: { requirement: { summary: 'Review report', objectives: [{ id: 'review', statement: 'Review records' }], inputs: [], outputs: [], constraints: [], acceptanceCases: [] }, nodes: [], finalOutputs: [], positions: {} } } }
  const agentQuery = vi.fn(async (_request: AgentRunQuery) => ({ items: [run] }))
  const workflowQuery = vi.fn(async () => ({ items: [] }))
  const agentCommand = vi.fn(async () => ({ agentId: run.agentId, runId: 'revision' as never }))
  const workflowCommand = vi.fn(async () => ({ workflowId: workflow.workflowId, runIds: ['revision' as never] }))
  const agentInspect = vi.fn(async () => structuredClone(run))
  const workflowInspect = vi.fn(async () => structuredClone(workflow))
  const inspect = vi.fn(async () => ({ events: [{ seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Recorded delivery' }] } } }] }))
  const workspace = vi.fn(() => ({ path: root }))
  ctx.provide('workbenchAgents', { queryRuns: agentQuery, inspectRun: agentInspect, command: agentCommand, snapshot: async () => ({ agents: [{ id: run.agentId, name: 'Reporter', revision: 1, archived: false, instructions: 'Review', runtime: 'mock', skills: [], model: { provider: 'mock', model: 'mock' }, mcpServers: [{ name: 'CRM', env: [{ name: 'TOKEN', value: 'secret' }] }] }, { id: 'other', name: 'Other', revision: 1, archived: false, instructions: '', runtime: 'mock', skills: [], mcpServers: [] }] }) } as never)
  ctx.provide('workflowWorkbench', { queryRuns: workflowQuery, inspectRun: workflowInspect, command: workflowCommand, catalog: async () => [] } as never)
  ctx.provide('sessionPersistence', { inspect } as never)
  ctx.provide('workspaceRegistry', { get: workspace } as never)
  await ctx.plugin(Center, { pageSize: 2, maxPageSize: 5, maxReviewDecisions: 20, maxRecordBytes: 8192,
    maxDeliveryBytes: 4096, maxArtifactBytes: 32,
    maxStatisticsRuns: 5000, maxStatisticsSessions: 100, maxStatisticsGroups: 1000, maxStatisticsBytes: 1048576,
    maxDiagnosisSources: 50, maxDiagnosisFindings: 200, maxDiagnosisBytes: 262144, ...config })
  return { ctx, root, run, workflow, agentQuery, workflowQuery, agentCommand, workflowCommand, agentInspect, workflowInspect, inspect, workspace, service: ctx.workCenter, gateway: ctx.get('workCenterGateway') as WorkCenterGateway }
}
async function assess(ui: Awaited<ReturnType<typeof boot>>, source: WorkReference = ref, patch: Partial<Extract<WorkCommand, { kind: 'review' }>> = {}) {
  const detail = await ui.service.detail(source)
  return ui.service.command({ kind: 'review', ref: source, version: detail.delivery!.version, decisionId: 'decision' as never, expectedRevision: 0, decision: 'changes-requested', reason: 'Add citations', ...patch })
}

describe('work center source ownership', () => {
  it('qualifies colliding IDs, continues below the merged row, filters source states, and exposes failures', async () => {
    const ui = await boot()
    ui.workflowQuery.mockResolvedValueOnce({ items: [{ id: flowRef.id, workflowId: 'workflow', workflowName: 'Workflow', sessionId: 'flow-session', workspaceId: 'workspace', status: 'succeeded', mode: 'execution', createdAt: 1, updatedAt: 2 }] } as never)
    const first = await ui.gateway.query({ limit: 1 })
    expect(first.items[0]?.kind).toBe('workflow')
    expect(first.next).toBeDefined()
    expect((await ui.gateway.query({ limit: 1, cursor: first.next! })).items[0]?.kind).toBe('agent')
    expect(ui.agentQuery.mock.calls.at(-1)?.[0]).toMatchObject({ before: { attention: false, updatedAt: 2, id: '\uffff' } })
    for (const state of ['active', 'finished', 'waiting'] as const) await ui.service.query({ limit: 2, state, workspaceId: ui.run.workspaceId })
    expect(ui.agentQuery).toHaveBeenLastCalledWith(expect.objectContaining({ statuses: ['running'], attentionOnly: true, workspaceId: 'workspace' }))
    expect(ui.workflowQuery).toHaveBeenLastCalledWith(expect.objectContaining({ statuses: ['waiting'] }))
    const before = ui.agentQuery.mock.calls.length
    await ui.service.query({ limit: 2, source: 'workflow' })
    expect(ui.agentQuery).toHaveBeenCalledTimes(before)
    await ui.service.query({ limit: 2, source: 'agent' })
    ui.workflowQuery.mockRejectedValueOnce(new Error('Workflow unavailable'))
    const partial = await ui.service.query({ limit: 1 })
    expect(partial.items.map(item => item.run.id)).toEqual(['same'])
    expect(partial.next).toBeUndefined()
    expect(partial.failures).toEqual([{ source: 'workflow', message: 'Workflow unavailable' }])
    ui.agentQuery.mockRejectedValueOnce('Agent unavailable'); ui.workflowQuery.mockRejectedValueOnce(new Error('Workflow unavailable'))
    expect((await ui.service.query({ limit: 2 })).failures).toEqual([{ source: 'agent', message: 'Agent unavailable' }, { source: 'workflow', message: 'Workflow unavailable' }])
    await expect(ui.service.query({ limit: 0 })).rejects.toThrow('limit')
    await expect(ui.service.query({ limit: 6 })).rejects.toThrow('limit')
    await expect(ui.service.query({ limit: 2, cursor: { query: 'different' } })).rejects.toThrow('another work query')
    expect(ui.gateway.options({})).toEqual({ pageSize: 2 })
    expect(JSON.stringify(await ui.gateway.executors({}))).not.toContain('secret')
  })
  it('keeps deterministic execution-update order for equal-time source rows and stable ties', async () => {
    const ui = await boot()
    const rows = ['z', 'a', 'm', 'z'].map(id => ({ ...ui.run, id: id as typeof ui.run.id }))
    ui.agentQuery.mockResolvedValueOnce({ items: rows })
    expect((await ui.service.query({ limit: 5 })).items.map(item => item.run.id)).toEqual(['z', 'z', 'm', 'a'])
    ui.agentQuery.mockResolvedValueOnce({ items: [{ ...ui.run, updatedAt: 5 }] })
    ui.workflowQuery.mockResolvedValueOnce({ items: [{ id: 'flow', workflowId: 'workflow', workflowName: 'Workflow', sessionId: 'flow-session', workspaceId: 'workspace', status: 'succeeded', mode: 'execution', createdAt: 1, updatedAt: 2 }] } as never)
    expect((await ui.service.query({ limit: 5 })).items[0]?.kind).toBe('agent')
  })
  it('ranks pending work across sources ahead of newer updates and scopes continuations to the observed pending set', async () => {
    const ui = await boot()
    ui.run.status = 'running'
    ui.run.updatedAt = 10
    const recent = { ...ui.run, id: 'recent' as never, sessionId: 'not-pending' as never, status: 'completed' as const, updatedAt: 100 }
    ui.agentQuery.mockResolvedValue({ items: [recent, ui.run] })
    ui.workflowQuery.mockResolvedValue({ items: [{ id: 'waiting', workflowId: 'workflow', workflowName: 'Waiting workflow', sessionId: 'waiting-session', workspaceId: 'workspace', status: 'waiting', mode: 'execution', createdAt: 1, updatedAt: 2 }] } as never)
    expect((await ui.service.query({ limit: 1, source: 'workflow' })).items[0]?.kind).toBe('workflow')
    const pending = ['session' as never]
    const first = await ui.service.query({ limit: 2, attentionSessionIds: pending })
    expect(first.items.map(item => [item.run.id, item.needsAttention])).toEqual([['same', true], ['waiting', true]])
    expect(first.next?.agent).toEqual({ attention: true, updatedAt: 2, id: '\uffff' })
    expect(ui.agentQuery).toHaveBeenLastCalledWith(expect.objectContaining({ attentionSessionIds: pending }))
    await expect(ui.service.query({ limit: 2, attentionSessionIds: [], cursor: first.next! })).rejects.toThrow('another work query')
    await expect(ui.service.query({ limit: 2, attentionSessionIds: [...pending, ...pending], cursor: first.next! })).resolves.toBeDefined()
    ui.agentQuery.mockResolvedValue({ items: [recent, { ...ui.run, status: 'completed' }] })
    expect((await ui.service.query({ limit: 5, attentionSessionIds: pending })).items.map(item => item.run.id)).toEqual(['waiting', 'recent', 'same'])
  })
  it('distinguishes response absence, transcript failure, and oversized complete evidence', async () => {
    const ui = await boot()
    delete ui.run.settledSeq
    expect((await ui.service.detail(ref)).delivery).toBeUndefined()
    ui.run.settledSeq = 2
    ui.inspect.mockResolvedValueOnce({ events: [] })
    expect((await ui.service.detail(ref)).delivery).toBeUndefined()
    ui.inspect.mockResolvedValueOnce({ events: [{ seq: 2, type: 'assistant/message', data: { message: { content: [] } } }] })
    expect((await ui.service.detail(ref)).delivery).toBeUndefined()
    ui.inspect.mockRejectedValueOnce('Transcript unavailable')
    expect((await ui.service.detail(ref)).deliveryError).toBe('Transcript unavailable')
    ui.inspect.mockResolvedValueOnce({ events: [{ seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'x'.repeat(4096) }] } } }] })
    expect((await ui.service.detail(ref)).deliveryError).toContain('maxDeliveryBytes')
    ui.run.error = 'Execution interrupted'; delete ui.run.submission
    expect((await ui.service.detail(ref)).error).toBe('Execution interrupted')
    ui.workflow.status = 'waiting'
    expect((await ui.service.detail(flowRef)).delivery).toBeUndefined()
    ui.workflow.status = 'succeeded'; ui.workflow.outputs = {}
    expect((await ui.service.detail(flowRef)).delivery).toBeUndefined()
  })
  it('captures text and binary bytes and explicitly rejects missing, external, or excessive files', async () => {
    const ui = await boot()
    ui.run.submission!.brief = { ...brief, deliverables: ['text.txt', 'binary.dat', 'nul.dat', 'missing', '../outside', 'large'] }
    await writeFile(join(ui.root, 'text.txt'), 'Text evidence')
    await writeFile(join(ui.root, 'binary.dat'), Buffer.from([255]))
    await writeFile(join(ui.root, 'nul.dat'), Buffer.from([0]))
    await writeFile(join(ui.root, 'large'), 'x'.repeat(33))
    const detail = await ui.service.detail(ref)
    expect(detail.delivery?.artifacts.map(artifact => artifact.state)).toEqual(['captured', 'captured', 'captured', 'unavailable', 'unavailable', 'unavailable'])
    expect(detail.delivery?.artifacts[1]).toMatchObject({ encoding: 'base64', content: '/w==' })
    ui.workspace.mockReturnValueOnce(undefined as never)
    expect((await ui.service.detail(ref)).delivery?.artifacts[0]).toMatchObject({ state: 'unavailable', error: 'Workspace is unavailable.' })
    await expect(assess(ui, ref, { decision: 'accepted' })).rejects.toThrow('artifacts are unavailable')
  })
  it('rejects stale decisions and conflicting idempotency keys while preserving every committed decision', async () => {
    const ui = await boot()
    await expect(assess(ui, ref, { reason: ' ' })).rejects.toThrow('Explain')
    await expect(assess(ui, ref, { version: 'stale' as never })).rejects.toThrow('changed')
    await expect(assess(ui, ref, { expectedRevision: 1 })).rejects.toThrow('another window')
    ui.run.status = 'running'
    await expect(assess(ui)).rejects.toThrow('unavailable or changed')
    ui.run.status = 'completed'
    await expect(ui.service.revisionBrief({ ref, reviewRevision: 0, brief })).rejects.toThrow('Review changed')
    expect(await assess(ui)).toEqual({ ref, reviewRevision: 1 })
    expect(await assess(ui, ref, { expectedRevision: 99 })).toEqual({ ref, reviewRevision: 1 })
    for (const patch of [{ ref: flowRef }, { version: 'different' as never }, { decision: 'accepted' as const }, { reason: 'Different reason' }])
      await expect(assess(ui, ref, patch)).rejects.toThrow('another review')
    await expect(ui.service.command({ kind: 'revise-workflow', ref: flowRef, reviewRevision: 0, requestId: 'request' as never })).rejects.toThrow('Review changed')
    await assess(ui, ref, { decisionId: 'accepted' as never, expectedRevision: 1, decision: 'accepted', reason: '' })
    expect((await ui.service.detail(ref)).priorReviews).toHaveLength(1)
    await expect(ui.service.command({ kind: 'revise-agent', ref, reviewRevision: 1, agentRevision: 1, requestId: 'request' as never, brief })).rejects.toThrow('Review changed')
    await expect(ui.service.command({ kind: 'invalid' } as never)).rejects.toThrow('Unknown work command')
  })
  it('forwards exact source actions and keeps new revision executions separate from human decisions', async () => {
    const ui = await boot()
    await assess(ui)
    const expected = await ui.gateway.revisionBrief({ ref, reviewRevision: 1, brief })
    expect(expected.background).toContain('Original recorded delivery:\nRecorded delivery')
    const agentRevision: WorkCommand = { kind: 'revise-agent', ref, reviewRevision: 1, agentRevision: 1, requestId: 'request' as never, brief }
    expect(await ui.gateway.command(agentRevision)).toEqual({ ref: { kind: 'agent', id: 'revision' } })
    expect(ui.agentCommand).toHaveBeenCalledWith(expect.objectContaining({ kind: 'submit-task', brief: expected, revisionOf: ref.id }))
    ui.agentCommand.mockResolvedValueOnce({ agentId: ui.run.agentId } as never)
    await expect(ui.service.command(agentRevision)).rejects.toThrow('no run identity')
    ui.workflow.outputs = { z: 'Last output', a: 'First output' }
    expect((await ui.service.detail(flowRef)).delivery?.outputs.map(output => output.name)).toEqual(['a', 'z'])
    ui.workflow.outputs = { report: 'Workflow delivery' }
    ui.run.retryOf = 'retried' as never
    expect((await ui.service.detail(ref)).revisionOf).toEqual({ kind: 'agent', id: 'retried' })
    ui.run.revisionOf = 'original' as never
    expect((await ui.service.detail(ref)).revisionOf).toEqual({ kind: 'agent', id: 'original' })
    ui.workflow.assertion = { passed: false, detail: 'Missing citation' }; ui.workflow.rerunOf = 'original' as never; ui.workflow.error = 'Assertion failed'
    ui.workflow.attempts = [{ id: 'attempt', status: 'waiting' }] as never
    const detail = await ui.gateway.detail(flowRef)
    expect(detail).toMatchObject({ waitingAttemptId: 'attempt', revisionOf: { kind: 'workflow', id: 'original' }, error: 'Assertion failed', delivery: { assertion: { passed: false } } })
    expect(detail.delivery?.criteria).toEqual(['Review records'])
    await assess(ui, flowRef, { decisionId: 'workflow-decision' as never })
    const revision: WorkCommand = { kind: 'revise-workflow', ref: flowRef, reviewRevision: 1, requestId: 'workflow-request' as never }
    expect(await ui.service.command(revision)).toEqual({ ref: { kind: 'workflow', id: 'revision' } })
    expect(ui.workflowCommand).toHaveBeenCalledWith(expect.objectContaining({ kind: 'start', versionId: 'publication', rerunOf: flowRef.id, feedback: 'Add citations\n\nOriginal recorded delivery:\nWorkflow delivery' }))
    ui.workflowCommand.mockResolvedValueOnce({ workflowId: ui.workflow.workflowId, runIds: [] })
    await expect(ui.service.command(revision)).rejects.toThrow('no run identity')
    await ui.service.command({ kind: 'decide-workflow', ref: flowRef, attemptId: 'attempt' as never, approve: false })
    expect(ui.workflowCommand).toHaveBeenLastCalledWith({ kind: 'decide', runId: flowRef.id, attemptId: 'attempt', approve: false })
  })
  it('forwards full retry identity to its owner without changing human review history', async () => {
    const ui = await boot()
    await assess(ui)
    const agentRetry: WorkCommand = { kind: 'retry-agent', ref, expectedRevision: 1, requestId: 'retry-agent' as never }
    expect(await ui.gateway.command(agentRetry)).toEqual({ ref: { kind: 'agent', id: 'revision' } })
    expect(ui.agentCommand).toHaveBeenLastCalledWith({ kind: 'retry', runId: ref.id, expectedRevision: 1, requestId: 'retry-agent' })
    expect((await ui.service.detail(ref)).review?.revision).toBe(1)
    ui.agentCommand.mockResolvedValueOnce({ agentId: ui.run.agentId } as never)
    await expect(ui.service.command(agentRetry)).rejects.toThrow('Task retry returned no run identity')
    const workflowRetry: WorkCommand = { kind: 'retry-workflow', ref: flowRef, requestId: 'retry-workflow' as never }
    expect(await ui.service.command(workflowRetry)).toEqual({ ref: { kind: 'workflow', id: 'revision' } })
    expect(ui.workflowCommand).toHaveBeenLastCalledWith({ kind: 'retry', runId: flowRef.id, requestId: 'retry-workflow' })
    ui.workflowCommand.mockResolvedValueOnce({ workflowId: ui.workflow.workflowId, runIds: [] })
    await expect(ui.service.command(workflowRetry)).rejects.toThrow('Workflow retry returned no run identity')
    ui.workflowCommand.mockResolvedValueOnce({ workflowId: ui.workflow.workflowId } as never)
    await expect(ui.service.command(workflowRetry)).rejects.toThrow('Workflow retry returned no run identity')
  })
  it('enforces capacity without deleting history and contains failures in post-commit observers', async () => {
    const ui = await boot({ maxReviewDecisions: 1 })
    ctxListeners(ui.ctx)
    const changed = vi.fn(); ui.ctx.on('work-center/changed', changed)
    expect(await assess(ui)).toEqual({ ref, reviewRevision: 1 })
    expect(changed).toHaveBeenCalledWith(ref)
    expect(await assess(ui)).toEqual({ ref, reviewRevision: 1 })
    await expect(assess(ui, ref, { expectedRevision: 1, decisionId: 'second' as never })).rejects.toThrow('capacity')
    const narrow = await boot({ maxRecordBytes: 1024 })
    narrow.run.submission!.brief = { ...brief, constraints: 'x'.repeat(1000), acceptanceCriteria: ['x'.repeat(800)] }
    await expect(assess(narrow)).rejects.toThrow('maxRecordBytes')
    const service = ui.service
    await ui.ctx.fiber.dispose()
    await expect(service.detail(ref)).rejects.toThrow('unloading')
    await expect(boot({ pageSize: 6, maxPageSize: 5 })).rejects.toThrow('pageSize')
  })
})
function ctxListeners(ctx: Context) {
  ctx.on('work-center/changed', () => { throw new Error('Observer threw') })
  // oxlint-disable-next-line typescript/no-misused-promises -- Model a rejecting untyped void listener.
  ctx.on('work-center/changed', (() => Promise.reject(new Error('Observer rejected'))))
}

it('checks the source key, delivery reference, revision sequence, and unique decision identities on committed records', async () => {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(InvariantRegistry)
  const fiber = ctx.plugin(Companion)
  await fiber.await()
  const review = { ref, version: 'version', revision: 1, decisionId: 'id', delivery: { version: 'version' } }
  const change = (value: object, patch: object = {}) => { ctx.emit('domain/changed', { domain: 'work_center_reviews', table: 'assessments', operation: 'put', key: 'agent:same', value, ...patch } as never) }
  expect(() => { change({ ref, history: [review] }) }).not.toThrow()
  expect(() => { change({}, { domain: 'other' }) }).not.toThrow()
  expect(() => { change({}, { table: 'other' }) }).not.toThrow()
  expect(() => { change({}, { operation: 'deleted' }) }).not.toThrow()
  expect(() => { change({ ref: flowRef, history: [] }) }).toThrow('key differs')
  expect(() => { change({ ref, history: [{ ...review, ref: flowRef }] }) }).toThrow('another execution')
  expect(() => { change({ ref, history: [{ ...review, version: 'other' }] }) }).toThrow('version differs')
  expect(() => { change({ ref, history: [{ ...review, revision: 2 }] }) }).toThrow('not contiguous')
  expect(() => { change({ ref, history: [review, { ...review, revision: 2 }] }) }).toThrow('duplicate')
  expect(Companion.name).toBe('work-center-invariant')
  await fiber.dispose()
})

describe('on-demand failure diagnosis', () => {
  it('retains the original run error and exact recorded failures inside the settled interval', async () => {
    const ui = await boot()
    ui.run.status = 'failed'; ui.run.error = 'Original failure'
    ui.inspect.mockResolvedValueOnce({ events: [
      { seq: 0, time: 0, type: 'tool/call', data: { callId: 'call', name: 'read', arguments: 'private-input' } },
      { seq: 1, time: 10, type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'call', isError: true, content: [{ type: 'text', text: 'Tool timed out' }] }] }, error: { name: 'Timeout', code: 'TOOL_TIMEOUT' } } },
      { seq: 2, time: 20, type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { message: 'Request denied', code: 'AUTH', status: 401 } } } },
      { seq: 3, time: 30, type: 'turn/end', data: { turn: 2, reason: { kind: 'error', error: { message: 'Later failure', code: 'TIMEOUT' } } } },
    ] } as never)
    const result = await ui.gateway.diagnose(ref)
    expect(result.ref).toEqual(ref)
    expect(result.status).toBe('failed')
    expect(result.retry).toEqual({ kind: 'agent', agentId: 'agent', task: 'Task' })
    expect(result.sources[1]).toMatchObject({ kind: 'session', sessionId: 'session', state: 'available', throughSeq: 2 })
    expect(result.findings.map(item => [item.category, item.terminal])).toEqual([['unknown', true], ['timeout', false], ['authentication', true]])
    expect(result.findings[0]?.message).toBe('Original failure')
    expect(JSON.stringify(result)).not.toContain('private-input'); expect(JSON.stringify(result)).not.toContain('Later failure')
    expect(ui.agentCommand).not.toHaveBeenCalled(); expect(ui.workflowCommand).not.toHaveBeenCalled()
    ui.run.purpose = 'design'; ui.run.configuration = { revision: 2 } as never
    expect((await ui.service.diagnose(ref)).retry).toMatchObject({ purpose: 'design', configuration: { revision: 2 } })
    expect((await ui.service.detail(ref)).configuration).toEqual({ revision: 2 })
    ui.workflow.feedback = 'Original feedback'
    expect((await ui.service.diagnose(flowRef)).retry).toMatchObject({ feedback: 'Original feedback' })
  })
  it('exposes absent logs and missing interval evidence rather than inferring a cause from wording', async () => {
    const ui = await boot()
    ui.run.status = 'cancelled'; ui.run.error = 'Timeout mentioned in user content'
    ui.inspect.mockRejectedValueOnce(new Error('external-secret'))
    let report = await ui.service.diagnose(ref)
    expect(report.sources[1]?.state).toBe('unavailable')
    expect(report.findings[0]?.category).toBe('cancelled')
    expect(JSON.stringify(report)).not.toContain('external-secret')
    ui.run.status = 'interrupted'; delete ui.run.error
    delete ui.run.settledSeq
    const before = ui.inspect.mock.calls.length
    report = await ui.service.diagnose(ref)
    expect(ui.inspect.mock.calls).toHaveLength(before)
    expect(report.sources[1]?.state).toBe('interval-unknown')
    expect(report.findings[0]).toMatchObject({ category: 'interrupted', message: '' })
    ui.run.settledSeq = 2
    report = await ui.service.diagnose(ref)
    expect(report.sources[1]?.state).toBe('interval-unknown')
  })
  it('keeps oversized source evidence explicit and rejects an oversized complete report', async () => {
    const ui = await boot({ maxDiagnosisFindings: 1 })
    ui.inspect.mockResolvedValueOnce({ events: [
      { seq: 1, time: 1, type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'AUTH', message: 'one' } } } },
      { seq: 2, time: 2, type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'AUTH', message: 'two' } } } },
    ] } as never)
    let report = await ui.service.diagnose(ref)
    expect(report.sources[1]?.state).toBe('capacity'); expect(report.findings).toEqual([])
    ui.inspect.mockResolvedValueOnce({ events: [{ seq: 2, time: 2, type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'AUTH', message: '一'.repeat(100000) } } } }] } as never)
    report = await ui.service.diagnose(ref)
    expect(report.sources[1]?.state).toBe('capacity')
    ui.run.error = '一'.repeat(100000)
    await expect(ui.service.diagnose(ref)).rejects.toThrow('byte capacity')
    delete ui.run.error
    ui.workflow.assertion = { passed: false }
    ui.workflow.error = 'Workflow failure'
    await expect(ui.service.diagnose(flowRef)).rejects.toThrow('finding or byte capacity')
  })
  it('separates workflow assertions, node records, and child-session observations by their actual sources', async () => {
    const ui = await boot()
    const attempt = { id: 'attempt', nodeId: 'node', status: 'failed', inputs: {}, sources: {}, preset: 'standard', cwd: ui.root,
      startedAt: 10, endedAt: 30, error: 'Original node error', childSessionId: 'child' }
    ui.workflow.status = 'failed'; ui.workflow.error = 'Original workflow error'; ui.workflow.assertion = { passed: false, detail: 'Acceptance failed' }
    ui.workflow.attempts = [attempt, { ...attempt, id: 'missing-time', nodeId: 'missing-time', status: 'cancelled', startedAt: undefined, error: 'Cancelled node', childSessionId: 'missing-child' },
      { ...attempt, id: 'interrupted', nodeId: 'interrupted', status: 'interrupted', childSessionId: undefined },
      { ...attempt, id: 'pending', nodeId: 'pending', status: 'pending', error: undefined, childSessionId: undefined }] as never
    ui.inspect.mockResolvedValueOnce({ events: [
      { seq: 1, time: 20, type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'TIMEOUT', message: 'Child timeout' } } } },
      { seq: 2, time: 40, type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'AUTH', message: 'Later user work' } } } },
    ] } as never)
    const report = await ui.service.diagnose(flowRef)
    expect(report.findings.map(item => item.scope)).toEqual(['run', 'assertion', 'node', 'turn', 'node', 'node'])
    expect(report.findings.find(item => item.scope === 'assertion')?.message).toBe('Acceptance failed')
    expect(report.findings.find(item => item.scope === 'turn')).toMatchObject({ category: 'timeout', terminal: false, message: 'Child timeout' })
    expect(report.sources[1]).toMatchObject({ sessionId: 'child', nodeId: 'node', state: 'available', interval: { from: 10, to: 30 } })
    expect(report.sources[2]).toMatchObject({ sessionId: 'missing-child', nodeId: 'missing-time', state: 'interval-unknown' })
    expect(JSON.stringify(report)).not.toContain('Later user work')
    expect(report.findings.filter(item => item.scope === 'node').map(item => item.category)).toEqual(['unknown', 'cancelled', 'interrupted'])
    delete ui.workflow.error; ui.workflow.assertion = { passed: false }; ui.workflow.attempts = []
    expect((await ui.service.diagnose(flowRef)).findings[0]?.message).toBe('')
    ui.workflow.assertion = { passed: true }
    expect((await ui.service.diagnose(flowRef)).findings).toEqual([{ source: 0, scope: 'run', terminal: true, message: '', category: 'unknown' }])
  })
  it('bounds child-source fanout and accepts a successful empty child transcript', async () => {
    const ui = await boot({ maxDiagnosisSources: 1 })
    const attempt = { id: 'a', nodeId: 'a', status: 'succeeded', inputs: {}, sources: {}, preset: 'standard', cwd: ui.root, startedAt: 1, endedAt: 2, childSessionId: 'child' }
    ui.workflow.attempts = [attempt, { ...attempt, id: 'b' }] as never
    await expect(ui.service.diagnose(flowRef)).rejects.toThrow('maxDiagnosisSources')
    ui.workflow.attempts = [attempt] as never
    ui.inspect.mockResolvedValueOnce({ events: [] })
    expect((await ui.service.diagnose(flowRef)).sources[1]?.state).toBe('available')
  })
})
it('keeps diagnostic evidence independent of the committed human delivery assessment', async () => {
  const ui = await boot()
  await assess(ui)
  const page = await ui.service.query({ limit: 2 })
  expect(page.items[0]?.review?.decision).toBe('changes-requested')
  expect(page.items[0]?.review).not.toHaveProperty('delivery')
  const before = await ui.service.detail(ref)
  await ui.service.diagnose(ref)
  expect((await ui.service.detail(ref)).review).toEqual(before.review)
})

it('exposes bounded source statistics and safe executor choices through the generated gateway', async () => {
  const ui = await boot()
  const report = await ui.gateway.statistics({ from: 0, to: 1000, timeZone: 'UTC', usage: 'skip' })
  expect(report.counts.runs).toBe(1)
  const query = { from: 0, to: 1000, timeZone: 'UTC', usage: 'skip' as const }
  const pending = ui.service.statistics(query)
  query.from = 2000
  expect((await pending).query.from).toBe(0)
  const choices = await ui.gateway.statisticsChoices({})
  expect(choices.executors).toHaveLength(2)
  expect(JSON.stringify(choices)).not.toContain('secret')
})

it('reads detached source metadata and exact retained reviews without recapturing files or transcripts', async () => {
  const ui = await boot()
  const reference = structuredClone(ref), reading = ui.service.source(reference)
  reference.id = 'mutated' as never
  expect(await reading).toEqual({ ref, name: 'Reporter', workspaceId: ui.run.workspaceId, sessionId: ui.run.sessionId, status: 'completed' })
  expect(ui.agentInspect).toHaveBeenLastCalledWith(ref.id)
  expect(await ui.service.source(flowRef)).toMatchObject({ ref: flowRef, name: 'Review report', status: 'succeeded' })
  expect(ui.inspect).not.toHaveBeenCalled(); expect(ui.workspace).not.toHaveBeenCalled()
  ui.run.submission!.brief = { ...brief, deliverables: ['bom.txt'] }
  await writeFile(join(ui.root, 'bom.txt'), '\uFEFFretained')
  await assess(ui, ref, { decision: 'accepted' })
  const before = ui.inspect.mock.calls.length
  await writeFile(join(ui.root, 'bom.txt'), 'changed')
  const retained = await ui.service.review(ref, 1)
  expect(retained.delivery.artifacts[0]).toMatchObject({ state: 'captured', content: '\uFEFFretained', bytes: 11 })
  retained.reason = 'mutated'
  expect((await ui.service.review(ref, 1)).reason).toBe('Add citations')
  expect(ui.inspect).toHaveBeenCalledTimes(before)
  await expect(ui.service.review(ref, 2)).rejects.toThrow('Unknown committed')
})
