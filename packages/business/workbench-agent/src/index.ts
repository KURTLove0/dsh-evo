/** Durable workbench identities and a host-owned native Harness execution queue. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { installModelSelection, type AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-workspace'
import { renderSkillContent } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { WorkbenchAgents } from './service.ts'
import { agentDomain, definitionSchema } from './schema.ts'
import { WorkbenchAgentGateway } from './gateway.ts'
import type { AgentCapabilities, AgentCommand, AgentDefinition, AgentDirectory, AgentReceipt, AgentRun, AgentRunId, AgentRuntime, WorkbenchAgent, WorkbenchAgentId } from './types.ts'

export type * from './types.ts'
export { WorkbenchAgents } from './service.ts'
export { WorkbenchAgentGateway } from './gateway.ts'

/** Deployment-owned runtime composition and storage capacity. */
export interface Config {
  /** Fixed plugin composition used to provision the native runtime. Never an agent identity. */
  runtimePreset: string
  /** Maximum simultaneous native runs across agents. */
  maxActiveRuns: number
  /** Maximum retained identities. */
  maxAgents: number
  /** Maximum retained run records; overflow rejects new work. */
  maxRuns: number
  /** Maximum serialized record bytes, including configuration and task text. */
  maxRecordBytes: number
  /** Default concurrency for a blank editor. */
  defaultConcurrency: number
  /** Timeout for tools exposed by identity-owned MCP connections, in milliseconds. */
  mcpToolCallTimeoutMs: number
}

/** Required native execution capabilities. */
export const inject = ['storageDomain', 'agents', 'sessions', 'sessionPersistence', 'workspaceRegistry', 'agentPresets', 'skills', 'llm', 'tools']
/** Validated runtime settings. */
export const Config: z<Config> = z.object({
  runtimePreset: z.string().required(),
  maxActiveRuns: z.number().step(1).min(1).default(8),
  maxAgents: z.number().step(1).min(1).default(200),
  maxRuns: z.number().step(1).min(1).default(10000),
  maxRecordBytes: z.number().step(1).min(1024).default(1_048_576),
  defaultConcurrency: z.number().step(1).min(1).default(6),
  mcpToolCallTimeoutMs: z.number().step(1).min(1).default(60_000),
})

interface ActiveRun {
  controller: AbortController
  done: Promise<void>
}
const unfinished = (run: AgentRun) => run.status === 'queued' || run.status === 'running'
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

/** Native provider with serialized commits and independent per-task session ownership. */
export class NativeWorkbenchAgents extends WorkbenchAgents {
  static inject = inject
  static Config = Config
  private domain!: Domain<typeof agentDomain>
  private tail: Promise<void> = Promise.resolve()
  private readonly active = new Map<AgentRunId, ActiveRun>()
  private closing = false
  private failure: Error | undefined
  private readonly owner: Context

  constructor(ctx: Context, private readonly config: Config) { super(ctx); this.owner = ctx }

  protected async [Service.init](): Promise<void> {
    await this.owner.agentPresets.resolve(this.config.runtimePreset)
    this.domain = await this.owner.storageDomain.open(agentDomain)
    this.owner.effect(() => async () => {
      this.closing = true
      await this.tail
      for (const work of this.active.values()) work.controller.abort()
      await Promise.allSettled([...this.active.values()].map(work => work.done))
      await this.tail
      await this.domain.close()
    }, 'workbench agents: drain native runs and close storage')
    for (const [, run] of this.domain.table('runs').entries()) {
      if (this.agent(run.agentId).archived && unfinished(run))
        await this.putRun({ ...run, status: 'cancelled', endedAt: Date.now() })
      else if (run.status === 'running') await this.putRun({ ...run, status: 'interrupted', endedAt: Date.now(), error: 'Host stopped during execution.' })
    }
    await this.queue(() => { this.pump() })
  }

