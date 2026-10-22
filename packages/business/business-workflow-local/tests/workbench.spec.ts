/** Real storage, Agent/subagent execution, and restart evidence for the workspace workbench. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as Domain from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import type { WorkflowDefinition, WorkflowId, WorkflowRunId } from '@deepseek-ai/dsh-business-workflow/workbench-types'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as Workbench from '../src/workbench.ts'
import { WorkflowGateway } from '../src/workbench-gateway.ts'
import * as Agents from '../../workbench-agent/src/index.ts'
import * as Center from '../../work-center/src/index.ts'
import Skills from '@deepseek-ai/dsh-skill'
import FsLocal from '@deepseek-ai/dsh-fs-local'

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workbench-'))
  roots.push(root)
  await mkdir(join(root, 'presets', 'standard'), { recursive: true })
  await writeFile(join(root, 'presets', 'standard', 'agent.cordis.yml'), '[]\n')
  return root
}
async function boot(
  root: string,
  script: ConstructorParameters<typeof MockAdapter>[0] = [textResponse('ranked leads')],
  config: Partial<Workbench.Config> = {},
) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    import: async (name: string) => {
      if (name === 'test:workbench') return Workbench
      throw new Error(`Unexpected loader module ${name}`)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentDefaultModel, { provider: 'mock', model: 'mock' })
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(JsonlPersistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(Storage)
  await ctx.plugin(JsonStorage, { root: join(root, 'storage') })
  await ctx.plugin(Domain, { backend: 'json' })
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(AgentPresets, {
    default: 'standard',
    roots: [{ path: join(root, 'presets'), trust: 'system' }],
    includeUserRoot: false,
  })
  await ctx.plugin(Subagents)
  await ctx.plugin(Spawn, { providerName: 'spawn' })
  const yaml = join(root, 'cordis.yml')
  await writeFile(
    yaml,
    JSON.stringify([{ name: 'test:workbench', config: {
      presets: ['standard'], generatorPreset: 'standard', subagentProvider: 'spawn', nodeTimeoutMs: 10000, ...config,
    } }]),
  )
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(yaml).href } })
  await ctx.loader.await()
  return { ctx, adapter }
}
function definition(approval = false): WorkflowDefinition {
  return {
    requirement: {
      summary: 'Rank the leads',
      objectives: [{ id: 'rank', statement: 'Rank every lead' }],
      inputs: [{ name: 'leads', description: 'Lead records' }],
      outputs: [{ name: 'ranking', description: 'Ranked records' }],
      constraints: ['Keep all records.'],
      acceptanceCases: [
        { name: 'sample', given: { leads: ['a', 'b'] }, expect: { kind: 'contains', value: 'ranked' } },
      ],
    },
    nodes: [
      ...(approval
        ? [
          {
            id: 'review',
            kind: 'approval' as const,
            title: 'Review leads',
            instruction: 'Confirm that these leads may be processed.',
            preset: 'standard',
            dependsOn: [],
            inputs: [{ name: 'leads', source: { kind: 'requirement' as const, field: 'leads' } }],
            objectives: ['rank'],
          },
        ]
        : []),
      {
        id: 'rank',
        kind: 'agent',
        title: 'Rank',
        instruction: 'Rank these leads.',
        preset: 'standard',
        dependsOn: approval ? ['review'] : [],
        inputs: [
          {
            name: 'leads',
            source: approval ? { kind: 'step', step: 'review' } : { kind: 'requirement', field: 'leads' },
          },
        ],
        objectives: ['rank'],
      },
    ],
    finalOutputs: [{ name: 'ranking', source: { kind: 'step', step: 'rank' } }],
    positions: {},
  }
}
async function publish(ctx: Context, root: string, approval = false) {
  const workspace = await ctx.workspaceRegistry.create(root)
  const created = await ctx.workflowWorkbench.command({
    kind: 'create',
    workspaceId: workspace.id,
    name: 'Lead ranking',
    description: 'Rank the leads',
  })
  await ctx.workflowWorkbench.command({
    kind: 'save',
    id: created.workflowId,
    expectedRevision: 1,
    name: 'Lead ranking',
    definition: definition(approval),
  })
  await ctx.workflowWorkbench.command({ kind: 'publish', id: created.workflowId, expectedRevision: 2 })
  const document = (await ctx.workflowWorkbench.snapshot(created.workflowId)).workflows[0]!
  return { document, version: document.versions[0]! }
}
async function waitRun(ctx: Context, workflowId: WorkflowId, runId: WorkflowRunId, status: string) {
  await expect
    .poll(async () => (await ctx.workflowWorkbench.snapshot(workflowId)).runs.find(item => item.id === runId)?.status)
    .toBe(status)
  return (await ctx.workflowWorkbench.snapshot(workflowId)).runs.find(item => item.id === runId)!
}
async function stopHost(ctx: Context) {
  contexts.splice(contexts.indexOf(ctx), 1)
  await ctx.fiber.dispose()
}

describe('workspace workflow workbench', () => {
  it('copies a pinned publication into an independent draft and replays creation after editing and restart', async () => {
    const root = await scratch()
    const { ctx, adapter } = await boot(root)
    const { document, version } = await publish(ctx, root, true)
    const request = { kind: 'copy' as const, id: document.id, versionId: version.id, workspaceId: document.workspaceId,
      name: 'Independent review', requestId: 'copy-request' as never, template: { id: 'saved-template' as never, version: 1 } }
    const receipt = await ctx.workflowWorkbench.command(request)
    expect(await ctx.workflowWorkbench.command({ ...request, template: { version: 1, id: request.template.id } })).toEqual(receipt)
    const copy = (await ctx.workflowWorkbench.snapshot(receipt.workflowId)).workflows.find(item => item.id === receipt.workflowId)!
    expect(copy.id).not.toBe(document.id)
    expect(copy.draft).toEqual(version.definition)
    expect(copy.versions).toEqual([])
    expect(copy.copiedFrom).toEqual({ id: document.id, versionId: version.id, template: request.template })
    expect(adapter.requests).toEqual([])
    await ctx.workflowWorkbench.command({ kind: 'save', id: copy.id, expectedRevision: 1, name: 'Edited copy', definition: copy.draft })
    expect(await ctx.workflowWorkbench.command(request)).toEqual({ workflowId: copy.id, revision: 2 })
    await expect(ctx.workflowWorkbench.command({ ...request, name: 'Different' })).rejects.toThrow('another workflow copy')
    await expect(ctx.workflowWorkbench.command({ ...request, requestId: '' as never })).rejects.toThrow('nonempty')
    await expect(ctx.workflowWorkbench.command({ ...request, requestId: 'blank' as never, name: '' })).rejects.toThrow('name')
    await expect(ctx.workflowWorkbench.command({ ...request, requestId: 'missing' as never, versionId: 'missing' as never }))
      .rejects.toThrow('Unknown published version')
    await ctx.workflowWorkbench.command({ kind: 'publish', id: copy.id, expectedRevision: 2 })
    const publication = (await ctx.workflowWorkbench.snapshot(copy.id)).workflows.find(item => item.id === copy.id)!.versions[0]!
    const run = await ctx.workflowWorkbench.command({ kind: 'start', id: copy.id, versionId: publication.id, inputs: { leads: [] } })
    const waiting = await waitRun(ctx, copy.id, run.runIds![0]!, 'waiting')
    await ctx.workflowWorkbench.command({ kind: 'cancel', runId: waiting.id })
    await waitRun(ctx, copy.id, waiting.id, 'cancelled')
    await stopHost(ctx)
    const restarted = await boot(root)
    expect((await restarted.ctx.workflowWorkbench.command(request)).workflowId).toBe(copy.id)
    expect((await restarted.ctx.workflowWorkbench.snapshot(copy.id)).workflows.find(item => item.id === copy.id)?.copiedFrom)
      .toEqual(copy.copiedFrom)
    await stopHost(restarted.ctx)
    const full = await boot(root, [], { maxWorkflows: 2 })
    await expect(full.ctx.workflowWorkbench.command({ ...request, requestId: 'overflow-copy' as never }))
      .rejects.toThrow('Workflow capacity reached')
  })

  it('pages committed sources, forwards exact approvals, and idempotently reruns the captured publication with feedback', async () => {
    const root = await scratch()
    const { ctx, adapter } = await boot(root, [textResponse('ranked original'), textResponse('ranked revised')])
    const { document, version } = await publish(ctx, root, true)
    const request = { kind: 'start' as const, id: document.id, versionId: version.id, inputs: { leads: ['a'] }, requestId: 'initial' as never }
    await expect(ctx.workflowWorkbench.command({ ...request, requestId: '' as never })).rejects.toThrow('nonempty')
    const receipt = await ctx.workflowWorkbench.command(request)
    expect(await ctx.workflowWorkbench.command(request)).toEqual(receipt)
    await expect(ctx.workflowWorkbench.command({ ...request, inputs: { leads: ['b'] } })).rejects.toThrow('request ID')
    const runId = receipt.runIds![0]!
    const waiting = await waitRun(ctx, document.id, runId, 'waiting')
    expect(await ctx.workflowWorkbench.inspectRun(runId)).toEqual(waiting)
    await expect(ctx.workflowWorkbench.command({ ...request, requestId: 'early-revision' as never, rerunOf: runId }))
      .rejects.toThrow('settle before rerunning')
    const page = await ctx.workflowWorkbench.queryRuns({ limit: 1, statuses: ['waiting'], workspaceId: document.workspaceId })
    expect(page.items).toMatchObject([{ id: runId, waitingAttemptId: waiting.attempts[0]!.id }])
    expect(page.items[0]).not.toHaveProperty('version')
    await expect(ctx.workflowWorkbench.queryRuns({ limit: 0 })).rejects.toThrow('limit')
    await ctx.workflowWorkbench.command({ kind: 'decide', runId, attemptId: waiting.attempts[0]!.id, approve: true })
    await expect(ctx.workflowWorkbench.command({ kind: 'decide', runId, attemptId: waiting.attempts[0]!.id, approve: true })).rejects.toThrow()
    await waitRun(ctx, document.id, runId, 'succeeded')
    const revision = { ...request, requestId: 'revision' as never, rerunOf: runId, feedback: 'Include source references' }
    const revised = await ctx.workflowWorkbench.command(revision)
    expect(await ctx.workflowWorkbench.command(revision)).toEqual(revised)
    const rerun = await waitRun(ctx, document.id, revised.runIds![0]!, 'waiting')
    await ctx.workflowWorkbench.command({ kind: 'decide', runId: rerun.id, attemptId: rerun.attempts[0]!.id, approve: true })
    const completed = await waitRun(ctx, document.id, rerun.id, 'succeeded')
    expect(completed.version.id).toBe(version.id)
    expect(JSON.stringify(adapter.requests)).toContain('Include source references')
    const transcript = await ctx.sessionPersistence.inspect(completed.sessionId)
    expect(JSON.stringify(transcript.events)).toContain('Include source references')
    expect((await (ctx.get('workflowGateway') as WorkflowGateway).catalog({})).find(item => item.id === document.id)).toEqual({
      id: document.id, name: document.name, workspaceId: document.workspaceId, archived: false,
    })
    expect((await ctx.workflowWorkbench.queryRuns({ limit: 10, workflowId: 'absent' as never })).items).toEqual([])
    expect((await ctx.workflowWorkbench.queryRuns({ limit: 10, workflowId: document.id, createdFrom: completed.createdAt,
      createdBefore: completed.createdAt + 1 })).items.map(run => run.id)).toContain(completed.id)
    expect((await ctx.workflowWorkbench.queryRuns({ limit: 10, createdBefore: 1 })).items).toEqual([])
    for (const bounds of [{ createdFrom: NaN }, { createdBefore: Infinity }, { createdFrom: 2, createdBefore: 1 }])
      await expect(ctx.workflowWorkbench.queryRuns({ limit: 1, ...bounds })).rejects.toThrow('creation bounds')
    const first = await ctx.workflowWorkbench.queryRuns({ limit: 1 })
    const second = await ctx.workflowWorkbench.queryRuns({ limit: 1, before: first.next! })
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(2)
    const third = await ctx.workflowWorkbench.command({ ...request, requestId: 'later' as never })
    const paused = await waitRun(ctx, document.id, third.runIds![0]!, 'waiting')
    await expect(ctx.workflowWorkbench.queryRuns({ limit: 1, before: first.next! })).rejects.toThrow('directory changed')
    const ordered = await ctx.workflowWorkbench.queryRuns({ limit: 3 })
    expect(ordered.items[0]?.id).toBe(paused.id)
    expect(ordered.items.slice(1).map(run => run.updatedAt)).toEqual(ordered.items.slice(1).map(run => run.updatedAt).sort((a, b) => b - a))
    await ctx.workflowWorkbench.command({ kind: 'cancel', runId: paused.id })
    await waitRun(ctx, document.id, paused.id, 'cancelled')
    const finalPage = await ctx.workflowWorkbench.queryRuns({ limit: 1 })
    const owner = ctx.workflowWorkbench
    await stopHost(ctx)
    await expect(owner.queryRuns({ limit: 1 })).rejects.toThrow('unloading')
    await expect(owner.inspectRun(runId)).rejects.toThrow('unloading')
    const restarted = await boot(root)
    expect(await restarted.ctx.workflowWorkbench.command(revision)).toEqual(revised)
    await expect(restarted.ctx.workflowWorkbench.queryRuns({ limit: 1, before: finalPage.next! })).rejects.toThrow('directory changed')
  })

  it('retains exact delivery evidence, rejects stale acceptance, and creates explicit revision tasks through the assembled owners', async () => {
    const root = await scratch()
    const { ctx, adapter } = await boot(root, [textResponse('Report complete'), textResponse('Revised report')])
    await ctx.plugin(Skills)
    await ctx.plugin(FsLocal)
    await ctx.plugin(Agents, {
      runtimePreset: 'standard', maxActiveRuns: 8, maxAgents: 100, maxRuns: 1000, maxRecordBytes: 1048576,
      defaultConcurrency: 1, mcpToolCallTimeoutMs: 10000, maxRunPageSize: 100,
    })
    await ctx.plugin(Center, {
      pageSize: 1, maxPageSize: 100, maxReviewDecisions: 100, maxRecordBytes: 1048576,
      maxDeliveryBytes: 262144, maxArtifactBytes: 131072,
      maxStatisticsRuns: 5000, maxStatisticsSessions: 100, maxStatisticsGroups: 1000, maxStatisticsBytes: 1048576,
      maxDiagnosisSources: 50, maxDiagnosisFindings: 200, maxDiagnosisBytes: 262144,
    })
    ctx.llm.registerConfigurableProviders([{ provider: 'mock', displayName: 'Test executor', settingsNs: '', settingsPath: [], localCommand: process.execPath, defaultModel: 'mock' }])
    const workspace = await ctx.workspaceRegistry.create(root)
    const agent = await ctx.workbenchAgents.command({ kind: 'create', definition: { name: 'Reporter', avatar: '', description: '', instructions: 'Write a report', runtime: 'mock', skills: [], mcpServers: [], starters: [], concurrency: 1 } })
    const brief = { version: 1 as const, goal: 'Prepare a report', background: '', deliverables: ['report.txt'], acceptanceCriteria: ['Includes references'], constraints: '' }
    const check = await ctx.workbenchAgents.preflight({ id: agent.agentId, workspaceId: workspace.id, brief })
    expect(check.issues).toEqual([])
    expect(adapter.requests).toHaveLength(0)
    const receipt = await ctx.workbenchAgents.command({ kind: 'submit-task', id: agent.agentId, workspaceId: workspace.id, expectedRevision: 1, requestId: 'report' as never, brief })
    const ref = { kind: 'agent' as const, id: receipt.runId! }
    await expect.poll(async () => (await ctx.workbenchAgents.inspectRun(ref.id)).status).toBe('completed')
    const missing = await ctx.workCenter.detail(ref)
    expect(missing.delivery?.artifacts[0]).toMatchObject({ state: 'unavailable' })
    await expect(ctx.workCenter.command({ kind: 'review', ref, version: missing.delivery!.version, expectedRevision: 0,
      decisionId: 'missing' as never, decision: 'accepted', reason: '' })).rejects.toThrow('artifacts are unavailable')
    await writeFile(join(root, 'report.txt'), 'Evidence version one')
    const initial = await ctx.workCenter.detail(ref)
    expect(initial.delivery?.outputs[0]?.text).toBe('Report complete')
    expect(initial.delivery?.artifacts[0]).toMatchObject({ state: 'captured', content: 'Evidence version one' })
    expect(JSON.stringify(adapter.requests)).toContain(JSON.stringify(check.prompt!).slice(1, -1))
    const accept = { kind: 'review' as const, ref, version: initial.delivery!.version, expectedRevision: 0, decisionId: 'accept' as never, decision: 'accepted' as const, reason: 'Checked the file' }
    await writeFile(join(root, 'report.txt'), 'Evidence version two')
    await expect(ctx.workCenter.command(accept)).rejects.toThrow('changed')
    const current = await ctx.workCenter.detail(ref)
    const changes = { ...accept, version: current.delivery!.version, decisionId: 'changes' as never, decision: 'changes-requested' as const, reason: 'Add missing references' }
    expect(await ctx.workCenter.command(changes)).toEqual({ ref, reviewRevision: 1 })
    expect(await ctx.workCenter.command(changes)).toEqual({ ref, reviewRevision: 1 })
    await expect(ctx.workCenter.command({ ...changes, reason: 'Different feedback' })).rejects.toThrow('another review')
    expect(adapter.requests).toHaveLength(1)
    await expect(ctx.workCenter.command({ ...changes, decisionId: 'conflict' as never })).rejects.toThrow('another window')
    const amended = await ctx.workCenter.revisionBrief({ ref, reviewRevision: 1, brief })
    const preview = await ctx.workbenchAgents.preflight({ id: agent.agentId, workspaceId: workspace.id, brief: amended })
    const revision = { kind: 'revise-agent' as const, ref, reviewRevision: 1, requestId: 'revised-report' as never, agentRevision: 1, brief }
    const next = await ctx.workCenter.command(revision)
    expect(await ctx.workCenter.command(revision)).toEqual(next)
    await expect.poll(async () => next.ref.kind === 'agent' && (await ctx.workbenchAgents.inspectRun(next.ref.id)).status).toBe('completed')
    expect(JSON.stringify(adapter.requests)).toContain(JSON.stringify(preview.prompt!).slice(1, -1))
    await writeFile(join(root, 'report.txt'), 'Evidence version three')
    const reviewed = await ctx.workCenter.detail(ref)
    expect(reviewed.review?.delivery.artifacts[0]).toMatchObject({ content: 'Evidence version two' })
    expect(reviewed.delivery?.artifacts[0]).toMatchObject({ content: 'Evidence version three' })
    await ctx.workCenter.command({ ...accept, decisionId: 'accepted-current' as never, version: reviewed.delivery!.version, expectedRevision: 1 })
    const history = await ctx.workCenter.detail(ref)
    expect(history.priorReviews?.[0]?.delivery).toEqual(reviewed.review?.delivery)
    expect(await ctx.workCenter.command(changes)).toEqual({ ref, reviewRevision: 1 })
    await writeFile(join(root, 'report.txt'), 'x'.repeat(131073))
    const oversized = await ctx.workCenter.detail(ref)
    expect(oversized.delivery?.artifacts[0]).toMatchObject({ state: 'unavailable' })
    await expect(ctx.workCenter.command({ ...accept, decisionId: 'oversized' as never,
      version: oversized.delivery!.version, expectedRevision: 2 })).rejects.toThrow('artifacts are unavailable')
    const failedSource = vi.spyOn(ctx.workflowWorkbench, 'queryRuns').mockRejectedValueOnce(new Error('Workflow directory offline'))
    expect((await ctx.workCenter.query({ limit: 1 })).failures).toEqual([{ source: 'workflow', message: 'Workflow directory offline' }])
    failedSource.mockRestore()
    const page = await ctx.workCenter.query({ limit: 1, source: 'agent', workspaceId: workspace.id })
    expect(page.items).toHaveLength(1)
    expect(page.next).toBeDefined()
    expect((await ctx.workCenter.query({ limit: 1, source: 'agent', workspaceId: workspace.id, cursor: page.next! })).items).toHaveLength(1)
    await expect(ctx.workCenter.query({ limit: 2, cursor: page.next! })).rejects.toThrow('another work query')
    await stopHost(ctx)
    const restarted = await boot(root)
    await restarted.ctx.plugin(Skills)
    await restarted.ctx.plugin(FsLocal)
    await restarted.ctx.plugin(Agents, {
      runtimePreset: 'standard', maxActiveRuns: 8, maxAgents: 100, maxRuns: 1000, maxRecordBytes: 1048576,
      defaultConcurrency: 1, mcpToolCallTimeoutMs: 10000, maxRunPageSize: 100,
    })
    await restarted.ctx.plugin(Center, {
      pageSize: 1, maxPageSize: 100, maxReviewDecisions: 100, maxRecordBytes: 1048576,
      maxDeliveryBytes: 262144, maxArtifactBytes: 131072,
      maxStatisticsRuns: 5000, maxStatisticsSessions: 100, maxStatisticsGroups: 1000, maxStatisticsBytes: 1048576,
      maxDiagnosisSources: 50, maxDiagnosisFindings: 200, maxDiagnosisBytes: 262144,
    })
    expect((await restarted.ctx.workCenter.detail(ref)).priorReviews?.[0]?.delivery).toEqual(reviewed.review?.delivery)
    expect(await restarted.ctx.workCenter.command(changes)).toEqual({ ref, reviewRevision: 1 })
  })

  it('saves without a conversation, rejects conflicting edits, and retains immutable publications after restart', async () => {
    const root = await scratch()
    const { ctx } = await boot(root)
    const { document, version } = await publish(ctx, root)
    await expect(
      ctx.workflowWorkbench.command({
        kind: 'save',
        id: document.id,
        expectedRevision: 1,
        name: 'stale',
        definition: definition(),
      }),
    ).rejects.toThrow('Draft conflict')
    const edited = definition()
    edited.nodes[0]!.instruction = 'Changed instructions'
    await ctx.workflowWorkbench.command({
      kind: 'save',
      id: document.id,
      expectedRevision: 3,
      name: 'Edited',
      definition: edited,
    })
    await stopHost(ctx)
    const restarted = await boot(root)
    const restored = (await restarted.ctx.workflowWorkbench.snapshot(document.id)).workflows[0]!
    expect(restored.draft.nodes[0]!.instruction).toBe('Changed instructions')
    expect(restored.versions[0]).toEqual(version)
    expect(restarted.ctx.agents.list()).toEqual([])
  })

  it('executes the published snapshot and records actual context, full outputs, and a durable audit', async () => {
    const root = await scratch()
    const { ctx, adapter } = await boot(root)
    const { document, version } = await publish(ctx, root)
    const receipt = await ctx.workflowWorkbench.command({
      kind: 'start',
      id: document.id,
      versionId: version.id,
      inputs: { leads: ['real customer'] },
    })
    const run = await waitRun(ctx, document.id, receipt.runIds![0]!, 'succeeded')
    expect(run.outputs).toEqual({ ranking: 'ranked leads' })
    expect(run.attempts[0]).toMatchObject({
      status: 'succeeded',
      inputs: { leads: ['real customer'] },
      provider: 'mock',
      model: 'mock',
      preset: 'standard',
      tools: [],
    })
    expect(run.attempts[0]!.prompt).toContain('Keep all records.')
    expect(adapter.requests).toHaveLength(1)
    await expect.poll(() => ctx.agents.list().length).toBe(0)
    await stopHost(ctx)
    const restarted = await boot(root)
    expect((await restarted.ctx.workflowWorkbench.snapshot(document.id)).runs[0]).toEqual(run)
  })

  it('restores human waiting after restart and accepts a decision only once', async () => {
    const root = await scratch()
    const { ctx } = await boot(root)
    const { document, version } = await publish(ctx, root, true)
    const receipt = await ctx.workflowWorkbench.command({
      kind: 'start',
      id: document.id,
      versionId: version.id,
      inputs: { leads: ['a'] },
    })
    const waiting = await waitRun(ctx, document.id, receipt.runIds![0]!, 'waiting')
    expect(ctx.agents.list()).toEqual([])
    await stopHost(ctx)
    const { ctx: restarted } = await boot(root)
    const request = { kind: 'decide' as const, runId: waiting.id, attemptId: waiting.attempts[0]!.id, approve: true }
    await restarted.workflowWorkbench.command(request)
    await expect(restarted.workflowWorkbench.command(request)).rejects.toThrow('no longer waiting')
    const done = await waitRun(restarted, document.id, waiting.id, 'succeeded')
    expect(done.attempts[1]!.inputs).toEqual({ leads: '{"leads":["a"]}' })
    expect(done.attempts[1]!.sources).toEqual({ leads: {
      kind: 'step', nodeId: 'review', attemptId: done.attempts[0]!.id,
    } })
  })

  it('cancels a waiting run before deciding and skips all downstream work', async () => {
    const root = await scratch()
    const { ctx, adapter } = await boot(root)
    const { document, version } = await publish(ctx, root, true)
    const receipt = await ctx.workflowWorkbench.command({
      kind: 'start',
      id: document.id,
      versionId: version.id,
      inputs: { leads: [] },
    })
    const waiting = await waitRun(ctx, document.id, receipt.runIds![0]!, 'waiting')
    await ctx.workflowWorkbench.command({ kind: 'cancel', runId: waiting.id })
    await expect(
      ctx.workflowWorkbench.command({
        kind: 'decide',
        runId: waiting.id,
        attemptId: waiting.attempts[0]!.id,
        approve: true,
      }),
    ).rejects.toThrow('no longer waiting')
    const done = await waitRun(ctx, document.id, waiting.id, 'cancelled')
    expect(done.attempts.map(attempt => attempt.status)).toEqual(['cancelled', 'skipped'])
    expect(adapter.requests).toEqual([])
  })

  it('waits for active child cleanup before recording cancellation', async () => {
    const root = await scratch()
    const { ctx } = await boot(root, ['hang-slow'])
    const { document, version } = await publish(ctx, root)
    const receipt = await ctx.workflowWorkbench.command({
      kind: 'start',
      id: document.id,
      versionId: version.id,
      inputs: { leads: [] },
    })
    await expect
      .poll(async () => (await ctx.workflowWorkbench.snapshot(document.id)).runs[0]?.attempts[0]?.childSessionId)
      .toBeTruthy()
    await ctx.workflowWorkbench.command({ kind: 'cancel', runId: receipt.runIds![0]! })
    const immediate = (await ctx.workflowWorkbench.snapshot(document.id)).runs[0]!
    expect(['stopping', 'cancelled']).toContain(immediate.status)
    await waitRun(ctx, document.id, receipt.runIds![0]!, 'cancelled')
    await expect.poll(() => ctx.agents.list().length).toBe(0)
  })

  it('keeps execution success separate from a failed acceptance assertion', async () => {
    const root = await scratch()
    const { ctx } = await boot(root, [textResponse('unmatched output')])
    const { document, version } = await publish(ctx, root)
    const receipt = await ctx.workflowWorkbench.command({ kind: 'verify', id: document.id, versionId: version.id })
    const run = await waitRun(ctx, document.id, receipt.runIds![0]!, 'succeeded')
    expect(run.mode).toBe('verification')
    expect(run.assertion?.passed).toBe(false)
    expect(run.caseName).toBe('sample')
  })

  it('rejects invalid DAGs, unknown presets, incomplete cases, and unsupported fields', async () => {
    const root = await scratch()
    const { ctx } = await boot(root)
    const invalid = definition()
    invalid.nodes[0]!.dependsOn = ['missing']
    invalid.nodes[0]!.preset = 'administrator'
    expect(ctx.workflowWorkbench.validate(invalid)).toMatchObject({ valid: false })
    const cycle = definition(true)
    cycle.nodes[0]!.dependsOn = ['rank']
    expect(ctx.workflowWorkbench.validate(cycle).issues.join('\n')).toMatch(/cycl/i)
    const incomplete = definition()
    incomplete.requirement.acceptanceCases[0]!.given = {}
    expect(ctx.workflowWorkbench.validate(incomplete).valid).toBe(false)
    expect(ctx.workflowWorkbench.validate({ ...definition(), unsupported: true } as WorkflowDefinition).valid).toBe(
      false,
    )
  })
  it('generates an explicit candidate without replacing a concurrently edited draft', async () => {
    const root = await scratch()
    const { ctx } = await boot(root, [textResponse(JSON.stringify(definition()))])
    const { document } = await publish(ctx, root)
    const receipt = await ctx.workflowWorkbench.command({
      kind: 'generate',
      id: document.id,
      expectedRevision: 3,
      description: 'Draft a ranking workflow',
    })
    const edit = definition()
    edit.requirement.summary = 'Edited while generating'
    await ctx.workflowWorkbench.command({
      kind: 'save',
      id: document.id,
      expectedRevision: 3,
      name: document.name,
      definition: edit,
    })
    await expect
      .poll(async () => (await ctx.workflowWorkbench.snapshot(document.id)).operations[0]?.status)
      .toBe('succeeded')
    const snapshot = await ctx.workflowWorkbench.snapshot(document.id)
    expect(snapshot.workflows[0]!.draft.requirement.summary).toBe('Edited while generating')
    expect(snapshot.operations[0]).toMatchObject({ id: receipt.operationId, revision: 3, candidate: definition() })
  })

  it('retains generation errors and releases the generator Agent', async () => {
    const root = await scratch()
    const { ctx } = await boot(root, [textResponse('{bad json}')])
    const { document } = await publish(ctx, root)
    await ctx.workflowWorkbench.command({
      kind: 'generate',
      id: document.id,
      expectedRevision: 3,
      description: 'Generate',
    })
    await expect
      .poll(async () => (await ctx.workflowWorkbench.snapshot(document.id)).operations[0]?.status)
      .toBe('failed')
    await expect.poll(() => ctx.agents.list().length).toBe(0)
  })

  it('refuses to launch any node when the audit durability checkpoint fails', async () => {
    const root = await scratch()
    const { ctx, adapter } = await boot(root)
    const { document, version } = await publish(ctx, root)
    const off = ctx.on('session/flush', (session) => {
      if (session.events.some(event => event.type === 'business-workflow/checkpoint'))
        throw new Error('audit checkpoint rejected')
    })
    await expect(
      ctx.workflowWorkbench.command({ kind: 'start', id: document.id, versionId: version.id, inputs: { leads: [] } }),
    ).rejects.toThrow('audit checkpoint rejected')
    off()
    expect(adapter.requests).toEqual([])
    expect(ctx.agents.list()).toEqual([])
    await expect(ctx.workflowWorkbench.command({ kind: 'cancel', runId: 'unrelated' as WorkflowRunId }))
      .rejects.toThrow('restart the Host')
    await stopHost(ctx)
    const restarted = await boot(root)
    expect((await restarted.ctx.workflowWorkbench.snapshot(document.id)).runs[0]?.status).toBe('interrupted')
  })

  it('serializes verification cases and gives every batch and rerun a new identity', async () => {
    const root = await scratch()
    const { ctx } = await boot(root, [
      textResponse('ranked a'),
      textResponse('ranked b'),
      textResponse('ranked a again'),
    ])
    const { document } = await publish(ctx, root)
    const draft = definition()
    draft.requirement.acceptanceCases.push({ name: 'second', given: { leads: ['b'] }, expect: { kind: 'nonEmpty' } })
    await ctx.workflowWorkbench.command({
      kind: 'save',
      id: document.id,
      expectedRevision: 3,
      name: document.name,
      definition: draft,
    })
    await ctx.workflowWorkbench.command({ kind: 'publish', id: document.id, expectedRevision: 4 })
    const version = (await ctx.workflowWorkbench.snapshot(document.id)).workflows[0]!.versions[1]!
    const receipt = await ctx.workflowWorkbench.command({ kind: 'verify', id: document.id, versionId: version.id })
    const first = await waitRun(ctx, document.id, receipt.runIds![0]!, 'succeeded')
    const second = await waitRun(ctx, document.id, receipt.runIds![1]!, 'succeeded')
    expect(first.batchId).toBeTruthy()
    expect(first.batchId).toBe(second.batchId)
    expect(first.assertion?.passed).toBe(true)
    expect(second.assertion?.passed).toBe(true)
    const again = await ctx.workflowWorkbench.command({
      kind: 'start',
      id: document.id,
      versionId: version.id,
      inputs: first.inputs,
      rerunOf: first.id,
    })
    const repeated = await waitRun(ctx, document.id, again.runIds![0]!, 'succeeded')
    expect(repeated.rerunOf).toBe(first.id)
    expect(repeated.id).not.toBe(first.id)
    expect((await ctx.workflowWorkbench.snapshot(document.id)).runs[0]).toEqual(first)
  })

  it('blocks archived workflows, missing inputs, invalid versions, and concurrent workspace runs', async () => {
    const root = await scratch()
    const { ctx } = await boot(root)
    const { document, version } = await publish(ctx, root, true)
    await expect(
      ctx.workflowWorkbench.command({ kind: 'start', id: document.id, versionId: version.id, inputs: {} }),
    ).rejects.toThrow('Missing input')
    await expect(
      ctx.workflowWorkbench.command({
        kind: 'start',
        id: document.id,
        versionId: 'missing' as typeof version.id,
        inputs: {},
      }),
    ).rejects.toThrow('Unknown published version')
    const receipt = await ctx.workflowWorkbench.command({
      kind: 'start',
      id: document.id,
      versionId: version.id,
      inputs: { leads: [] },
    })
    await waitRun(ctx, document.id, receipt.runIds![0]!, 'waiting')
    await expect(
      ctx.workflowWorkbench.command({ kind: 'start', id: document.id, versionId: version.id, inputs: { leads: [] } }),
    ).rejects.toThrow('unfinished workflow run')
    await ctx.workflowWorkbench.command({ kind: 'archive', id: document.id, expectedRevision: 3, archived: true })
    await expect(
      ctx.workflowWorkbench.command({ kind: 'start', id: document.id, versionId: version.id, inputs: { leads: [] } }),
    ).rejects.toThrow('archived')
  })

  it('keeps a run unfinished until the delegating Agent has reached quiescence', async () => {
    const root = await scratch()
    const { ctx } = await boot(root)
    const { document, version } = await publish(ctx, root)
    const create = ctx.agents.create.bind(ctx.agents)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let draining = false
    vi.spyOn(ctx.agents, 'create').mockImplementationOnce(async (request) => {
      const handle = await create(request)
      return { agent: handle.agent, dispose: async () => {
        draining = true
        await gate
        await handle.dispose()
      } }
    })
    try {
      const receipt = await ctx.workflowWorkbench.command({
        kind: 'start', id: document.id, versionId: version.id, inputs: { leads: [] },
      })
      await expect.poll(() => draining).toBe(true)
      expect((await ctx.workflowWorkbench.snapshot(document.id)).runs[0]?.status).toBe('running')
      release()
      await waitRun(ctx, document.id, receipt.runIds![0]!, 'succeeded')
      expect(ctx.agents.list()).toEqual([])
    } finally {
      release()
    }
  })

  it('drains active execution on unload and records interruption after restart without replaying work', async () => {
    const root = await scratch()
    const { ctx } = await boot(root, ['hang-slow'])
    const { document, version } = await publish(ctx, root)
    const receipt = await ctx.workflowWorkbench.command({
      kind: 'start', id: document.id, versionId: version.id, inputs: { leads: [] },
    })
    await expect.poll(async () => (await ctx.workflowWorkbench.snapshot(document.id)).runs[0]?.attempts[0]?.childSessionId)
      .toBeTruthy()
    await stopHost(ctx)
    const restarted = await boot(root)
    const run = await waitRun(restarted.ctx, document.id, receipt.runIds![0]!, 'interrupted')
    expect(run.attempts[0]?.status).toBe('interrupted')
    expect(restarted.adapter.requests).toEqual([])
  })

  it('ends timed-out nodes without accepting their output or leaving child Agents', async () => {
    const root = await scratch()
    const { ctx } = await boot(root, ['hang-slow'], { nodeTimeoutMs: 100 })
    const { document, version } = await publish(ctx, root)
    const receipt = await ctx.workflowWorkbench.command({
      kind: 'start', id: document.id, versionId: version.id, inputs: { leads: [] },
    })
    const run = await waitRun(ctx, document.id, receipt.runIds![0]!, 'failed')
    expect(run.outputs).toEqual({})
    expect(run.attempts[0]?.status).toBe('failed')
    expect(ctx.agents.list()).toEqual([])
  })
})

describe('complete workflow retry ownership', () => {
  it('retains the publication, original route, inputs and feedback, and recovers one retry after restart', async () => {
    const root = await scratch()
    const { ctx, adapter } = await boot(root, [textResponse('ranked retry')])
    const { document, version } = await publish(ctx, root, true)
    const initial = { kind: 'start' as const, id: document.id, versionId: version.id, inputs: { leads: ['original'] },
      feedback: 'Keep this business feedback', requestId: 'original-submission' as never }
    const sourceId = (await ctx.workflowWorkbench.command(initial)).runIds![0]!
    const waiting = await waitRun(ctx, document.id, sourceId, 'waiting')
    await ctx.workflowWorkbench.command({ kind: 'decide', runId: sourceId, attemptId: waiting.attempts[0]!.id, approve: false })
    const source = await waitRun(ctx, document.id, sourceId, 'failed')
    const request = { kind: 'retry' as const, runId: sourceId, requestId: 'complete-retry' as never }
    await expect(ctx.workflowWorkbench.command({ ...request, requestId: '' as never })).rejects.toThrow('nonempty')
    await expect(ctx.workflowWorkbench.command({ ...request, requestId: initial.requestId })).rejects.toThrow('another workflow submission or retry')
    const defaults = vi.spyOn(ctx.agentDefaultModel, 'currentSelection').mockReturnValue({ provider: 'changed-default', model: 'changed-default' })
    const [first, repeated] = await Promise.all([ctx.workflowWorkbench.command(request), ctx.workflowWorkbench.command(request)])
    expect(repeated).toEqual(first)
    const retried = await waitRun(ctx, document.id, first.runIds![0]!, 'waiting')
    expect(retried).toMatchObject({ version: source.version, inputs: source.inputs, execution: source.execution,
      feedback: source.feedback, rerunOf: sourceId, retryRequest: request.requestId, mode: 'execution' })
    expect(retried.attempts.map(attempt => attempt.id)).not.toEqual(source.attempts.map(attempt => attempt.id))
    expect(defaults).not.toHaveBeenCalled()
    defaults.mockRestore()
    await expect(ctx.workflowWorkbench.command({ ...initial, requestId: request.requestId })).rejects.toThrow('another workflow submission')
    await expect(ctx.workflowWorkbench.command({ ...request, runId: first.runIds![0]! })).rejects.toThrow('another workflow submission or retry')
    await ctx.workflowWorkbench.command({ kind: 'decide', runId: retried.id, attemptId: retried.attempts[0]!.id, approve: true })
    await waitRun(ctx, document.id, retried.id, 'succeeded')
    expect(adapter.requests).toHaveLength(1)
    expect(JSON.stringify(adapter.requests)).toContain(initial.feedback)
    expect(await ctx.workflowWorkbench.inspectRun(sourceId)).toEqual(source)
    await expect(ctx.workflowWorkbench.command({ ...request, runId: retried.id, requestId: 'successful-run' as never })).rejects.toThrow('Only failed')
    const current = (await ctx.workflowWorkbench.snapshot(document.id)).workflows[0]!
    await ctx.workflowWorkbench.command({ kind: 'archive', id: document.id, expectedRevision: current.revision, archived: true })
    expect(await ctx.workflowWorkbench.command(request)).toEqual(first)
    await expect(ctx.workflowWorkbench.command({ ...request, requestId: 'archived-retry' as never })).rejects.toThrow('archived')
    await stopHost(ctx)
    const restarted = await boot(root, [])
    expect(await restarted.ctx.workflowWorkbench.command(request)).toEqual(first)
    expect((await restarted.ctx.workflowWorkbench.queryRuns({ limit: 10 })).items).toHaveLength(2)
  })
  it('retries one failed acceptance case as a new verification run rather than a normal execution', async () => {
    const root = await scratch()
    const { ctx } = await boot(root, [textResponse('does not satisfy the criterion'), textResponse('ranked output')])
    const { document, version } = await publish(ctx, root)
    const sourceId = (await ctx.workflowWorkbench.command({ kind: 'verify', id: document.id, versionId: version.id })).runIds![0]!
    const source = await waitRun(ctx, document.id, sourceId, 'succeeded')
    expect(source.assertion?.passed).toBe(false)
    const request = { kind: 'retry' as const, runId: sourceId, requestId: 'retry-acceptance' as never }
    const next = await ctx.workflowWorkbench.command(request)
    const retried = await waitRun(ctx, document.id, next.runIds![0]!, 'succeeded')
    expect(retried).toMatchObject({ mode: 'verification', caseName: source.caseName, inputs: source.inputs, execution: source.execution,
      retryRequest: request.requestId, rerunOf: sourceId, assertion: { passed: true } })
    expect(retried.batchId).not.toBe(source.batchId)
    expect(await ctx.workflowWorkbench.command(request)).toEqual(next)
    await expect(ctx.workflowWorkbench.command({ ...request, runId: retried.id, requestId: 'passed-case' as never })).rejects.toThrow('Only failed')
  })
  it('rejects active sources and preserves the shared workspace execution lock during retry admission', async () => {
    const root = await scratch()
    const { ctx } = await boot(root, [])
    const { document, version } = await publish(ctx, root, true)
    const start = { kind: 'start' as const, id: document.id, versionId: version.id, inputs: { leads: [] } }
    const sourceId = (await ctx.workflowWorkbench.command(start)).runIds![0]!
    const source = await waitRun(ctx, document.id, sourceId, 'waiting')
    await expect(ctx.workflowWorkbench.command({ kind: 'retry', runId: sourceId, requestId: 'active' as never })).rejects.toThrow('Only failed')
    await ctx.workflowWorkbench.command({ kind: 'decide', runId: sourceId, attemptId: source.attempts[0]!.id, approve: false })
    await waitRun(ctx, document.id, sourceId, 'failed')
    const otherId = (await ctx.workflowWorkbench.command(start)).runIds![0]!
    await waitRun(ctx, document.id, otherId, 'waiting')
    await expect(ctx.workflowWorkbench.command({ kind: 'retry', runId: sourceId, requestId: 'busy' as never })).rejects.toThrow('unfinished workflow run')
  })
})
