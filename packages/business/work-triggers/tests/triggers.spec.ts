/** Durable trigger ownership over real JSON storage and nondeterministic native admission ports. */
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as Domain from '@deepseek-ai/dsh-storage-domain'
import type { AgentCommand } from '@deepseek-ai/dsh-workbench-agent/types'
import type { WorkflowCommand } from '@deepseek-ai/dsh-business-workflow/workbench-types'
import type { WorkReference, WorkSource } from '@deepseek-ai/dsh-work-center/types'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as Companion from '../src/invariant.ts'
import * as Triggers from '../src/index.ts'
import { WorkTriggerGateway } from '../src/gateway.ts'
import { triggerDomain, type StoredTrigger } from '../src/schema.ts'
import type { TriggerCommand, WorkTriggerId } from '../src/types.ts'
const contexts: Context[] = [], roots: string[] = []
const start = Date.UTC(2026, 9, 21)
let clockNow = start
beforeEach(() => { clockNow = start; vi.spyOn(Date, 'now').mockImplementation(() => clockNow) })
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  vi.restoreAllMocks()
})
const definition = (): Triggers.TriggerDefinition => ({ name: 'Scheduled report', rule: { kind: 'at', at: start + 100 },
  target: { kind: 'agent', id: 'agent' as never, workspaceId: 'workspace' as never, expectedRevision: 1,
    brief: { version: 1, goal: 'Review report', background: '', deliverables: [], acceptanceCriteria: [], constraints: '' } } })
const create = (patch: Partial<Extract<TriggerCommand, { kind: 'create' }>> = {}): Extract<TriggerCommand, { kind: 'create' }> =>
  ({ kind: 'create', id: randomUUID() as WorkTriggerId, definition: definition(), enabled: true, ...patch })