  async snapshot(id?: WorkbenchAgentId): Promise<AgentDirectory> {
    return this.queue(() => {
      const agents = [...this.domain.table('agents').entries()].map(([, agent]) => agent)
      const runs = [...this.domain.table('runs').entries()].map(([, run]) => run)
      return structuredClone({
        agents,
        runs: id === undefined ? [] : runs.filter(run => run.agentId === id).sort((a, b) => b.createdAt - a.createdAt),
        workloads: agents.map(agent => ({ agentId: agent.id,
          running: runs.filter(run => run.agentId === agent.id && run.status === 'running').length,
          queued: runs.filter(run => run.agentId === agent.id && run.status === 'queued').length,
        })),
        defaultConcurrency: Math.min(this.config.defaultConcurrency, this.config.maxActiveRuns),
        maxConcurrency: this.config.maxActiveRuns,
        runtime: { id: 'harness' as const, available: !this.closing && this.failure === undefined },
      })
    })
  }

  command(command: AgentCommand): Promise<AgentReceipt> {
    if (this.closing) return Promise.reject(new Error('Agent runtime is unloading.'))
    return this.queue(async () => {
      if (this.failure !== undefined) throw this.failure
      const receipt = await this.mutate(command)
      this.notify(receipt.agentId)
      this.pump()
      return receipt
    })
  }

  async capabilities(workspaceId: AgentRun['workspaceId']): Promise<AgentCapabilities> {
    if (this.closing) throw new Error('Agent runtime is unloading.')
    const workspace = this.owner.workspaceRegistry.get(workspaceId)
    if (workspace === undefined || await workspace.status() !== 'ok') throw new Error('Workspace directory is unavailable.')
    const scope = await this.owner.agentPresets.standingKeyFor(this.config.runtimePreset)
    const skills = await this.owner.skills.list({ cwd: workspace.path, scope })
    return { skills: skills.filter(skill => skill.invocation.userInvocable)
      .map(({ name, description, source }) => ({ name, description, source })).sort((a, b) => a.name.localeCompare(b.name)) }
  }

  async runtimes(): Promise<AgentRuntime[]> {
    if (this.closing) throw new Error('Agent runtime is unloading.')
    const active = new Set(this.owner.llm.listProviders().map(provider => provider.id))
    const entries = this.owner.llm.listConfigurableProviders().filter(entry => entry.localCommand !== undefined)
    return Promise.all(entries.map(async (entry) => {
      const runtime: AgentRuntime = { id: entry.provider, name: entry.displayName, command: entry.localCommand as string,
        available: active.has(entry.provider), models: [],
        ...(entry.defaultModel === undefined ? {} : { defaultModel: entry.defaultModel }),
      }
      if (!runtime.available) return runtime
      try { runtime.models = (await this.owner.llm.listModels(entry.provider)).map(({ id, name }) => ({ id, name })) }
      catch (error) { runtime.error = message(error); runtime.available = false }
      return runtime
    }))
  }

  private localRuntime(id: string) {
    const runtime = this.owner.llm.listConfigurableProviders().find(entry => entry.provider === id && entry.localCommand !== undefined)
    if (runtime === undefined) throw new Error('Unknown local runtime service. Choose a service from Runtimes.')
    if (!this.owner.llm.listProviders().some(provider => provider.id === id)) throw new Error(`Local runtime ${id} is unavailable.`)
    return runtime
  }

  private queue<T>(action: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(action)
    this.tail = result.then(() => {}, () => {})
    return result
  }

  private agent(id: WorkbenchAgentId): WorkbenchAgent {
    const agent = this.domain.table('agents').get(id)
    if (agent === undefined) throw new Error('Unknown workbench agent.')
    return agent
  }

  private run(id: AgentRunId): AgentRun {
    const run = this.domain.table('runs').get(id)
    if (run === undefined) throw new Error('Unknown agent run.')
    return run
  }

  private revision(agent: WorkbenchAgent, expected: number): void {
    if (agent.revision !== expected) throw new Error('Agent changed in another window. Reload before saving.')
  }

  private definition(input: AgentDefinition, except?: WorkbenchAgentId): AgentDefinition {
    const definition = definitionSchema.parse(input)
    if ([...this.domain.table('agents').entries()].map(([, agent]) => agent).some(agent => agent.id !== except && agent.name.toLocaleLowerCase() === definition.name.toLocaleLowerCase()))
      throw new Error('An agent with this name already exists.')
    if (definition.concurrency > this.config.maxActiveRuns) throw new Error(`Concurrency cannot exceed ${this.config.maxActiveRuns}.`)
    const runtime = this.localRuntime(definition.runtime)
    if (definition.model !== undefined && definition.model.provider !== runtime.provider)
      throw new Error('Model provider must match the selected local runtime.')
    if (definition.model === undefined && runtime.defaultModel === undefined)
      throw new Error('This runtime has no declared default model. Select a model explicitly.')
    return definition
  }

