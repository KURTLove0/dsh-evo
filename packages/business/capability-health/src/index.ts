/** Configuration observations and host-owned temporary MCP initialization/ping jobs. */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { assertNever } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-authorization'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-workbench-agent'
import type {} from '@deepseek-ai/dsh-workspace'
import { commandPresent } from '@deepseek-ai/dsh-daemon'
import { probeMcp } from '@deepseek-ai/dsh-mcp-client'
import type { Config as McpConfig } from '@deepseek-ai/dsh-mcp-client'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { AgentMcpServer, WorkbenchAgent } from '@deepseek-ai/dsh-workbench-agent/types'
import { CapabilityHealth } from './service.ts'
import { CapabilityHealthGateway } from './gateway.ts'
import type { HealthAgent, HealthCheckRequest, HealthCode, HealthItem, HealthProbeId, HealthProbeRecord, HealthProbeRequest, HealthReport } from './types.ts'

export { CapabilityHealth } from './service.ts'
export type * from './types.ts'

/** Deployment bounds; probe records are transient and retained until host restart. */
export interface Config {
  /** Inclusive item count bound for complete reports and executor choices. */
  maxItems: number
  /** Inclusive UTF-8 serialized byte bound for complete reports and executor choices. */
  maxReportBytes: number
  /** Maximum concurrently running temporary connections. */
  maxActiveProbes: number
  /** Maximum retained recovery identities until service reload. */
  maxProbeRecords: number
  /** Positive total initialization and ping deadline in milliseconds. */
  probeTimeoutMs: number
  /** Positive close-event wait in milliseconds after SDK shutdown settles. */
  probeCloseTimeoutMs: number
}
/** Source services, without depending on the browser transport implementation. */
export const inject = ['workbenchAgents', 'workspaceRegistry', 'llm', 'credentials', 'authorization', 'settings']
/** Explicit bounds for complete reports and owned probe work. */
export const Config: z<Config> = z.object({
  maxItems: z.number().step(1).min(1).default(1000),
  maxReportBytes: z.number().step(1).min(1).default(262144),
  maxActiveProbes: z.number().step(1).min(1).default(2),
  maxProbeRecords: z.number().step(1).min(1).default(200),
  probeTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(10000),
  probeCloseTimeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(5000),
})

interface ProbeJob { record: HealthProbeRecord; controller: AbortController; done: Promise<void> }
const signature = (request: HealthProbeRequest) =>
  JSON.stringify([request.id, request.agentId, request.expectedRevision, request.workspaceId, request.serverName])
function profileAt(value: unknown, path: readonly string[]): { apiKeyEnv?: unknown } | undefined {
  for (const key of path) {
    if (typeof value !== 'object' || value === null) return undefined
    value = (value as Record<string, unknown>)[key]
  }
  return typeof value === 'object' && value !== null ? value : undefined
}
function connection(server: AgentMcpServer, cwd: string, timeout: number): McpConfig {
  return { serverName: server.name, toolCallTimeoutMs: timeout, failOnStartupError: true,
    ...(server.transport === 'stdio'
      ? { transport: 'stdio', command: server.command, args: server.args, env: Object.fromEntries(server.env.map(entry => [entry.name, entry.value])), cwd }
      : { transport: 'streamable-http', url: server.url, headers: Object.fromEntries(server.headers.map(entry => [entry.name, entry.value])) }) }
}

