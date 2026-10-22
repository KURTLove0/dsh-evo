/** Durable host scheduling over idempotent native admissions; session lifetime does not own the worker. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-work-center'
import type {} from '@deepseek-ai/dsh-workbench-agent'
import type {} from '@deepseek-ai/dsh-business-workflow/workbench'
import type {} from '@deepseek-ai/dsh-workspace'
import type { TaskRequestId } from '@deepseek-ai/dsh-workbench-agent/types'
import type { WorkflowRequestId } from '@deepseek-ai/dsh-business-workflow/workbench-types'
import type { WorkReference, WorkSource } from '@deepseek-ai/dsh-work-center/types'
import { WorkTriggers } from './service.ts'
import { WorkTriggerGateway } from './gateway.ts'
import { definitionSchema, triggerIdSchema, triggerDomain, type StoredOccurrence, type StoredTrigger } from './schema.ts'
import type { TriggerCommand, TriggerDefinition, TriggerDirectory, TriggerNotice, TriggerNoticeId, TriggerOccurrenceId, TriggerQuery,
  TriggerReceipt, TriggerSummary, TriggerTarget, TriggerTerminalStatus, WorkTrigger, WorkTriggerId } from './types.ts'
export type * from './types.ts'
export { WorkTriggers } from './service.ts'
/** Deployment capacities bound retained definitions, occurrences, and complete responses independently. */
export interface Config {
  /** Worker wake interval; the wall clock is reread on every pass. */
  pollIntervalMs: number
  /** Minimum accepted recurrence interval. */
  minIntervalMs: number
  /** Maximum retained trigger definitions. */
  maxTriggers: number
  /** Complete immutable definition byte cap, including target content and rule. */
  maxDefinitionBytes: number
  /** Maximum retained occurrences per trigger; no history eviction occurs. */
  maxOccurrences: number
  /** Complete retained occurrence byte cap, including native request and notices. */
  maxOccurrenceBytes: number
  /** Complete emitted response byte cap. */
  maxResponseBytes: number
}
/** Scheduling consumes metadata and admissions from existing execution owners. */
export const inject = ['storageDomain', 'workbenchAgents', 'workflowWorkbench', 'workCenter', 'workspaceRegistry']
/** Positive capacities and Node-compatible polling bounds. */
export const Config: z<Config> = z.object({
  pollIntervalMs: z.number().step(1).min(1).max(2_147_483_647).default(1000),
  minIntervalMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(300000),
  maxTriggers: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(100),
  maxDefinitionBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(262144),
  maxOccurrences: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(100),
  maxOccurrenceBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(16384),
  maxResponseBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(1048576),
})
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
const terminalStates: Record<WorkSource['status'], boolean> = { queued: false, running: false, waiting: false, stopping: false,
  completed: true, succeeded: true, failed: true, cancelled: true, interrupted: true }
const terminal = (status: WorkSource['status']): status is TriggerTerminalStatus => terminalStates[status]
const summaryOccurrence = ({ requestId: _requestId, notices: _notices, ...value }: StoredOccurrence) => value
const publicOccurrence = ({ requestId: _requestId, ...value }: StoredOccurrence) => value
const publicRecord = ({ creationHash: _hash, occurrences, ...value }: StoredTrigger): WorkTrigger =>
  ({ ...value, occurrences: occurrences.map(publicOccurrence) })