  private async mutate(command: AgentCommand): Promise<AgentReceipt> {
    switch (command.kind) {
      case 'create':
      case 'copy': {
        if (this.domain.table('agents').size >= this.config.maxAgents) throw new Error('Agent capacity reached.')
        let input: AgentDefinition
        if (command.kind === 'copy') {
          const { id: _id, revision: _revision, archived: _archived,
            createdAt: _created, updatedAt: _updated, ...definition } = this.agent(command.id)
          input = { ...definition, name: command.name }
        } else input = command.definition
        const definition = this.definition(input)
        const id = randomUUID() as WorkbenchAgentId
        const agent: WorkbenchAgent = { ...definition, id, revision: 1, archived: false, createdAt: Date.now(), updatedAt: Date.now() }
        this.size(agent)
        await this.domain.table('agents').put(id, agent)
        return { agentId: id }
      }
      case 'save':
      case 'archive': {
        const current = this.agent(command.id)
        this.revision(current, command.revision)
        if (command.kind === 'save' && current.archived) throw new Error('Restore this agent before editing it.')
        if (command.kind === 'archive' && current.archived && !command.archived) {
          for (const [, run] of this.domain.table('runs').entries())
            if (run.agentId === current.id && unfinished(run)) await this.stop(run)
        }
        const next = { ...current, ...(command.kind === 'save' ? this.definition(command.definition, current.id) : { archived: command.archived }), revision: current.revision + 1, updatedAt: Date.now() }
        this.size(next)
        await this.domain.table('agents').put(next.id, next)
        if (command.kind === 'archive' && command.archived) {
          for (const [, run] of this.domain.table('runs').entries()) {
            if (run.agentId === current.id && unfinished(run)) await this.stop(run)
          }
        }
        return { agentId: current.id }
      }
      case 'design': return this.submit(command.id, command.workspaceId, command.prompt, undefined, 'design')
      case 'run': return this.submit(command.id, command.workspaceId, command.prompt)
      case 'retry': {
        const prior = this.run(command.runId)
        if (prior.status !== 'failed' && prior.status !== 'cancelled' && prior.status !== 'interrupted') throw new Error('Only failed or stopped runs can be retried.')
        return this.submit(prior.agentId, prior.workspaceId, prior.prompt, prior.id, prior.purpose)
      }
      case 'stop': {
        const run = this.run(command.runId)
        await this.stop(run)
        return { agentId: run.agentId, runId: run.id }
      }
      /* v8 ignore next -- Remote decoding and the closed command union exclude every other tag. */
      default: return assert.fail(`Unsupported agent command: ${String(command satisfies never)}`)
    }
  }

  private async submit(id: WorkbenchAgentId, workspaceId: AgentRun['workspaceId'], prompt: string, retryOf?: AgentRunId, purpose?: 'design'): Promise<AgentReceipt> {
    if (this.agent(id).archived) throw new Error('Archived agents cannot receive work.')
    if (prompt.trim() === '') throw new Error('Describe the task to run.')
    const workspace = this.owner.workspaceRegistry.get(workspaceId)
    if (workspace === undefined || await workspace.status() !== 'ok') throw new Error('Workspace directory is unavailable.')
    if (this.domain.table('runs').size >= this.config.maxRuns) throw new Error('Run history capacity reached.')
    const run: AgentRun = {
      id: randomUUID() as AgentRunId, agentId: id, workspaceId, sessionId: SessionId(randomUUID()), prompt,
      status: 'queued', createdAt: Date.now(), ...(purpose === undefined ? {} : { purpose }), ...(retryOf === undefined ? {} : { retryOf }),
    }
    await this.putRun(run)
    return { agentId: id, runId: run.id }
  }

