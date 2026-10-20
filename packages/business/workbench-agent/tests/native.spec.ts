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
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as Domain from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import Skills from '@deepseek-ai/dsh-skill'
import type { AgentDefinition, WorkbenchAgentId, AgentRunId } from '../src/types.ts'
import { MockAdapter, textResponse, maxTokensResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as Workbench from '../src/index.ts'
import { WorkbenchAgentGateway } from '../src/gateway.ts'
import { agentDomain } from '../src/schema.ts'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'

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
  await ctx.plugin(Skills)
  const yaml = join(root, 'cordis.yml')
  await writeFile(
    yaml,
    JSON.stringify([{ name: 'test:workbench', config: {
      runtimePreset: 'standard', ...config,
    } }]),
  )
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(yaml).href } })
  await ctx.loader.await()
  return { ctx, adapter }
}

const definition = (name = 'Reviewer'): AgentDefinition => ({ name, avatar: 'R', description: 'Display-only description', instructions: 'Review changes carefully.', runtime: 'harness', skills: [], starters: [{ label: 'Review', prompt: 'Review this repository.' }], concurrency: 1 })
const create = async (ctx: Context, name?: string) => (await ctx.workbenchAgents.command({ kind: 'create', definition: definition(name) })).agentId
async function settled(ctx: Context, id: WorkbenchAgentId) {
  await vi.waitFor(async () => {
    const data = await ctx.workbenchAgents.snapshot(id)
    expect(data.runs.every(run => run.status !== 'queued' && run.status !== 'running')).toBe(true)
  })
  return ctx.workbenchAgents.snapshot(id)
}

