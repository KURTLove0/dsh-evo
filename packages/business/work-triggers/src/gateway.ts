/** Typed Remote consumer for host trigger management and retained observations. */
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkReference } from '@deepseek-ai/dsh-work-center/types'
import type { Context } from '@deepseek-ai/cordis'
import type {} from './service.ts'
import type { TriggerDefinition, TriggerCommand, TriggerDirectory, TriggerOptions, TriggerQuery, TriggerReceipt, WorkTrigger, WorkTriggerId } from './types.ts'
/** Trigger management does not require an active conversation. */
export class WorkTriggerGateway extends TypertRemoteService {
  static inject = ['workTriggers']
  constructor(ctx: Context) { super(ctx, 'workTriggerGateway') }
  /**
   * Read current deployment limits.
   * @param _request - empty options request.
   * @returns explicit polling and interval bounds.
   */
  @Remote('options')
  options(_request: Record<string, never>): TriggerOptions { return this.ctx.workTriggers.options() }
  /**
   * Prepare original task content for explicit trigger creation.
   * @param request - exact original execution.
   * @returns fixed task target without capturing credentials.
   */
  @Remote('prepare')
  prepare(request: { source: WorkReference }): Promise<Pick<TriggerDefinition, 'name' | 'target'>> { return this.ctx.workTriggers.prepare(request.source) }
  /**
   * Read retained metadata without inspecting executions.
   * @param request - explicit directory filters.
   * @returns retained trigger directory.
   */
  @Remote('query')
  query(request: TriggerQuery): Promise<TriggerDirectory> { return this.ctx.workTriggers.query(request) }
  /**
   * Read complete retained trigger state.
   * @param request - trigger identity.
   * @returns definition, occurrence history, and notices.
   */
  @Remote('read')
  read(request: { id: WorkTriggerId }): Promise<WorkTrigger> { return this.ctx.workTriggers.read(request.id) }
  /**
   * Apply explicit trigger management independently of any session.
   * @param request - fixed creation input or a revision/attempt-scoped control operation.
   * @returns committed identity and control revision.
   */
  @Remote('command')
  command(request: TriggerCommand): Promise<TriggerReceipt> { return this.ctx.workTriggers.command(request) }
}