function nativeState() {
  return { admissions: new Map<string, WorkReference>(), statuses: new Map<string, WorkSource['status']>() }
}
async function boot(root?: string, config: Partial<Triggers.Config> = {}, state = nativeState()) {
  if (root === undefined) { root = await mkdtemp(join(tmpdir(), 'dsh-triggers-')); roots.push(root) }
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage); await ctx.plugin(JsonStorage, { root: join(root, 'storage') }); await ctx.plugin(Domain, { backend: 'json' })
  const source = vi.fn(async (ref: WorkReference): Promise<WorkSource> => ({ ref, name: 'Execution', workspaceId: 'workspace' as never,
    sessionId: 'session' as never, status: state.statuses.get(ref.id) ?? 'running' }))
  const preflight = vi.fn(async () => ({ agentRevision: 1, issues: [] }))
  const admit = (requestId: string, kind: WorkReference['kind']) => {
    const known = state.admissions.get(requestId)
    if (known !== undefined) return known
    const ref: WorkReference = kind === 'agent' ? { kind: 'agent', id: randomUUID() as never }
      : { kind: 'workflow', id: randomUUID() as never }
    state.admissions.set(requestId, ref)
    return ref
  }
  const agent = vi.fn(async (request: AgentCommand) => {
    if (request.kind !== 'submit-task') throw new Error('Unexpected native command')
    const ref = admit(request.requestId, 'agent'); return { agentId: request.id, runId: ref.id }
  })
  const workflow = vi.fn(async (request: WorkflowCommand) => {
    if (request.kind !== 'start' || request.requestId === undefined) throw new Error('Unexpected native command')
    const ref = admit(request.requestId, 'workflow'); return { workflowId: request.id, runIds: [ref.id] }
  })
  const snapshot = vi.fn(async () => ({ workflows: [{ id: 'workflow', workspaceId: 'workspace', archived: false,
    versions: [{ id: 'publication', definition: { requirement: { inputs: [{ name: 'report' }] } } }] }] }))
  const validate = vi.fn(() => ({ valid: true, issues: [] as string[] }))
  const workspace = vi.fn(() => ({ id: 'workspace', path: root }))
  ctx.provide('workCenter', { source } as never)
  const inspectAgent = vi.fn(async () => ({ id: 'original', agentId: 'agent', agentName: 'Reporter', workspaceId: 'workspace', prompt: 'Original goal' }))
  const agentSnapshot = vi.fn(async () => ({ agents: [{ id: 'agent', revision: 7, archived: false }] }))
  const inspectWorkflow = vi.fn(async () => ({ mode: 'execution', workflowId: 'workflow', workspaceId: 'workspace', version: { id: 'publication' }, inputs: { report: 'Original input' } }))
  ctx.provide('workbenchAgents', { preflight, command: agent, inspectRun: inspectAgent, snapshot: agentSnapshot } as never)
  ctx.provide('workflowWorkbench', { snapshot, validate, command: workflow, inspectRun: inspectWorkflow } as never)
  ctx.provide('workspaceRegistry', { get: workspace } as never)
  const fiber = ctx.plugin(Triggers, { pollIntervalMs: 10, minIntervalMs: 100, maxTriggers: 100, maxDefinitionBytes: 262144,
    maxOccurrences: 10, maxOccurrenceBytes: 16384, maxResponseBytes: 1048576, ...config }); await fiber
  return { ctx, fiber, root, state, source, preflight, agent, workflow, snapshot, validate, workspace,
    inspectAgent, agentSnapshot, inspectWorkflow, service: ctx.workTriggers, gateway: ctx.get('workTriggerGateway') as WorkTriggerGateway }
}
async function phase(ui: Awaited<ReturnType<typeof boot>>, id: WorkTriggerId, state: string) {
  await vi.waitFor(async () => { expect((await ui.service.read(id)).occurrences.at(-1)?.admission.state).toBe(state) }, { interval: 5 })
  return (await ui.service.read(id)).occurrences.at(-1)!
}
it('reserves before native handoff and records settlement without conflating acceptance and success', async () => {
  const ui = await boot(), command = create(), changed = vi.fn(); ui.ctx.on('work-trigger/changed', changed)
  expect(ui.gateway.options({})).toEqual({ minIntervalMs: 100, pollIntervalMs: 10, maxOccurrences: 10 })
  expect(await ui.gateway.command(command)).toEqual({ id: command.id, revision: 1 })
  expect(ui.agent).not.toHaveBeenCalled(); clockNow = start + 99
  await new Promise(resolve => setTimeout(resolve, 20)); expect(ui.agent).not.toHaveBeenCalled()
  clockNow = start + 100
  await phase(ui, command.id, 'admitted')
  expect((await ui.gateway.read({ id: command.id })).definition.name).toBe('Scheduled report')
  expect(JSON.stringify(await ui.service.read(command.id))).not.toContain('requestId')
  expect(JSON.stringify(await ui.gateway.query({ text: '' }))).not.toContain('Review report')
  expect(ui.agent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'submit-task', expectedRevision: 1, brief: command.definition.target.kind === 'agent' ? command.definition.target.brief : undefined }))
  const native = [...ui.state.admissions.values()][0]!; ui.state.statuses.set(native.id, 'failed')
  const settled = await phase(ui, command.id, 'settled')
  expect(settled.admission).toMatchObject({ ref: native, observation: { status: 'failed', observedAt: start + 100 } })
  expect(settled.notices).toMatchObject([{ kind: 'settled', status: 'failed' }])
  expect((await ui.service.query({ text: 'report', workspaceId: 'workspace' as never, enabled: true })).items[0]).toMatchObject({ status: 'consumed', unread: 1 })
  const noticeId = settled.notices[0]!.id
  await ui.service.command({ kind: 'acknowledge', id: command.id, noticeId })
  const count = changed.mock.calls.length; await ui.service.command({ kind: 'acknowledge', id: command.id, noticeId })
  expect(changed).toHaveBeenCalledTimes(count); expect((await ui.service.query({ text: '' })).items[0]?.unread).toBe(0)
  expect((await ui.service.query({ text: 'absent' })).items).toEqual([])
  expect((await ui.service.query({ text: '', workspaceId: 'other' as never })).items).toEqual([])
})
it('recovers immutable creation identity after pause and restart and rejects conflicting definitions or stale controls', async () => {
  const ui = await boot(), command = create({ enabled: false })
  await ui.service.command(command)
  await ui.service.command({ kind: 'set-enabled', id: command.id, expectedRevision: 1, enabled: true })
  await expect(ui.service.command({ kind: 'set-enabled', id: command.id, expectedRevision: 1, enabled: false })).rejects.toThrow('revision changed')
  expect(await ui.service.command(command)).toEqual({ id: command.id, revision: 1 })
  await expect(ui.service.command({ ...command, definition: { ...command.definition, name: 'Other' } })).rejects.toThrow('different definition')
  await ui.fiber.dispose(); clockNow = start + 1000
  const restarted = await boot(ui.root, {}, ui.state)
  expect(await restarted.service.command(command)).toEqual({ id: command.id, revision: 1 })
  await phase(restarted, command.id, 'admitted'); expect(ui.state.admissions.size).toBe(1)
  await restarted.service.command({ kind: 'set-enabled', id: command.id, expectedRevision: 2, enabled: false })
  const ref = [...ui.state.admissions.values()][0]!; ui.state.statuses.set(ref.id, 'completed')
  await phase(restarted, command.id, 'settled')
  await restarted.service.command({ kind: 'set-enabled', id: command.id, expectedRevision: 3, enabled: true })
  await new Promise(resolve => setTimeout(resolve, 25)); expect(ui.state.admissions.size).toBe(1)
})
it('coalesces overdue intervals, blocks overlap, retains paused nominal time, and stops at history capacity', async () => {
  const ui = await boot(undefined, { maxOccurrences: 2 }), command = create({ definition: { ...definition(),
    rule: { kind: 'every', firstAt: start + 100, intervalMs: 100 } } })
  await ui.service.command(command); clockNow = start + 450
  const first = await phase(ui, command.id, 'admitted')
  expect(first).toMatchObject({ dueAt: start + 400, skippedIntervals: 3 })
  expect((await ui.service.read(command.id)).nextAt).toBe(start + 500)
  clockNow = start + 900; await new Promise(resolve => setTimeout(resolve, 20)); expect(ui.state.admissions.size).toBe(1)
  await ui.service.command({ kind: 'set-enabled', id: command.id, expectedRevision: 1, enabled: false })
  ui.state.statuses.set([...ui.state.admissions.values()][0]!.id, 'completed'); await phase(ui, command.id, 'settled')
  expect((await ui.service.read(command.id)).nextAt).toBe(start + 500)
  await ui.service.command({ kind: 'set-enabled', id: command.id, expectedRevision: 2, enabled: true })
  const second = await phase(ui, command.id, 'admitted'); expect(second).toMatchObject({ dueAt: start + 900, skippedIntervals: 4 })
  const secondRef = [...ui.state.admissions.values()][1]!; ui.state.statuses.set(secondRef.id, 'cancelled')
  await phase(ui, command.id, 'settled'); clockNow = start + 2000
  await new Promise(resolve => setTimeout(resolve, 25)); expect(ui.state.admissions.size).toBe(2)
  expect((await ui.service.query({ text: '' })).items[0]?.status).toBe('capacity')
})
it('restores an unconfirmed native handoff without automatic resubmission or a duplicate native run', async () => {
  const ui = await boot(), command = create(), real = ui.agent.getMockImplementation()!
  ui.agent.mockImplementationOnce(async (request) => { await real(request); throw new Error('Lost acknowledgment') })
  await ui.service.command(command); clockNow = start + 100
  const uncertain = await phase(ui, command.id, 'unconfirmed')
  await vi.waitFor(async () => { expect((await ui.service.read(command.id)).occurrences[0]?.notices).toHaveLength(1) })
  expect(ui.state.admissions.size).toBe(1)
  const originalRequest = ui.agent.mock.calls[0]?.[0]
  await ui.fiber.dispose(); const restarted = await boot(ui.root, {}, ui.state)
  await new Promise(resolve => setTimeout(resolve, 25)); expect(restarted.agent).not.toHaveBeenCalled()
  await restarted.service.command({ kind: 'set-enabled', id: command.id, expectedRevision: 1, enabled: false })
  await expect(restarted.service.command({ kind: 'recover', id: command.id, occurrenceId: uncertain.id, expectedAttempt: 1 })).rejects.toThrow('Resume')
  await restarted.service.command({ kind: 'set-enabled', id: command.id, expectedRevision: 2, enabled: true })
  const recover = { kind: 'recover' as const, id: command.id, occurrenceId: uncertain.id, expectedAttempt: 1 }
  await restarted.service.command(recover); await phase(restarted, command.id, 'admitted')
  expect(restarted.agent).toHaveBeenCalledWith(originalRequest); expect(ui.state.admissions.size).toBe(1)
  await expect(restarted.service.command(recover)).rejects.toThrow('attempt changed')
  await expect(restarted.service.command({ ...recover, expectedAttempt: 2 })).rejects.toThrow('Only an unconfirmed')
})
it('watches one exact source settlement and submits a pinned workflow publication through its native request identity', async () => {
  const ui = await boot(), source = { kind: 'agent' as const, id: 'source' as never }
  const command = create({ definition: { name: 'After source', rule: { kind: 'on-settled', source },
    target: { kind: 'workflow', id: 'workflow' as never, workspaceId: 'workspace' as never, versionId: 'publication' as never, inputs: { report: 'Original input' } } } })
  await ui.service.command(command); await new Promise(resolve => setTimeout(resolve, 20)); expect(ui.workflow).not.toHaveBeenCalled()
  ui.state.statuses.set(source.id, 'interrupted')
  await phase(ui, command.id, 'admitted')
  expect(ui.workflow).toHaveBeenCalledWith(expect.objectContaining({ kind: 'start', id: 'workflow', versionId: 'publication', inputs: { report: 'Original input' } }))
  ui.state.statuses.set([...ui.state.admissions.values()][0]!.id, 'succeeded')
  expect((await phase(ui, command.id, 'settled')).notices).toMatchObject([{ kind: 'settled', status: 'succeeded' }])
  await new Promise(resolve => setTimeout(resolve, 20)); expect(ui.workflow).toHaveBeenCalledTimes(1)
})
it('retains source unavailability separately from the last known outcome and recovers observation without another admission', async () => {
  const ui = await boot(), command = create(); await ui.service.command(command); clockNow = start + 100
  await phase(ui, command.id, 'admitted')
  ui.source.mockRejectedValue(new Error('Source unavailable'))
  await vi.waitFor(async () => { expect((await ui.service.read(command.id)).occurrences[0]?.admission).toHaveProperty('unavailableAt') })
  ui.source.mockImplementation(async ref => ({ ref, name: 'Execution', workspaceId: 'workspace' as never, sessionId: 'session' as never, status: 'running' }))
  await vi.waitFor(async () => { expect((await ui.service.read(command.id)).occurrences[0]?.admission).toHaveProperty('observation.status', 'running') })
  expect((await ui.service.read(command.id)).occurrences[0]?.admission).not.toHaveProperty('unavailableAt')
  expect(ui.agent).toHaveBeenCalledTimes(1)
})
it('rejects invalid or unready creation before retaining a rule and applies complete definition and response bounds', async () => {
  const ui = await boot()
  await expect(ui.service.command(create({ id: 'not-uuid' as never }))).rejects.toThrow('UUID')
  await expect(ui.service.command(create({ definition: { ...definition(), rule: { kind: 'at', at: start } } }))).rejects.toThrow('future')
  await expect(ui.service.command(create({ definition: { ...definition(), rule: { kind: 'every', firstAt: start + 1, intervalMs: 99 } } }))).rejects.toThrow('minIntervalMs')
  ui.workspace.mockReturnValueOnce(undefined as never); await expect(ui.service.command(create())).rejects.toThrow('workspace')
  ui.preflight.mockResolvedValueOnce({ agentRevision: 2, issues: [] }); await expect(ui.service.command(create())).rejects.toThrow('revision')
  ui.preflight.mockResolvedValueOnce({ agentRevision: 1, issues: [{ message: 'Runtime missing' }] } as never)
  await expect(ui.service.command(create())).rejects.toThrow('Runtime missing')
  expect((await ui.service.query({ text: '' })).items).toEqual([])
  const tiny = await boot(undefined, { maxDefinitionBytes: 1 })
  await expect(tiny.service.command(create())).rejects.toThrow('maxDefinitionBytes')
  await expect(boot(undefined, { maxResponseBytes: 1 })).rejects.toThrow('maxResponseBytes')
})
it('reports oversized reservations without native admission and clears the process observation after pausing', async () => {
  const ui = await boot(undefined, { maxOccurrenceBytes: 1 }), command = create()
  await ui.service.command(command); clockNow = start + 100
  await vi.waitFor(async () => { expect((await ui.service.query({ text: '' })).failures).toMatchObject([{ id: command.id, code: 'worker-step-failed' }]) })
  expect(ui.agent).not.toHaveBeenCalled(); expect((await ui.service.read(command.id)).occurrences).toEqual([])
  await new Promise(resolve => setTimeout(resolve, 25))
  await ui.service.command({ kind: 'set-enabled', id: command.id, expectedRevision: 1, enabled: false })
  await vi.waitFor(async () => { expect((await ui.service.query({ text: '' })).failures).toEqual([]) })
})
it('contains observer failures after commit and drains an admitted native call before closing its domain', async () => {
  const ui = await boot(), command = create()
  ui.ctx.on('work-trigger/changed', () => { throw new Error('Observer threw') })
  // oxlint-disable-next-line typescript/no-misused-promises -- Emit dispatch must contain post-commit asynchronous callback failures.
  ui.ctx.on('work-trigger/changed', (() => Promise.reject(new Error('Observer rejected'))))
  const waiting = Promise.withResolvers<{ agentId: never; runId: never }>()
  ui.agent.mockReturnValueOnce(waiting.promise)
  await ui.service.command(create({ enabled: false }))
  await ui.service.command(command)
  await ui.service.command(create({ enabled: false }))
  clockNow = start + 100
  await vi.waitFor(() => { expect(ui.agent).toHaveBeenCalledTimes(1) })
  let stopped = false; const stop = ui.fiber.dispose().then(() => { stopped = true })
  try {
    await new Promise(resolve => setImmediate(resolve)); expect(stopped).toBe(false)
    const read = ui.service.query({ text: '' }).then(() => 'read', () => 'rejected')
    const outcome = await Promise.race([read, new Promise(resolve => setTimeout(() => { resolve('pending') }, 20))])
    expect(outcome).toBe('rejected')
  } finally { waiting.resolve({ agentId: 'agent' as never, runId: 'run' as never }); await stop }
  expect(stopped).toBe(true); expect(ui.agent).toHaveBeenCalledTimes(1)
})
it('strictly decodes consumed targets, unfinished phases, native ownership, notices, and unsupported durable fields', async () => {
  const ui = await boot(), command = create(); await ui.service.command(command); clockNow = start + 100
  await phase(ui, command.id, 'admitted')
  const record = ui.ctx.storageDomain.get('work_triggers')!.table('triggers').get(command.id) as StoredTrigger
  expect(triggerDomain.tables.triggers.valueSchema.parse(record)).toEqual(record)
  const occurrence = record.occurrences[0]!
  const corrupt = [ { ...record, unexpected: true }, { ...record, nextAt: start + 100 },
    { ...record, occurrences: [occurrence, occurrence] },
    { ...record, occurrences: [{ ...occurrence, attempts: 0 }] },
    { ...record, occurrences: [{ ...occurrence, admission: { state: 'admitted', acceptedAt: start, ref: { kind: 'workflow', id: 'other' } } }] },
    { ...record, occurrences: [{ ...occurrence, notices: [ { id: randomUUID(), createdAt: start, kind: 'admission-unconfirmed' }, { id: randomUUID(), createdAt: start, kind: 'admission-unconfirmed' } ] }] },
  ]
  for (const value of corrupt) expect(() => triggerDomain.tables.triggers.valueSchema.parse(value)).toThrow()
})

