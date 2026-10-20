/** Replaceable management and execution service for workbench agents. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { AgentCommand, AgentDirectory, AgentReceipt, WorkbenchAgentId } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Persistent workbench collaborators and their task queue. */
    workbenchAgents: WorkbenchAgents
  }
}

/** Providers commit mutations before notifying directory consumers. */
export abstract class WorkbenchAgents extends Service {
  constructor(ctx: Context) { super(ctx, 'workbenchAgents') }
  /**
   * Read identities, workload, and one identity's history.
   * @param id - omit to read only directory and workload.
   * @returns detached committed data.
   */
  abstract snapshot(id?: WorkbenchAgentId): Promise<AgentDirectory>
  /**
   * Manage identities or submit, retry, or cancel a task.
   * @param command - operation with an expected revision for edits.
   * @returns committed identities; execution remains host-owned.
   */
  abstract command(command: AgentCommand): Promise<AgentReceipt>
}
