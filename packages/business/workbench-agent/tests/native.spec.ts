/** Real storage, Agent/subagent execution, and restart evidence for the workspace workbench. */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createServer } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
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
import { MockAdapter, textResponse, maxTokensResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
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
  ctx.llm.registerConfigurableProviders([{ provider: 'mock', displayName: 'Local test runtime', settingsNs: '', settingsPath: [], localCommand: process.execPath, defaultModel: 'mock' }])
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

const definition = (name = 'Reviewer'): AgentDefinition => ({ name, avatar: 'R', description: 'Display-only description', instructions: 'Review changes carefully.', runtime: 'mock', skills: [], mcpServers: [], starters: [{ label: 'Review', prompt: 'Review this repository.' }], concurrency: 1 })
const create = async (ctx: Context, name?: string) => (await ctx.workbenchAgents.command({ kind: 'create', definition: definition(name) })).agentId
const businessServer = () => ({ name: 'business', transport: 'stdio' as const, command: process.execPath,
  args: [fileURLToPath(new URL('./business-mcp-server.mjs', import.meta.url))], env: [] })
async function settled(ctx: Context, id: WorkbenchAgentId) {
  await vi.waitFor(async () => {
    const data = await ctx.workbenchAgents.snapshot(id)
    expect(data.runs.every(run => run.status !== 'queued' && run.status !== 'running')).toBe(true)
  })
  return ctx.workbenchAgents.snapshot(id)
}

describe('independent workbench agents through the Loader', () => {
  it('binds native default and override models to the chosen local service instead of the global default', async () => {
    const { ctx, adapter: global } = await boot(await scratch())
    const local = new MockAdapter([textResponse('Local default'), textResponse('Local override')])
    ctx.llm.registerAdapter(['codex-cli'], local)
    const directory = ctx.llm.registerConfigurableProviders([
      { provider: 'codex-cli', displayName: 'Codex CLI', settingsNs: '', settingsPath: [], localCommand: 'codex', defaultModel: 'native-default' },
      { provider: 'absent-cli', displayName: 'Unavailable CLI', settingsNs: '', settingsPath: [], localCommand: 'missing-cli' },
      { provider: 'remote-api', displayName: 'Remote API', settingsNs: 'remote', settingsPath: [] },
    ])
    expect(await ctx.workbenchAgents.runtimes()).toEqual([
      { id: 'mock', name: 'Local test runtime', command: process.execPath, available: true, defaultModel: 'mock', models: [] },
      { id: 'codex-cli', name: 'Codex CLI', command: 'codex', available: true, defaultModel: 'native-default', models: [] },
      { id: 'absent-cli', name: 'Unavailable CLI', command: 'missing-cli', available: false, models: [] },
    ])
    const gateway = ctx.get('workbenchAgentGateway') as WorkbenchAgentGateway
    expect(await gateway.runtimes({})).toEqual(await ctx.workbenchAgents.runtimes())
    const id = (await ctx.workbenchAgents.command({ kind: 'create', definition: { ...definition(), runtime: 'codex-cli' } })).agentId
    const workspace = await ctx.workspaceRegistry.create(await scratch())
    await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'Run on the local service' })
    await settled(ctx, id)
    expect(local.requests[0]).toMatchObject({ provider: 'codex-cli', model: 'native-default', cwd: workspace.path })
    expect(global.requests).toEqual([])
    await ctx.workbenchAgents.command({ kind: 'save', id, revision: 1, definition: { ...definition(), runtime: 'codex-cli', model: { provider: 'codex-cli', model: 'chosen-model' } } })
    await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'Use the override' })
    await settled(ctx, id)
    expect(local.requests[1]?.model).toBe('chosen-model')
    await expect(ctx.workbenchAgents.command({ kind: 'create', definition: { ...definition('Wrong model'), runtime: 'codex-cli', model: { provider: 'mock', model: 'mock' } } })).rejects.toThrow('must match')
    await expect(ctx.workbenchAgents.command({ kind: 'create', definition: { ...definition('Unavailable'), runtime: 'absent-cli' } })).rejects.toThrow('unavailable')
    directory()
    await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'Removed service' })
    const removed = (await settled(ctx, id)).runs.find(run => run.prompt === 'Removed service')
    expect(removed?.status).toBe('failed')
    expect(removed?.error).toContain('Unknown local runtime')
  })

  it('reports catalog errors, requires explicit models without a default, and rejects stale queued configuration', async () => {
    const { ctx, adapter } = await boot(await scratch())
    vi.spyOn(adapter, 'listModels').mockResolvedValueOnce([{ provider: 'mock', id: 'listed', name: 'Listed' }]).mockRejectedValueOnce(new Error('Catalog failed'))
    expect((await ctx.workbenchAgents.runtimes())[0]?.models).toEqual([{ id: 'listed', name: 'Listed' }])
    expect((await ctx.workbenchAgents.runtimes())[0]).toMatchObject({ available: false, error: 'Catalog failed' })
    ctx.llm.registerAdapter(['no-default'], new MockAdapter([textResponse('done')]))
    const directory = ctx.llm.registerConfigurableProviders([{ provider: 'no-default', displayName: 'No default', settingsNs: '', settingsPath: [], localCommand: 'cli' }])
    await expect(ctx.workbenchAgents.command({ kind: 'create', definition: { ...definition('Needs model'), runtime: 'no-default' } })).rejects.toThrow('Select a model explicitly')
    const root = await scratch()
    const workspace = await ctx.workspaceRegistry.create(root)
    const id = await create(ctx)
    const domain = ctx.storageDomain.get('workbench_agents') as unknown as import('@deepseek-ai/dsh-storage-domain').Domain<typeof agentDomain>
    const current = domain.table('agents').get(id)!
    await domain.table('agents').put(id, { ...current, runtime: 'no-default' })
    await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'Missing native default' })
    expect((await settled(ctx, id)).runs[0]?.error).toContain('Select a model explicitly')
    await domain.table('agents').put(id, { ...current, model: { provider: 'no-default', model: 'model' } })
    await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'Invalid persisted route' })
    expect((await settled(ctx, id)).runs.find(run => run.prompt === 'Invalid persisted route')?.error).toContain('must match')
    directory()
    const service = ctx.workbenchAgents
    await ctx.fiber.dispose()
    await expect(service.runtimes()).rejects.toThrow('unloading')
  })

  it('discovers user-invocable skills before creating an identity or session', async () => {
    const root = await scratch()
    const { ctx } = await boot(root)
    const workspace = await ctx.workspaceRegistry.create(root)
    ctx.skills.register({ name: 'business-report', description: 'Summarize customer revenue', content: 'Read records and write a report.', source: 'test' })
    ctx.skills.register({ name: 'account-review', description: 'Review accounts', content: 'Check customer records.', source: 'test' })
    ctx.skills.register({ name: 'internal', description: 'Internal only', content: 'Hidden', source: 'test', invocation: { userInvocable: false, modelInvocable: true } })
    const before = ctx.sessions.list()
    expect(await ctx.workbenchAgents.capabilities(workspace.id)).toEqual({ skills: [
      { name: 'account-review', description: 'Review accounts', source: 'test' },
      { name: 'business-report', description: 'Summarize customer revenue', source: 'test' },
    ] })
    const gateway = ctx.get('workbenchAgentGateway') as WorkbenchAgentGateway
    expect(await gateway.capabilities({ workspaceId: workspace.id })).toEqual(await ctx.workbenchAgents.capabilities(workspace.id))
    expect(ctx.sessions.list()).toEqual(before)
    expect((await ctx.workbenchAgents.snapshot()).agents).toEqual([])
    await expect(ctx.workbenchAgents.capabilities('missing' as never)).rejects.toThrow('Workspace directory is unavailable')
    const service = ctx.workbenchAgents
    await ctx.fiber.dispose()
    await expect(service.capabilities(workspace.id)).rejects.toThrow('unloading')
  })

  it('runs business instructions and a selected skill through a real MCP process and persists the result', async () => {
    const root = await scratch()
    const { ctx, adapter } = await boot(root, [
      toolCallResponse('report-call', 'mcp__business__customer_report', { customer: 'Northwind' }),
      textResponse('Customer report saved.'),
    ])
    ctx.skills.register({ name: 'account-review', description: 'Customer account reviews', content: 'Use customer_report to calculate the customer total from business records.', source: 'test' })
    const workspace = await ctx.workspaceRegistry.create(root)
    await writeFile(join(root, 'customers.json'), JSON.stringify([{ customer: 'Northwind', revenue: 120 }, { customer: 'Northwind', revenue: 80 }, { customer: 'Other', revenue: 999 }]))
    const configured = { ...definition('Account reviewer'), instructions: 'Prepare a revenue report for the requested business customer.', skills: ['account-review'], mcpServers: [{
      name: 'business', transport: 'stdio' as const, command: process.execPath,
      args: [fileURLToPath(new URL('./business-mcp-server.mjs', import.meta.url))],
      env: [{ name: 'REPORT_PREFIX', value: 'Customer revenue' }],
    }] }
    const id = (await ctx.workbenchAgents.command({ kind: 'create', definition: configured })).agentId
    await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'Review Northwind revenue.' })
    const data = await settled(ctx, id)
    expect(data.runs[0]).toMatchObject({ status: 'completed', definition: { instructions: configured.instructions, skills: ['account-review'], mcpServers: configured.mcpServers } })
    expect(await readFile(join(root, 'customer-report.txt'), 'utf8')).toBe('Customer revenue: Northwind = 200\n')
    expect(JSON.stringify(adapter.requests[0])).toContain(configured.instructions)
    expect(JSON.stringify(adapter.requests[0])).toContain('Use customer_report to calculate')
    expect(adapter.requests[0]?.tools?.map(tool => tool.name)).toContain('mcp__business__customer_report')
    const transcript = await ctx.sessionPersistence.inspect(data.runs[0]!.sessionId)
    expect(transcript.events.filter(event => event.type === 'tool/result')).toHaveLength(1)
    expect(JSON.stringify(transcript.events)).toContain('Customer revenue: Northwind = 200')
    expect(ctx.tools.get('mcp__business__customer_report')).toBeUndefined()
    await vi.waitFor(async () => { expect(await readFile(join(root, 'mcp-closed.txt'), 'utf8')).toBe('closed\n') })
  })

  it('rejects duplicate MCP namespaces and invalid endpoints before committing a definition', async () => {
    const { ctx } = await boot(await scratch())
    const server = { name: 'crm', transport: 'streamable-http' as const, url: 'https://example.com/mcp', headers: [] }
    for (const mcpServers of [
      [server, server],
      [{ ...server, url: 'file:///tmp/mcp' }],
      [{ ...server, headers: [{ name: 'Authorization', value: 'one' }, { name: 'authorization', value: 'two' }] }],
      [{ ...server, headers: [{ name: 'Authorization', value: 'one\ntwo' }] }],
      [{ name: 'crm', transport: 'stdio' as const, command: 'node', args: [], env: [{ name: 'invalid=name', value: 'x' }] }],
    ]) await expect(ctx.workbenchAgents.command({ kind: 'create', definition: { ...definition(), mcpServers } })).rejects.toThrow()
    expect((await ctx.workbenchAgents.snapshot()).agents).toEqual([])
  })

  it('connects an HTTP MCP service with explicit headers without putting credentials into model context', async () => {
    const { ctx, adapter } = await boot(await scratch(), [
      toolCallResponse('crm-check', 'mcp__crm__check', {}), textResponse('CRM connected.'),
    ])
    const authorizations: (string | undefined)[] = []
    const http = createServer((request, response) => {
      void (async () => {
        authorizations.push(request.headers.authorization)
        const chunks: Buffer[] = []
        for await (const chunk of request as AsyncIterable<Buffer>) chunks.push(chunk)
        const body: unknown = chunks.length === 0 ? undefined : JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const server = new McpServer({ name: 'crm', version: '1.0.0' })
        server.registerTool('check', { description: 'Verify the CRM connection', inputSchema: {} }, async () => ({ content: [{ type: 'text', text: 'CRM authenticated' }] }))
        const transport = new StreamableHTTPServerTransport({})
        response.on('close', () => { void server.close() })
        await server.connect(transport as Transport)
        await transport.handleRequest(request, response, body)
      })().catch((error: unknown) => { response.destroy(error instanceof Error ? error : new Error(String(error))) })
    })
    ctx.effect(() => () => new Promise<void>((resolve, reject) => {
      http.close((error) => { if (error) reject(error); else resolve() })
      http.closeIdleConnections()
    }))
    await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(0, '127.0.0.1', resolve) })
    const address = http.address()
    if (address === null || typeof address === 'string') throw new Error('Missing HTTP fixture port')
    const workspace = await ctx.workspaceRegistry.create(await scratch())
    const id = (await ctx.workbenchAgents.command({ kind: 'create', definition: { ...definition(), mcpServers: [{
      name: 'crm', transport: 'streamable-http', url: `http://127.0.0.1:${address.port}/mcp`, headers: [{ name: 'Authorization', value: 'Bearer fixture-only-token' }],
    }] } })).agentId
    await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'Check the CRM connection.' })
    expect((await settled(ctx, id)).runs[0]?.status).toBe('completed')
    expect(authorizations.length).toBeGreaterThan(0)
    expect(authorizations.every(value => value === 'Bearer fixture-only-token')).toBe(true)
    expect(JSON.stringify(adapter.requests)).not.toContain('fixture-only-token')
  })

  it('isolates concurrent identities using the same MCP namespace and drains connections independently', async () => {
    const firstRoot = await scratch()
    const secondRoot = await scratch()
    const { ctx, adapter } = await boot(firstRoot, ['hang', 'hang'])
    const first = (await ctx.workbenchAgents.command({ kind: 'create', definition: { ...definition('First'), mcpServers: [businessServer()] } })).agentId
    const second = (await ctx.workbenchAgents.command({ kind: 'create', definition: { ...definition('Second'), mcpServers: [businessServer()] } })).agentId
    const firstWorkspace = await ctx.workspaceRegistry.create(firstRoot)
    const secondWorkspace = await ctx.workspaceRegistry.create(secondRoot)
    const firstRun = await ctx.workbenchAgents.command({ kind: 'run', id: first, workspaceId: firstWorkspace.id, prompt: 'Wait' })
    const secondRun = await ctx.workbenchAgents.command({ kind: 'run', id: second, workspaceId: secondWorkspace.id, prompt: 'Wait' })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    expect(adapter.requests.every(request => request.tools?.some(tool => tool.name === 'mcp__business__customer_report'))).toBe(true)
    await ctx.workbenchAgents.command({ kind: 'stop', runId: firstRun.runId! })
    await vi.waitFor(async () => { expect(await readFile(join(firstRoot, 'mcp-closed.txt'), 'utf8')).toBe('closed\n') })
    expect((await ctx.workbenchAgents.snapshot(second)).runs[0]?.status).toBe('running')
    await ctx.workbenchAgents.command({ kind: 'stop', runId: secondRun.runId! })
    await vi.waitFor(async () => { expect(await readFile(join(secondRoot, 'mcp-closed.txt'), 'utf8')).toBe('closed\n') })
  })

  it('rolls back earlier MCP connections when a later required server fails to start', async () => {
    const root = await scratch()
    const { ctx, adapter } = await boot(root)
    const id = (await ctx.workbenchAgents.command({ kind: 'create', definition: { ...definition(), mcpServers: [
      businessServer(), { ...businessServer(), name: 'unavailable', command: join(root, 'missing-command') },
    ] } })).agentId
    const workspace = await ctx.workspaceRegistry.create(root)
    await ctx.workbenchAgents.command({ kind: 'run', id, workspaceId: workspace.id, prompt: 'Produce a report' })
    const data = await settled(ctx, id)
    expect(data.runs[0]?.status).toBe('failed')
    expect(data.runs[0]?.error).toContain('unavailable')
    expect(adapter.requests).toEqual([])
    await vi.waitFor(async () => { expect(await readFile(join(root, 'mcp-closed.txt'), 'utf8')).toBe('closed\n') })
    expect(ctx.tools.get('mcp__business__customer_report')).toBeUndefined()
  })

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
    ctx.llm.registerConfigurableProviders([{ provider: 'reasoning', displayName: 'Reasoning CLI', settingsNs: '', settingsPath: [], localCommand: 'reasoning' }])
    const id = (await ctx.workbenchAgents.command({ kind: 'create', definition: { ...definition(), runtime: 'reasoning', model: { provider: 'reasoning', model: 'model', reasoningEffort: 'high' } } })).agentId
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
    await expect(ctx.workbenchAgents.command({ kind: 'save', id, revision: 1, definition: { ...definition(), model: { provider: 'unknown', model: 'model' } } })).rejects.toThrow('Model provider must match')
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
    ctx.skills.register({ name: 'review', description: 'Skill summary', content: 'Check authorization first.', source: 'test', resourceBase: { kind: 'directory', path: join(root, 'review-resources') } })
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
    expect(request).toContain('Base directory for this skill:')
    expect(request).toContain(join(root, 'review-resources'))
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
    await expect(ctx.workbenchAgents.command({ kind: 'create', definition: { ...definition('Other'), runtime: 'external' } })).rejects.toThrow()
    await expect(ctx.workbenchAgents.command({ kind: 'create', definition: { ...definition('Other'), concurrency: 100 } })).rejects.toThrow('Concurrency')
    await expect(ctx.workbenchAgents.command({ kind: 'create', definition: { ...definition('Other'), starters: Array.from({ length: 4 }, () => ({ label: 'x', prompt: 'y' })) } })).rejects.toThrow()
    await create(ctx, 'Other')
    await expect(create(ctx, 'Third')).rejects.toThrow('capacity')
    await expect(ctx.workbenchAgents.command({ kind: 'stop', runId: 'unknown' as AgentRunId })).rejects.toThrow('Unknown')
  })
})
