/** Replaceable authenticated remote execution transport consumed by the application gateway. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { RemoteCallRequest, RemotePeer, RemoteWorkResult } from './types.ts'
declare module '@deepseek-ai/cordis' { interface Context { remoteWork: RemoteWork } }
/** A disconnected caller cannot infer whether a native command committed. */
export abstract class RemoteWork extends Service {
  constructor(ctx: Context) { super(ctx, 'remoteWork') }
  /**
   * Describe explicitly configured execution peers without exposing credentials.
   * @returns identities and current credential-presence observations, without network probes.
   */
  abstract peers(): Promise<RemotePeer[]>
  /**
   * Invoke one explicit operation without automatic transport retries.
   * @param request - fixed peer identity and operation input.
   * @returns a validated, Host/principal-qualified remote result; unavailable responses leave writes uncertain.
   */
  abstract call(request: RemoteCallRequest): Promise<RemoteWorkResult>
}
