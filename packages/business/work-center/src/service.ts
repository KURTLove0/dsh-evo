/** Replaceable work directory and delivery assessment service. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { WorkCommand, WorkDetail, WorkExecutor, WorkPage, WorkQuery, WorkReceipt, WorkReference, WorkDiagnosis, WorkSource, DeliveryReview } from './types.ts'
import type { WorkStatisticsChoices, WorkStatisticsQuery, WorkStatisticsReport } from './statistics-types.ts'
import type { TaskBrief } from '@deepseek-ai/dsh-workbench-agent/types'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Cross-executor reads and independently stored human delivery reviews. */
    workCenter: WorkCenter
  }
}

/** Execution facts remain owned by their source services. */
export abstract class WorkCenter extends Service {
  constructor(ctx: Context) { super(ctx, 'workCenter') }
  /**
   * Aggregate a bounded submission-time cohort across execution owners.
   * @param request - date/time zone, workspace, executor, and explicit usage-read choice.
   * @returns counts and measurement coverage, with independent source failures.
   */
  abstract statistics(request: WorkStatisticsQuery): Promise<WorkStatisticsReport>
  /**
   * Read safe executor filter choices without loading their history or credentials.
   * @returns source-qualified identities and explicit directory failures.
   */
  abstract statisticsChoices(): Promise<WorkStatisticsChoices>
  /**
   * Merge bounded source pages with attention first, then latest execution updates.
   * @param request - explicit page limit and optional source/workspace scope.
   * @returns detached records, source failures, and an owned continuation.
   */
  abstract query(request: WorkQuery): Promise<WorkPage>
  /**
   * Read captured delivery evidence for one execution.
   * @param ref - typed original execution identity.
   * @returns detail, optional delivery, and review; unavailable evidence stays explicit.
   */
  abstract detail(ref: WorkReference): Promise<WorkDetail>
  /**
   * Read source execution metadata without inspecting transcripts or files.
   * @param ref - typed source execution.
   * @returns original execution identity, workspace, session, name, and status.
   */
  abstract source(ref: WorkReference): Promise<WorkSource>
  /**
   * Read one immutable committed human assessment without rereading its source.
   * @param ref - reviewed execution identity.
   * @param revision - exact committed review revision.
   * @returns detached retained assessment and its original captured bytes.
   */
  abstract review(ref: WorkReference, revision: number): Promise<DeliveryReview>
  /**
   * Inspect stable failure codes and original recorded evidence without executing work.
   * @param ref - original typed execution identity.
   * @returns bounded timestamped findings and explicit unavailable sources.
   */
  abstract diagnose(ref: WorkReference): Promise<WorkDiagnosis>
  /**
   * Record an assessment or explicitly request subsequent work.
   * @param command - revisioned decision or explicit source action.
   * @returns the committed reviewed or newly created execution identity.
   */
  abstract command(command: WorkCommand): Promise<WorkReceipt>
  /**
   * Read executor choices and configuration without connection credentials.
   * @returns committed identity names, revisions, archive flags, and runtime IDs.
   */
  abstract executors(): Promise<WorkExecutor[]>
  /**
   * Read deployment-selected directory paging settings.
   * @returns the explicit page size used by browser consumers.
   */
  abstract options(): { pageSize: number }
  /**
   * Prepare the exact revision brief including committed feedback and original output.
   * @param request - source assessment revision and editable task fields.
   * @returns the brief used by the subsequent explicit revision command.
   */
  abstract revisionBrief(request: Pick<Extract<WorkCommand, { kind: 'revise-agent' }>, 'ref' | 'reviewRevision' | 'brief'>): Promise<TaskBrief>
}
