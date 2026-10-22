/** Remote consumer of the work directory service. */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from './service.ts'
import type { WorkCommand, WorkDetail, WorkExecutor, WorkPage, WorkQuery, WorkReceipt, WorkReference, WorkDiagnosis } from './types.ts'
import type { WorkStatisticsChoices, WorkStatisticsQuery, WorkStatisticsReport } from './statistics-types.ts'
import type { TaskBrief } from '@deepseek-ai/dsh-workbench-agent/types'

/** Management operations do not require an active conversation. */
export class WorkCenterGateway extends TypertRemoteService {
  static inject = ['workCenter']
  constructor(ctx: Context) { super(ctx, 'workCenterGateway') }
  /**
   * Read execution statistics for an explicit submission-time cohort.
   * @param request - date/time zone, workspace, executor, and usage-read choice.
   * @returns bounded aggregates and independently unavailable sources.
   */
  @Remote('statistics')
  statistics(request: WorkStatisticsQuery): Promise<WorkStatisticsReport> { return this.ctx.workCenter.statistics(request) }
  /**
   * Read safe executor filter choices.
   * @param _request - empty directory request.
   * @returns source-qualified identities without configurations or history.
   */
  @Remote('statisticsChoices')
  statisticsChoices(_request: Record<string, never>): Promise<WorkStatisticsChoices> { return this.ctx.workCenter.statisticsChoices() }
  /**
   * Read a bounded directory page.
   * @param request - source, workspace, page limit, and optional cursor.
   * @returns committed source summaries and explicit read failures.
   */
  @Remote('query')
  query(request: WorkQuery): Promise<WorkPage> { return this.ctx.workCenter.query(request) }
  /**
   * Inspect a recorded delivery and its human assessment.
   * @param request - source execution reference.
   * @returns the recorded evidence or its availability error.
   */
  @Remote('detail')
  detail(request: WorkReference): Promise<WorkDetail> { return this.ctx.workCenter.detail(request) }
  /**
   * Read execution diagnosis on demand without starting recovery work.
   * @param request - original typed execution identity.
   * @returns source-linked observations and explicit read limits.
   */
  @Remote('diagnose')
  diagnose(request: WorkReference): Promise<WorkDiagnosis> { return this.ctx.workCenter.diagnose(request) }
  /**
   * Persist an explicit operator action.
   * @param request - human review, revision task, or workflow confirmation.
   * @returns the committed source identity.
   */
  @Remote('command')
  command(request: WorkCommand): Promise<WorkReceipt> { return this.ctx.workCenter.command(request) }
  /**
   * List selectable executors without connection credentials.
   * @param _request - empty directory request.
   * @returns committed executor choices.
   */
  @Remote('executors')
  executors(_request: Record<string, never>): Promise<WorkExecutor[]> { return this.ctx.workCenter.executors() }
  /**
   * Read the deployment's selected page size.
   * @param _request - empty options request.
   * @returns browser directory paging settings.
   */
  @Remote('options')
  options(_request: Record<string, never>): { pageSize: number } { return this.ctx.workCenter.options() }
  /**
   * Prepare exact revision content without starting work.
   * @param request - source review revision and editable brief.
   * @returns the canonical revision brief for preflight preview.
   */
  @Remote('revisionBrief')
  revisionBrief(request: Pick<Extract<WorkCommand, { kind: 'revise-agent' }>, 'ref' | 'reviewRevision' | 'brief'>): Promise<TaskBrief> {
    return this.ctx.workCenter.revisionBrief(request)
  }
}
