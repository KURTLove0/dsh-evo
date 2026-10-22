/** Typed Remote consumer for explicit project-file registration and preview. */
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import type {} from './service.ts'
import type { ArtifactDetail, ArtifactObservation, ArtifactOptions, ArtifactPage, ArtifactQuery, ArtifactReceipt, ArtifactRegistration, WorkArtifactId } from './types.ts'
/** Project artifacts remain accessible without an active conversation. */
export class WorkArtifactGateway extends TypertRemoteService {
  static inject = ['workArtifacts']
  constructor(ctx: Context) { super(ctx, 'workArtifactGateway') }
  /**
   * Read deployment limits.
   * @param _request - empty options request.
   * @returns explicit directory and capture limits.
   */
  @Remote('options')
  options(_request: Record<string, never>): ArtifactOptions { return this.ctx.workArtifacts.options() }
  /**
   * Read registered latest-version metadata.
   * @param request - explicit selection and continuation.
   * @returns bounded metadata; this call never reads files.
   */
  @Remote('query')
  query(request: ArtifactQuery): Promise<ArtifactPage> { return this.ctx.workArtifacts.query(request) }
  /**
   * Read one historical byte snapshot and its version directory.
   * @param request - registered identity and exact version.
   * @returns retained inert content and provenance.
   */
  @Remote('read')
  read(request: { id: WorkArtifactId; version: number }): Promise<ArtifactDetail> {
    return this.ctx.workArtifacts.read(request.id, request.version)
  }
  /**
   * Commit an explicit file capture with idempotent acknowledgment recovery.
   * @param request - pinned source and expected registration version.
   * @returns original or newly committed capture identity.
   */
  @Remote('register')
  register(request: ArtifactRegistration): Promise<ArtifactReceipt> { return this.ctx.workArtifacts.register(request) }
  /**
   * Observe current-file availability and digest explicitly.
   * @param request - historical version to compare against.
   * @returns a timestamped observation without altering history.
   */
  @Remote('inspectCurrent')
  inspectCurrent(request: { id: WorkArtifactId; version: number }): Promise<ArtifactObservation> {
    return this.ctx.workArtifacts.inspectCurrent(request.id, request.version)
  }
}
