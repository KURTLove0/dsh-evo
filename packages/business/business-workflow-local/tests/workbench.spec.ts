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
