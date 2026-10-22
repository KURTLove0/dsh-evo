/** Replaceable configuration checks and bounded temporary connection probes. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { HealthAgent, HealthCheckRequest, HealthProbeId, HealthProbeRecord, HealthProbeRequest, HealthReport } from './types.ts'
declare module '@deepseek-ai/cordis' { interface Context { capabilityHealth: CapabilityHealth } }
/** Observations do not establish task success, credential validity, or MCP tool-call readiness. */
export abstract class CapabilityHealth extends Service {
  constructor(ctx: Context) { super(ctx, 'capabilityHealth') }
  /**
   * Read saved executors without inspecting their dependencies.
   * @returns bounded saved executor choices, excluding connection secrets.
   */
  abstract choices(): Promise<HealthAgent[]>
  /**
   * Read current configuration and model catalogs without submitting model input.
   * @param request - global scope or explicit saved executor revision and workspace.
   * @returns timestamped source-local observations without secret values or raw provider errors.
   */
  abstract check(request: HealthCheckRequest): Promise<HealthReport>
  /**
   * Admit one explicit initialization/ping operation; exact request retries reuse it.
   * @param request - client-owned identity and saved server selection.
   * @returns the admitted or already retained record, without waiting for connection completion.
   */
  abstract startProbe(request: HealthProbeRequest): Promise<HealthProbeRecord>
  /**
   * Recover an admitted probe without repeating network or process work.
   * @param id - previously supplied probe identity.
   * @returns its current record, or null when this host has no retained record.
   */
  abstract readProbe(id: HealthProbeId): HealthProbeRecord | null
  /**
   * Cancel and await an owned probe, including transport cleanup.
   * @param id - retained probe identity.
   * @returns its settled record; unknown identities reject.
   */
  abstract cancelProbe(id: HealthProbeId): Promise<HealthProbeRecord>
}