/** Reads source-owned facts; only temporary probe jobs are mutable local state. */
export class NativeCapabilityHealth extends CapabilityHealth {
  static inject = inject
  static Config = Config
  private readonly jobs = new Map<HealthProbeId, ProbeJob>()
  private readonly checks = new Set<Promise<HealthReport>>()
  private tail: Promise<void> = Promise.resolve()
  private closing = false
  private cleanupFailed = false
  private readonly owner: Context
  constructor(ctx: Context, private readonly config: Config) { super(ctx); this.owner = ctx }
  protected [Service.init](): void {
    if (this.config.maxActiveProbes > this.config.maxProbeRecords) throw new Error('maxActiveProbes must not exceed maxProbeRecords.')
    this.owner.effect(() => async () => {
      this.closing = true
      for (const job of this.jobs.values()) job.controller.abort()
      await this.tail
      await Promise.all([...this.jobs.values()].map(job => job.done))
      await Promise.allSettled(this.checks)
    }, 'capability health: cancel and settle temporary probes and reads')
  }
  private open(): void { if (this.closing) throw new Error('Capability health is unloading.') }
  private bounded<T>(value: T, count: number): T {
    if (count > this.config.maxItems || Buffer.byteLength(JSON.stringify(value)) > this.config.maxReportBytes)
      throw new Error('Capability report exceeds configured item or byte capacity.')
    return value
  }
  async choices(): Promise<HealthAgent[]> {
    this.open()
    const agents = (await this.owner.workbenchAgents.snapshot()).agents
      .map(({ id, name, revision, archived }) => ({ id, name, revision, archived }))
    return this.bounded(agents, agents.length)
  }
  async check(request: HealthCheckRequest): Promise<HealthReport> {
    this.open()
    const checked = this.inspect(request)
    this.checks.add(checked)
    void checked.then(() => this.checks.delete(checked), () => this.checks.delete(checked))
    return checked
  }
  private async inspect(request: HealthCheckRequest): Promise<HealthReport> {
    const items: HealthItem[] = []
    let selection: HealthReport['selection']
    switch (request.kind) {
      case 'global': break
      case 'agent': {
        const agent = await this.agent(request.id, request.expectedRevision)
        selection = { id: agent.id, revision: agent.revision, workspaceId: request.workspaceId }
        try {
          const readiness = await this.owner.workbenchAgents.preflight({ id: agent.id, workspaceId: request.workspaceId })
          if (readiness.agentRevision !== agent.revision) throw new Error('Executor changed during the check.')
          const rows: { kind: HealthItem['kind']; label: string; issue: 'archived' | 'workspace' | 'runtime' | 'model' | 'skills'; good: HealthCode; bad: HealthCode; repair: HealthItem['repair'] }[] = [
            { kind: 'executor', label: agent.name, issue: 'archived', good: 'agent-ready', bad: 'agent-archived', repair: 'agents' },
            { kind: 'workspace', label: request.workspaceId, issue: 'workspace', good: 'workspace-ready', bad: 'workspace-unavailable', repair: 'workspace' },
            { kind: 'runtime', label: agent.runtime, issue: 'runtime', good: 'runtime-ready', bad: 'runtime-unavailable', repair: 'runtimes' },
            { kind: 'model', label: agent.model?.model ?? agent.runtime, issue: 'model', good: 'model-route-ready', bad: 'model-route-unavailable', repair: 'agents' },
            { kind: 'skills', label: agent.skills.join(', '), issue: 'skills', good: 'skills-ready', bad: 'skills-unavailable', repair: 'agents' },
          ]
          for (const row of rows) {
            const failed = readiness.issues.some(issue => issue.code === row.issue)
            const unchecked = row.kind === 'skills' && agent.skills.length > 0 && readiness.issues.some(issue => issue.code === 'workspace')
              ? 'skills-unchecked' : row.kind === 'model' && readiness.issues.some(issue => issue.code === 'runtime') ? 'model-route-unchecked' : undefined
            items.push({ key: `agent:${row.kind}`, kind: row.kind, label: row.label,
              state: unchecked === undefined ? failed ? 'missing' : 'ready' : 'unknown', code: unchecked ?? (failed ? row.bad : row.good), repair: row.repair,
              ...(row.kind === 'skills' ? { count: agent.skills.length } : {}) })
          }
        } catch { items.push({ key: 'agent:source', kind: 'executor', label: agent.name, state: 'failed', code: 'source-unavailable', repair: 'agents' }) }
        for (const server of agent.mcpServers) items.push({ key: `mcp:${server.name}`, kind: 'mcp', label: server.name, state: 'not-checked', code: 'mcp-not-checked', repair: 'agents' })
        break
      }
      /* v8 ignore next -- The Remote decoder validates this closed request union. */
      default: return assertNever(request)
    }
    const sources = await Promise.allSettled([this.providers(), this.records()])
    for (const [index, source] of sources.entries()) {
      if (source.status === 'fulfilled') items.push(...source.value)
      else items.push({ key: `source:${index}`, kind: index === 0 ? 'provider' : 'credential', label: '', state: 'failed',
        code: 'source-unavailable', repair: index === 0 ? 'runtimes' : 'settings' })
    }
    return this.bounded({ checkedAt: Date.now(), items, ...(selection === undefined ? {} : { selection }) }, items.length)
  }
  private async providers(): Promise<HealthItem[]> {
    const entries = this.owner.llm.listConfigurableProviders()
    const active = new Set(this.owner.llm.listProviders().map(entry => entry.id))
    let settings: ReturnType<Context['settings']['describe']> | undefined
    try { settings = this.owner.settings.describe({ redactSecrets: true }) }
    catch { /* Credential-reference discovery is unavailable; independent provider/catalog facts remain readable. */ }
    return (await Promise.all(entries.map(async (entry): Promise<HealthItem[]> => {
      const rows: HealthItem[] = [{ key: `provider:${entry.provider}`, kind: 'provider', label: entry.displayName,
        state: active.has(entry.provider) ? 'ready' : 'missing', code: active.has(entry.provider) ? 'provider-registered' : 'provider-unconfigured',
        repair: entry.localCommand === undefined ? 'models' : 'runtimes' }]
      const present = entry.localCommand === undefined || commandPresent(entry.localCommand)
      if (entry.localCommand !== undefined) rows.push({ key: `command:${entry.provider}`, kind: 'runtime', label: entry.localCommand,
        state: present ? 'ready' : 'missing', code: present ? 'runtime-command-present' : 'runtime-command-missing', repair: 'runtimes' })
      if (!present) rows.push({ key: `catalog:${entry.provider}`, kind: 'catalog', label: entry.displayName, state: 'not-checked', code: 'catalog-not-checked', repair: 'runtimes' })
      if (active.has(entry.provider) && present) {
        try {
          const models = await this.owner.llm.listModels(entry.provider)
          rows.push({ key: `catalog:${entry.provider}`, kind: 'catalog', label: entry.displayName, state: 'ready', code: 'catalog-readable', count: models.length, repair: 'runtimes' })
        } catch { rows.push({ key: `catalog:${entry.provider}`, kind: 'catalog', label: entry.displayName, state: 'failed', code: 'catalog-failed', repair: 'runtimes' }) }
      }
      if (settings === undefined) {
        rows.push({ key: `credential:${entry.provider}`, kind: 'credential', label: entry.displayName, state: 'failed', code: 'credential-read-failed', repair: 'models' })
        return rows
      }
      const namespace = settings.find(value => value.ns === entry.settingsNs)
      const ref = profileAt(namespace?.value, entry.settingsPath)?.apiKeyEnv
      if (typeof ref !== 'string' || ref === '') rows.push({ key: `credential:${entry.provider}`, kind: 'credential', label: entry.displayName,
        state: 'unknown', code: 'credential-undeclared', repair: 'models' })
      else {
        try {
          const info = await this.owner.credentials.describe(credentialRef(ref))
          rows.push({ key: `credential:${entry.provider}`, kind: 'credential', label: ref,
            state: info.configured ? 'ready' : 'missing', code: info.configured ? 'credential-configured' : 'credential-missing', repair: 'models',
            ...(info.source === undefined ? {} : { source: info.source }) })
        } catch { rows.push({ key: `credential:${entry.provider}`, kind: 'credential', label: entry.displayName, state: 'failed', code: 'credential-read-failed', repair: 'models' }) }
      }
      return rows
    }))).flat()
  }
  private async records(): Promise<HealthItem[]> {
    const owned = this.owner.authorization.list()
    const stored = await this.owner.credentials.listRecords()
    const keys = new Set<CredentialKey>([...owned.map(entry => entry.key), ...stored.map(entry => entry.key)])
    return Promise.all([...keys].map(async (key): Promise<HealthItem> => {
      const flow = owned.find(entry => entry.key === key)
      const row = { key: `record:${key}`, kind: 'credential' as const, label: flow?.label ?? key, repair: 'settings' as const }
      if (flow === undefined) return { ...row, state: 'unknown', code: 'credential-owner-missing' }
      try {
        const info = await this.owner.credentials.describeRecord(key)
        return { ...row, state: info.configured ? 'ready' : 'missing', code: info.configured ? 'credential-configured' : 'credential-missing' }
      } catch { return { ...row, state: 'failed', code: 'credential-read-failed' } }
    }))
  }
  private async agent(id: HealthAgent['id'], revision: number): Promise<WorkbenchAgent> {
    const agent = (await this.owner.workbenchAgents.snapshot()).agents.find(entry => entry.id === id)
    if (agent === undefined) throw new Error('Executor is unavailable. Choose a saved executor.')
    if (agent.revision !== revision) throw new Error('Executor changed. Refresh before checking or probing.')
    return agent
  }
  startProbe(request: HealthProbeRequest): Promise<HealthProbeRecord> {
    const admitted = this.tail.then(async () => {
      this.open()
      const prior = this.jobs.get(request.id)
      if (prior !== undefined) {
        if (signature(prior.record) !== signature(request)) throw new Error('Probe identity belongs to another request.')
        return structuredClone(prior.record)
      }
      if (request.id === '') throw new Error('Probe identity must be nonempty.')
      if (this.cleanupFailed) throw new Error('Earlier probe cleanup failed. Reload the host before probing again.')
      if (this.jobs.size >= this.config.maxProbeRecords) throw new Error('Probe record capacity reached. Reload the host to clear transient results.')
      if ([...this.jobs.values()].filter(job => job.record.status === 'running').length >= this.config.maxActiveProbes)
        throw new Error('Another connection probe is using the available capacity. Wait or cancel it.')
      const agent = await this.agent(request.agentId, request.expectedRevision)
      if (agent.archived) throw new Error('Restore this executor before probing its connections.')
      const workspace = this.owner.workspaceRegistry.get(request.workspaceId)
      if (workspace === undefined || await workspace.status() !== 'ok') throw new Error('Choose an available workspace before probing.')
      const server = agent.mcpServers.find(entry => entry.name === request.serverName)
      if (server === undefined) throw new Error('This saved MCP server is unavailable. Refresh the executor.')
      this.open()
      const job: ProbeJob = { record: { ...request, startedAt: Date.now(), status: 'running' }, controller: new AbortController(), done: Promise.resolve() }
      this.jobs.set(request.id, job)
      job.done = Promise.resolve().then(async () => {
        try {
          const outcome = await probeMcp(connection(server, workspace.path, this.config.probeTimeoutMs), {
            timeoutMs: this.config.probeTimeoutMs, closeTimeoutMs: this.config.probeCloseTimeoutMs, signal: job.controller.signal,
          })
          job.record = { ...job.record, ...outcome }
        } catch {
          // Configuration/setup refusal is not a successful probe; no server-controlled diagnostic crosses the wire.
          job.record = { ...job.record, status: 'failed', cleanup: 'failed', checkedAt: Date.now() }
        }
        if (job.record.cleanup === 'failed') this.cleanupFailed = true
        this.notify(request.id)
      })
      this.notify(request.id)
      return structuredClone(job.record)
    })
    this.tail = admitted.then(() => {}, () => {})
    return admitted
  }
  readProbe(id: HealthProbeId): HealthProbeRecord | null { return structuredClone(this.jobs.get(id)?.record ?? null) }
  async cancelProbe(id: HealthProbeId): Promise<HealthProbeRecord> {
    const job = this.jobs.get(id)
    if (job === undefined) throw new Error('This host has no retained probe with that identity.')
    job.controller.abort(); await job.done
    return structuredClone(job.record)
  }
  private notify(id: HealthProbeId): void {
    if (this.closing) return
    let invariantFailure: Error | undefined
    for (const listener of this.owner.events.dispatch('emit', ['capability-health/probe-changed', id])) {
      try { void Promise.resolve(listener(id)).catch(() => { this.owner.logger.warn('Capability health probe listener rejected.') }) }
      catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'INVARIANT') invariantFailure ??= error
        else this.owner.logger.warn('Capability health probe listener threw.')
      }
    }
    if (invariantFailure !== undefined) throw invariantFailure
  }
}
/**
 * Mount the replaceable observation provider and generated Remote consumer.
 * @param ctx - host plugin context.
 * @param config - validated report and probe bounds.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(NativeCapabilityHealth, config).await()
  await ctx.plugin(CapabilityHealthGateway).await()
}
