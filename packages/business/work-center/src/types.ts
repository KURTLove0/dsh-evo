/** Typed cross-executor references and durable human review data. */
import type { LlmFailure } from '@deepseek-ai/dsh-llm/types'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { AgentRunId, AgentRunSummary, AgentRunPosition, TaskBrief, TaskRequestId, WorkbenchAgentId } from '@deepseek-ai/dsh-workbench-agent/types'
import type { WorkflowRunId, WorkflowRunSummary, WorkflowRunPosition, WorkflowAttemptId, WorkflowRequestId, WorkflowId, WorkflowVersionId, WorkflowRun } from '@deepseek-ai/dsh-business-workflow/workbench-types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** A source discriminant prevents cross-domain execution ID collisions. */
export type WorkReference = { kind: 'agent'; id: AgentRunId } | { kind: 'workflow'; id: WorkflowRunId }
/** Content-addressed delivery version, independent of mutable workspace files. */
export type DeliveryVersion = Branded<'DeliveryVersion'>
/** Idempotent human decision identity. */
export type ReviewDecisionId = Branded<'ReviewDecisionId'>
/** Attention-first continuation scoped to filters and observed pending sessions. */
export interface WorkCursor {
  query: string
  agent?: AgentRunPosition
  workflow?: WorkflowRunPosition
}
/** Explicit bounded query; refresh after execution or pending-session changes. */
export interface WorkQuery {
  limit: number
  workspaceId?: WorkspaceId
  source?: 'agent' | 'workflow'
  state?: 'active' | 'finished' | 'waiting'
  cursor?: WorkCursor
  /** Connection-observed pending interactions; absent means none are known. */
  attentionSessionIds?: SessionId[]
}
/** Executor choices include preview configuration without MCP credentials or task history. */
export interface WorkExecutor {
  id: WorkbenchAgentId
  name: string
  revision: number
  archived: boolean
  runtime: string
  instructions: string
  skills: string[]
  model?: { provider: string; model: string; reasoningEffort?: string | undefined }
  mcpServerNames: string[]
}
/** Execution facts and independent human review, without captured credentials. */
export type WorkItem = (
  | { kind: 'agent'; run: AgentRunSummary }
  | { kind: 'workflow'; run: WorkflowRunSummary }
) & { needsAttention: boolean; review?: Omit<DeliveryReview, 'delivery'> }
/** A failed source is explicit even when its successful peers contain no rows. */
export interface WorkPage {
  items: WorkItem[]
  observedAt: number
  failures: { source: 'agent' | 'workflow'; message: string }[]
  next?: WorkCursor
}
/** Recorded response or workflow outputs together with explicitly labelled inspection-time files. */
export interface DeliverySnapshot {
  version: DeliveryVersion
  outputs: { name: string; text: string }[]
  criteria: string[]
  evidence: 'recorded-response' | 'recorded-workflow-output'
  artifacts: DeliveryArtifact[]
  assertion?: { passed: boolean; detail?: string }
}
/** Workspace files observed during inspection; captured bytes are retained with the review. */
export type DeliveryArtifact =
  | { path: string; state: 'captured'; sha256: string; bytes: number; encoding: 'utf-8' | 'base64'; content: string }
  | { path: string; state: 'unavailable'; error: string }
