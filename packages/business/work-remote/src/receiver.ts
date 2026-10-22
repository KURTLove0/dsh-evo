/** Optional loopback machine receiver; authentication and grants precede native admission and controls. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-workbench-agent'
import type {} from '@deepseek-ai/dsh-business-workflow/workbench'
import type {} from '@deepseek-ai/dsh-work-center'
import type {} from '@deepseek-ai/dsh-workspace'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { TaskRequestId } from '@deepseek-ai/dsh-workbench-agent/types'
import type { WorkflowRequestId } from '@deepseek-ai/dsh-business-workflow/workbench-types'
import type { WorkReference } from '@deepseek-ai/dsh-work-center/types'
import { authenticate, resolvePrincipalHashes } from './auth.ts'
import { REMOTE_WORK_PATH, RemoteWorkFault, encode, envelopeSchema, hostIdentitySchema, principalSchema } from './protocol.ts'
import { remoteDomain, submissionKey, nativeRequestId, submissionSummary, targetHash, type StoredSubmission } from './store.ts'
import type { RemoteCatalog, RemoteEnvelope, RemoteWorkResult, RemoteTarget, RemoteSubmission } from './types.ts'
/** One authenticated principal's workspace/executor grants and independent native-control authority. */
export interface ReceiverPrincipal {
  id: string
  credentialRef: string
  allowStop: boolean
  allowWorkflowDecisions: boolean
  grants: { workspaceId: string; agents: string[]; workflows: string[] }[]
}
/** Receiver configuration never contains bearer values or local-to-remote path mappings. */
export interface Config {
  /** UUID pinned by callers and retained even while the submission directory is empty. */
  hostId: string
  /** Explicit credential references and current workspace/executor authorization. */
  principals: ReceiverPrincipal[]
  /** Complete incoming JSON byte cap, including identity and operation wrappers. */
  maxRequestBytes: number
  /** Complete outgoing JSON byte cap, including identity and result wrappers. */
  maxResponseBytes: number
  /** Complete retained submission byte cap, including private recovery fields. */
  maxRecordBytes: number
  /** Retained submissions across all principals; capacity never evicts history. */
  maxSubmissions: number
  /** Concurrent HTTP handlers, including authentication and body consumption. */
  maxInFlight: number
  /** Socket-idle deadline while authenticating and reading the request body. */
  bodyTimeoutMs: number
}
/** Native capability owners and dedicated HTTP route registration. */
export const inject = ['webServer', 'credentials', 'storageDomain', 'workbenchAgents', 'workflowWorkbench', 'workCenter', 'workspaceRegistry']
/** Machine admission is opt-in and contains only credential references. */
export const Config: z<Config> = z.object({
  hostId: z.string().required(),
  principals: z.array(z.object({ id: z.string().required(), credentialRef: z.string().required(),
    allowStop: z.boolean().required(), allowWorkflowDecisions: z.boolean().required(),
    grants: z.array(z.object({ workspaceId: z.string().min(1).required(), agents: z.array(z.string().min(1)).required(),
      workflows: z.array(z.string().min(1)).required() })).required(),
  })).min(1).required(),
  maxRequestBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(262144),
  maxResponseBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(1048576),
  maxRecordBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(262144),
  maxSubmissions: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(100),
  maxInFlight: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(16),
  bodyTimeoutMs: z.number().step(1).min(1).max(2_147_483_647).default(10000),
})
type Principal = Config['principals'][number]
const allowed = (principal: Principal, target: RemoteTarget) => principal.grants.some(grant => grant.workspaceId === target.workspaceId
  && (target.kind === 'agent' ? grant.agents : grant.workflows).includes(target.id))