describe('independent workbench agents through the Loader', () => {
  it('rejects commands once the owning service has drained', async () => {
    const { ctx } = await boot(await scratch())
    const service = ctx.workbenchAgents
    await ctx.fiber.dispose()
    await expect(service.command({ kind: 'create', definition: definition() })).rejects.toThrow('unloading')
  })

  it('can cancel a queued reservation before preparation or during Agent publication', async () => {
    for (const phase of ['queued', 'created'] as const) {
      const root = await scratch()
      const { ctx, adapter } = await boot(root)
      const id = await create(ctx)
      const workspace = await ctx.workspaceRegistry.create(root)
      let cancelled: Promise<unknown> | undefined
      if (phase === 'queued') ctx.on('domain/changed', (change) => {
        if (change.domain !== 'workbench_agents' || change.table !== 'runs' || change.operation !== 'put') return
        if ((change.value as { status: string }).status !== 'queued') return
        cancelled = ctx.workbenchAgents.command({ kind: 'stop', runId: change.key as AgentRunId })
      })
      else ctx.on('agent/created', ({ agent }) => {
        const run = [...ctx.storageDomain.get('workbench_agents')!.table('runs').entries()]
          .find(([, value]) => (value as { sessionId: string }).sessionId === agent.id)
        if (run !== undefined) cancelled = ctx.workbenchAgents.command({ kind: 'stop', runId: run[0] as AgentRunId })
      })
      await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'Task' })
      await cancelled
      expect((await settled(ctx, id)).runs[0]?.status).toBe('cancelled')
      expect(adapter.requests).toEqual([])
    }
  })

  it('keeps queued tasks bounded by global capacity and rechecks their directory before execution', async () => {
    const root = await scratch()
    const { ctx, adapter } = await boot(root, ['hang'], { maxActiveRuns: 1 })
    const id = await create(ctx)
    const firstWorkspace = await ctx.workspaceRegistry.create(root)
    const otherPath = join(root, 'other')
    await mkdir(otherPath)
    const secondWorkspace = await ctx.workspaceRegistry.create(otherPath)
    const first = await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: firstWorkspace.id, prompt: 'First' })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: secondWorkspace.id, prompt: 'Second' })
    await rm(otherPath, { recursive: true })
    await ctx.workbenchAgents.command({ kind: 'stop', runId: first.runId! })
    expect((await settled(ctx, id)).runs.find(run => run.prompt === 'Second')).toMatchObject({ status: 'failed', error: 'Workspace directory is unavailable.' })
  })

  it('applies an explicitly selected reasoning effort', async () => {
    const root = await scratch()
    const { ctx } = await boot(root)
    const adapter = new MockAdapter([textResponse('Reasoned')], { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }] })
    ctx.llm.registerAdapter(['reasoning'], adapter)
    const id = (await ctx.workbenchAgents.command({ kind: 'create', definition: { ...definition(), model: { provider: 'reasoning', model: 'model', reasoningEffort: 'high' } } })).agentId
    const workspace = await ctx.workspaceRegistry.create(root)
    await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'Task' })
    expect((await settled(ctx, id)).runs[0]?.status).toBe('completed')
    expect(adapter.requests[0]?.reasoningEffort).toBe('high')
  })

  it('retains archive cancellation intent across a failed run write and restoration', async () => {
    const root = await scratch()
    const { ctx, adapter } = await boot(root, ['hang'])
    const id = await create(ctx)
    const workspace = await ctx.workspaceRegistry.create(root)
    await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'Active' })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'Queued' })
    const writes = vi.spyOn(ctx.storageDomain.get('workbench_agents')!.table('runs'), 'put')
      .mockRejectedValueOnce(new Error('Temporary disk failure'))
    await expect(ctx.workbenchAgents.command({ kind: 'archive', id, revision: 1, archived: true })).rejects.toThrow('Temporary disk failure')
    await vi.waitFor(async () => {
      const data = await ctx.workbenchAgents.snapshot(id)
      expect(data.runs.find(run => run.prompt === 'Active')?.status).toBe('cancelled')
    })
    await create(ctx, 'Another agent')
    expect((await ctx.workbenchAgents.snapshot(id)).runs.find(run => run.prompt === 'Queued')?.status).toBe('queued')
    await ctx.workbenchAgents.command({ kind: 'archive', id, revision: 2, archived: false })
    expect((await ctx.workbenchAgents.snapshot(id)).runs.every(run => run.status === 'cancelled')).toBe(true)
    writes.mockRestore()
  })

  it('stops accepting work after run persistence fails instead of repeatedly restarting the queue', async () => {
    const root = await scratch()
    const { ctx, adapter } = await boot(root, ['hang'])
    const id = await create(ctx)
    const workspace = await ctx.workspaceRegistry.create(root)
    const receipt = await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'Task' })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const table = ctx.storageDomain.get('workbench_agents')!.table('runs')
    const writes = vi.spyOn(table, 'put').mockRejectedValue(new Error('Disk unavailable'))
    try {
      await expect(ctx.workbenchAgents.command({ kind: 'stop', runId: receipt.runId! })).rejects.toThrow('Disk unavailable')
      await vi.waitFor(async () => { expect((await ctx.workbenchAgents.snapshot(id)).runtime.available).toBe(false) })
      await expect(ctx.workbenchAgents.command({ kind: 'copy', id, name: 'Copy' })).rejects.toThrow('persistence failed')
      expect(adapter.requests).toHaveLength(1)
    } finally { writes.mockRestore() }
  })

  it('records model failures, output limits, and rejected task admission as failures', async () => {
    for (const kind of ['error', 'limit', 'blocked'] as const) {
      const root = await scratch()
      const { ctx } = await boot(root, kind === 'error'
        ? [() => { throw new Error('Model unavailable') }]
        : [maxTokensResponse('Partial result')])
      if (kind === 'blocked') ctx.on('agent/pre-step', async () => ({ kind: 'reject' as const }))
      const id = await create(ctx)
      const workspace = await ctx.workspaceRegistry.create(root)
      await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'Task' })
      const data = await settled(ctx, id)
      expect(data.runs[0]?.status).toBe('failed')
      expect(data.runs[0]?.error).toContain(kind === 'error' ? 'Model unavailable' : kind === 'limit' ? 'output limit' : 'blocked')
    }
  })

  it('enforces per-agent concurrency across distinct workspaces', async () => {
    const root = await scratch()
    const { ctx, adapter } = await boot(root, ['hang', textResponse('Second')])
    const id = await create(ctx)
    const firstWorkspace = await ctx.workspaceRegistry.create(root)
    const otherPath = join(root, 'other')
    await mkdir(otherPath)
    const secondWorkspace = await ctx.workspaceRegistry.create(otherPath)
    const first = await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: firstWorkspace.id, prompt: 'First' })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: secondWorkspace.id, prompt: 'Second' })
    expect((await ctx.workbenchAgents.snapshot(id)).runs.find(run => run.prompt === 'Second')?.status).toBe('queued')
    await ctx.workbenchAgents.command({ kind: 'stop', runId: first.runId! })
    expect((await settled(ctx, id)).runs.find(run => run.prompt === 'Second')?.status).toBe('completed')
  })

  it('serves management through its own Remote service', async () => {
    const { ctx } = await boot(await scratch())
    const gateway = ctx.get('workbenchAgentGateway') as WorkbenchAgentGateway
    const receipt = await gateway.command({ kind: 'create', definition: definition() })
    expect((await gateway.snapshot({ id: receipt.agentId })).agents[0]?.id).toBe(receipt.agentId)
  })

  it('rejects missing workspaces, blank tasks, unknown providers, oversized records, and full history', async () => {
    const root = await scratch()
    const { ctx } = await boot(root, [textResponse('done')], { maxRuns: 1, maxRecordBytes: 2048 })
    const id = await create(ctx)
    await expect(ctx.workbenchAgents.command({ kind: 'create', definition: { ...definition('Huge'), instructions: 'a'.repeat(3000) } })).rejects.toThrow('maxRecordBytes')
    await expect(ctx.workbenchAgents.command({ kind: 'save', id, revision: 1, definition: { ...definition(), model: { provider: 'unknown', model: 'model' } } })).rejects.toThrow('Unknown model provider')
    await expect(ctx.workbenchAgents.command({ kind: 'copy', id: 'missing' as WorkbenchAgentId, name: 'Copy' })).rejects.toThrow('Unknown workbench')
    await expect(ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: 'missing' as never, prompt: 'Task' })).rejects.toThrow('unavailable')
    const workspace = await ctx.workspaceRegistry.create(root)
    await expect(ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: '  ' })).rejects.toThrow('Describe')
    await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'Task' })
    await settled(ctx, id)
    await expect(ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'Another' })).rejects.toThrow('history capacity')
  })

  it('contains broken directory subscribers and admits the next queued task', async () => {
    const root = await scratch()
    const { ctx } = await boot(root, [textResponse('First'), textResponse('Recovery')])
    ctx.on('workbench-agent/changed', () => { throw 'Synchronous listener failure' })
    // oxlint-disable-next-line typescript/no-misused-promises -- listeners may reject despite their void signature
    ctx.on('workbench-agent/changed', () => Promise.reject(new Error('Async listener failure')))
    const id = await create(ctx)
    const workspace = await ctx.workspaceRegistry.create(root)
    await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'First' })
    await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'Second' })
    const data = await settled(ctx, id)
    expect(data.runs.every(run => run.status === 'completed')).toBe(true)
    expect(data.runs.some(run => run.status === 'completed')).toBe(true)
    await ctx.workbenchAgents.command({ kind: 'stop', runId: data.runs.find(run => run.status === 'completed')!.id })
  })

  it('recovers an archived identity with unfinished durable work without executing it', async () => {
    const root = await scratch()
    const { ctx } = await boot(root)
    const id = await create(ctx)
    const workspace = await ctx.workspaceRegistry.create(root)
    const domain = ctx.storageDomain.get('workbench_agents')!
    const typed = domain as unknown as import('@deepseek-ai/dsh-storage-domain').Domain<typeof agentDomain>
    const current = (await ctx.workbenchAgents.snapshot()).agents[0]!
    await typed.table('agents').put(id, { ...current, archived: true })
    await typed.table('runs').put('orphan' as AgentRunId, { id: 'orphan' as AgentRunId, agentId: id, workspaceId: workspace.id, sessionId: 'orphan-session' as never, prompt: 'Abandoned', status: 'queued', createdAt: 1 })
    await ctx.fiber.dispose()
    const reopened = await boot(root)
    expect((await reopened.ctx.workbenchAgents.snapshot(id)).runs[0]?.status).toBe('cancelled')
    expect(reopened.adapter.requests).toEqual([])
  })

  it('generates a validated tool-free configuration candidate without saving it', async () => {
    const root = await scratch()
    const candidate = { ...definition(), instructions: 'Focus on security.' }
    const { ctx, adapter } = await boot(root, [textResponse(JSON.stringify(candidate))])
    const id = await create(ctx)
    const workspace = await ctx.workspaceRegistry.create(root)
    await ctx.workbenchAgents.command({ kind: 'design', id, workspaceId: workspace.id, prompt: 'Design a security reviewer.' })
    const data = await settled(ctx, id)
    expect(data.runs[0]?.candidate).toEqual(candidate)
    expect(data.agents[0]?.instructions).toBe('Review changes carefully.')
    expect(adapter.requests[0]?.tools ?? []).toEqual([])
    await ctx.workbenchAgents.command({ kind: 'save', id, revision: 1, definition: data.runs[0]!.candidate! })
    expect((await ctx.workbenchAgents.snapshot()).agents[0]?.instructions).toBe('Focus on security.')
  })

  it('records malformed AI candidates as failed rather than changing configuration', async () => {
    const root = await scratch()
    const { ctx } = await boot(root, [textResponse('{"instructions":"Incomplete"}')])
    const id = await create(ctx)
    const workspace = await ctx.workspaceRegistry.create(root)
    await ctx.workbenchAgents.command({ kind: 'design', id, workspaceId: workspace.id, prompt: 'Design a reviewer.' })
    const data = await settled(ctx, id)
    expect(data.runs[0]?.status).toBe('failed')
    expect(data.runs[0]?.candidate).toBeUndefined()
    expect(data.agents[0]?.revision).toBe(1)
  })

  it('records cancellation requested through the live conversation', async () => {
    const root = await scratch()
    const { ctx, adapter } = await boot(root, ['hang'])
    const id = await create(ctx)
    const workspace = await ctx.workspaceRegistry.create(root)
    const receipt = await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'Task' })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const run = (await ctx.workbenchAgents.snapshot(id)).runs.find(run => run.id === receipt.runId)!
    ctx.agents.get(run.sessionId)!.cancel({ kind: 'user' })
    expect((await settled(ctx, id)).runs[0]?.status).toBe('cancelled')
  })

  it('drains live work on unload and resumes queued work after graceful restart', async () => {
    const root = await scratch()
    const { ctx, adapter } = await boot(root, ['hang-slow'])
    const id = await create(ctx)
    const workspace = await ctx.workspaceRegistry.create(root)
    await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'Active' })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'Queued' })
    await ctx.fiber.dispose()
    const restarted = await boot(root, [textResponse('Finished queued work')])
    const data = await settled(restarted.ctx, id)
    expect(data.runs.find(run => run.prompt === 'Queued')?.status).toBe('completed')
    expect(data.runs.find(run => run.prompt === 'Active')?.status).toBe('interrupted')
  })

  it('creates, edits, copies, archives, and restores stable identities without changing presets', async () => {
    const { ctx } = await boot(await scratch())
    expect((await ctx.workbenchAgents.snapshot()).agents).toEqual([])
    const id = await create(ctx)
    await ctx.workbenchAgents.command({ kind: 'save', id, revision: 1, definition: { ...definition(), instructions: 'Changed instructions' } })
    await expect(ctx.workbenchAgents.command({ kind: 'save', id, revision: 1, definition: definition() })).rejects.toThrow('another window')
    const copy = await ctx.workbenchAgents.command({ kind: 'copy', id, name: 'Second reviewer' })
    const copied = (await ctx.workbenchAgents.snapshot()).agents.find(agent => agent.id === copy.agentId)!
    expect(copied.id).not.toBe(id)
    expect(copied.instructions).toBe('Changed instructions')
    await ctx.workbenchAgents.command({ kind: 'archive', id, revision: 2, archived: true })
    await expect(ctx.workbenchAgents.command({ kind: 'save', id, revision: 3, definition: definition() })).rejects.toThrow('Restore')
    await ctx.workbenchAgents.command({ kind: 'archive', id, revision: 3, archived: false })
    expect((await ctx.workbenchAgents.snapshot()).agents.find(agent => agent.id === id)?.revision).toBe(4)
    expect(ctx.agentPresets.defaultId).toBe('standard')
    expect((await ctx.agentPresets.list()).map(row => row.id)).toEqual(['standard'])
  })

  it('logs instructions and selected skill content, excludes descriptions, and freezes past configurations', async () => {
    const root = await scratch()
    const { ctx, adapter } = await boot(root)
    ctx.skills.register({ name: 'review', description: 'Skill summary', content: 'Check authorization first.', source: 'test' })
    const id = (await ctx.workbenchAgents.command({ kind: 'create', definition: { ...definition(), skills: ['review'], model: { provider: 'mock', model: 'custom' } } })).agentId
    const workspace = await ctx.workspaceRegistry.create(root)
    const receipt = await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'Review the patch.' })
    const data = await settled(ctx, id)
    expect(data.runs[0]?.error).toBeUndefined()
    expect(data.runs[0]?.status).toBe('completed')
    expect(adapter.requests[0]?.model).toBe('custom')
    const request = JSON.stringify(adapter.requests[0])
    expect(request).toContain('Review changes carefully.')
    expect(request).toContain('Check authorization first.')
    expect(request).not.toContain('Display-only description')
    const history = await ctx.sessionPersistence.inspect(data.runs[0]!.sessionId)
    expect(JSON.stringify(history.events)).toContain('Check authorization first.')
    await ctx.workbenchAgents.command({ kind: 'save', id, revision: 1, definition: { ...definition(), instructions: 'New responsibilities' } })
    expect((await ctx.workbenchAgents.snapshot(id)).runs[0]?.definition?.instructions).toBe('Review changes carefully.')
    expect(workspace.sessionIds).toContain(data.runs[0]?.sessionId)
    expect(receipt.runId).toBe(data.runs[0]?.id)
    await ctx.workbenchAgents.command({ kind: 'archive', id, revision: 2, archived: true })
    expect((await ctx.workbenchAgents.snapshot(id)).runs[0]?.status).toBe('completed')
    await ctx.fiber.dispose()
    const reopened = await boot(root)
    const restored = await reopened.ctx.workbenchAgents.snapshot(id)
    expect(restored.agents.find(agent => agent.id === id)?.instructions).toBe('New responsibilities')
    expect(restored.runs[0]?.status).toBe('completed')
  })

  it('queues at concurrency capacity and archival cancels running and queued work', async () => {
    const root = await scratch()
    const { ctx, adapter } = await boot(root, ['hang'])
    const id = await create(ctx)
    const workspace = await ctx.workspaceRegistry.create(root)
    await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'First' })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'Second' })
    expect((await ctx.workbenchAgents.snapshot(id)).workloads).toEqual([{ agentId: id, running: 1, queued: 1 }])
    await ctx.workbenchAgents.command({ kind: 'archive', id, revision: 1, archived: true })
    expect((await ctx.workbenchAgents.snapshot(id)).runs.map(run => run.status)).toEqual(['cancelled', 'cancelled'])
    await expect(ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'Third' })).rejects.toThrow('Archived')
  })

  it('stops a task and retries with a new execution identity', async () => {
    const root = await scratch()
    const { ctx, adapter } = await boot(root, ['hang', textResponse('done')])
    const id = await create(ctx)
    const workspace = await ctx.workspaceRegistry.create(root)
    const first = await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'Task' })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    await ctx.workbenchAgents.command({ kind: 'stop', runId: first.runId! })
    const next = await ctx.workbenchAgents.command({ kind: 'retry', runId: first.runId! })
    expect(next.runId).not.toBe(first.runId)
    const data = await settled(ctx, id)
    expect(data.runs.find(run => run.id === next.runId)).toMatchObject({ status: 'completed', retryOf: first.runId })
    await expect(ctx.workbenchAgents.command({ kind: 'retry', runId: next.runId! })).rejects.toThrow('Only failed')
  })

  it('reports missing skills as failed runs instead of silently dropping capabilities', async () => {
    const root = await scratch()
    const { ctx } = await boot(root)
    const id = (await ctx.workbenchAgents.command({ kind: 'create', definition: { ...definition(), skills: ['missing'] } })).agentId
    const workspace = await ctx.workspaceRegistry.create(root)
    await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'Task' })
    expect((await settled(ctx, id)).runs[0]).toMatchObject({ status: 'failed', error: 'Skill missing is unavailable in this runtime.' })
  })

  it('rejects invalid names, unsupported fields, duplicate names, capacity, and foreign identities', async () => {
    const { ctx } = await boot(await scratch(), [], { maxAgents: 2 })
    await create(ctx)
    await expect(create(ctx)).rejects.toThrow('already exists')
    await expect(ctx.workbenchAgents.command({ kind: 'create', definition: { ...definition('Other'), runtime: 'external' as never } })).rejects.toThrow()
    await expect(ctx.workbenchAgents.command({ kind: 'create', definition: { ...definition('Other'), concurrency: 100 } })).rejects.toThrow('Concurrency')
    await expect(ctx.workbenchAgents.command({ kind: 'create', definition: { ...definition('Other'), starters: Array.from({ length: 4 }, () => ({ label: 'x', prompt: 'y' })) } })).rejects.toThrow()
    await create(ctx, 'Other')
    await expect(create(ctx, 'Third')).rejects.toThrow('capacity')
    await expect(ctx.workbenchAgents.command({ kind: 'stop', runId: 'unknown' as AgentRunId })).rejects.toThrow('Unknown')
  })
})
