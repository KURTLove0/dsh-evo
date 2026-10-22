/** Typed Remote consumer of the private template service. */
import { type Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from './service.ts'
import type { WorkflowReceipt } from '@deepseek-ai/dsh-business-workflow/workbench-types'
import type { TemplateCopyRequest, TemplateMutation, TemplateSummary, TemplateRecord, TemplateReceipt, TemplateWorkflowSource, TemplateExample, WorkTemplateId } from './types.ts'

/** Template reads and edits require no conversation. */
export class WorkTemplateGateway extends TypertRemoteService {
  static inject = ['workTemplates']
  constructor(ctx: Context) { super(ctx, 'workTemplateGateway') }
  /**
   * Read the bounded directory.
   * @param _request - empty request.
   * @returns committed template summaries.
   */
  @Remote('list')
  list(_request: Record<string, never>): Promise<TemplateSummary[]> { return this.ctx.workTemplates.list() }
  /**
   * Read one complete history.
   * @param request - template identity.
   * @returns immutable content versions.
   */
  @Remote('read')
  read(request: { id: WorkTemplateId }): Promise<TemplateRecord> { return this.ctx.workTemplates.read(request.id) }
  /**
   * Persist a revisioned template mutation.
   * @param request - idempotent mutation.
   * @returns committed template version and revision.
   */
  @Remote('command')
  command(request: TemplateMutation): Promise<TemplateReceipt> { return this.ctx.workTemplates.command(request) }
  /**
   * Create an independently editable workflow draft.
   * @param request - pinned source and destination.
   * @returns draft identity, without execution.
   */
  @Remote('copyWorkflow')
  copyWorkflow(request: TemplateCopyRequest): Promise<WorkflowReceipt> { return this.ctx.workTemplates.copyWorkflow(request) }
  /**
   * List immutable source publications.
   * @param _request - empty request.
   * @returns workflow names and published version IDs.
   */
  @Remote('sources')
  sources(_request: Record<string, never>): Promise<TemplateWorkflowSource[]> { return this.ctx.workTemplates.sources() }
  /**
   * Read task-only starter content.
   * @param _request - empty request.
   * @returns editable task examples without configured executors.
   */
  @Remote('examples')
  examples(_request: Record<string, never>): TemplateExample[] { return this.ctx.workTemplates.examples() }
}
