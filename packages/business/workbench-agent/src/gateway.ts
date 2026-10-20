/** Typed Remote consumer for independent workbench-agent operations. */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from './service.ts'
import type { AgentCommand, AgentDirectory, AgentReceipt, WorkbenchAgentId } from './types.ts'

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
}