it('rejects unavailable workflow publications and inputs before persisting a definition', async () => {
  const ui = await boot(), command = create({ definition: { name: 'Workflow trigger', rule: { kind: 'at', at: start + 100 },
    target: { kind: 'workflow', id: 'workflow' as never, workspaceId: 'workspace' as never, versionId: 'publication' as never, inputs: { report: 'Ready' } } } })
  ui.snapshot.mockResolvedValueOnce({ workflows: [] })
  await expect(ui.service.command(command)).rejects.toThrow('unavailable')
  ui.snapshot.mockResolvedValueOnce({ workflows: [{ id: 'workflow', archived: true }] } as never)
  await expect(ui.service.command(command)).rejects.toThrow('unavailable')
  ui.snapshot.mockResolvedValueOnce({ workflows: [{ id: 'workflow', archived: false, workspaceId: 'other' }] } as never)
  await expect(ui.service.command(command)).rejects.toThrow('unavailable')
  await expect(ui.service.command({ ...command, definition: { ...command.definition,
    target: { ...command.definition.target, versionId: 'missing' } } } as typeof command)).rejects.toThrow('publication')
  ui.validate.mockReturnValueOnce({ valid: false, issues: ['Preset missing'] })
  await expect(ui.service.command(command)).rejects.toThrow('Preset missing')
  await expect(ui.service.command({ ...command, definition: { ...command.definition,
    target: { ...command.definition.target, inputs: {} } } } as typeof command)).rejects.toThrow('Missing trigger input')
  expect((await ui.service.query({ text: '' })).items).toEqual([])
})
it('bounds trigger count and whole UTF-8 definitions and preserves control access after lowering definition capacity', async () => {
  const command = create({ enabled: false }); command.definition.name = '报告'
  const length = Buffer.byteLength(JSON.stringify(command.definition))
  const tooSmall = await boot(undefined, { maxDefinitionBytes: length - 1 })
  await expect(tooSmall.service.command(command)).rejects.toThrow('maxDefinitionBytes')
  const exact = await boot(undefined, { maxDefinitionBytes: length, maxTriggers: 1 })
  await exact.service.command(command)
  await expect(exact.service.command(create())).rejects.toThrow('capacity')
  const record = await exact.service.read(command.id)
  record.definition.name = 'Changed local copy'; expect((await exact.service.read(command.id)).definition.name).toBe('报告')
  await exact.fiber.dispose(); const lowered = await boot(exact.root, { maxDefinitionBytes: 1 })
  await lowered.service.command({ kind: 'set-enabled', id: command.id, expectedRevision: 1, enabled: false })
  expect((await lowered.service.read(command.id)).revision).toBe(2)
  await expect(lowered.service.read(randomUUID() as WorkTriggerId)).rejects.toThrow('Unknown work trigger')
  await expect(lowered.service.command({ kind: 'acknowledge', id: command.id, noticeId: randomUUID() as never })).rejects.toThrow('Unknown trigger notice')
  await lowered.service.command({ kind: 'set-enabled', id: command.id, expectedRevision: 2, enabled: true })
  await expect(lowered.service.command({ kind: 'recover', id: command.id, occurrenceId: randomUUID() as never, expectedAttempt: 0 })).rejects.toThrow('Unknown trigger occurrence')
})
it('retains an uncertain durable phase if the post-admission write fails, without leaking the operation draft into storage', async () => {
  const ui = await boot(), command = create(); await ui.service.command(command)
  const table = ui.ctx.storageDomain.get('work_triggers')!.table('triggers'), put = table.put.bind(table)
  let fail = true
  vi.spyOn(table, 'put').mockImplementation(async (id, value) => {
    if (fail && (value as StoredTrigger).occurrences[0]?.admission.state === 'admitted') { fail = false; throw new Error('Storage unavailable') }
    await put(id, value)
  })
  clockNow = start + 100
  await phase(ui, command.id, 'unconfirmed')
  await vi.waitFor(() => { expect(ui.state.admissions.size).toBe(1) })
  const occurrence = (await ui.service.read(command.id)).occurrences[0]!
  expect(occurrence.admission).not.toHaveProperty('ref')
  await vi.waitFor(async () => { expect((await ui.service.read(command.id)).occurrences[0]?.notices).toHaveLength(1) })
  await ui.service.command({ kind: 'recover', id: command.id, occurrenceId: occurrence.id, expectedAttempt: 1 })
  await phase(ui, command.id, 'admitted'); expect(ui.state.admissions.size).toBe(1)
})
it('contains a source failure per rule and leaves unrelated due work runnable', async () => {
  const ui = await boot(), watch = create({ definition: { ...definition(), rule: { kind: 'on-settled', source: { kind: 'workflow', id: 'watched' as never } } } })
  await ui.service.command(watch); const ordinary = create(); await ui.service.command(ordinary)
  const original = ui.source.getMockImplementation()!
  ui.source.mockImplementation(async (ref) => { if (ref.id === 'watched') throw new Error('Source missing'); return original(ref) })
  clockNow = start + 100; await phase(ui, ordinary.id, 'admitted')
  expect((await ui.service.query({ text: '' })).failures).toMatchObject([{ id: watch.id }])
  ui.source.mockImplementation(original); ui.state.statuses.set('watched', 'failed')
  await phase(ui, watch.id, 'admitted'); expect(ui.state.admissions.size).toBe(2)
})
it.each(['pending', 'unconfirmed'] as const)('stops before new native handoff during unload after the %s write', async (stopAt) => {
  const ui = await boot(), command = create(); await ui.service.command(command)
  const table = ui.ctx.storageDomain.get('work_triggers')!.table('triggers'), put = table.put.bind(table)
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  let intercepted = false
  vi.spyOn(table, 'put').mockImplementation(async (id, value) => {
    if (!intercepted && (value as StoredTrigger).occurrences[0]?.admission.state === stopAt) {
      intercepted = true; entered.resolve(undefined); await release.promise
    }
    await put(id, value)
  })
  clockNow = start + 100; await entered.promise
  const stopped = ui.fiber.dispose(); await new Promise(resolve => setImmediate(resolve))
  release.resolve(undefined); await stopped; expect(ui.agent).not.toHaveBeenCalled()
  const restored = await boot(ui.root, {}, ui.state)
  if (stopAt === 'pending') await phase(restored, command.id, 'admitted')
  else {
    await phase(restored, command.id, 'unconfirmed')
    await vi.waitFor(async () => { expect((await restored.service.read(command.id)).occurrences[0]?.notices).toHaveLength(1) })
    expect(restored.agent).not.toHaveBeenCalled()
  }
})
it('retries a failed recovery with the same native identity and coalesces repeated pending recovery controls', async () => {
  const ui = await boot(), command = create(); ui.agent.mockRejectedValue(new Error('Native owner unavailable'))
  await ui.service.command(command); clockNow = start + 100
  const occurrence = await phase(ui, command.id, 'unconfirmed')
  const request = { kind: 'recover' as const, id: command.id, occurrenceId: occurrence.id, expectedAttempt: 1 }
  await Promise.all([ui.service.command(request), ui.service.command(request)])
  await vi.waitFor(async () => { expect((await ui.service.read(command.id)).occurrences[0]?.attempts).toBe(2) })
  const result = (await ui.service.read(command.id)).occurrences[0]!
  expect(result.notices.filter(notice => notice.kind === 'admission-unconfirmed')).toHaveLength(1)
  expect(ui.agent.mock.calls[0]?.[0]).toEqual(ui.agent.mock.calls[1]?.[0])
})
it('rejects corrupt stored identity relationships and releases a failed startup domain', async () => {
  const ui = await boot(), command = create(); await ui.service.command(command); clockNow = start + 100
  await phase(ui, command.id, 'admitted'); await ui.fiber.dispose()
  const path = join(ui.root, 'storage', 'work_triggers.json')
  const disk = JSON.parse(await readFile(path, 'utf8')) as { tables: { triggers: Record<string, StoredTrigger> } }
  const record = disk.tables.triggers[command.id]!
  const wrong = randomUUID(); disk.tables.triggers = { [wrong]: record }
  await writeFile(path, JSON.stringify(disk)); await expect(boot(ui.root)).rejects.toThrow('storage key')
  const copy = { ...record, id: randomUUID() as WorkTriggerId }
  disk.tables.triggers = { [record.id]: record, [copy.id]: copy }
  await writeFile(path, JSON.stringify(disk)); await expect(boot(ui.root)).rejects.toThrow('shared by different occurrences')
})

