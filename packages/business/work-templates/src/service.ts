/** Replaceable private template storage and source-copy service. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { WorkflowReceipt } from '@deepseek-ai/dsh-business-workflow/workbench-types'
import type { TemplateCopyRequest, TemplateExample, TemplateMutation, TemplateReceipt, TemplateRecord, TemplateSummary, TemplateWorkflowSource, WorkTemplateId } from './types.ts'

declare module '@deepseek-ai/cordis' { interface Context { workTemplates: WorkTemplates } }

/** Saved content does not include executor configuration or workspace assignments. */
export abstract class WorkTemplates extends Service {
  constructor(ctx: Context) { super(ctx, 'workTemplates') }
  /**
   * List committed summaries without downloading complete histories.
   * @returns the bounded private directory, including archived records.
   */
  abstract list(): Promise<TemplateSummary[]>
  /**
   * Read an immutable content history.
   * @param id - private template identity.
   * @returns detached content snapshots and the current archive revision.
   */
  abstract read(id: WorkTemplateId): Promise<TemplateRecord>
  /**
   * Commit an idempotent content or archive mutation.
   * @param request - explicit revision and mutation identity.
   * @returns the original committed receipt on identical transport retries.
   */
  abstract command(request: TemplateMutation): Promise<TemplateReceipt>
  /**
   * Copy an immutable workflow publication into an independent editable draft.
   * @param request - pinned template version, destination, name, and idempotent copy identity.
   * @returns the created draft; this operation never publishes or executes it.
   */
  abstract copyWorkflow(request: TemplateCopyRequest): Promise<WorkflowReceipt>
  /**
   * Read immutable workflow source choices.
   * @returns available workflow names and publication IDs, excluding unpublished drafts.
   */
  abstract sources(): Promise<TemplateWorkflowSource[]>
  /**
   * Read editable starter instructions without checking execution capabilities.
   * @returns task-only examples that require a separately selected, checked executor.
   */
  abstract examples(): TemplateExample[]
}
