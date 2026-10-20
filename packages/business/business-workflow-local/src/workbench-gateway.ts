/** Typed Remote consumer of the workflow management service. */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-business-workflow/workbench'
import type {
  WorkflowCommand,
  WorkflowId,
  WorkflowReceipt,
  WorkflowDefinition,
  WorkflowValidation,
  WorkflowWorkbenchSnapshot,
} from '@deepseek-ai/dsh-business-workflow/workbench-types'

/** Direct operations need no active conversation or Agent lookup. */
export class WorkflowGateway extends TypertRemoteService {
  static inject = ['workflowWorkbench']
  constructor(ctx: Context) {
    super(ctx, 'workflowGateway')
  }

  /**
   * Query committed workflows and one selected history.
   * @param request - optional selected workflow identity.
   * @returns the directory, history, and generation candidates.
   */
  @Remote('snapshot')
  snapshot(request: { id?: WorkflowId }): Promise<WorkflowWorkbenchSnapshot> {
    return this.ctx.workflowWorkbench.snapshot(request.id)
  }

  /**
   * Execute a deterministic operation or reserve background work.
   * @param request - management command with revision or attempt identity.
   * @returns the persisted receipt.
   */
  @Remote('command')
  command(request: WorkflowCommand): Promise<WorkflowReceipt> {
    return this.ctx.workflowWorkbench.command(request)
  }

  /**
   * Check a draft without modifying it.
   * @param definition - the supported workflow fields.
   * @returns all publish diagnostics.
   */
  @Remote('validate')
  validate(definition: WorkflowDefinition): WorkflowValidation {
    return this.ctx.workflowWorkbench.validate(definition)
  }
}
