/** Workspace workflow management and execution Service Definition. */
import { Context, Service } from '@deepseek-ai/cordis'
import type {
  WorkflowCommand,
  WorkflowId,
  WorkflowReceipt,
  WorkflowValidation,
  WorkflowDefinition,
  WorkflowWorkbenchSnapshot,
} from './workbench-types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable workflow definitions and independently owned executions. */
    workflowWorkbench: WorkflowWorkbench
  }
}

/** Providers persist before returning receipts and own work beyond any client connection. */
export abstract class WorkflowWorkbench extends Service {
  constructor(ctx: Context) {
    super(ctx, 'workflowWorkbench')
  }

  /**
   * Read the directory and selected workflow's runs and operations.
   * @param id - selected workflow; omit to read only the directory.
   * @returns committed state and server-authorized presets.
   */
  abstract snapshot(id?: WorkflowId): Promise<WorkflowWorkbenchSnapshot>

  /**
   * Apply a management action independently from the caller's conversation.
   * @param request - full command; edits require the currently committed revision.
   * @returns affected identities after persistence; background work remains service-owned.
   */
  abstract command(request: WorkflowCommand): Promise<WorkflowReceipt>

  /**
   * Check a definition without saving or starting work.
   * @param definition - draft or generated candidate.
   * @returns requirement and topology diagnostics.
   */
  abstract validate(definition: WorkflowDefinition): WorkflowValidation
}
