/** Read-only execution cohorts and explicitly attributed measurement coverage. */
import type { WorkbenchAgentId } from '@deepseek-ai/dsh-workbench-agent/types'
import type { WorkflowId } from '@deepseek-ai/dsh-business-workflow/workbench-types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/types'

/** Source-qualified executor identity; equal strings from different owners remain distinct. */
export type WorkStatisticsExecutor = { kind: 'agent'; id: WorkbenchAgentId } | { kind: 'workflow'; id: WorkflowId }
/** Submission-time cohort; reports never silently clip an oversized selection. */
export interface WorkStatisticsQuery {
  from: number
  to: number
  timeZone: string
  workspaceId?: WorkspaceId
  source?: 'agent' | 'workflow'
  executor?: WorkStatisticsExecutor
  /** Expensive log reads are explicit; ordinary counts do not inspect transcripts. */
  usage: 'skip' | 'recorded'
  /** Current connection observations only, not historical waiting-time evidence. */
  attentionSessionIds?: SessionId[]
}
/** Nonnegative elapsed samples exclude missing or inconsistent timestamps. */
export interface WorkDurationSamples {
  count: number
  totalMs: number
}
/** Provider reports within known execution intervals, with missing evidence kept separate. */
export interface WorkUsageCoverage {
  usage: TokenUsageProjection
  requests: number
  reportedSteps: number
  checkedRuns: number
  unavailableRuns: number
  uncheckedRuns: number
}
/** Counts partition queued, active, and settled work; waiting is a subset of active. */
export interface WorkStatisticsCounts {
  runs: number
  queued: number
  active: number
  waiting: number
  settled: number
  succeeded: number
  failed: number
  cancelled: number
  interrupted: number
  taskRuns: number
  designRuns: number
  executionRuns: number
  verificationRuns: number
  /** Submission to settlement, including queueing and human waiting. */
  elapsed: WorkDurationSamples
  /** Submission to first execution start, only where recorded. */
  queue: WorkDurationSamples
  tokens: WorkUsageCoverage
}
/** One aggregation over the same selected cohort and source observations. */
export interface WorkStatisticsGroup {
  key: string
  /** Most recently submitted run's observed executor name. */
  label: string
  counts: WorkStatisticsCounts
  /** Present on executor groups, independent of display names and string IDs. */
  source?: 'agent' | 'workflow'
}
/** Lightweight choices remain separate from mutable configuration and run history. */
export interface WorkStatisticsChoices {
  executors: { ref: WorkStatisticsExecutor; name: string; archived: boolean; workspaceId?: WorkspaceId }[]
  failures: { source: 'agent' | 'workflow'; message: string }[]
}
/** Each source is independently observed; unavailable sources never imply zero work. */
export interface WorkStatisticsReport {
  query: WorkStatisticsQuery
  observedAt: number
  usageSessions: { attempted: number; limit: number }
  sources: { source: 'agent' | 'workflow'; state: 'available' | 'excluded' | 'unavailable'; message?: string; runs: number }[]
  counts: WorkStatisticsCounts
  days: WorkStatisticsGroup[]
  workspaces: WorkStatisticsGroup[]
  executors: WorkStatisticsGroup[]
}
