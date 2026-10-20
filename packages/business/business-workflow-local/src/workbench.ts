/** Durable workspace workflows with immutable publications and session-backed run checkpoints. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionId, type Session, type JsonValue } from '@deepseek-ai/dsh-session'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { WorkflowWorkbench } from '@deepseek-ai/dsh-business-workflow/workbench'
import type {
  WorkflowCommand,
  WorkflowDefinition,
  WorkflowDocument,
  WorkflowId,
  WorkflowVersionId,
  WorkflowRunId,
  WorkflowAttemptId,
  WorkflowAttempt,
  WorkflowBatchId,
  WorkflowRun,
  WorkflowOperationId,
  WorkflowWorkbenchSnapshot,
  WorkflowReceipt,
  WorkflowValidation,
} from '@deepseek-ai/dsh-business-workflow/workbench-types'
import { definitionSchema, runSchema, workbenchDomain } from './workbench-schema.ts'
import {
  analyzeGaps,
  checkCaseInputCoverage,
  topologicalOrder,
  validateComposition,
  validateSubmission,
} from './validation.ts'
import { assertAcceptance, renderThrown } from './execution.ts'
import { WorkflowGateway } from './workbench-gateway.ts'

/** Deployment-authorized execution settings; generated definitions cannot expand this roster. */
export interface Config {
  /** Presets selectable for workflow nodes and AI generation. */
  presets: string[]
  /** Subagent provider used for all Agent nodes. */
  subagentProvider: string
  /** Preset used by the AI draft generator. */
  generatorPreset: string
  /** Maximum retained workflow definitions. */
  maxWorkflows: number
  /** Maximum serialized definition or run size in bytes. */
  maxRecordBytes: number
  /** Maximum simultaneous runs across all workflows. */
  maxActiveRuns: number
  /** Maximum duration of an Agent node or generation operation. */
  nodeTimeoutMs: number
}

/** One owned lifecycle; abort requests cancellation and done includes resource cleanup. */
interface ActiveWork {
  controller: AbortController
  done: Promise<void>
}
const terminal = (run: WorkflowRun): boolean => ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(run.status)
const assertNever = (value: never): never => assert.fail(`Unsupported workflow command: ${String(value)}`)

/** Persistent provider; shared writable workspace execution is deliberately serialized per run. */
export class DurableWorkflowWorkbench extends WorkflowWorkbench {
  static inject = [
    'storageDomain',
    'sessions',
    'sessionPersistence',
    'agents',
    'subagents',
    'workspaceRegistry',
    'agentPresets',
    'agentDefaultModel',
    'tools',
  ]
  static Config: z<Config> = z.object({
    presets: z.array(z.string()).required(),
    subagentProvider: z.string().required(),
    generatorPreset: z.string().required(),
    maxWorkflows: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(200),
    maxRecordBytes: z.number().step(1).min(1024).max(Number.MAX_SAFE_INTEGER).default(4_194_304),
    maxActiveRuns: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(8),
    nodeTimeoutMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(300_000),
  })
  private domain!: Domain<typeof workbenchDomain>
  private readonly active = new Map<string, ActiveWork>()
  private readonly committed = new Map<WorkflowRunId, WorkflowRun>()
  private tail: Promise<void> = Promise.resolve()
  private closing = false
  /** A rejected audit flush leaves append-only memory ahead of confirmed storage. */
  private auditFailure: Error | undefined
  private readonly selfCtx: Context

  constructor(
    ctx: Context,
    private readonly config: Config,
  ) {
    super(ctx)
    this.selfCtx = ctx
  }

