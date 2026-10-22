/** Replaceable host-owned trigger provider; native execution services retain all task admission authority. */
import type { WorkReference } from '@deepseek-ai/dsh-work-center/types'
import { Context, Service } from '@deepseek-ai/cordis'
import type { TriggerDefinition, TriggerCommand, TriggerDirectory, TriggerOptions, TriggerQuery, TriggerReceipt, WorkTrigger, WorkTriggerId } from './types.ts'
declare module '@deepseek-ai/cordis' { interface Context { workTriggers: WorkTriggers } }
/** Durable triggers require a running host, independently of browser and session lifetime. */
export abstract class WorkTriggers extends Service {
  constructor(ctx: Context) { super(ctx, 'workTriggers') }
  /**
   * Read deployment-selected polling and interval bounds.
   * @returns limits without observing files, sessions, or execution state.
   */
  abstract options(): TriggerOptions
  /**
   * Prepare a fixed target from an original execution without starting work.
   * @param source - exact original agent or formal workflow execution.
   * @returns original content and current agent revision, or the original workflow publication.
   */
  abstract prepare(source: WorkReference): Promise<Pick<TriggerDefinition, 'name' | 'target'>>
  /**
   * Query retained metadata and process-local worker failures.
   * @param request - explicit text and optional workspace/enabled filters.
   * @returns bounded detached metadata; no source reads occur.
   */
  abstract query(request: TriggerQuery): Promise<TriggerDirectory>
  /**
   * Inspect one immutable definition, occurrences, and in-app notices.
   * @param id - trigger identity.
   * @returns detached committed state, excluding private native submission identities.
   */
  abstract read(id: WorkTriggerId): Promise<WorkTrigger>
  /**
   * Create, pause/resume, recover an uncertain handoff, or acknowledge one notice.
   * @param request - caller identity, control revision, or exact occurrence attempt.
   * @returns a committed receipt; stale revisions reject without another admission.
   */
  abstract command(request: TriggerCommand): Promise<TriggerReceipt>
}
