/** Replaceable management and execution service for workbench agents. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { AgentCapabilities, AgentCommand, AgentDirectory, AgentReceipt, AgentRuntime, AgentRunId, AgentRunSummary, AgentRunQuery, AgentRunPage, TaskBrief, TaskPreflight, WorkbenchAgentId } from './types.ts'

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
  /**
   * Discover local CLI services from the live provider directory.
   * @returns declared local routes, native defaults, model choices, and availability.
   */
  abstract runtimes(): Promise<AgentRuntime[]>
  /**
   * Discover selectable skills through the deployment composition in a workspace.
   * @param workspaceId - workspace whose project and deployment skills are merged.
   * @returns user-invocable skill summaries without creating an agent or session.
   */
  abstract capabilities(workspaceId: WorkspaceId): Promise<AgentCapabilities>
  /**
   * Read a bounded cross-identity history page, excluding captured credentials.
   * @param request - generation-scoped attention/update cursor, optional workspace, and explicit page limit.
   * @returns detached run summaries and continuation position.
   */
  abstract queryRuns(request: AgentRunQuery): Promise<AgentRunPage>
  /**
   * Read one committed run without captured credentials.
   * @param id - original execution identity.
   * @returns detached run summary; unknown identities reject.
   */
  abstract inspectRun(id: AgentRunId): Promise<AgentRunSummary>
  /**
   * Check current task dependencies without executing work or probing MCP.
   * @param request - selected identity and workspace.
   * @returns timestamped issues, captured revision, and unchecked MCP names.
   */
  abstract preflight(request: { id: WorkbenchAgentId; workspaceId: WorkspaceId; brief?: TaskBrief }): Promise<TaskPreflight>
}
