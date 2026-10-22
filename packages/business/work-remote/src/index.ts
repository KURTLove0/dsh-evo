/** Authenticated whole-task HTTP provider; remote native services own execution worlds and credentials. */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { RemoteWork } from './service.ts'
import { RemoteWorkGateway } from './gateway.ts'
import { REMOTE_WORK_PATH, RemoteWorkFault, encode, replySchema, principalSchema, hostIdentitySchema, failureSchema } from './protocol.ts'
import { resolveBearer } from './auth.ts'
import { readReply, remoteOrigin } from './transport.ts'
import type { RemoteCallRequest, RemoteEnvelope, RemoteOperation, RemotePeer, RemotePeerId, RemoteWorkResult } from './types.ts'
export type * from './types.ts'
export { RemoteWork } from './service.ts'
/** Transport configuration contains credential references, never their values. */
export interface Config {
  /** Execution-capable peers explicitly pinned to origin, Host, principal, and a local bearer reference. */
  peers: {
    /** Stable local selection id; independent of runtime-directory entries. */
    id: string
    /** Human-readable execution peer name. */
    name: string
    /** Canonical HTTPS origin, or numeric loopback HTTP origin for a secured tunnel. */
    origin: string
    /** Expected receiving Host UUID, checked before mutation. */
    hostId: string
    /** Expected receiving authorization principal, checked before mutation. */
    principalId: string
    /** Local credential reference resolved for each machine request. */
    credentialRef: string
  }[]
  /** Total network-operation deadline; no automatic retries occur. */
  timeoutMs: number
  /** Complete machine request bytes, including identity and operation wrappers. */
  maxRequestBytes: number
  /** Complete machine reply bytes before decoding. */
  maxResponseBytes: number
  /** Concurrent Host transport calls. */
  maxInFlight: number
}
/** Required credential owner; no local execution services are used by the transport. */
export const inject = ['credentials']
/** Explicit peers and complete HTTP request/response limits. */
export const Config: z<Config> = z.object({
  peers: z.array(z.object({ id: z.string().min(1).required(), name: z.string().min(1).required(), origin: z.string().required(),
    hostId: z.string().required(), principalId: z.string().required(), credentialRef: z.string().required() })).required(),
  timeoutMs: z.number().step(1).min(1).max(2_147_483_647).default(10000),
  maxRequestBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(262144),
  maxResponseBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(1048576),
  maxInFlight: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(16),
})
class HttpRemoteWork extends RemoteWork {
  private readonly peersById = new Map<string, Config['peers'][number]>()
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<RemoteWorkResult>>()
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
    for (const peer of config.peers) {
      if (this.peersById.has(peer.id)) throw new RemoteWorkFault('conflict')
      principalSchema.parse(peer.principalId); credentialRef(peer.credentialRef)
      hostIdentitySchema.parse(peer.hostId)
      this.peersById.set(peer.id, { ...peer, origin: remoteOrigin(peer.origin) })
    }
    ctx.effect(() => async () => { this.lifetime.abort(); await Promise.allSettled([...this.pending]) }, 'remote work: abort and drain HTTP operations')
  }
  async peers(): Promise<RemotePeer[]> {
    return await Promise.all([...this.peersById.values()].map(async peer => ({ id: peer.id as RemotePeerId, name: peer.name,
      origin: peer.origin, hostId: peer.hostId as RemotePeer['hostId'], principalId: peer.principalId as RemotePeer['principalId'],
      authorization: { reference: credentialRef(peer.credentialRef),
        configured: (await this.ctx.credentials.describe(credentialRef(peer.credentialRef))).configured,
        owner: 'local-host' as const }, executionCredentialOwner: 'remote-host' as const }))).catch(() => { throw new RemoteWorkFault('unavailable') })
  }
  call(request: RemoteCallRequest): Promise<RemoteWorkResult> {
    if (this.lifetime.signal.aborted || this.pending.size >= this.config.maxInFlight) return Promise.reject(new RemoteWorkFault('unavailable'))
    const peer = this.peersById.get(request.peer)
    if (peer === undefined || peer.hostId !== request.expected.hostId || peer.principalId !== request.expected.principalId)
      return Promise.reject(new RemoteWorkFault('denied'))
    const envelope: RemoteEnvelope = { version: 1, hostId: peer.hostId as RemoteEnvelope['hostId'],
      principalId: peer.principalId as RemoteEnvelope['principalId'], operation: structuredClone(request.operation) }
    const task = this.send(peer, envelope).catch((error: unknown) => {
      throw error instanceof RemoteWorkFault ? error : new RemoteWorkFault('unavailable')
    }).finally(() => { this.pending.delete(task) })
    this.pending.add(task); return task
  }
  private async send(peer: Config['peers'][number], envelope: RemoteEnvelope): Promise<RemoteWorkResult> {
    const body = encode(envelope, this.config.maxRequestBytes)
    const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(this.config.timeoutMs)])
    const bearer = await resolveBearer(this.ctx, peer.credentialRef)
    signal.throwIfAborted()
    let response: Response
    try {
      response = await fetch(`${peer.origin}${REMOTE_WORK_PATH}`, { method: 'POST', redirect: 'error', signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body })
    } catch { throw new RemoteWorkFault('unavailable') }
    const value = await readReply(response, this.config.maxResponseBytes)
    if (!response.ok) {
      const failure = failureSchema.safeParse(value)
      throw new RemoteWorkFault(failure.success ? failure.data.error.code : 'unavailable')
    }
    const decoded = replySchema.safeParse(value)
    if (!decoded.success || decoded.data.hostId !== envelope.hostId || decoded.data.principalId !== envelope.principalId)
      throw new RemoteWorkFault('unavailable')
    const { result } = decoded.data
    if (!matches(envelope.operation, result, envelope)) throw new RemoteWorkFault('unavailable')
    return result
  }
}
function matches(operation: RemoteOperation, result: RemoteWorkResult, envelope: RemoteEnvelope): boolean {
  const expected = operation.kind === 'catalog' || operation.kind === 'list' ? operation.kind
    : operation.kind === 'inspect' ? 'inspection' : operation.kind === 'stop' || operation.kind === 'decide' ? 'controlled' : 'submission'
  if (result.kind !== expected) return false
  const records = result.kind === 'list' ? result.items
    : result.kind === 'submission' || result.kind === 'inspection' ? [result.submission] : []
  if (records.some(record => record.hostId !== envelope.hostId || record.principalId !== envelope.principalId
    || record.admission.state === 'admitted' && record.admission.ref.kind !== record.target.kind)) return false
  if ('id' in operation) {
    const id = result.kind === 'controlled' ? result.id : records[0]?.id
    if (id !== operation.id) return false
  }
  if (operation.kind === 'submit' && result.kind === 'submission' && (result.submission.target.kind !== operation.target.kind
    || result.submission.target.id !== operation.target.id
    || result.submission.target.workspaceId !== operation.target.workspaceId)) return false
  if (result.kind === 'inspection' && result.source !== undefined) {
    const { admission, target } = result.submission
    if (admission.state !== 'admitted' || result.source.ref.kind !== admission.ref.kind || result.source.ref.id !== admission.ref.id
      || result.source.workspaceId !== target.workspaceId) return false
  }
  return true
}
/**
 * Mount the authenticated transport and generated application gateway without enabling a receiver.
 * @param ctx - credential-owning local Host.
 * @param config - explicit execution peers and transport limits.
 * @returns completion after both provider and gateway activate.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(HttpRemoteWork, config)
  await ctx.plugin(RemoteWorkGateway)
}