  protected async [Service.init](): Promise<void> {
    if (
      [...this.config.presets, this.config.generatorPreset, this.config.subagentProvider].some(
        value => value === '' || value !== value.trim(),
      ) ||
      new Set(this.config.presets).size !== this.config.presets.length
    )
      throw new Error('Workflow preset and provider names must be nonempty, normalized, and unique.')
    if (!this.config.presets.includes(this.config.generatorPreset))
      throw new Error('generatorPreset must be in presets')
    const provider = this.selfCtx.subagents.getProvider(this.config.subagentProvider)
    if (provider === undefined) throw new Error(`Unknown workflow subagent provider ${this.config.subagentProvider}.`)
    if (provider.inheritsParentContext || !provider.capabilities.toolFilter)
      throw new Error('Workflow delegation requires fresh child context and tool filtering.')
    for (const preset of this.config.presets) await this.selfCtx.agentPresets.resolve(preset)
    this.domain = await this.selfCtx.storageDomain.open(workbenchDomain)
    this.selfCtx.effect(
      () => async () => {
        this.closing = true
        for (const work of this.active.values()) work.controller.abort(new Error('workflow service unloading'))
        await Promise.allSettled([...this.active.values()].map(work => work.done))
        await this.tail
        await this.domain.close()
      },
      'workflow-workbench: drain work and close storage',
    )
    for (const [id, index] of this.domain.table('runs').entries()) {
      let run: WorkflowRun
      if (index.pending !== undefined) {
        // An initial audit may already be durable when the index update failed.
        const headers = await this.selfCtx.sessionPersistence.list()
        if (headers.some(header => header.id === index.sessionId)) run = await this.readRun(id)
        else run = index.pending
      } else run = await this.readRun(id)
      if (!terminal(run) && run.status !== 'waiting') {
        await this.commit({
          ...run,
          status: 'interrupted',
          error: 'Host stopped before this execution settled.',
          attempts: run.attempts.map(attempt =>
            attempt.status === 'running' || attempt.status === 'stopping'
              ? {
                ...attempt,
                status: 'interrupted',
                endedAt: Date.now(),
                error: 'Execution was interrupted; no work was replayed.',
              }
              : attempt.status === 'pending'
                ? { ...attempt, status: 'skipped', error: 'Run interrupted.' }
                : attempt,
          ),
        })
      }
      if (index.pending !== undefined)
        await this.domain.table('runs').put(id, { workflowId: index.workflowId, sessionId: index.sessionId })
    }
    for (const [id, operation] of this.domain.table('operations').entries()) {
      if (operation.status === 'running')
        await this.domain
          .table('operations')
          .put(id, { ...operation, status: 'interrupted', error: 'Host stopped during generation.' })
    }
  }

  async snapshot(id?: WorkflowId): Promise<WorkflowWorkbenchSnapshot> {
    return this.enqueue(async () => {
      const allRuns = await Promise.all([...this.domain.table('runs').keys()].map(runId => this.readRun(runId)))
      const latest = new Map<WorkflowId, WorkflowRun>()
      for (const run of allRuns) {
        const prior = latest.get(run.workflowId)
        if (prior === undefined || run.createdAt >= prior.createdAt) latest.set(run.workflowId, run)
      }
      return {
        ...(this.auditFailure === undefined ? {} : { failure: this.auditFailure.message }),
        workflows: [...this.domain.table('workflows').entries()].map(([, document]) => structuredClone(document)),
        runs:
        id === undefined
          ? []
          : allRuns.filter(run => run.workflowId === id),
        latestRuns: [...latest.values()].map(({ id, workflowId, status, mode, createdAt, updatedAt }) =>
          ({ id, workflowId, status, mode, createdAt, updatedAt })),
        operations:
        id === undefined
          ? []
          : [...this.domain.table('operations').entries()]
            .filter(([, operation]) => operation.workflowId === id)
            .map(([, operation]) => structuredClone(operation)),
        presets: [...this.config.presets],
      }
    })
  }