const publicSubmission = ({ inputHash: _hash, requestId: _requestId, ...value }: StoredSubmission): RemoteSubmission => value
class Receiver {
  private domain!: Domain<typeof remoteDomain>
  private tail: Promise<void> = Promise.resolve()
  private readonly requests = new Set<IncomingMessage>()
  private readonly tasks = new Set<Promise<void>>()
  constructor(private readonly ctx: Context, private readonly config: Config) {}
  async start(): Promise<void> {
    if (this.ctx.webServer.host !== '127.0.0.1') throw new Error('Remote work receiver requires a loopback listener behind a secured tunnel or TLS proxy.')
    hostIdentitySchema.parse(this.config.hostId)
    const ids = new Set<string>(), refs = new Set<string>()
    for (const principal of this.config.principals) {
      principalSchema.parse(principal.id); credentialRef(principal.credentialRef)
      if (ids.has(principal.id) || refs.has(principal.credentialRef)) throw new RemoteWorkFault('conflict')
      ids.add(principal.id); refs.add(principal.credentialRef)
      if (new Set(principal.grants.map(grant => grant.workspaceId)).size !== principal.grants.length) throw new RemoteWorkFault('conflict')
    }
    this.domain = await this.ctx.storageDomain.open(remoteDomain)
    this.ctx.effect(() => async () => {
      for (const request of this.requests) request.destroy()
      await Promise.allSettled([...this.tasks]); await this.tail; await this.domain.close()
    }, 'remote receiver: stop requests, drain native operations, then close durable admissions')
    const identity = this.domain.global.get()
    if (identity.hostId !== undefined && identity.hostId !== this.config.hostId) throw new RemoteWorkFault('conflict')
    if (identity.hostId === undefined) await this.domain.global.set({ hostId: this.config.hostId })
    for (const [key, value] of this.domain.table('submissions').entries())
      if (key !== submissionKey(value) || value.hostId !== this.config.hostId) throw new RemoteWorkFault('conflict')
    for (const principal of this.config.principals) {
      await this.catalog(principal)
      this.checked(principal, { kind: 'list', items: [], observedAt: Date.now() })
    }
    await resolvePrincipalHashes(this.ctx, this.config.principals)
    this.ctx.effect(() => this.ctx.webServer.register({ kind: 'exact', path: REMOTE_WORK_PATH, handler: (request, response) => {
      const task = this.handle(request, response).finally(() => { this.tasks.delete(task) })
      this.tasks.add(task)
      return task
    } }), 'remote receiver: authenticated machine route')
  }
  private checked(principal: Principal, result: RemoteWorkResult): string {
    return encode({ version: 1, hostId: this.config.hostId, principalId: principal.id, result }, this.config.maxResponseBytes)
  }
  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (this.requests.size >= this.config.maxInFlight) { response.writeHead(503); response.end(); return }
    this.requests.add(request)
    request.setTimeout(this.config.bodyTimeoutMs, () => { request.destroy() })
    try {
      if (request.method !== 'POST' || request.url !== REMOTE_WORK_PATH || request.headers.origin !== undefined
        || request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new RemoteWorkFault('denied')
      const principal = await authenticate(this.ctx, this.config.principals, request.headers.authorization)
      const chunks: Buffer[] = []; let bytes = 0
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        const buffer = Buffer.from(chunk as Uint8Array); bytes += buffer.byteLength
        if (bytes > this.config.maxRequestBytes) throw new RemoteWorkFault('limit')
        chunks.push(buffer)
      }
      request.setTimeout(0)
      let decoded: unknown
      try { decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as unknown }
      catch { throw new RemoteWorkFault('invalid-request') }
      const parsed = envelopeSchema.safeParse(decoded)
      if (!parsed.success) throw new RemoteWorkFault('invalid-request')
      if (parsed.data.hostId !== this.config.hostId || parsed.data.principalId !== principal.id) throw new RemoteWorkFault('denied')
      const result = await this.queue(() => this.execute(principal, parsed.data))
      const body = this.checked(principal, result)
      if (!response.destroyed) { response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(body) }
    } catch (error) {
      const code = error instanceof RemoteWorkFault ? error.code : 'unavailable'
      if (!response.destroyed) {
        const status = code === 'denied' ? 403 : code === 'limit' ? 413 : code === 'conflict' ? 409
          : code === 'invalid-request' ? 400 : code === 'unknown-submission' ? 404 : 503
        response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', connection: 'close' })
        response.end(JSON.stringify({ version: 1, error: { code } }))
      }
    } finally { request.setTimeout(0); request.resume(); this.requests.delete(request) }
  }
  private queue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.tail.then(operation); this.tail = task.then(() => {}, () => {}); return task
  }
  private record(principal: Principal, id: RemoteSubmission['id']): StoredSubmission {
    const value = this.domain.table('submissions').get(submissionKey({ principalId: principal.id as RemoteSubmission['principalId'], id }))
    if (value === undefined) throw new RemoteWorkFault('unknown-submission')
    if (!allowed(principal, value.target)) throw new RemoteWorkFault('denied')
    return structuredClone(value)
  }
  private async persist(record: StoredSubmission): Promise<void> {
    encode(record, this.config.maxRecordBytes)
    await this.domain.table('submissions').put(submissionKey(record), structuredClone(record))
  }
  private async catalog(principal: Principal): Promise<RemoteCatalog> {
    const agents = (await this.ctx.workbenchAgents.snapshot()).agents
    const workflows = (await this.ctx.workflowWorkbench.snapshot()).workflows
    return { credentialOwner: 'remote-host', controls: { stop: principal.allowStop, workflowDecisions: principal.allowWorkflowDecisions },
      workspaces: principal.grants.map((grant) => {
        const workspace = this.ctx.workspaceRegistry.get(grant.workspaceId as RemoteTarget['workspaceId'])
        if (workspace === undefined) throw new RemoteWorkFault('unavailable')
        return { id: workspace.id, title: workspace.title, path: workspace.path,
          agents: grant.agents.map((id) => {
            const agent = agents.find(value => value.id === id)
            if (agent === undefined) throw new RemoteWorkFault('unavailable')
            return { id: agent.id, name: agent.name, revision: agent.revision, runtime: agent.runtime, skills: agent.skills,
              mcpServerNames: agent.mcpServers.map(server => server.name), archived: agent.archived }
          }), workflows: grant.workflows.map((id) => {
            const workflow = workflows.find(value => value.id === id && value.workspaceId === grant.workspaceId)
            if (workflow === undefined) throw new RemoteWorkFault('unavailable')
            return { id: workflow.id, name: workflow.name, archived: workflow.archived,
              versions: workflow.versions.map(value => ({ id: value.id, number: value.number,
                inputs: value.definition.requirement.inputs.map(input => ({ name: input.name, description: input.description })) })) }
          }) }
      }) }
  }
  private async validate(target: RemoteTarget): Promise<void> {
    if (this.ctx.workspaceRegistry.get(target.workspaceId) === undefined) throw new RemoteWorkFault('unavailable')
    if (target.kind === 'agent') {
      const check = await this.ctx.workbenchAgents.preflight({ id: target.id, workspaceId: target.workspaceId, brief: target.brief })
      if (check.agentRevision !== target.expectedRevision || check.issues.length > 0) throw new RemoteWorkFault('conflict')
    } else {
      const workflow = (await this.ctx.workflowWorkbench.snapshot(target.id)).workflows.find(value => value.id === target.id)
      if (workflow === undefined || workflow.archived || workflow.workspaceId !== target.workspaceId
        || !workflow.versions.some(value => value.id === target.versionId)) throw new RemoteWorkFault('conflict')
    }
  }
  private async admit(value: StoredSubmission): Promise<WorkReference> {
    const target = value.target
    if (target.kind === 'agent') {
      const receipt = await this.ctx.workbenchAgents.command({ kind: 'submit-task', id: target.id, workspaceId: target.workspaceId,
        expectedRevision: target.expectedRevision, brief: target.brief, requestId: value.requestId as TaskRequestId })
      if (receipt.runId === undefined) throw new RemoteWorkFault('unavailable')
      return { kind: 'agent', id: receipt.runId }
    }
    const receipt = await this.ctx.workflowWorkbench.command({ kind: 'start', id: target.id, versionId: target.versionId,
      inputs: target.inputs, requestId: value.requestId as WorkflowRequestId })
    const runs = receipt.runIds ?? [], [runId] = runs
    if (runId === undefined || runs.length !== 1) throw new RemoteWorkFault('unavailable')
    return { kind: 'workflow', id: runId }
  }
  private async handoff(value: StoredSubmission): Promise<RemoteWorkResult> {
    let ref: WorkReference
    // A native admission may commit before its acknowledgment rejects; the retained request remains recoverable.
    try { ref = await this.admit(value) }
    catch { return { kind: 'submission', submission: submissionSummary(value) } }
    value.admission = { state: 'admitted', ref }; await this.persist(value)
    return { kind: 'submission', submission: submissionSummary(value) }
  }
  private async execute(principal: Principal, envelope: RemoteEnvelope): Promise<RemoteWorkResult> {
    const operation = envelope.operation
    if (operation.kind === 'catalog') return { kind: 'catalog', catalog: await this.catalog(principal), observedAt: Date.now() }
    if (operation.kind === 'list') return { kind: 'list', observedAt: Date.now(), items: [...this.domain.table('submissions').entries()]
      .map(([, value]) => value).filter(value => value.principalId === principal.id && allowed(principal, value.target)
        && (operation.workspaceId === undefined || value.target.workspaceId === operation.workspaceId)).map(submissionSummary) }
    if (operation.kind === 'submit') {
      if (!allowed(principal, operation.target)) throw new RemoteWorkFault('denied')
      const key = submissionKey({ principalId: envelope.principalId, id: operation.id }), existing = this.domain.table('submissions').get(key)
      if (existing !== undefined) {
        if (existing.inputHash !== targetHash(operation.target)) throw new RemoteWorkFault('conflict')
        return { kind: 'submission', submission: submissionSummary(existing) }
      }
      if (this.domain.table('submissions').size >= this.config.maxSubmissions) throw new RemoteWorkFault('limit')
      await this.validate(operation.target)
      const value: StoredSubmission = { id: operation.id, hostId: envelope.hostId, principalId: envelope.principalId,
        createdAt: Date.now(), attempts: 1, target: operation.target, admission: { state: 'unconfirmed' },
        inputHash: targetHash(operation.target),
        requestId: nativeRequestId({ hostId: envelope.hostId, principalId: envelope.principalId, id: operation.id }) }
      this.checked(principal, { kind: 'submission', submission: submissionSummary(value) })
      await this.persist(value); return this.handoff(value)
    }
    const value = this.record(principal, operation.id)
    if (operation.kind === 'recover') {
      if (value.admission.state === 'admitted') return { kind: 'submission', submission: submissionSummary(value) }
      if (operation.expectedAttempt !== value.attempts) throw new RemoteWorkFault('conflict')
      value.attempts++; await this.persist(value); return this.handoff(value)
    }
    if (operation.kind === 'inspect') {
      const result: Extract<RemoteWorkResult, { kind: 'inspection' }> = { kind: 'inspection', submission: publicSubmission(value), observedAt: Date.now() }
      if (value.admission.state === 'unconfirmed') return result
      try {
        const source = await this.ctx.workCenter.source(value.admission.ref)
        if (source.workspaceId !== value.target.workspaceId || source.ref.kind !== value.admission.ref.kind
          || source.ref.id !== value.admission.ref.id) throw new RemoteWorkFault('unavailable')
        result.source = source
      } catch { result.unavailable = true; return result }
      try {
        const detail = await this.ctx.workCenter.detail(value.admission.ref)
        if (detail.delivery === undefined || detail.ref.kind !== value.admission.ref.kind || detail.ref.id !== value.admission.ref.id
          || detail.workspaceId !== value.target.workspaceId) result.unavailable = true
        else result.delivery = { outputs: detail.delivery.outputs, evidence: detail.delivery.evidence }
      } catch { result.unavailable = true }
      if (value.admission.ref.kind === 'workflow' && principal.allowWorkflowDecisions) {
        try {
          const run = await this.ctx.workflowWorkbench.inspectRun(value.admission.ref.id)
          if (run.id !== value.admission.ref.id || run.workspaceId !== value.target.workspaceId)
            throw new RemoteWorkFault('unavailable')
          result.decisions = run.attempts.filter(attempt => attempt.status === 'waiting').map((attempt) => {
            const node = run.version.definition.nodes.find(node => node.id === attempt.nodeId)
            if (node?.kind !== 'approval') throw new RemoteWorkFault('unavailable')
            return { attemptId: attempt.id, title: node.title, instruction: node.instruction, inputs: attempt.inputs }
          })
        } catch { result.decisionsUnavailable = true }
      }
      return result
    }
    if (value.admission.state !== 'admitted') throw new RemoteWorkFault('conflict')
    const ref = value.admission.ref
    if (operation.kind === 'stop') {
      if (!principal.allowStop) throw new RemoteWorkFault('denied')
      if (ref.kind === 'agent') await this.ctx.workbenchAgents.command({ kind: 'stop', runId: ref.id })
      else await this.ctx.workflowWorkbench.command({ kind: 'cancel', runId: ref.id })
    } else {
      if (!principal.allowWorkflowDecisions || ref.kind !== 'workflow') throw new RemoteWorkFault('denied')
      await this.ctx.workflowWorkbench.command({ kind: 'decide', runId: ref.id, attemptId: operation.attemptId, approve: operation.approve })
    }
    return { kind: 'controlled', id: value.id }
  }
}
/**
 * Mount the opt-in authenticated receiver on a loopback Web server.
 * @param ctx - remote deployment's native execution and credential owners.
 * @param config - fixed Host identity, principals, grants, and complete data limits.
 * @returns completion after identity, configured references, and native referents are verified.
 */
export async function apply(ctx: Context, config: Config): Promise<void> { await new Receiver(ctx, config).start() }