it('contains a late timer callback after the provider has retired', async () => {
  const timers = vi.spyOn(globalThis, 'setTimeout'), ui = await boot()
  const callback = timers.mock.calls[0]![0]
  await ui.fiber.dispose(); callback(); await new Promise(resolve => setImmediate(resolve))
  expect(ui.agent).not.toHaveBeenCalled()
})
it('rejects exhausted durable counters and unrepresentable future intervals before another admission', async () => {
  const ui = await boot(), command = create({ enabled: false }); await ui.service.command(command); await ui.fiber.dispose()
  const path = join(ui.root, 'storage', 'work_triggers.json')
  const disk = JSON.parse(await readFile(path, 'utf8')) as { tables: { triggers: Record<string, StoredTrigger> } }
  const record = disk.tables.triggers[command.id]!
  record.revision = Number.MAX_SAFE_INTEGER
  await writeFile(path, JSON.stringify(disk)); const max = await boot(ui.root)
  await expect(max.service.command({ kind: 'set-enabled', id: command.id, expectedRevision: record.revision, enabled: false })).rejects.toThrow('exhausted')
  await max.fiber.dispose()
  record.revision = 1; record.enabled = true; delete record.nextAt
  record.occurrences = [{ id: randomUUID() as never, requestId: randomUUID() as never, dueAt: start, claimedAt: start,
    skippedIntervals: 0, attempts: Number.MAX_SAFE_INTEGER, admission: { state: 'pending', lastAttemptAt: start }, notices: [] }]
  await writeFile(path, JSON.stringify(disk)); const attempt = await boot(ui.root)
  await vi.waitFor(async () => { expect((await attempt.service.query({ text: '' })).failures).toHaveLength(1) })
  expect(attempt.agent).not.toHaveBeenCalled()
  for (const intervalMs of [Number.MAX_SAFE_INTEGER, 8_640_000_000_000_000 - start]) {
    const clock = await boot(), rule = create({ definition: { ...definition(), rule: { kind: 'every', firstAt: start + 100, intervalMs } } })
    await clock.service.command(rule); clockNow = start + 100
    await vi.waitFor(async () => { expect((await clock.service.query({ text: '' })).failures).toHaveLength(1) })
    expect(clock.agent).not.toHaveBeenCalled(); clockNow = start
  }
})
it('validates event-rule consumption, interval alignment, notice identities, and unfinished-record counts at durable decoding', async () => {
  const ui = await boot(), command = create(); await ui.service.command(command); clockNow = start + 100
  await phase(ui, command.id, 'admitted')
  const record = ui.ctx.storageDomain.get('work_triggers')!.table('triggers').get(command.id) as StoredTrigger
  const occurrence = record.occurrences[0]!, next = { ...occurrence, id: randomUUID(), requestId: randomUUID() }
  const recurring = { ...record, definition: { ...record.definition, rule: { kind: 'every', firstAt: start + 100, intervalMs: 100 } }, nextAt: start + 200 }
  const noticed = { ...occurrence, notices: [{ kind: 'admission-unconfirmed', id: randomUUID(), createdAt: start },
    { kind: 'settled', id: randomUUID(), createdAt: start, status: 'failed' }] }
  noticed.notices[1]!.id = noticed.notices[0]!.id
  const values = [
    { ...record, definition: { ...record.definition, rule: { kind: 'on-settled', source: { kind: 'agent', id: 'watched' } } }, nextAt: start },
    { ...record, occurrences: [], nextAt: start },
    { ...recurring, nextAt: undefined }, { ...recurring, nextAt: start }, { ...recurring, nextAt: start + 201 },
    { ...recurring, occurrences: [occurrence, next] }, { ...record, occurrences: [noticed] },
  ]
  for (const value of values) expect(() => triggerDomain.tables.triggers.valueSchema.parse(value)).toThrow()
})
it('checks committed native request ownership and ignores unrelated domain events', async () => {
  const ctx = new Context(); contexts.push(ctx); await ctx.plugin(InvariantRegistry)
  const fiber = ctx.plugin(Companion); await fiber
  const id = randomUUID(), requestId = randomUUID(), target = { kind: 'agent' }
  const occurrence = { requestId, admission: { state: 'settled', ref: { kind: 'agent' } } }
  const record = { id, definition: { target }, occurrences: [occurrence] }
  const emit = (value: object, patch: object = {}) => { ctx.emit('domain/changed', { domain: 'work_triggers', table: 'triggers', operation: 'put', key: id, value, ...patch } as never) }
  expect(() => { emit(record) }).not.toThrow()
  for (const patch of [{ domain: 'other' }, { table: 'other' }, { operation: 'delete' }]) expect(() => { emit({}, patch) }).not.toThrow()
  expect(() => { emit({ ...record, id: 'other' }) }).toThrow('key differs')
  expect(() => { emit({ ...record, occurrences: [{ ...occurrence, admission: { state: 'pending' } }, { ...occurrence, admission: { state: 'pending' } }] }) }).toThrow('concurrent')
  expect(() => { emit({ ...record, occurrences: [occurrence, occurrence] }) }).toThrow('multiple trigger occurrences')
  expect(() => { emit({ ...record, occurrences: [{ ...occurrence, admission: { state: 'admitted', ref: { kind: 'workflow' } } }] }) }).toThrow('kind differs')
  await fiber.dispose()
})

