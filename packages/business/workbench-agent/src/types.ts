/** Persistent workbench identities and execution records, independent of plugin presets. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Named transport value supplied explicitly when starting an MCP server. */
export interface AgentMcpVariable {
  name: string
  value: string
}

/** One execution-owned MCP connection; stdio uses the task workspace as cwd. */
export type AgentMcpServer =
  | { name: string; transport: 'stdio'; command: string; args: string[]; env: AgentMcpVariable[] }
  | { name: string; transport: 'streamable-http'; url: string; headers: AgentMcpVariable[] }

/** Local provider route shared with the runtime directory. */
export interface AgentRuntime {
  id: string
  name: string
  command: string
  available: boolean
  defaultModel?: string
  models: { id: string; name: string }[]
  error?: string
}

/** Workspace-specific capabilities available while configuring an identity. */
export interface AgentCapabilities {
  skills: { name: string; description: string; source: string }[]
}

/** Stable identity retained across edits, copies, and run history. */
export type WorkbenchAgentId = Branded<'WorkbenchAgentId'>
/** One submitted task and its whole-agent execution interval. */
export type AgentRunId = Branded<'AgentRunId'>
/** Idempotent structured-task submission identity. */
export type TaskRequestId = Branded<'TaskRequestId'>

/** Versioned user-visible task content, captured with the submitted run. */
export interface TaskBrief {
  version: 1
  goal: string
  background: string
  deliverables: string[]
  acceptanceCriteria: string[]
  constraints: string
  /** Saved content copied into this brief; edits do not change its source version. */
  template?: { id: Branded<'WorkTemplateId'>; version: number }
}
/** Readiness facts observed without creating a task or connecting MCP servers. */
export interface TaskPreflight {
  checkedAt: number
  agentRevision: number
  issues: { code: 'archived' | 'workspace' | 'runtime' | 'model' | 'skills'; message: string }[]
  mcp: { name: string; status: 'not-checked' }[]
  prompt?: string
}
/** Opaque committed run-directory generation; invalid after any execution mutation or host restart. */
export type AgentRunRevision = Branded<'AgentRunRevision'>
/** Attention-first position, then descending committed execution update and id. */
export interface AgentRunPosition {
  revision: AgentRunRevision
  attention: boolean
  updatedAt: number
  id: AgentRunId
}
/** Bounded history request across identities, without captured credentials. */
export interface AgentRunQuery {
  limit: number
  workspaceId?: WorkspaceId
  agentId?: WorkbenchAgentId
  /** Submission time bounds: inclusive start and exclusive end. */
  createdFrom?: number
  createdBefore?: number
  before?: AgentRunPosition
  statuses?: AgentRun['status'][]
  /** Sessions with a pending interaction observed by the querying connection. */
  attentionSessionIds?: SessionId[]
  /** Restrict to running tasks with one of the supplied pending sessions. */
  attentionOnly?: boolean
}
/** Run data safe for the work directory; captured MCP configuration is excluded. */
export type AgentRunSummary = Omit<AgentRun, 'definition' | 'candidate'> & {
  agentName: string
  /** Latest known execution mutation: creation, start, or settlement. */
  updatedAt: number
  configuration?: Pick<AgentDefinition, 'instructions' | 'runtime' | 'model' | 'skills'> & { revision: number; mcpServerNames: string[] }
}
/** A bounded page ordered by attention, execution update, and id. */
export interface AgentRunPage {
  revision: AgentRunRevision
  items: AgentRunSummary[]
  next?: AgentRunPosition
}

/** User-editable configuration; descriptions are display-only. */
export interface AgentDefinition {
  name: string
  avatar: string
  description: string
  instructions: string
  runtime: string
  model?: { provider: string; model: string; reasoningEffort?: string | undefined } | undefined
  skills: string[]
  mcpServers: AgentMcpServer[]
  starters: { label: string; prompt: string }[]
  concurrency: number
}
/** Revision-protected identity; archiving preserves all execution history. */
export interface WorkbenchAgent extends AgentDefinition {
  id: WorkbenchAgentId
  revision: number
  archived: boolean
  createdAt: number
  updatedAt: number
}
/** A run retains the configuration captured when execution starts. */
export interface AgentRun {
  id: AgentRunId
  agentId: WorkbenchAgentId
  workspaceId: WorkspaceId
  sessionId: SessionId
  prompt: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  definition?: WorkbenchAgent
  createdAt: number
  startedAt?: number
  endedAt?: number
  /** Last durable event owned by this execution interval. */
  settledSeq?: number
  error?: string
  purpose?: 'design'
  candidate?: AgentDefinition
  retryOf?: AgentRunId
  /** One explicit full retry; retained independently of browser acknowledgments. */
  retryRequest?: { id: TaskRequestId; agentRevision: number }
  submission?: { id: TaskRequestId; agentRevision: number; brief: TaskBrief }
  revisionOf?: AgentRunId
}
/** Complete directory and selected execution history. */
export interface AgentDirectory {
  agents: WorkbenchAgent[]
  runs: AgentRun[]
  workloads: { agentId: WorkbenchAgentId; running: number; queued: number }[]
  defaultConcurrency: number
  maxConcurrency: number
  runtime: { id: 'harness'; available: boolean }
}
/** Mutations execute on the host and survive browser disconnection. */
export type AgentCommand =
  | { kind: 'create'; definition: AgentDefinition }
  | { kind: 'save'; id: WorkbenchAgentId; revision: number; definition: AgentDefinition }
  | { kind: 'copy'; id: WorkbenchAgentId; name: string }
  | { kind: 'archive'; id: WorkbenchAgentId; revision: number; archived: boolean }
  | { kind: 'run'; id: WorkbenchAgentId; workspaceId: WorkspaceId; prompt: string }
  | { kind: 'submit-task'; id: WorkbenchAgentId; workspaceId: WorkspaceId; requestId: TaskRequestId; expectedRevision: number; brief: TaskBrief; revisionOf?: AgentRunId }
  | { kind: 'design'; id: WorkbenchAgentId; workspaceId: WorkspaceId; prompt: string }
  | { kind: 'retry'; runId: AgentRunId; requestId: TaskRequestId; expectedRevision: number }
  | { kind: 'stop'; runId: AgentRunId }
/** Returned only after the requested mutation is durable. */
export interface AgentReceipt {
  agentId: WorkbenchAgentId
  runId?: AgentRunId
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A directory record or execution status committed.
     * @mode emit
     * @param id - affected stable agent identity.
     */
    'workbench-agent/changed'(id: WorkbenchAgentId): void
  }
}