  private async stop(run: AgentRun): Promise<void> {
    if (!unfinished(run)) return
    try { await this.putRun({ ...run, status: 'cancelled', endedAt: Date.now() }) }
    finally { this.active.get(run.id)?.controller.abort() }
  }

  private size(record: unknown): void {
    if (Buffer.byteLength(JSON.stringify(record)) > this.config.maxRecordBytes) throw new Error('Agent record exceeds maxRecordBytes.')
  }

  private async putRun(run: AgentRun): Promise<void> {
    this.size(run)
    await this.domain.table('runs').put(run.id, run)
    this.notify(run.agentId)
  }

  private notify(id: WorkbenchAgentId): void {
    for (const listener of this.owner.events.dispatch('emit', ['workbench-agent/changed', id])) {
      try {
        void Promise.resolve(listener('workbench-agent/changed', id)).catch((error: unknown) => { this.owner.logger.warn('Agent directory listener failed: %s', message(error)) })
      } catch (error) { this.owner.logger.warn('Agent directory listener failed: %s', message(error)) }
    }
  }

  private pump(): void {
    if (this.closing || this.failure !== undefined) return
    for (const [, run] of this.domain.table('runs').entries()) {
      if (this.active.size >= this.config.maxActiveRuns) break
      if (run.status !== 'queued' || this.active.has(run.id)) continue
      const agent = this.agent(run.agentId)
      if ([...this.active.keys()].some(id => this.run(id).workspaceId === run.workspaceId)) continue
      if (agent.archived) continue
      const occupied = [...this.active.keys()].filter(id => this.run(id).agentId === agent.id).length
      if (occupied >= agent.concurrency) continue
      const controller = new AbortController()
      const work = { controller, done: Promise.resolve() }
      this.active.set(run.id, work)
      work.done = Promise.resolve().then(() => this.drive(run.id, controller.signal)).catch((error: unknown) => {
        this.failure = new Error(`Agent execution persistence failed: ${message(error)}`)
        this.owner.logger.error(this.failure)
        for (const active of this.active.values()) active.controller.abort()
      }).finally(() => {
        this.active.delete(run.id)
        void this.queue(() => { this.pump() })
      })
    }
  }