it('rejects polling values outside the native timer range and unsafe history capacities during configuration', async () => {
  await expect(boot(undefined, { pollIntervalMs: 2_147_483_648 })).rejects.toThrow()
  await expect(boot(undefined, { maxOccurrences: 9_007_199_254_740_992 })).rejects.toThrow()
})

it('prepares original content with current agent revision or original workflow publication without admitting work', async () => {
  const ui = await boot(), agent = { kind: 'agent' as const, id: 'original' as never }
  const prepared = await ui.gateway.prepare({ source: agent })
  expect(prepared).toMatchObject({ name: 'Reporter', target: { kind: 'agent', expectedRevision: 7, brief: { goal: 'Original goal' } } })
  const brief = definition().target.kind === 'agent' ? (definition().target as Extract<Triggers.TriggerTarget, { kind: 'agent' }>).brief : null
  ui.inspectAgent.mockResolvedValueOnce({ ...(await ui.inspectAgent()), submission: { brief } } as never)
  expect((await ui.service.prepare(agent)).target).toMatchObject({ brief })
  ui.inspectAgent.mockResolvedValueOnce({ ...(await ui.inspectAgent()), purpose: 'design' } as never)
  await expect(ui.service.prepare(agent)).rejects.toThrow('Design runs')
  ui.agentSnapshot.mockResolvedValueOnce({ agents: [] })
  await expect(ui.service.prepare(agent)).rejects.toThrow('unavailable')
  ui.agentSnapshot.mockResolvedValueOnce({ agents: [{ id: 'agent', revision: 7, archived: true }] })
  await expect(ui.service.prepare(agent)).rejects.toThrow('unavailable')
  expect(await ui.service.prepare({ kind: 'workflow', id: 'original-workflow' as never })).toMatchObject({ name: 'Execution', target: { kind: 'workflow', versionId: 'publication', inputs: { report: 'Original input' } } })
  ui.inspectWorkflow.mockResolvedValueOnce({ ...(await ui.inspectWorkflow()), mode: 'verification' })
  await expect(ui.service.prepare({ kind: 'workflow', id: 'case' as never })).rejects.toThrow('formal workflow')
  expect(ui.agent).not.toHaveBeenCalled(); expect(ui.workflow).not.toHaveBeenCalled()
})