/** Serialized reservations and handoffs drain before storage closes. */
export class NativeWorkTriggers extends WorkTriggers {
  static inject = inject
  static Config = Config
  private domain!: Domain<typeof triggerDomain>
  private tail: Promise<void> = Promise.resolve()
  private closing = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly failures = new Map<WorkTriggerId, TriggerDirectory['failures'][number]>()
  private readonly owner: Context
  constructor(ctx: Context, private readonly config: Config) { super(ctx); this.owner = ctx }
  protected async [Service.init](): Promise<void> {
    this.options()
    this.checked({ id: randomUUID(), revision: Number.MAX_SAFE_INTEGER })
    this.domain = await this.owner.storageDomain.open(triggerDomain)
    this.owner.effect(() => async () => {
      this.closing = true; clearTimeout(this.timer); await this.tail; await this.domain.close()
    }, 'triggers: stop new admissions and drain before closing storage')
    const requests = new Set<string>()
    for (const [key, record] of this.domain.table('triggers').entries()) {
      if (key !== record.id) throw new Error('Trigger storage key differs from its identity.')
      for (const occurrence of record.occurrences) {
        if (requests.has(occurrence.requestId)) throw new Error('Native trigger request identity is shared by different occurrences.')
        requests.add(occurrence.requestId)
      }
    }
    this.schedule()
  }
  private isClosing(): boolean { return this.closing }
  private schedule(): void {
    if (this.isClosing()) return
    this.timer = setTimeout(() => {
      void this.queue(() => this.tick()).finally(() => { this.schedule() }).catch(() => {
        // Per-trigger failures are retained by tick; disposal can reject a queued wake.
      })
    }, this.config.pollIntervalMs)
    this.timer.unref()
  }
  private queue<T>(action: () => T | Promise<T>): Promise<T> {
    if (this.isClosing()) return Promise.reject(new Error('Trigger provider is unloading.'))
    const task = this.tail.then(action); this.tail = task.then(() => {}, () => {}); return task
  }
  private checked<T>(value: T): T {
    if (bytes(value) > this.config.maxResponseBytes) throw new Error('Trigger response exceeds maxResponseBytes. Narrow the directory.')
    return structuredClone(value)
  }
  private record(id: WorkTriggerId): StoredTrigger {
    const value = this.domain.table('triggers').get(id)
    if (value === undefined) throw new Error('Unknown work trigger.')
    return value
  }
  private async persist(value: StoredTrigger): Promise<void> {
    const previous = this.domain.table('triggers').get(value.id)
    if (previous === undefined && bytes(value.definition) > this.config.maxDefinitionBytes)
      throw new Error('Trigger definition exceeds maxDefinitionBytes.')
    for (const occurrence of value.occurrences) {
      const old = previous?.occurrences.find(item => item.id === occurrence.id)
      if (JSON.stringify(old) !== JSON.stringify(occurrence) && bytes(occurrence) > this.config.maxOccurrenceBytes)
        throw new Error('Trigger occurrence exceeds maxOccurrenceBytes.')
    }
    // Later handoff phases continue editing their local draft after this durable commit.
    await this.domain.table('triggers').put(value.id, structuredClone(value))
    for (const listener of this.owner.events.dispatch('emit', ['work-trigger/changed', value.id])) {
      try { void Promise.resolve(listener(value.id)).catch(() => { this.owner.logger.warn('Trigger observer rejected after commit.') }) }
      catch { this.owner.logger.warn('Trigger observer threw after commit.') }
    }
  }
  options() {
    return this.checked({ minIntervalMs: this.config.minIntervalMs, pollIntervalMs: this.config.pollIntervalMs,
      maxOccurrences: this.config.maxOccurrences })
  }
  query(request: TriggerQuery): Promise<TriggerDirectory> {
    const query = structuredClone(request)
    return this.queue(() => {
      const text = query.text.trim().toLowerCase()
      const items: TriggerSummary[] = [...this.domain.table('triggers').entries()].map(([, value]) => value)
        .filter(value => (query.workspaceId === undefined || value.definition.target.workspaceId === query.workspaceId)
          && (query.enabled === undefined || value.enabled === query.enabled) && value.definition.name.toLowerCase().includes(text))
        .map((value) => {
          const last = value.occurrences.at(-1), rule = value.definition.rule
          const consumed = rule.kind !== 'every' && value.occurrences.length > 0
          const status = !value.enabled ? 'paused' : consumed ? 'consumed'
            : value.occurrences.length >= this.config.maxOccurrences ? 'capacity' : 'armed'
          const latest = last === undefined ? undefined : summaryOccurrence(last)
          return { id: value.id, revision: value.revision, name: value.definition.name, workspaceId: value.definition.target.workspaceId,
            target: value.definition.target.kind, enabled: value.enabled, status,
            ...(value.nextAt === undefined ? {} : { nextAt: value.nextAt }), ...(latest === undefined ? {} : { latest }),
            unread: value.occurrences.reduce((count, item) =>
              count + item.notices.filter(notice => notice.readAt === undefined).length, 0) }
        })
      const ids = new Set(items.map(value => value.id))
      return this.checked({ items, observedAt: Date.now(), failures: [...this.failures.values()].filter(value => ids.has(value.id)) })
    })
  }
  read(id: WorkTriggerId): Promise<WorkTrigger> { return this.queue(() => this.checked(publicRecord(this.record(id)))) }
  prepare(source: WorkReference): Promise<Pick<TriggerDefinition, 'name' | 'target'>> {
    return this.queue(async () => {
      if (source.kind === 'agent') {
        const run = await this.owner.workbenchAgents.inspectRun(source.id)
        if (run.purpose === 'design') throw new Error('Design runs cannot become trigger targets.')
        const agent = (await this.owner.workbenchAgents.snapshot()).agents.find(value => value.id === run.agentId)
        if (agent === undefined || agent.archived) throw new Error('Trigger executor is unavailable.')
        const brief = run.submission?.brief ?? { version: 1 as const, goal: run.prompt, background: '', deliverables: [], acceptanceCriteria: [], constraints: '' }
        return this.checked({ name: run.agentName, target: { kind: 'agent' as const, id: run.agentId,
          workspaceId: run.workspaceId, expectedRevision: agent.revision, brief } })
      }
      const run = await this.owner.workflowWorkbench.inspectRun(source.id)
      if (run.mode !== 'execution') throw new Error('Only formal workflow executions can become trigger targets.')
      return this.checked({ name: (await this.owner.workCenter.source(source)).name, target: { kind: 'workflow' as const, id: run.workflowId,
        workspaceId: run.workspaceId, versionId: run.version.id, inputs: run.inputs } })
    })
  }
  private async validateTarget(target: TriggerTarget): Promise<void> {
    if (this.owner.workspaceRegistry.get(target.workspaceId) === undefined) throw new Error('Trigger workspace is unavailable.')
    if (target.kind === 'agent') {
      const check = await this.owner.workbenchAgents.preflight({ id: target.id, workspaceId: target.workspaceId, brief: target.brief })
      if (check.agentRevision !== target.expectedRevision) throw new Error('Trigger executor revision changed.')
      if (check.issues.length > 0) throw new Error(check.issues.map(value => value.message).join('\n'))
    } else {
      const document = (await this.owner.workflowWorkbench.snapshot(target.id)).workflows.find(value => value.id === target.id)
      if (document === undefined || document.archived || document.workspaceId !== target.workspaceId) throw new Error('Trigger workflow is unavailable.')
      const publication = document.versions.find(value => value.id === target.versionId)
      if (publication === undefined) throw new Error('Unknown trigger workflow publication.')
      const validation = this.owner.workflowWorkbench.validate(publication.definition)
      if (!validation.valid) throw new Error(validation.issues.join('\n'))
      for (const field of publication.definition.requirement.inputs)
        if (!Object.hasOwn(target.inputs, field.name)) throw new Error(`Missing trigger input ${field.name}.`)
    }
  }
  command(request: TriggerCommand): Promise<TriggerReceipt> {
    const owned = structuredClone(request)
    return this.queue(async () => {
      if (owned.kind === 'create') {
        const definition: TriggerDefinition = definitionSchema.parse(owned.definition)
        triggerIdSchema.parse(owned.id)
        const creationHash = createHash('sha256').update(JSON.stringify([definition, owned.enabled])).digest('hex')
        const existing = this.domain.table('triggers').get(owned.id)
        if (existing !== undefined) {
          if (existing.creationHash !== creationHash) throw new Error('Trigger identity belongs to a different definition.')
          return this.checked({ id: existing.id, revision: 1 })
        }
        if (this.domain.table('triggers').size >= this.config.maxTriggers) throw new Error('Trigger capacity reached.')
        const { rule } = definition, now = Date.now()
        if (rule.kind !== 'on-settled' && (rule.kind === 'at' ? rule.at : rule.firstAt) <= now) throw new Error('Trigger time must be in the future.')
        if (rule.kind === 'every' && rule.intervalMs < this.config.minIntervalMs) throw new Error('Trigger interval is below minIntervalMs.')
        if (rule.kind === 'on-settled') await this.owner.workCenter.source(rule.source)
        await this.validateTarget(definition.target)
        const value: StoredTrigger = { id: owned.id, revision: 1, creationHash, definition, enabled: owned.enabled,
          createdAt: now, updatedAt: now, occurrences: [], ...(rule.kind === 'on-settled' ? {} : { nextAt: rule.kind === 'at' ? rule.at : rule.firstAt }) }
        const receipt = this.checked({ id: value.id, revision: 1 }); await this.persist(value); return receipt
      }
      const value = structuredClone(this.record(owned.id))
      switch (owned.kind) {
        case 'set-enabled':
          if (value.revision !== owned.expectedRevision) throw new Error('Trigger control revision changed. Refresh before editing.')
          if (!Number.isSafeInteger(value.revision + 1)) throw new Error('Trigger control revision is exhausted.')
          value.revision++; value.enabled = owned.enabled
          break
        case 'recover': {
          if (!value.enabled) throw new Error('Resume the trigger before recovering its handoff.')
          const occurrence = value.occurrences.find(item => item.id === owned.occurrenceId)
          if (occurrence === undefined) throw new Error('Unknown trigger occurrence.')
          if (occurrence.attempts !== owned.expectedAttempt) throw new Error('Trigger handoff attempt changed. Refresh before recovery.')
          if (occurrence.admission.state === 'pending') return this.checked({ id: value.id, revision: value.revision })
          if (occurrence.admission.state !== 'unconfirmed') throw new Error('Only an unconfirmed handoff can be recovered.')
          occurrence.admission = { state: 'pending', lastAttemptAt: occurrence.admission.lastAttemptAt }
          break
        }
        case 'acknowledge': {
          const notice = value.occurrences.flatMap(item => item.notices).find(item => item.id === owned.noticeId)
          if (notice === undefined) throw new Error('Unknown trigger notice.')
          if (notice.readAt !== undefined) return this.checked({ id: value.id, revision: value.revision })
          notice.readAt = Date.now()
          break
        }
        /* v8 ignore next -- TriggerCommand is closed; Remote decoding rejects unknown command tags. */
        default: assert.fail(`Unsupported trigger command: ${String(owned satisfies never)}`)
      }
      value.updatedAt = Date.now(); const receipt = this.checked({ id: value.id, revision: value.revision })
      await this.persist(value); return receipt
    })
  }
  private async tick(): Promise<void> {
    for (const [id] of this.domain.table('triggers').entries()) {
      if (this.isClosing()) return
      try { await this.advance(id); this.failures.delete(id) }
      catch {
        // Retained pre-handoff phases preserve recovery; operational failures do not establish a run outcome.
        if (!this.failures.has(id)) this.failures.set(id, { id, observedAt: Date.now(), code: 'worker-step-failed' })
      }
    }
  }
  private notice(occurrence: StoredOccurrence, value: Omit<Extract<TriggerNotice, { kind: 'settled' }>, 'id' | 'createdAt' | 'readAt'> | { kind: 'admission-unconfirmed' }): void {
    if (occurrence.notices.some(notice => notice.kind === value.kind)) return
    occurrence.notices.push({ ...value, id: randomUUID() as TriggerNoticeId, createdAt: Date.now() })
  }
  private async advance(id: WorkTriggerId): Promise<void> {
    let value = structuredClone(this.record(id)), occurrence = value.occurrences.find(item => item.admission.state !== 'settled')
    if (occurrence?.admission.state === 'admitted') {
      const phase = occurrence.admission
      let source: WorkSource
      try { source = await this.owner.workCenter.source(phase.ref) }
      catch {
        // Source unavailability leaves the last recorded execution observation intact.
        if (phase.unavailableAt === undefined) { phase.unavailableAt = Date.now(); value.updatedAt = Date.now(); await this.persist(value) }
        return
      }
      assert.equal(source.workspaceId, value.definition.target.workspaceId, 'Trigger run belongs to another workspace.')
      if (terminal(source.status)) {
        occurrence.admission = { state: 'settled', ref: phase.ref, acceptedAt: phase.acceptedAt,
          observation: { status: source.status, observedAt: Date.now() } }
        this.notice(occurrence, { kind: 'settled', status: source.status })
      } else {
        if (phase.observation?.status === source.status && phase.unavailableAt === undefined) return
        phase.observation = { status: source.status, observedAt: Date.now() }; delete phase.unavailableAt
      }
      value.updatedAt = Date.now(); await this.persist(value); return
    }
    if (occurrence?.admission.state === 'unconfirmed') {
      if (!occurrence.notices.some(notice => notice.kind === 'admission-unconfirmed')) {
        this.notice(occurrence, { kind: 'admission-unconfirmed' }); value.updatedAt = Date.now(); await this.persist(value)
      }
      return
    }
    if (!value.enabled) return
    if (occurrence === undefined) {
      if (value.occurrences.length >= this.config.maxOccurrences) return
      const rule = value.definition.rule, now = Date.now()
      let dueAt: number, skippedIntervals = 0
      if (rule.kind === 'on-settled') {
        if (value.occurrences.length !== 0) return
        const source = await this.owner.workCenter.source(rule.source)
        if (!terminal(source.status) || this.isClosing()) return
        dueAt = Date.now()
      } else {
        if (value.nextAt === undefined || value.nextAt > now) return
        dueAt = value.nextAt
        if (rule.kind === 'every') {
          skippedIntervals = Math.floor((now - dueAt) / rule.intervalMs); dueAt += skippedIntervals * rule.intervalMs
          const nextAt = dueAt + rule.intervalMs
          if (!Number.isSafeInteger(nextAt) || nextAt > 8_640_000_000_000_000) throw new Error('Next trigger time is out of range.')
          value.nextAt = nextAt
        } else delete value.nextAt
      }
      occurrence = { id: randomUUID() as TriggerOccurrenceId, requestId: randomUUID() as TaskRequestId | WorkflowRequestId,
        dueAt, claimedAt: Date.now(), skippedIntervals, attempts: 0, admission: { state: 'pending' }, notices: [] }
      value.occurrences.push(occurrence); value.updatedAt = Date.now(); await this.persist(value)
      value = structuredClone(this.record(id))
      const reserved = value.occurrences.at(-1)
      assert(reserved !== undefined, 'Reserved trigger occurrence is missing from committed history.')
      occurrence = reserved
    }
    if (this.isClosing()) return
    if (!Number.isSafeInteger(occurrence.attempts + 1)) throw new Error('Trigger handoff attempt counter is exhausted.')
    occurrence.attempts++; occurrence.admission = { state: 'unconfirmed', lastAttemptAt: Date.now() }
    value.updatedAt = Date.now(); await this.persist(value)
    if (this.isClosing()) return
    const target = value.definition.target
    let ref: WorkReference
    try {
      if (target.kind === 'agent') {
        const receipt = await this.owner.workbenchAgents.command({ kind: 'submit-task', id: target.id, workspaceId: target.workspaceId,
          expectedRevision: target.expectedRevision, brief: target.brief, requestId: occurrence.requestId as TaskRequestId })
        assert(receipt.runId !== undefined, 'Task admission returned no run identity.'); ref = { kind: 'agent', id: receipt.runId }
      } else {
        const receipt = await this.owner.workflowWorkbench.command({ kind: 'start', id: target.id, versionId: target.versionId,
          inputs: target.inputs, requestId: occurrence.requestId as WorkflowRequestId })
        const runId = receipt.runIds?.[0]
        assert(receipt.runIds?.length === 1 && runId !== undefined, 'Workflow admission returned no single run identity.')
        ref = { kind: 'workflow', id: runId }
      }
    } catch {
      // Admission rejection and lost acknowledgments are indistinguishable here; keep the native request identity.
      this.notice(occurrence, { kind: 'admission-unconfirmed' }); value.updatedAt = Date.now(); await this.persist(value); return
    }
    occurrence.admission = { state: 'admitted', ref, acceptedAt: Date.now() }
    value.updatedAt = Date.now(); await this.persist(value)
  }
}
/**
 * Mount durable triggers and the typed Remote management consumer.
 * @param ctx - host context with persistence, workspace, and native execution owners.
 * @param config - explicit polling and retention limits.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(NativeWorkTriggers, config).await(); await ctx.plugin(WorkTriggerGateway).await()
}
