/** Replaceable explicit file registry over retained snapshots. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { ArtifactDetail, ArtifactObservation, ArtifactOptions, ArtifactPage, ArtifactQuery, ArtifactReceipt, ArtifactRegistration, WorkArtifactId } from './types.ts'
declare module '@deepseek-ai/cordis' { interface Context { workArtifacts: WorkArtifacts } }
/** Registration never executes work or rewrites source files. */
export abstract class WorkArtifacts extends Service {
  constructor(ctx: Context) { super(ctx, 'workArtifacts') }
  /**
   * Read deployment-selected directory and capture limits.
   * @returns the browser's explicit page size and per-file byte limit.
   */
  abstract options(): ArtifactOptions
  /**
   * Query bounded latest-version metadata without reading source files.
   * @param request - explicit text, workspace, source, origin, and page selection.
   * @returns detached metadata with a generation-bound continuation.
   */
  abstract query(request: ArtifactQuery): Promise<ArtifactPage>
  /**
   * Read one retained version and its content-free history.
   * @param id - registered file identity.
   * @param version - exact immutable capture number.
   * @returns stored bytes and provenance, independent of live file availability.
   */
  abstract read(id: WorkArtifactId, version: number): Promise<ArtifactDetail>
  /**
   * Commit an explicit snapshot or promote one accepted review's retained file.
   * @param request - source, exact path, expected version, and idempotency identity.
   * @returns the original receipt on identical retries, including after restart.
   */
  abstract register(request: ArtifactRegistration): Promise<ArtifactReceipt>
  /**
   * Explicitly compare a current workspace file with one retained version.
   * @param id - registered file identity.
   * @param version - immutable capture to compare against.
   * @returns timestamped current-file evidence; history and acceptance remain unchanged.
   */
  abstract inspectCurrent(id: WorkArtifactId, version: number): Promise<ArtifactObservation>
}
