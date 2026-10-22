/** Remote consumer for configuration observations and explicit connection probes. */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from './service.ts'
import type { HealthAgent, HealthCheckRequest, HealthProbeId, HealthProbeRecord, HealthProbeRequest, HealthReport } from './types.ts'
/** Probe response recovery uses reads and never automatic resubmission. */
export class CapabilityHealthGateway extends TypertRemoteService {
  static inject = ['capabilityHealth']
  constructor(ctx: Context) { super(ctx, 'capabilityHealthGateway') }
  /**
   * Read saved executor choices without probing connections.
 * @param _request - empty directory request.
   * @returns sanitized executor choices.
   */
  @Remote('choices')
  choices(_request: Record<string, never>): Promise<HealthAgent[]> { return this.ctx.capabilityHealth.choices() }
  /**
   * Read one explicit configuration scope.
 * @param request - observation scope.
   * @returns timestamped configuration facts.
   */
  @Remote('check')
  check(request: HealthCheckRequest): Promise<HealthReport> { return this.ctx.capabilityHealth.check(request) }
  /**
   * Admit an explicitly requested temporary connection.
 * @param request - explicit new probe or identical transport retry.
   * @returns retained admission record.
   */
  @Remote('startProbe')
  startProbe(request: HealthProbeRequest): Promise<HealthProbeRecord> { return this.ctx.capabilityHealth.startProbe(request) }
  /**
   * Read an existing connection observation without repeating work.
 * @param request - probe to recover.
   * @returns retained facts, or null after host restart or unknown identity.
   */
  @Remote('readProbe')
  readProbe(request: { id: HealthProbeId }): HealthProbeRecord | null { return this.ctx.capabilityHealth.readProbe(request.id) }
  /**
   * Cancel a retained probe and await its transport cleanup.
 * @param request - probe to cancel.
   * @returns settled connection and cleanup facts.
   */
  @Remote('cancelProbe')
  cancelProbe(request: { id: HealthProbeId }): Promise<HealthProbeRecord> { return this.ctx.capabilityHealth.cancelProbe(request.id) }
}
