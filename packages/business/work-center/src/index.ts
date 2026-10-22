/** Cross-executor directory provider and durable, revisioned delivery reviews. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-workbench-agent'
import type {} from '@deepseek-ai/dsh-business-workflow/workbench'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-fs'
import { readStatistics, readStatisticsChoices } from './statistics.ts'
import type { WorkStatisticsChoices, WorkStatisticsQuery, WorkStatisticsReport } from './statistics-types.ts'
import { sessionFindings } from './diagnosis.ts'
import { WorkCenter } from './service.ts'
import { WorkCenterGateway } from './gateway.ts'
import { reviewDomain, workKey } from './schema.ts'
import type { DeliveryArtifact, DeliveryReview, DeliverySnapshot, DeliveryVersion, WorkCommand, WorkCursor, WorkDetail, WorkExecutor, WorkItem, WorkPage, WorkQuery, WorkReceipt, WorkReference, WorkDiagnosis, DiagnosticSource, DiagnosticFinding, WorkSource } from './types.ts'
import type { AgentRun, TaskBrief } from '@deepseek-ai/dsh-workbench-agent/types'
import type { WorkflowRunStatus } from '@deepseek-ai/dsh-business-workflow/workbench-types'

export type * from './types.ts'
export { WorkCenter } from './service.ts'

/** Bounds for directory reads and retained human-review evidence. */
export interface Config {
  /** Default page size advertised to directory consumers. */
  pageSize: number
  /** Maximum summaries requested from either source in one page. */
  maxPageSize: number
  /** Maximum retained human decisions across all executions. */
  maxReviewDecisions: number
  /** Maximum serialized bytes for one execution's complete review history. */
  maxRecordBytes: number
  /** Maximum serialized bytes for captured response evidence. */
  maxDeliveryBytes: number
  /** Inclusive byte cap on each explicitly requested workspace artifact. */
  maxArtifactBytes: number
  /** Maximum independently read session sources in one explicit diagnosis. */
  maxDiagnosisSources: number
  /** Maximum retained findings in one complete source projection. */
  maxDiagnosisFindings: number
  /** Maximum UTF-8 bytes in a complete diagnostic report or source projection. */
  maxDiagnosisBytes: number
  /** Maximum selected run summaries read per source in one statistics request. */
  maxStatisticsRuns: number
  /** Maximum original session logs inspected by one explicit usage request. */
  maxStatisticsSessions: number
  /** Maximum combined day, workspace, and executor groups in one report. */
  maxStatisticsGroups: number
  /** Maximum UTF-8 bytes in the complete statistics response. */
  maxStatisticsBytes: number
}
/** Required source and persistence services. */
export const inject = ['workbenchAgents', 'workflowWorkbench', 'sessionPersistence', 'storageDomain', 'workspaceRegistry', 'fs']
/** Deployment-configurable directory and evidence bounds. */
export const Config: z<Config> = z.object({
  pageSize: z.number().step(1).min(1).default(25),
  maxPageSize: z.number().step(1).min(1).default(100),
  maxReviewDecisions: z.number().step(1).min(1).default(10000),
  maxRecordBytes: z.number().step(1).min(1024).default(4_194_304),
  maxDeliveryBytes: z.number().step(1).min(1024).default(262_144),
  maxDiagnosisSources: z.number().step(1).min(1).default(50),
  maxDiagnosisFindings: z.number().step(1).min(1).default(200),
  maxDiagnosisBytes: z.number().step(1).min(1).default(262144),
  maxStatisticsRuns: z.number().step(1).min(1).default(5000),
  maxStatisticsSessions: z.number().step(1).min(1).default(100),
  maxStatisticsGroups: z.number().step(1).min(1).default(1000),
  maxStatisticsBytes: z.number().step(1).min(1).default(1048576),
  maxArtifactBytes: z.number().step(1).min(1).default(131_072),
})
const renderError = (error: unknown) => error instanceof Error ? error.message : String(error)
const compare = (a: WorkItem, b: WorkItem): number => {
  const priority = Number(b.needsAttention) - Number(a.needsAttention)
  if (priority !== 0) return priority
  const time = b.run.updatedAt - a.run.updatedAt
  if (time !== 0) return time
  const aKey = workKey({ kind: a.kind, id: a.run.id } as WorkReference)
  const bKey = workKey({ kind: b.kind, id: b.run.id } as WorkReference)
  return aKey < bKey ? 1 : aKey > bKey ? -1 : 0
}

