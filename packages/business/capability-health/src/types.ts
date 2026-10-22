/** Secret-free configuration observations and explicitly owned temporary probes. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { WorkbenchAgentId } from '@deepseek-ai/dsh-workbench-agent/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** One temporary connection probe, retained for recovery until host restart. */
export type HealthProbeId = Branded<'HealthProbeId'>
/** Configuration facts do not claim successful authentication or business execution. */
export type HealthState = 'ready' | 'missing' | 'failed' | 'not-checked' | 'unknown'
/** Closed diagnostic keys deliberately exclude provider-controlled error text. */
export type HealthCode =
  | 'provider-registered' | 'provider-unconfigured' | 'catalog-readable' | 'catalog-failed' | 'catalog-not-checked' | 'runtime-command-present' | 'runtime-command-missing'
  | 'credential-configured' | 'credential-missing' | 'credential-undeclared' | 'credential-owner-missing' | 'credential-read-failed'
  | 'workspace-ready' | 'workspace-unavailable' | 'agent-ready' | 'agent-archived'
  | 'runtime-ready' | 'runtime-unavailable' | 'model-route-ready' | 'model-route-unavailable'
  | 'model-route-unchecked' | 'skills-ready' | 'skills-unavailable' | 'skills-unchecked' | 'mcp-not-checked' | 'source-unavailable'
/** A bounded observation with a repair destination and no secret configuration. */
export interface HealthItem {
  key: string
  kind: 'provider' | 'catalog' | 'credential' | 'executor' | 'workspace' | 'runtime' | 'model' | 'skills' | 'mcp'
  label: string
  state: HealthState
  code: HealthCode
  repair: 'agents' | 'runtimes' | 'models' | 'settings' | 'workspace'
  count?: number
  source?: string
}
/** Sanitized executor selection; directory reads do not perform checks. */
export interface HealthAgent {
  id: WorkbenchAgentId
  name: string
  revision: number
  archived: boolean
}
/** Global provider checks or checks of one explicit saved executor and workspace. */
export type HealthCheckRequest = { kind: 'global' } | {
  kind: 'agent'
  id: WorkbenchAgentId
  expectedRevision: number
  workspaceId: WorkspaceId
}
/** One timestamped check; each failed source retains its own failed item. */
export interface HealthReport {
  checkedAt: number
  items: HealthItem[]
  selection?: { id: WorkbenchAgentId; revision: number; workspaceId: WorkspaceId }
}
/** The client supplies a fresh probe identity only for an explicit new action. */
export interface HealthProbeRequest {
  id: HealthProbeId
  agentId: WorkbenchAgentId
  expectedRevision: number
  workspaceId: WorkspaceId
  serverName: string
}
/** Connection and cleanup are independent facts; unknown IDs never restart work. */
export type HealthProbeRecord = HealthProbeRequest & {
  startedAt: number
  checkedAt?: number
  cleanup?: 'closed' | 'failed'
} & ({ status: 'running' } | {
  status: 'connected' | 'failed' | 'timed-out' | 'cancelled'
  checkedAt: number
  cleanup: 'closed' | 'failed'
})
declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A temporary probe was admitted or finished; read its authoritative record.
     * @mode emit
     * @param id - retained probe identity.
     */
    'capability-health/probe-changed'(id: HealthProbeId): void
  }
}
