/** Browser-safe Remote contribution; machine authorization values remain on the calling Host. */
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import type {} from './service.ts'
import type { RemoteCallRequest, RemotePeer, RemoteWorkResult } from './types.ts'
/** Configuration UIs cannot turn a directory-only origin into an execution peer. */
export class RemoteWorkGateway extends TypertRemoteService {
  static inject = ['remoteWork']
  constructor(ctx: Context) { super(ctx, 'remoteWorkGateway') }
  /**
   * Read configured machine identities and credential presence without values or probes.
   * @param _request - empty directory request.
   * @returns explicitly configured execution peers.
   */
  @Remote('peers')
  peers(_request: Record<string, never>): Promise<RemotePeer[]> { return this.ctx.remoteWork.peers() }
  /**
   * Invoke a machine operation under its configured transport credential.
   * @param request - peer and caller-pinned operation.
   * @returns a validated remote result; failures do not establish that a write was rejected before admission.
   */
  @Remote('call')
  call(request: RemoteCallRequest): Promise<RemoteWorkResult> { return this.ctx.remoteWork.call(request) }
}