/** Human assessment of a specific captured delivery, separate from execution success. */
export interface DeliveryReview {
  ref: WorkReference
  version: DeliveryVersion
  revision: number
  decisionId: ReviewDecisionId
  decision: 'accepted' | 'changes-requested'
  reason: string
  reviewedAt: number
  actor: 'local-operator'
  delivery: DeliverySnapshot
}
/** One execution with captured response evidence and independently persisted assessment. */
export interface WorkDetail {
  ref: WorkReference
  sessionId: SessionId
  name: string
  workspaceId: WorkspaceId
  status: AgentRunSummary['status'] | WorkflowRunSummary['status']
  brief?: TaskBrief
  /** Original execution for an explicit revision or source-owned retry. */
  revisionOf?: WorkReference
  agentId?: WorkbenchAgentId
  configuration?: AgentRunSummary['configuration']
  delivery?: DeliverySnapshot
  deliveryError?: string
  review?: DeliveryReview
  /** Earlier committed decisions retain their own immutable delivery evidence. */
  priorReviews?: DeliveryReview[]
  waitingAttemptId?: WorkflowAttemptId
  error?: string
}
/** Review writes are revisioned and idempotent; changing an execution is a separate action. */
export type WorkCommand =
  | { kind: 'retry-agent'; ref: Extract<WorkReference, { kind: 'agent' }>; expectedRevision: number; requestId: TaskRequestId }
  | { kind: 'retry-workflow'; ref: Extract<WorkReference, { kind: 'workflow' }>; requestId: WorkflowRequestId }
  | { kind: 'review'; ref: WorkReference; version: DeliveryVersion; decisionId: ReviewDecisionId; expectedRevision: number; decision: 'accepted' | 'changes-requested'; reason: string }
  | { kind: 'revise-agent'; ref: { kind: 'agent'; id: AgentRunId }; reviewRevision: number; requestId: TaskRequestId; agentRevision: number; brief: TaskBrief }
  | { kind: 'revise-workflow'; ref: { kind: 'workflow'; id: WorkflowRunId }; reviewRevision: number; requestId: WorkflowRequestId }
  | { kind: 'decide-workflow'; ref: { kind: 'workflow'; id: WorkflowRunId }; attemptId: WorkflowAttemptId; approve: boolean }
/** A command may return a newly submitted revision run; review alone never does. */
export interface WorkReceipt {
  ref: WorkReference
  reviewRevision?: number
}

/** Classification uses durable tags and stable codes, never error wording. */
export type DiagnosticCategory = 'configuration' | 'authentication' | 'denied' | 'timeout' | 'model' | 'tool' | 'cancelled' | 'interrupted' | 'output-limit' | 'blocked' | 'assertion' | 'unknown'
/** One authoritative run record or explicitly attempted session read. */
export interface DiagnosticSource {
  kind: 'run' | 'session'
  sessionId: SessionId
  nodeId?: string
  state: 'available' | 'unavailable' | 'capacity' | 'interval-unknown'
  /** Agent transcript observations stop at the execution's committed end sequence. */
  throughSeq?: number
  /** Node observations use its recorded execution timestamps and never establish a root cause. */
  interval?: { from: number; to: number }
}
/** Raw recorded text stays separate from an evidenced category and its execution impact. */
export interface DiagnosticFinding {
  source: number
  category: DiagnosticCategory
  scope: 'run' | 'turn' | 'tool' | 'node' | 'assertion' | 'model-attempt'
  terminal: boolean
  message: string
  code?: string
  /** Exact original event; no synthetic event sequence is invented for run errors. */
  event?: { seq: number; time: number; type: string }
  toolName?: string
  /** Original structured provider facts, including HTTP status and request identity when recorded. */
  modelFailure?: LlmFailure
  provider?: string
  nodeId?: string
}
/** Complete retry inputs remain owned by the execution source; previews omit connection secrets. */
export type WorkRetryPreview =
  | { kind: 'agent'; agentId: WorkbenchAgentId; task: string; purpose?: 'design'; configuration?: NonNullable<AgentRunSummary['configuration']> }
  | { kind: 'workflow'; workflowId: WorkflowId; versionId: WorkflowVersionId; version: number; mode: WorkflowRun['mode']; inputs: Record<string, JsonValue>; execution: WorkflowRun['execution']; assertion?: WorkflowRun['assertion']; feedback?: string }
/** Timestamped on-demand evidence, with no model call or automatic recovery action. */
export interface WorkDiagnosis {
  ref: WorkReference
  observedAt: number
  status: WorkDetail['status']
  sources: DiagnosticSource[]
  findings: DiagnosticFinding[]
  retry: WorkRetryPreview
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A human delivery assessment committed.
     * @mode emit
     * @param ref - reviewed source execution.
     */
    'work-center/changed'(ref: WorkReference): void
  }
}

export type * from './statistics-types.ts'

/** Source-owned execution metadata without transcript or current-file inspection. */
export interface WorkSource {
  ref: WorkReference
  name: string
  workspaceId: WorkspaceId
  sessionId: SessionId
  status: WorkDetail['status']
}