/** Sources own executions; this provider owns only independently committed human decisions. */
export class NativeWorkCenter extends WorkCenter {
  static inject = inject
  static Config = Config
  private domain!: Domain<typeof reviewDomain>
  private tail: Promise<void> = Promise.resolve()
  private closing = false
  private readonly owner: Context
  constructor(ctx: Context, private readonly config: Config) { super(ctx); this.owner = ctx }

  protected async [Service.init](): Promise<void> {
    if (this.config.pageSize > this.config.maxPageSize) throw new Error('pageSize must not exceed maxPageSize.')
    this.domain = await this.owner.storageDomain.open(reviewDomain)
    this.owner.effect(() => async () => { this.closing = true; await this.tail; await this.domain.close() }, 'work center: settle decisions and close reviews')
  }

  private queue<T>(action: () => T | Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('Work center is unloading.'))
    const result = this.tail.then(action)
    this.tail = result.then(() => {}, () => {})
    return result
  }

  query(request: WorkQuery): Promise<WorkPage> {
    return this.queue(async () => {
      if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > this.config.maxPageSize)
        throw new Error(`Work page limit must be an integer from 1 to ${this.config.maxPageSize}.`)
      const pending = [...new Set(request.attentionSessionIds)].sort()
      const query = createHash('sha256').update(JSON.stringify([request.workspaceId ?? null, request.source ?? null, request.state ?? null, request.limit, pending])).digest('hex')
      if (request.cursor !== undefined && request.cursor.query !== query) throw new Error('This cursor belongs to another work query. Refresh the directory.')
      const base = { limit: request.limit, ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }) }
      const agentStatuses: AgentRun['status'][] | undefined = request.state === 'waiting' ? ['running'] : request.state === 'active' ? ['queued', 'running'] : request.state === 'finished' ? ['completed', 'failed', 'cancelled', 'interrupted'] : undefined
      const workflowStatuses: WorkflowRunStatus[] | undefined = request.state === 'waiting' ? ['waiting'] : request.state === 'active' ? ['queued', 'running', 'waiting', 'stopping'] : request.state === 'finished' ? ['succeeded', 'failed', 'cancelled', 'interrupted'] : undefined
      const [agents, workflows] = await Promise.allSettled([
        request.source === 'workflow' ? Promise.resolve(undefined) : this.owner.workbenchAgents.queryRuns({ ...base, attentionSessionIds: pending,
          ...(request.state === 'waiting' ? { attentionOnly: true } : {}),
          ...(agentStatuses === undefined ? {} : { statuses: agentStatuses }),
          ...(request.cursor?.agent === undefined ? {} : { before: request.cursor.agent }) }),
        request.source === 'agent' ? Promise.resolve(undefined) : this.owner.workflowWorkbench.queryRuns({ ...base,
          ...(workflowStatuses === undefined ? {} : { statuses: workflowStatuses }),
          ...(request.cursor?.workflow === undefined ? {} : { before: request.cursor.workflow }) }),
      ])
      const failures: WorkPage['failures'] = []
      const rows: WorkItem[] = []
      let more = false
      if (agents.status === 'rejected') failures.push({ source: 'agent', message: renderError(agents.reason) })
      else if (agents.value !== undefined) { rows.push(...agents.value.items.map(run => ({ kind: 'agent' as const, run, needsAttention: run.status === 'running' && pending.includes(run.sessionId) }))); more ||= agents.value.next !== undefined }
      if (workflows.status === 'rejected') failures.push({ source: 'workflow', message: renderError(workflows.reason) })
      else if (workflows.value !== undefined) { rows.push(...workflows.value.items.map(run => ({ kind: 'workflow' as const, run, needsAttention: run.status === 'waiting' }))); more ||= workflows.value.next !== undefined }
      rows.sort(compare)
      more ||= rows.length > request.limit
      const items = rows.slice(0, request.limit).map((item) => {
        const review = this.domain.table('assessments').get(workKey({ kind: item.kind, id: item.run.id } as WorkReference))?.history.at(-1)
        if (review === undefined) return item
        const { delivery: _delivery, ...summary } = review
        return { ...item, review: summary }
      })
      const next: WorkCursor = { ...request.cursor, query }
      const last = items.at(-1)
      if (last !== undefined) {
        // Source-kind sentinels preserve the merged tie order when the other source has not emitted a row.
        if (agents.status === 'fulfilled' && agents.value !== undefined) next.agent = { revision: agents.value.revision, attention: last.needsAttention, updatedAt: last.run.updatedAt,
          id: (last.kind === 'agent' ? last.run.id : '\uffff') as NonNullable<WorkCursor['agent']>['id'] }
        if (workflows.status === 'fulfilled' && workflows.value !== undefined) next.workflow = { revision: workflows.value.revision, attention: last.needsAttention, updatedAt: last.run.updatedAt,
          id: (last.kind === 'workflow' ? last.run.id : '') as NonNullable<WorkCursor['workflow']>['id'] }
      }
      return structuredClone({ items, failures, observedAt: Date.now(), ...(more && failures.length === 0 ? { next } : {}) })
    })
  }

  statistics(request: WorkStatisticsQuery): Promise<WorkStatisticsReport> {
    const selection = structuredClone(request)
    return this.queue(() => readStatistics(this.owner, this.config, selection))
  }

  statisticsChoices(): Promise<WorkStatisticsChoices> {
    return this.queue(() => readStatisticsChoices(this.owner))
  }

  detail(ref: WorkReference): Promise<WorkDetail> { return this.queue(() => this.readDetail(ref)) }

  source(ref: WorkReference): Promise<WorkSource> {
    ref = structuredClone(ref)
    return this.queue(async () => {
      if (ref.kind === 'agent') {
        const run = await this.owner.workbenchAgents.inspectRun(ref.id)
        return { ref, name: run.agentName, workspaceId: run.workspaceId, sessionId: run.sessionId, status: run.status }
      }
      const run = await this.owner.workflowWorkbench.inspectRun(ref.id)
      return { ref, name: run.version.definition.requirement.summary,
        workspaceId: run.workspaceId, sessionId: run.sessionId, status: run.status }
    })
  }

  review(ref: WorkReference, revision: number): Promise<DeliveryReview> {
    ref = structuredClone(ref)
    return this.queue(() => {
      const review = this.domain.table('assessments').get(workKey(ref))?.history.find(value => value.revision === revision)
      if (review === undefined) throw new Error('Unknown committed delivery review.')
      return structuredClone(review)
    })
  }

  diagnose(ref: WorkReference): Promise<WorkDiagnosis> {
    return this.queue(async () => {
      const sources: DiagnosticSource[] = []
      const findings: DiagnosticFinding[] = []
      const owned = ref.kind === 'agent'
        ? { kind: 'agent' as const, run: await this.owner.workbenchAgents.inspectRun(ref.id) }
        : { kind: 'workflow' as const, run: await this.owner.workflowWorkbench.inspectRun(ref.id) }
      const run = owned.run
      const retry: WorkDiagnosis['retry'] = owned.kind === 'agent'
        ? { kind: 'agent', agentId: owned.run.agentId, task: owned.run.prompt,
          ...(owned.run.purpose === undefined ? {} : { purpose: owned.run.purpose }),
          ...(owned.run.configuration === undefined ? {} : { configuration: owned.run.configuration }) }
        : { kind: 'workflow', workflowId: owned.run.workflowId, versionId: owned.run.version.id, version: owned.run.version.number,
          mode: owned.run.mode, inputs: owned.run.inputs, execution: owned.run.execution,
          ...(owned.run.assertion === undefined ? {} : { assertion: owned.run.assertion }),
          ...(owned.run.feedback === undefined ? {} : { feedback: owned.run.feedback }) }
      const report: WorkDiagnosis = { ref, observedAt: Date.now(), status: run.status, sources, findings, retry }
      sources.push({ kind: 'run', sessionId: run.sessionId, state: 'available' })
      if (run.error !== undefined || ['failed', 'cancelled', 'interrupted'].includes(run.status))
        findings.push({ source: 0, scope: 'run', terminal: true, message: run.error ?? '',
          category: run.status === 'cancelled' ? 'cancelled' : run.status === 'interrupted' ? 'interrupted' : 'unknown' })
      const inspect = async (source: DiagnosticSource, terminalSeq?: number): Promise<void> => {
        const index = sources.length
        sources.push(source)
        try {
          const transcript = await this.owner.sessionPersistence.inspect(source.sessionId)
          const through = source.throughSeq ?? transcript.events.at(-1)?.seq ?? -1
          if (terminalSeq !== undefined && !transcript.events.some(event => event.seq === terminalSeq && event.type === 'turn/end')) {
            source.state = 'interval-unknown'; return
          }
          const projected = sessionFindings(transcript.events, index, through, terminalSeq, source.interval)
          if (projected.length > this.config.maxDiagnosisFindings ||
            Buffer.byteLength(JSON.stringify(projected)) > this.config.maxDiagnosisBytes) {
            source.state = 'capacity'; return
          }
          findings.push(...projected)
        } catch { source.state = 'unavailable' }
      }
      if (owned.kind === 'agent') {
        const agent = owned.run
        if (agent.settledSeq === undefined) sources.push({ kind: 'session', sessionId: run.sessionId, state: 'interval-unknown' })
        else await inspect({ kind: 'session', sessionId: run.sessionId, throughSeq: agent.settledSeq, state: 'available' }, agent.settledSeq)
      } else {
        const workflow = owned.run
        const children = workflow.attempts.filter(attempt => attempt.childSessionId !== undefined)
        if (children.length > this.config.maxDiagnosisSources) throw new Error('Diagnosis exceeds maxDiagnosisSources. Inspect the original workflow history.')
        if (workflow.assertion?.passed === false)
          findings.push({ source: 0, scope: 'assertion', terminal: false, category: 'assertion', message: workflow.assertion.detail ?? '' })
        for (const attempt of workflow.attempts) {
          if (attempt.error !== undefined) findings.push({ source: 0, scope: 'node', nodeId: attempt.nodeId, terminal: false,
            category: attempt.status === 'cancelled' ? 'cancelled' : attempt.status === 'interrupted' ? 'interrupted' : 'unknown', message: attempt.error })
          if (attempt.childSessionId === undefined) continue
          if (attempt.startedAt === undefined || attempt.endedAt === undefined)
            sources.push({ kind: 'session', sessionId: attempt.childSessionId, nodeId: attempt.nodeId, state: 'interval-unknown' })
          else await inspect({ kind: 'session', sessionId: attempt.childSessionId, nodeId: attempt.nodeId, state: 'available',
            interval: { from: attempt.startedAt, to: attempt.endedAt } })
        }
      }
      report.observedAt = Date.now()
      if (findings.length > this.config.maxDiagnosisFindings || Buffer.byteLength(JSON.stringify(report)) > this.config.maxDiagnosisBytes)
        throw new Error('Diagnosis exceeds its configured finding or byte capacity. Inspect the original transcript.')
      return report
    })
  }

  executors(): Promise<WorkExecutor[]> {
    return this.queue(async () => (await this.owner.workbenchAgents.snapshot()).agents
      .map(({ id, name, revision, archived, runtime, instructions, skills, model, mcpServers }) => ({ id, name, revision, archived, runtime,
        instructions, skills, mcpServerNames: mcpServers.map(server => server.name), ...(model === undefined ? {} : { model }) })))
  }

  options(): { pageSize: number } { return { pageSize: this.config.pageSize } }

  revisionBrief(request: Pick<Extract<WorkCommand, { kind: 'revise-agent' }>, 'ref' | 'reviewRevision' | 'brief'>): Promise<TaskBrief> {
    return this.queue(() => this.prepareRevision(request))
  }

  private prepareRevision(command: Pick<Extract<WorkCommand, { kind: 'revise-agent' }>, 'ref' | 'reviewRevision' | 'brief'>): TaskBrief {
    const review = this.domain.table('assessments').get(workKey(command.ref))?.history.at(-1)
    if (review?.revision !== command.reviewRevision || review.decision !== 'changes-requested') throw new Error('Review changed. Reload the requested changes before creating a revision task.')
    return { ...command.brief, background: `${command.brief.background}\n\nReview feedback:\n${review.reason}\n\nOriginal recorded delivery:\n${review.delivery.outputs.map(output => output.text).join('\n\n')}` }
  }

  private async readDetail(ref: WorkReference): Promise<WorkDetail> {
    let detail: WorkDetail
    let evidence: Omit<DeliverySnapshot, 'version'> | undefined
    if (ref.kind === 'agent') {
      const run = await this.owner.workbenchAgents.inspectRun(ref.id)
      detail = { ref, name: run.agentName, sessionId: run.sessionId, workspaceId: run.workspaceId, status: run.status, agentId: run.agentId,
        ...((run.revisionOf ?? run.retryOf) === undefined ? {} : { revisionOf: { kind: 'agent' as const, id: (run.revisionOf ?? run.retryOf) as typeof run.id } }),
        ...(run.configuration === undefined ? {} : { configuration: run.configuration }),
        ...(run.submission === undefined ? {} : { brief: run.submission.brief }), ...(run.error === undefined ? {} : { error: run.error }) }
      if (run.settledSeq !== undefined) {
        try {
          const settledSeq = run.settledSeq
          const transcript = await this.owner.sessionPersistence.inspect(run.sessionId)
          const answer = transcript.events.findLast(event => event.seq <= settledSeq && event.type === 'assistant/message')
          if (answer?.type === 'assistant/message') {
            const text = answer.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
            if (text !== '') {
              const artifacts: DeliveryArtifact[] = []
              const workspace = this.owner.workspaceRegistry.get(run.workspaceId)
              for (const path of run.submission?.brief.deliverables ?? []) {
                try {
                  if (workspace === undefined) throw new Error('Workspace is unavailable.')
                  const parent = await this.owner.fs.resolve('.', { cwd: workspace.path })
                  const target = await this.owner.fs.resolve(path, { cwd: workspace.path })
                  if (!this.owner.fs.contains(parent, target)) throw new Error('Expected artifact is outside the selected workspace.')
                  const bytes = await this.owner.fs.readBytes(target, undefined, this.config.maxArtifactBytes)
                  let content: string
                  let encoding: 'utf-8' | 'base64'
                  try {
                    content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
                    if (content.includes('\0')) throw new Error('Binary content')
                    encoding = 'utf-8'
                  } catch {
                    // Non-text files retain bounded original bytes without executing or rendering them.
                    content = Buffer.from(bytes).toString('base64'); encoding = 'base64'
                  }
                  artifacts.push({ path, state: 'captured', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength, encoding, content })
                } catch (error) { artifacts.push({ path, state: 'unavailable', error: renderError(error) }) }
              }
              evidence = { outputs: [{ name: 'Assistant response', text }], artifacts,
                criteria: run.submission?.brief.acceptanceCriteria ?? [], evidence: 'recorded-response' }
            }
          }
        } catch (error) { detail.deliveryError = renderError(error) }
      }
    } else {
      const run = await this.owner.workflowWorkbench.inspectRun(ref.id)
      const waiting = run.attempts.find(attempt => attempt.status === 'waiting')
      detail = { ref, name: run.version.definition.requirement.summary, sessionId: run.sessionId,
        workspaceId: run.workspaceId, status: run.status,
        ...(run.rerunOf === undefined ? {} : { revisionOf: { kind: 'workflow' as const, id: run.rerunOf } }),
        ...(waiting === undefined ? {} : { waitingAttemptId: waiting.id }), ...(run.error === undefined ? {} : { error: run.error }) }
      if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(run.status) && Object.keys(run.outputs).length > 0)
        evidence = { outputs: Object.entries(run.outputs).sort(([a], [b]) => a.localeCompare(b)).map(([name, text]) => ({ name, text })),
          criteria: run.version.definition.requirement.objectives.map(objective => objective.statement),
          artifacts: [], evidence: 'recorded-workflow-output',
          ...(run.assertion === undefined ? {} : { assertion: run.assertion }) }
    }
    if (evidence !== undefined) {
      const serialized = JSON.stringify([ref, evidence])
      if (Buffer.byteLength(serialized) > this.config.maxDeliveryBytes)
        detail.deliveryError = 'Recorded delivery exceeds maxDeliveryBytes; inspect the source transcript.'
      else detail.delivery = { ...evidence,
        version: createHash('sha256').update(serialized).digest('hex') as DeliveryVersion }
    }
    const history = this.domain.table('assessments').get(workKey(ref))?.history ?? []
    const review = history.at(-1)
    if (review !== undefined) {
      detail.review = structuredClone(review)
      detail.priorReviews = structuredClone(history.slice(0, -1))
    }
    return detail
  }

  command(command: WorkCommand): Promise<WorkReceipt> {
    return this.queue(async () => {
      switch (command.kind) {
        case 'retry-agent': {
          const receipt = await this.owner.workbenchAgents.command({ kind: 'retry', runId: command.ref.id,
            expectedRevision: command.expectedRevision, requestId: command.requestId })
          if (receipt.runId === undefined) throw new Error('Task retry returned no run identity.')
          return { ref: { kind: 'agent', id: receipt.runId } }
        }
        case 'retry-workflow': {
          const receipt = await this.owner.workflowWorkbench.command({ kind: 'retry', runId: command.ref.id, requestId: command.requestId })
          const id = receipt.runIds?.[0]
          if (id === undefined) throw new Error('Workflow retry returned no run identity.')
          return { ref: { kind: 'workflow', id } }
        }
        case 'decide-workflow': {
          await this.owner.workflowWorkbench.command({ kind: 'decide', runId: command.ref.id, attemptId: command.attemptId, approve: command.approve })
          return { ref: command.ref }
        }
        case 'revise-agent': {
          const brief = this.prepareRevision(command)
          const source = await this.owner.workbenchAgents.inspectRun(command.ref.id)
          const receipt = await this.owner.workbenchAgents.command({ kind: 'submit-task', id: source.agentId, workspaceId: source.workspaceId,
            requestId: command.requestId, expectedRevision: command.agentRevision,
            brief, revisionOf: source.id })
          if (receipt.runId === undefined) throw new Error('Task submission returned no run identity.')
          return { ref: { kind: 'agent', id: receipt.runId } }
        }
        case 'revise-workflow': {
          const review = this.domain.table('assessments').get(workKey(command.ref))?.history.at(-1)
          if (review?.revision !== command.reviewRevision || review.decision !== 'changes-requested') throw new Error('Review changed. Reload the requested changes before starting a revision run.')
          const source = await this.owner.workflowWorkbench.inspectRun(command.ref.id)
          const receipt = await this.owner.workflowWorkbench.command({ kind: 'start', id: source.workflowId,
            versionId: source.version.id, inputs: source.inputs, rerunOf: source.id, requestId: command.requestId,
            feedback: `${review.reason}\n\nOriginal recorded delivery:\n${review.delivery.outputs.map(output => output.text).join('\n\n')}` })
          const id = receipt.runIds?.[0]
          if (id === undefined) throw new Error('Workflow submission returned no run identity.')
          return { ref: { kind: 'workflow', id } }
        }
        case 'review': {
          const all = [...this.domain.table('assessments').entries()].map(([, record]) => record)
          const repeated = all.flatMap(record => record.history).find(review => review.decisionId === command.decisionId)
          if (repeated !== undefined) {
            if (workKey(repeated.ref) !== workKey(command.ref) || repeated.version !== command.version ||
              repeated.decision !== command.decision || repeated.reason !== command.reason.trim())
              throw new Error('This decision ID already belongs to another review.')
            return { ref: repeated.ref, reviewRevision: repeated.revision }
          }
          const key = workKey(command.ref)
          const history = this.domain.table('assessments').get(key)?.history ?? []
          if (history.length !== command.expectedRevision) throw new Error('Review changed in another window. Reload before deciding.')
          if (command.decision === 'changes-requested' && command.reason.trim() === '') throw new Error('Explain the requested changes.')
          const detail = await this.readDetail(command.ref)
          if (detail.delivery === undefined || detail.delivery.version !== command.version || ['queued', 'running', 'waiting', 'stopping'].includes(detail.status))
            throw new Error('This recorded delivery is unavailable or changed. Reload before reviewing.')
          if (command.decision === 'accepted' && detail.delivery.artifacts.some(artifact => artifact.state === 'unavailable'))
            throw new Error('Expected artifacts are unavailable. Resolve the artifact errors before accepting delivery.')
          if (all.reduce((count, record) => count + record.history.length, 0) >= this.config.maxReviewDecisions) throw new Error('Review history capacity reached.')
          const review: DeliveryReview = { ref: command.ref, version: command.version, revision: history.length + 1,
            decisionId: command.decisionId, decision: command.decision, reason: command.reason.trim(), reviewedAt: Date.now(), actor: 'local-operator', delivery: detail.delivery }
          const record = { ref: command.ref, history: [...history, review] }
          if (Buffer.byteLength(JSON.stringify(record)) > this.config.maxRecordBytes) throw new Error('Review record exceeds maxRecordBytes.')
          await this.domain.table('assessments').put(key, record)
          for (const listener of this.owner.events.dispatch('emit', ['work-center/changed', command.ref])) {
            try { void Promise.resolve(listener(command.ref)).catch((error: unknown) => { this.owner.logger.warn('Review listener failed: %s', renderError(error)) }) }
            catch (error) { this.owner.logger.warn('Review listener failed: %s', renderError(error)) }
          }
          return { ref: command.ref, reviewRevision: review.revision }
        }
        default: return assert.fail(`Unknown work command: ${String(command satisfies never)}`)
      }
    })
  }
}

/**
 * Mount the directory provider and its typed Remote consumer.
 * @param ctx - owning host context.
 * @param config - deployment bounds for queries and retained evidence.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(NativeWorkCenter, config).await()
  await ctx.plugin(WorkCenterGateway).await()
}
