/** Typed Remote consumer for independent workbench-agent operations. */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from './service.ts'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { AgentCapabilities, AgentCommand, AgentDirectory, AgentReceipt, AgentRuntime, AgentRunQuery, AgentRunPage, TaskBrief, TaskPreflight, WorkbenchAgentId } from './types.ts'

/** Available without an active conversation or initiating model. */
export class WorkbenchAgentGateway extends TypertRemoteService {
  static inject = ['workbenchAgents']
  constructor(ctx: Context) { super(ctx, 'workbenchAgentGateway') }
  /**
   * Read committed identities and history.
   * @param request - optional agent selection.
   * @returns directory and workload.
   */
  @Remote('snapshot')
  snapshot(request: { id?: WorkbenchAgentId }): Promise<AgentDirectory> {
    return this.ctx.workbenchAgents.snapshot(request.id)
  }
  /**
   * Persist an edit or task request.
   * @param request - revisioned edit or task command.
   * @returns committed identity and optional run identity.
   */
  @Remote('command')
  command(request: AgentCommand): Promise<AgentReceipt> { return this.ctx.workbenchAgents.command(request) }
  /**
   * Discover capabilities for the creation and configuration forms.
   * @param request - selected workspace.
   * @returns skills available through the native runtime.
   */
  @Remote('capabilities')
  capabilities(request: { workspaceId: WorkspaceId }): Promise<AgentCapabilities> {
    return this.ctx.workbenchAgents.capabilities(request.workspaceId)
  }
  /**
   * Read the local runtime services available to identity configuration.
   * @param _request - empty catalog request.
   * @returns live local provider routes and their model catalogs.
   */
  @Remote('runtimes')
  runtimes(_request: Record<string, never>): Promise<AgentRuntime[]> { return this.ctx.workbenchAgents.runtimes() }

  /**
   * Read cross-identity history without captured credentials.
   * @param request - bounded query with an optional creation cursor.
   * @returns committed run summaries.
   */
  @Remote('queryRuns')
  queryRuns(request: AgentRunQuery): Promise<AgentRunPage> { return this.ctx.workbenchAgents.queryRuns(request) }

  /**
   * Check a selected executor and workspace without starting work.
   * @param request - identity and workspace.
   * @returns timestamped readiness facts.
   */
  @Remote('preflight')
  preflight(request: { id: WorkbenchAgentId; workspaceId: WorkspaceId; brief?: TaskBrief }): Promise<TaskPreflight> {
    return this.ctx.workbenchAgents.preflight(request)
  }

}