  private async drive(id: AgentRunId, signal: AbortSignal): Promise<void> {
    let handle: AgentHandle | undefined
    let disposeError: (() => void) | undefined
    let abort: (() => void) | undefined
    try {
      const run = await this.queue(async () => {
        const current = this.run(id)
        if (current.status !== 'queued' || signal.aborted) return undefined
        const next = { ...current, definition: structuredClone(this.agent(current.agentId)), status: 'running' as const, startedAt: Date.now() }
        await this.putRun(next)
        return next
      })
      if (run === undefined) return
      const workspace = this.owner.workspaceRegistry.get(run.workspaceId)
      if (workspace === undefined || await workspace.status() !== 'ok') throw new Error('Workspace directory is unavailable.')
      const runtime = this.localRuntime(run.definition.runtime)
      const selected = run.definition.model
      if (selected !== undefined && selected.provider !== runtime.provider) throw new Error('Model provider must match the selected local runtime.')
      if (selected === undefined && runtime.defaultModel === undefined) throw new Error('This runtime has no declared default model. Select a model explicitly.')
      const model = selected === undefined ? { provider: runtime.provider, model: runtime.defaultModel as string } : {
        provider: selected.provider, model: selected.model,
        ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(selected.reasoningEffort) }),
      }
      handle = await this.owner.agents.create({
        sessionId: run.sessionId, meta: { cwd: workspace.path, agentPreset: this.config.runtimePreset }, agentOptions: model, signal,
        setup: async (scope) => {
          await this.owner.agentPresets.mount(scope, this.config.runtimePreset)
          if (run.purpose !== 'design') {
            for (const server of run.definition.mcpServers) {
              signal.throwIfAborted()
              const connection: McpClient.Config = {
                serverName: server.name,
                toolCallTimeoutMs: this.config.mcpToolCallTimeoutMs,
                failOnStartupError: true,
                ...server.transport === 'stdio'
                  ? { transport: 'stdio', command: server.command, args: server.args, env: Object.fromEntries(server.env.map(item => [item.name, item.value])), cwd: workspace.path }
                  : { transport: 'streamable-http', url: server.url, headers: Object.fromEntries(server.headers.map(item => [item.name, item.value])) },
              }
              await scope.plugin(McpClient, connection).await()
            }
          }
          if (run.purpose === 'design') scope.effect(() => scope.tools.restrict({ allow: [] }), 'agent builder has no task tools')
          scope.effect(() => installModelSelection(scope, { current: model, assembled: undefined }), 'agent model selection')
        },
      })
      await workspace.attachSession(handle.agent.id)
      const agent = handle.agent
      abort = () => { agent.cancel({ kind: 'user' }) }
      signal.addEventListener('abort', abort, { once: true })
      signal.throwIfAborted()
      let failure: string | undefined
      disposeError = agent.ctx.on('agent/error', ({ error }) => { failure = message(error) })
      const context = [`Agent: ${run.definition.name}\nIdentity: ${run.agentId}\nRevision: ${run.definition.revision}`, run.definition.instructions]
      for (const name of run.purpose === 'design' ? [] : run.definition.skills) {
        const skill = await this.owner.skills.get(name, { cwd: workspace.path, scope: agent, signal })
        if (skill === undefined || !skill.invocation.userInvocable) throw new Error(`Skill ${name} is unavailable in this runtime.`)
        context.push(`Skill: ${name}\n${renderSkillContent(skill)}`)
      }
      signal.throwIfAborted()
      agent.inject(createUserMessage({ content: [{ type: 'text', text: run.purpose === 'design'
        ? `Design an agent configuration from the user's request. Return ONLY a JSON object matching this schema. Keep runtime ${JSON.stringify(run.definition.runtime)}. Keep its model provider unchanged. Suggest no skills unless the user names them. Do not execute tasks. The result is a draft for human review.\n${JSON.stringify(definitionSchema.toJSONSchema())}`
        : context.join('\n\n') }], source: { kind: 'plugin', plugin: 'dsh-workbench-agent' } }))
      agent.followup(createUserMessage({ content: [{ type: 'text', text: run.prompt }], source: { kind: 'user' } }))
      await agent.whenIdle()
      if (!(await this.owner.sessions.flush(agent.session))) throw new Error('Agent transcript has no persistence listener.')
      const end = agent.session.events.findLast(event => event.type === 'turn/end')
      assert(end !== undefined, 'Submitted task settled without a durable turn/end record.')
      const aborted = signal.aborted || end.data.reason.kind === 'aborted'
      if (end.data.reason.kind === 'error') failure = end.data.reason.error.message
      if (end.data.reason.kind === 'blocked') failure = 'Execution was blocked before completing the task.'
      if (end.data.reason.kind === 'max-tokens') failure = 'Execution reached the model output limit.'
      let candidate: AgentDefinition | undefined
      if (run.purpose === 'design' && failure === undefined && !aborted) {
        const answer = agent.session.events.findLast(event => event.type === 'assistant/message')
        assert(answer !== undefined, 'Completed design run has no assistant message.')
        const content = answer.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
        candidate = definitionSchema.parse(JSON.parse(content))
      }
      await this.queue(async () => {
        const current = this.run(id)
        if (current.status !== 'running') return
        await this.putRun({ ...current, ...(candidate === undefined ? {} : { candidate }), status: aborted ? 'cancelled' : failure === undefined ? 'completed' : 'failed', endedAt: Date.now(), ...(failure === undefined ? {} : { error: failure }) })
      })
    } catch (error) {
      await this.queue(async () => {
        const run = this.run(id)
        if (!unfinished(run)) return
        await this.putRun({ ...run, status: signal.aborted ? 'cancelled' : 'failed', endedAt: Date.now(), error: message(error) })
      })
    } finally {
      if (abort !== undefined) signal.removeEventListener('abort', abort)
      disposeError?.()
      await handle?.dispose()
    }
  }
}

/**
 * Mount the native provider and typed Remote consumer.
 * @param ctx - host plugin context.
 * @param config - deployment-approved runtime settings.
 * @returns readiness of both services.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(NativeWorkbenchAgents, config).await()
  await ctx.plugin(WorkbenchAgentGateway).await()
}