  validate(definition: WorkflowDefinition): WorkflowValidation {
    const issues: string[] = []
    const parsed = definitionSchema.safeParse(definition)
    if (!parsed.success)
      return { valid: false, issues: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`) }
    try {
      const spec = validateSubmission(definition.requirement)
      issues.push(...analyzeGaps(spec).map(gap => gap.question))
      issues.push(
        ...validateComposition(spec, { steps: definition.nodes, finalOutputs: definition.finalOutputs }).map(
          issue => `${issue.message} ${issue.remedy}`,
        ),
      )
      const coverage = checkCaseInputCoverage(spec)
      if (coverage !== undefined) issues.push(coverage)
    } catch (error) {
      issues.push(renderThrown(error))
    }
    for (const node of definition.nodes) {
      if (!this.config.presets.includes(node.preset))
        issues.push(`Node ${node.id}: preset ${node.preset} is not authorized.`)
    }
    return { valid: issues.length === 0, issues }
  }

  command(request: WorkflowCommand): Promise<WorkflowReceipt> {
    return this.enqueue(async () => {
      if (this.auditFailure !== undefined) throw this.auditFailure
      const receipt = await this.applyCommand(request)
      this.notify(receipt.workflowId)
      return receipt
    })
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('workflow service is unloading'))
    const work = this.tail.then(action)
    this.tail = work.then(
      () => {},
      () => {},
    )
    return work
  }

  private async applyCommand(request: WorkflowCommand): Promise<WorkflowReceipt> {
    switch (request.kind) {
      case 'create': {
        if (this.domain.table('workflows').size >= this.config.maxWorkflows)
          throw new Error('Workflow capacity reached.')
        if (request.name.trim() === '' || request.description.trim() === '')
          throw new Error('Name and business description are required.')
        await this.workspace(request.workspaceId)
        const id = randomUUID() as WorkflowId
        const document: WorkflowDocument = {
          id,
          workspaceId: request.workspaceId,
          name: request.name.trim(),
          revision: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          archived: false,
          draft: {
            requirement: {
              summary: request.description,
              objectives: [],
              inputs: [],
              outputs: [],
              constraints: [],
              acceptanceCases: [],
            },
            nodes: [],
            finalOutputs: [],
            positions: {},
          },
          versions: [],
        }
        this.assertSize(document)
        await this.domain.table('workflows').put(id, document)
        return { workflowId: id, revision: 1 }
      }
      case 'save':
      case 'publish':
      case 'archive': {
        const document = await this.domain.table('workflows').update(request.id, (current) => {
          this.assertRevision(current, request.expectedRevision)
          if (request.kind !== 'archive' && current.archived)
            throw new Error('Unarchive this workflow before editing or publishing.')
          const next = { ...current, revision: current.revision + 1, updatedAt: Date.now() }
          if (request.kind === 'save') {
            if (request.name.trim() === '') throw new Error('Workflow name is required.')
            const draft = definitionSchema.parse(request.definition)
            this.assertSize(draft)
            const saved = { ...next, name: request.name.trim(), draft }
            this.assertSize(saved)
            return saved
          }
          if (request.kind === 'archive') return { ...next, archived: request.archived }
          const validation = this.validate(current.draft)
          if (!validation.valid) throw new Error(validation.issues.join('\n'))
          const published = {
            ...next,
            versions: [
              ...current.versions,
              {
                id: randomUUID() as WorkflowVersionId,
                number: current.versions.length + 1,
                revision: current.revision,
                createdAt: Date.now(),
                definition: structuredClone(current.draft),
              },
            ],
          }
          this.assertSize(published)
          return published
        })
        return { workflowId: document.id, revision: document.revision }
      }
      case 'generate': {
        const document = this.document(request.id)
        this.assertRevision(document, request.expectedRevision)
        if (document.archived) throw new Error('Cannot generate an archived workflow.')
        if (request.description.trim() === '') throw new Error('Describe the requested workflow.')
        this.assertCapacity()
        const id = randomUUID() as WorkflowOperationId
        const operation = {
          id,
          workflowId: document.id,
          revision: document.revision,
          status: 'running' as const,
          description: request.description,
        }
        this.assertSize(operation)
        await this.domain.table('operations').put(id, operation)
        this.launch(id, controller => this.generate(id, document, request.description, controller.signal))
        return { workflowId: document.id, operationId: id }
      }
      case 'start':
      case 'verify': {
        const document = this.document(request.id)
        if (document.archived) throw new Error('Cannot run an archived workflow.')
        const version = document.versions.find(item => item.id === request.versionId)
        if (version === undefined) throw new Error('Unknown published version.')
        const validation = this.validate(version.definition)
        if (!validation.valid) throw new Error(validation.issues.join('\n'))
        const workspace = await this.workspace(document.workspaceId)
        const cases =
          request.kind === 'verify'
            ? version.definition.requirement.acceptanceCases
            : [{ name: undefined, given: request.inputs }]
        if (cases.length === 0) throw new Error('No acceptance cases to verify.')
        if (request.kind === 'start' && request.rerunOf !== undefined) {
          const prior = await this.readRun(request.rerunOf)
          if (prior.workflowId !== document.id || prior.version.id !== version.id)
            throw new Error('Rerun must reference this workflow and version.')
        }
        // Shared writable directories admit one active run, including waiting runs.
        for (const [runId, index] of this.domain.table('runs').entries()) {
          const owner = this.document(index.workflowId)
          if (owner.workspaceId === workspace.id && !terminal(await this.readRun(runId)))
            throw new Error('This workspace already has an unfinished workflow run.')
        }
        this.assertCapacity()
        const batchId = request.kind === 'verify' ? (randomUUID() as WorkflowBatchId) : undefined
        const runs: WorkflowRun[] = cases.map((kase) => {
          const inputs = structuredClone(kase.given)
          for (const field of version.definition.requirement.inputs)
            if (!Object.hasOwn(inputs, field.name)) throw new Error(`Missing input ${field.name}.`)
          const id = randomUUID() as WorkflowRunId
          return {
            id,
            workflowId: document.id,
            workspaceId: document.workspaceId,
            version: structuredClone(version),
            sessionId: SessionId(randomUUID()),
            mode: request.kind === 'verify' ? 'verification' : 'execution',
            ...(batchId === undefined ? {} : { batchId }),
            ...(kase.name === undefined ? {} : { caseName: kase.name }),
            ...(request.kind === 'start' && request.rerunOf !== undefined ? { rerunOf: request.rerunOf } : {}),
            execution: {
              ...this.selfCtx.agentDefaultModel.currentSelection(),
              subagentProvider: this.config.subagentProvider,
            },
            inputs,
            status: 'queued',
            seq: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            outputs: {},
            attempts: version.definition.nodes.map(node => ({
              id: randomUUID() as WorkflowAttemptId,
              nodeId: node.id,
              status: 'pending',
              inputs: {},
              sources: {},
              preset: node.preset,
              cwd: workspace.path,
            })),
          }
        })
        for (const run of runs) await this.reserveRun(run)
        const first = runs[0]
        assert(first !== undefined)
        this.launchRun(first.id)
        return { workflowId: document.id, runIds: runs.map(run => run.id) }
      }
      case 'cancel': {
        const run = await this.readRun(request.runId)
        if (terminal(run)) return { workflowId: run.workflowId }
        await this.commit({ ...run, status: 'stopping' })
        // Abort the exact active attempt; settlement publishes cancelled only after cleanup.
        const active = this.active.get(run.id)
        if (active !== undefined) active.controller.abort(new Error('Workflow cancelled by user.'))
        else {
          await this.finishCancelled(run.id)
          await this.scheduleNext(run.workspaceId)
        }
        return { workflowId: run.workflowId }
      }
      case 'decide': {
        const run = await this.readRun(request.runId)
        const attempt = run.attempts.find(item => item.id === request.attemptId)
        if (run.status !== 'waiting' || attempt?.status !== 'waiting')
          throw new Error('This attempt is no longer waiting for a decision.')
        const node = run.version.definition.nodes.find(item => item.id === attempt.nodeId)
        if (node?.kind !== 'approval') throw new Error('This is not a human confirmation node.')
        if (request.approve) this.assertCapacity()
        attempt.status = request.approve ? 'succeeded' : 'failed'
        attempt.endedAt = Date.now()
        if (request.approve) attempt.output = JSON.stringify(attempt.inputs)
        else attempt.error = 'Human confirmation rejected.'
        await this.commit({
          ...run,
          status: request.approve ? 'queued' : 'failed',
          ...(request.approve ? {} : { error: attempt.error }),
          attempts: run.attempts.map(item =>
            item.status === 'pending' && !request.approve
              ? { ...item, status: 'skipped', error: 'Human confirmation rejected.' }
              : item,
          ),
        })
        if (request.approve) this.launchRun(run.id)
        else await this.scheduleNext(run.workspaceId)
        return { workflowId: run.workflowId }
      }
      default:
        return assertNever(request)
    }
  }

  private notify(id: WorkflowId): void {
    for (const callback of this.selfCtx.events.dispatch('emit', ['business-workflow/changed', id])) {
      try {
        const result: unknown = (callback as (id: WorkflowId) => unknown)(id)
        void Promise.resolve(result).catch((error: unknown) => {
          this.selfCtx.logger.warn(renderThrown(error))
        })
      } catch (error) {
        this.selfCtx.logger.warn(renderThrown(error))
      }
    }
  }

  private document(id: WorkflowId): WorkflowDocument {
    const document = this.domain.table('workflows').get(id)
    if (document === undefined) throw new Error(`Unknown workflow ${id}.`)
    return document
  }

  private assertRevision(document: WorkflowDocument, revision: number): void {
    if (document.revision !== revision)
      throw new Error(
        `Draft conflict: expected revision ${revision}, found ${document.revision}. Reload before saving.`,
      )
  }

  private assertCapacity(): void {
    if (this.active.size >= this.config.maxActiveRuns) throw new Error('Workflow execution capacity reached.')
  }

  private assertSize(value: unknown): void {
    if (Buffer.byteLength(JSON.stringify(value)) > this.config.maxRecordBytes)
      throw new Error('Workflow record exceeds maxRecordBytes.')
  }

  private async workspace(id: WorkflowDocument['workspaceId']) {
    const workspace = this.selfCtx.workspaceRegistry.get(id)
    if (workspace === undefined || !(await stat(workspace.path)).isDirectory())
      throw new Error('Workflow workspace is unavailable.')
    return workspace
  }

  private launch(id: string, action: (controller: AbortController) => Promise<void>): void {
    const controller = new AbortController()
    const done = Promise.resolve()
      .then(() => action(controller))
      .catch((error: unknown) => {
        this.selfCtx.logger.error(`workflow ${id}: ${renderThrown(error)}`)
      })
      .finally(() => {
        if (this.active.get(id)?.controller === controller) this.active.delete(id)
      })
    this.active.set(id, { controller, done })
  }

  private launchRun(id: WorkflowRunId): void {
    this.launch(id, async (controller) => {
      await this.drive(id, controller.signal)
      if (this.closing) return
      await this.enqueue(async () => {
        // A decision may already have established the next owned lifecycle.
        if (this.active.get(id)?.controller !== controller) return
        this.active.delete(id)
        let run = await this.readRun(id)
        if (run.status === 'stopping') {
          await this.finishCancelled(id)
          run = await this.readRun(id)
        }
        if (terminal(run)) await this.scheduleNext(run.workspaceId)
      })
    })
  }

  private async scheduleNext(workspaceId: WorkflowDocument['workspaceId']): Promise<void> {
    const runs = await Promise.all([...this.domain.table('runs').keys()].map(id => this.readRun(id)))
    const unfinished = runs.filter(run => run.workspaceId === workspaceId && !terminal(run))
    if (unfinished.some(run => run.status !== 'queued' || this.active.has(run.id))) return
    const next = unfinished[0]
    if (next !== undefined) this.launchRun(next.id)
  }

  private async reserveRun(run: WorkflowRun): Promise<void> {
    this.assertSize(run)
    await this.domain.table('runs').put(run.id, { workflowId: run.workflowId, sessionId: run.sessionId, pending: run })
    await this.commit(run)
    await this.domain.table('runs').put(run.id, { workflowId: run.workflowId, sessionId: run.sessionId })
  }

  private async auditSession(run: WorkflowRun): Promise<{ session: Session; [Symbol.asyncDispose]: () => Promise<void> }> {
    const live = this.selfCtx.sessions.get(run.sessionId)
    if (live !== undefined) return { session: live, [Symbol.asyncDispose]: async () => {} }
    const headers = await this.selfCtx.sessionPersistence.list()
    if (headers.some(header => header.id === run.sessionId)) {
      using preparation = await this.selfCtx.sessionPersistence.prepare(run.sessionId)
      return this.attachAudit(preparation.session)
    }
    return this.attachAudit(this.selfCtx.sessions.prepare(run.sessionId, {
      meta: run.attempts[0] === undefined ? {} : { cwd: run.attempts[0].cwd },
    }))
  }

  private attachAudit(session: Session): { session: Session; [Symbol.asyncDispose]: () => Promise<void> } {
    const sessions = this.selfCtx.sessions
    const dispose = this.selfCtx.effect(function* () {
      yield sessions.enter(session)
      sessions.announce(session)
    }, 'workflow audit checkpoint')
    return { session, [Symbol.asyncDispose]: dispose }
  }

  private async commit(run: WorkflowRun): Promise<void> {
    if (this.auditFailure !== undefined) throw this.auditFailure
    await using audit = await this.auditSession(run)
    const session = audit.session
    const prior = session.events.findLast(event => event.type === 'business-workflow/checkpoint')
    const checkpoint = {
      ...run,
      seq: prior?.type === 'business-workflow/checkpoint' ? prior.data.seq + 1 : 1,
      updatedAt: Date.now(),
    }
    this.assertSize(checkpoint)
    try {
      session.append('business-workflow/checkpoint', checkpoint)
      if (!(await this.selfCtx.sessions.flush(session))) throw new Error('Workflow audit has no persistence listener.')
    } catch (error) {
      this.auditFailure = new Error(`Workflow audit persistence failed; restart the Host before further operations: ${renderThrown(error)}`)
      for (const work of this.active.values()) work.controller.abort(this.auditFailure)
      throw this.auditFailure
    }
    this.committed.set(run.id, structuredClone(checkpoint))
    this.notify(run.workflowId)
  }

  private async readRun(id: WorkflowRunId): Promise<WorkflowRun> {
    const index = this.domain.table('runs').get(id)
    if (index === undefined) throw new Error(`Unknown workflow run ${id}.`)
    const cached = this.committed.get(id)
    if (cached !== undefined) return structuredClone(cached)
    if (
      index.pending !== undefined &&
      !(await this.selfCtx.sessionPersistence.list()).some(header => header.id === index.sessionId)
    )
      return structuredClone(index.pending)
    const events = (await this.selfCtx.sessionPersistence.inspect(index.sessionId)).events
    const checkpoint = events.findLast(event => event.type === 'business-workflow/checkpoint')
    if (checkpoint === undefined) {
      if (index.pending !== undefined) return structuredClone(index.pending)
      throw new Error(`Workflow run ${id} has no audit checkpoint.`)
    }
    const run = runSchema.parse(checkpoint.data)
    if (run.id !== id || run.workflowId !== index.workflowId || run.sessionId !== index.sessionId)
      throw new Error('Workflow audit identity mismatch.')
    this.committed.set(id, structuredClone(run))
    return structuredClone(run)
  }

  private async finishCancelled(id: WorkflowRunId): Promise<void> {
    const run = await this.readRun(id)
    await this.commit({
      ...run,
      status: 'cancelled',
      attempts: run.attempts.map(attempt =>
        ['running', 'waiting', 'pending'].includes(attempt.status)
          ? {
            ...attempt,
            status: attempt.status === 'pending' ? 'skipped' : 'cancelled',
            endedAt: Date.now(),
            error: 'Run cancelled.',
          }
          : attempt,
      ),
    })
  }

  private async drive(id: WorkflowRunId, signal: AbortSignal): Promise<void> {
    let parent: AgentHandle | undefined
    try {
      const initial = await this.readRun(id)
      if (terminal(initial) || initial.status === 'waiting') return
      const workspace = await this.workspace(initial.workspaceId)
      const order = topologicalOrder(initial.version.definition.nodes).order
      for (const step of order) {
        const prepared = await this.enqueue(async () => {
          const run = await this.readRun(id)
          if (run.status === 'stopping' || signal.aborted) {
            await this.finishCancelled(id)
            return undefined
          }
          if (terminal(run)) return undefined
          const attempt = run.attempts.find(item => item.nodeId === step.id)
          assert(attempt !== undefined)
          if (attempt.status === 'succeeded') return { skip: true as const, run, attempt }
          const node = run.version.definition.nodes.find(item => item.id === step.id)
          assert(node !== undefined)
          const inputs = Object.fromEntries(
            node.inputs.map((input): readonly [string, JsonValue] => {
              if (input.source.kind === 'requirement') {
                const value = run.inputs[input.source.field]
                assert(value !== undefined)
                return [input.name, value]
              }
              const source = input.source
              const prior = run.attempts.find(item => item.nodeId === source.step)
              assert(prior !== undefined)
              if (prior.status !== 'succeeded' || prior.output === undefined)
                throw new Error(`Predecessor ${prior.nodeId} has no committed output.`)
              return [input.name, prior.output]
            }),
          )
          const requirement = run.version.definition.requirement
          attempt.inputs = inputs
          attempt.sources = Object.fromEntries(node.inputs.map((input): readonly [string, WorkflowAttempt['sources'][string]] => {
            if (input.source.kind === 'requirement') return [input.name, input.source]
            const source = input.source
            const prior = run.attempts.find(item => item.nodeId === source.step)
            assert(prior !== undefined)
            return [input.name, { kind: 'step', nodeId: prior.nodeId, attemptId: prior.id }]
          }))
          attempt.prompt = `${requirement.summary}\nObjectives: ${JSON.stringify(requirement.objectives)}\nConstraints: ${JSON.stringify(requirement.constraints)}\n\n${node.title}\n${node.instruction}\n\nInputs:\n${JSON.stringify(inputs)}`
          attempt.startedAt = Date.now()
          attempt.status = node.kind === 'approval' ? 'waiting' : 'running'
          await this.commit({ ...run, status: node.kind === 'approval' ? 'waiting' : 'running' })
          return { skip: false as const, run, attempt, prompt: attempt.prompt }
        })
        if (prepared === undefined) return
        if (prepared.skip) continue
        if (signal.aborted) {
          await this.enqueue(() => this.finishCancelled(id))
          return
        }
        if (prepared.attempt.status === 'waiting') return
        const node = initial.version.definition.nodes.find(item => item.id === step.id)
        assert(node !== undefined)
        const timeout = AbortSignal.timeout(this.config.nodeTimeoutMs)
        const nodeSignal = AbortSignal.any([signal, timeout])
        parent ??= await this.createParent(workspace.path, node.preset, initial.execution, nodeSignal)
        const parentSessionId = parent.agent.session.id
        const child = await this.selfCtx.subagents.start(initial.execution.subagentProvider, {
          parent: parent.agent,
          signal: nodeSignal,
          agentOptions: initial.execution,
          label: `${initial.id}: ${step.title}`,
          prompt: [{ type: 'text', text: prepared.prompt }],
        })
        let output: string
        try {
          await this.enqueue(async () => {
            const run = await this.readRun(id)
            const attempt = run.attempts.find(item => item.nodeId === step.id)
            assert(attempt !== undefined)
            attempt.parentSessionId = parentSessionId
            attempt.childSessionId = child.id
            attempt.provider = child.localAgent?.options.provider ?? initial.execution.subagentProvider
            if (child.localAgent !== undefined)
              attempt.tools = this.selfCtx.tools.schemas(child.localAgent).map(tool => tool.name)
            if (child.localAgent?.options.model !== undefined) attempt.model = child.localAgent.options.model
            await this.commit(run)
          })
          const result = await child.result
          nodeSignal.throwIfAborted()
          if (result.stopReason !== 'completed') throw new Error(`Node execution ended ${result.stopReason}.`)
          output = result.output
            .filter(item => item.type === 'text')
            .map(item => item.text)
            .join('\n')
        } finally {
          await child.dispose()
        }
        await parent.dispose()
        parent = undefined
        await this.enqueue(async () => {
          const run = await this.readRun(id)
          if (run.status === 'stopping' || signal.aborted) {
            await this.finishCancelled(id)
            return
          }
          const attempt = run.attempts.find(item => item.nodeId === step.id)
          assert(attempt !== undefined)
          attempt.status = 'succeeded'
          attempt.output = output
          attempt.endedAt = Date.now()
          await this.commit(run)
        })
      }
      await this.enqueue(async () => {
        const run = await this.readRun(id)
        if (terminal(run)) return
        if (run.status === 'stopping' || signal.aborted) {
          await this.finishCancelled(id)
          return
        }
        const outputs = Object.fromEntries(
          run.version.definition.finalOutputs.map((binding): readonly [string, string] => {
            if (binding.source.kind === 'requirement')
              return [binding.name, JSON.stringify(run.inputs[binding.source.field])]
            const source = binding.source
            const attempt = run.attempts.find(item => item.nodeId === source.step)
            assert(attempt?.output !== undefined)
            return [binding.name, attempt.output]
          }),
        )
        if (run.mode === 'verification') {
          const kase = run.version.definition.requirement.acceptanceCases.find(item => item.name === run.caseName)
          assert(kase !== undefined)
          const failure = assertAcceptance(kase.expect, outputs)
          run.assertion = failure === undefined ? { passed: true } : { passed: false, detail: failure }
        }
        await this.commit({ ...run, status: 'succeeded', outputs })
      })
    } catch (error) {
      await parent?.dispose()
      parent = undefined
      await this.enqueue(async () => {
        const run = await this.readRun(id)
        if (terminal(run)) return
        if (run.status === 'stopping' || signal.aborted) {
          await this.finishCancelled(id)
          return
        }
        const detail = renderThrown(error)
        await this.commit({
          ...run,
          status: 'failed',
          error: detail,
          attempts: run.attempts.map(attempt =>
            attempt.status === 'running'
              ? { ...attempt, status: 'failed', error: detail, endedAt: Date.now() }
              : attempt.status === 'pending'
                ? { ...attempt, status: 'skipped', error: 'A preceding node failed.' }
                : attempt,
          ),
        })
      })
    } finally {
      await parent?.dispose()
    }
  }

  private async createParent(
    cwd: string,
    preset: string,
    options = this.selfCtx.agentDefaultModel.currentSelection(),
    signal?: AbortSignal,
  ): Promise<AgentHandle> {
    return this.selfCtx.agents.create({
      agentOptions: options,
      ...(signal === undefined ? {} : { signal }),
      sessionId: SessionId(randomUUID()),
      meta: { cwd, agentPreset: preset },
      setup: async (agentCtx) => {
        await this.selfCtx.agentPresets.mount(agentCtx, preset)
      },
    })
  }

  private async generate(
    id: WorkflowOperationId,
    document: WorkflowDocument,
    description: string,
    signal: AbortSignal,
  ): Promise<void> {
    let parent: AgentHandle | undefined
    try {
      const operationSignal = AbortSignal.any([signal, AbortSignal.timeout(this.config.nodeTimeoutMs)])
      parent = await this.createParent(
        (await this.workspace(document.workspaceId)).path,
        this.config.generatorPreset,
        this.selfCtx.agentDefaultModel.currentSelection(),
        operationSignal,
      )
      const prompt = `Design a business workflow from the request. Return ONLY JSON matching the supplied definition. Include objectives, named inputs and outputs, realistic sample acceptanceCases, explicit dependsOn and input sources, and finalOutputs. Supported kinds: agent and approval. Authorized presets: ${JSON.stringify(this.config.presets)}. Positions may be {}. Do not execute business tasks.\nRequest: ${description}\nCurrent draft:\n${JSON.stringify(document.draft)}\nJSON Schema:\n${JSON.stringify(definitionSchema.toJSONSchema())}`
      const child = await this.selfCtx.subagents.start(this.config.subagentProvider, {
        parent: parent.agent,
        signal: operationSignal,
        label: 'Workflow design candidate',
        toolFilter: { allow: [] },
        prompt: [{ type: 'text', text: prompt }],
      })
      try {
        const result = await child.result
        operationSignal.throwIfAborted()
        if (result.stopReason !== 'completed') throw new Error(`Generation ended ${result.stopReason}.`)
        const content = result.output
          .filter(item => item.type === 'text')
          .map(item => item.text)
          .join('\n')
          .trim()
          .replace(/^```(?:json)?\s*|\s*```$/g, '')
        const candidate = definitionSchema.parse(JSON.parse(content))
        const validation = this.validate(candidate)
        if (!validation.valid) throw new Error(validation.issues.join('\n'))
        this.assertSize(candidate)
        await this.domain.table('operations').update(id, current => ({ ...current, status: 'succeeded', candidate }))
        this.notify(document.id)
      } finally {
        await child.dispose()
      }
    } catch (error) {
      await this.domain
        .table('operations')
        .update(id, current => ({ ...current, status: 'failed', error: renderThrown(error) }))
      this.notify(document.id)
    } finally {
      await parent?.dispose()
    }
  }
}

/** Plugin name for the durable provider entry. */
export const name = 'business-workflow-workbench'
/** Required capabilities; all execution is owned by this plugin's service. */
export const inject = DurableWorkflowWorkbench.inject
/** Validated deployment configuration. */
export const Config = DurableWorkflowWorkbench.Config
/**
 * Mount the durable provider and its Remote consumer.
 * @param ctx - host context.
 * @param config - deployment-approved execution settings.
 * @returns readiness of both services.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(DurableWorkflowWorkbench, config).await()
  await ctx.plugin(WorkflowGateway).await()
}
