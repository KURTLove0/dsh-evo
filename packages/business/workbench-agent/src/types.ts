/** Persistent workbench identities and execution records, independent of plugin presets. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Stable identity retained across edits, copies, and run history. */
export type WorkbenchAgentId = Branded<'WorkbenchAgentId'>
/** One submitted task and its whole-agent execution interval. */
export type AgentRunId = Branded<'AgentRunId'>

/** User-editable configuration; descriptions are display-only. */
export interface AgentDefinition {
  name: string
  avatar: string
  description: string
  instructions: string
  runtime: 'harness'
  model?: { provider: string; model: string; reasoningEffort?: string | undefined } | undefined
  skills: string[]
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
  error?: string
  purpose?: 'design'
  candidate?: AgentDefinition
  retryOf?: AgentRunId
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
  | { kind: 'design'; id: WorkbenchAgentId; workspaceId: WorkspaceId; prompt: string }
  | { kind: 'retry'; runId: AgentRunId }
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
