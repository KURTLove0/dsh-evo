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
