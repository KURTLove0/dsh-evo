/** Workspace workflow definitions, immutable versions, and execution records. */
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { JsonValue, SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { RequirementSpec, WorkflowStep, FinalOutputBinding } from './types.ts'

/** Durable workflow identity. */
export type WorkflowId = Branded<'WorkflowId'>
/** Immutable publication identity. */
export type WorkflowVersionId = Branded<'WorkflowVersionId'>
/** One complete execution, including verification executions. */
export type WorkflowRunId = Branded<'WorkflowRunId'>
/** Verification batch groups independent case executions of one publication. */
export type WorkflowBatchId = Branded<'WorkflowBatchId'>
/** One execution of one node. */
export type WorkflowAttemptId = Branded<'WorkflowAttemptId'>
/** AI generation operation identity. */
export type WorkflowOperationId = Branded<'WorkflowOperationId'>
/** An editable node; ids remain stable when titles change. */
export type WorkflowNode = WorkflowStep & (
  | { kind: 'agent'; preset: string }
  | { kind: 'approval'; preset: string }
)
/** Serializable workflow definition. Dependencies are the authoritative edges. */
export interface WorkflowDefinition {
  /** Complete business requirement, including sample assertions. */
  requirement: RequirementSpec
  /** Agent and human confirmation nodes. */
  nodes: WorkflowNode[]
  /** Named final output sources. */
  finalOutputs: FinalOutputBinding[]
  /** Optional editor positions; these do not affect execution. */
  positions: Record<string, { x: number; y: number }>
}
/** One immutable published definition. */
export interface WorkflowVersion {
  /** Unique publication id. */
  id: WorkflowVersionId
  /** Increasing number within this workflow. */
  number: number
  /** Draft revision published. */
  revision: number
  /** Publication timestamp. */
  createdAt: number
  /** Complete frozen execution definition. */
  definition: WorkflowDefinition
}
/** Workflow aggregate; saved independently from conversation sessions. */
export interface WorkflowDocument {
  /** Stable workflow identity. */
  id: WorkflowId
  /** Owning workspace. */
  workspaceId: WorkspaceId
  /** Display name. */
  name: string
  /** Compare-and-set revision for every edit and publication. */
  revision: number
  /** Created timestamp. */
  createdAt: number
  /** Latest committed mutation timestamp. */
  updatedAt: number
  /** Archived records cannot publish or start new runs. */
  archived: boolean
  /** Editable definition, independent of published versions. */
  draft: WorkflowDefinition
  /** Publications in ascending order. */
  versions: WorkflowVersion[]
}
/** Persisted run or attempt state. */
export type WorkflowRunStatus =
  'queued' | 'running' | 'waiting' | 'stopping' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
/** One node's resolved inputs, actual configuration, and output. */
export interface WorkflowAttempt {
  /** Execution identity required for human decisions. */
  id: WorkflowAttemptId
  /** Node identity from the run's definition. */
  nodeId: string
  /** Pending and skipped nodes never create child work. */
  status: WorkflowRunStatus | 'pending' | 'skipped'
  /** Actual named values given to this node. */
  inputs: Record<string, JsonValue>
  /** Exact upstream attempts or submitted fields used to resolve named inputs. */
  sources: Record<string,
    | { kind: 'requirement'; field: string }
    | { kind: 'step'; nodeId: string; attemptId: WorkflowAttemptId }
  >
  /** Executed prompt, including business context and resolved values. */
  prompt?: string
  /** Service-owned delegating session used by the subagent history endpoint. */
  parentSessionId?: SessionId
  /** Actual session that received the prompt. */
  childSessionId?: SessionId
  /** Provider used for delegation. */
  provider?: string
  /** Tool names visible to the actual child. */
  tools?: string[]
  /** Actual model selected by the child. */
  model?: string
  /** Node's selected preset. */
  preset: string
  /** Authorized workspace directory. */
  cwd: string
  /** Execution start timestamp. */
  startedAt?: number
  /** Cleanup completion timestamp. */
  endedAt?: number
  /** Complete text result. */
  output?: string
  /** Failure, cancellation, or skip explanation. */
  error?: string
}
/** A run is projected from its independent audit session's committed checkpoints. */
export interface WorkflowRun {
  /** Stable run identity. */
  id: WorkflowRunId
  /** Owning workflow. */
  workflowId: WorkflowId
  /** Owning workspace at start. */
  workspaceId: WorkspaceId
  /** Immutable version snapshot fixed at start. */
  version: WorkflowVersion
  /** Audit log identity. */
  sessionId: SessionId
  /** Formal execution or acceptance case execution. */
  mode: 'execution' | 'verification'
  /** Shared identity for all cases in one verification request. */
  batchId?: WorkflowBatchId
  /** Present for acceptance case executions. */
  caseName?: string
  /** Original run when explicitly rerunning. */
  rerunOf?: WorkflowRunId
  /** Model route fixed when the run is reserved. */
  execution: { provider: string; model: string; reasoningEffort?: ReasoningEffortId; subagentProvider: string }
  /** Exact submitted inputs. */
  inputs: Record<string, JsonValue>
  /** Lifecycle state after the latest durable checkpoint. */
  status: WorkflowRunStatus
  /** Monotone checkpoint number. */
  seq: number
  /** Start timestamp. */
  createdAt: number
  /** Latest checkpoint timestamp. */
  updatedAt: number
  /** One attempt per node; retries create a new complete run. */
  attempts: WorkflowAttempt[]
  /** Bound final outputs. */
  outputs: Record<string, string>
  /** Acceptance result, distinct from successful execution. */
  assertion?: { passed: boolean; detail?: string }
  /** Terminal failure or interruption explanation. */
  error?: string
}
/** AI-generated candidate never overwrites an edited draft. */
export interface WorkflowOperation {
  /** Stable operation identity. */
  id: WorkflowOperationId
  /** Candidate's owning workflow. */
  workflowId: WorkflowId
  /** Draft revision seen by the generator. */
  revision: number
  /** Generation lifecycle. */
  status: 'running' | 'succeeded' | 'failed' | 'interrupted'
  /** Requirement description supplied by the user. */
  description: string
  /** Generated definition, available only after validation. */
  candidate?: WorkflowDefinition
  /** Generation failure detail. */
  error?: string
}
/** Deterministic publish diagnostics, also used for clarification. */
export interface WorkflowValidation {
  /** Whether publication is allowed. */
  valid: boolean
  /** All requirement and graph issues. */
  issues: string[]
}
/** Directory and selection data fetched as one consistent service snapshot. */
export interface WorkflowWorkbenchSnapshot {
  /** Persistence failure requiring Host restart; committed records remain inspectable. */
  failure?: string
  /** Complete workspace-independent directory. */
  workflows: WorkflowDocument[]
  /** Runs for the requested workflow. */
  runs: WorkflowRun[]
  /** Generation operations for the requested workflow. */
  operations: WorkflowOperation[]
  /** Server-approved presets for node execution. */
  presets: string[]
  /** Most recent committed run per workflow, including unselected workflows. */
  latestRuns: Pick<WorkflowRun, 'id' | 'workflowId' | 'status' | 'mode' | 'createdAt' | 'updatedAt'>[]
}
/** Management commands shared by tools and the remote consumer. */
export type WorkflowCommand =
  | { kind: 'create'; workspaceId: WorkspaceId; name: string; description: string }
  | { kind: 'save'; id: WorkflowId; expectedRevision: number; name: string; definition: WorkflowDefinition }
  | { kind: 'publish'; id: WorkflowId; expectedRevision: number }
  | { kind: 'archive'; id: WorkflowId; expectedRevision: number; archived: boolean }
  | { kind: 'generate'; id: WorkflowId; expectedRevision: number; description: string }
  | {
    kind: 'start'
    id: WorkflowId
    versionId: WorkflowVersionId
    inputs: Record<string, JsonValue>
    rerunOf?: WorkflowRunId
  }
  | { kind: 'verify'; id: WorkflowId; versionId: WorkflowVersionId }
  | { kind: 'cancel'; runId: WorkflowRunId }
  | { kind: 'decide'; runId: WorkflowRunId; attemptId: WorkflowAttemptId; approve: boolean }
/** Commands return the selected record identities; clients then fetch committed state. */
export interface WorkflowReceipt {
  /** Workflow affected by the command. */
  workflowId: WorkflowId
  /** New or updated draft revision, when applicable. */
  revision?: number
  /** Newly started runs, including one per verification case. */
  runIds?: WorkflowRunId[]
  /** Newly started AI operation. */
  operationId?: WorkflowOperationId
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Committed workflow execution snapshot; does not enter model context. */
    'business-workflow/checkpoint': WorkflowRun
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A durable workflow mutation is available for snapshot refresh.
     * @param workflowId - workflow whose definition, run, or candidate changed.
     * @mode emit
     */
    'business-workflow/changed'(workflowId: WorkflowId): void
  }
}
