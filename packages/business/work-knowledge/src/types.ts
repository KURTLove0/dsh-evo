/** Project-local source grants, immutable decoded text, and exact line citations. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** Operator-owned identity for one fixed workspace file grant. */
export type KnowledgeSourceId = Branded<'KnowledgeSourceId'>
/** Caller-owned identity for an explicit indexing attempt. */
export type KnowledgeIndexId = Branded<'KnowledgeIndexId'>
/** Content-free immutable capture metadata; the digest covers decoded UTF-8 text. */
export interface KnowledgeVersion {
  version: number
  capturedAt: number
  textSha256: string
  bytes: number
  lines: number
}
/** Latest completed indexing attempt, independent from earlier successful captures. */
export type KnowledgeAttempt =
  | { state: 'ready'; completedAt: number; version: number }
  | { state: 'failed'; completedAt: number; message: string }
/** Source metadata is readable while disabled; content is not. */
export interface KnowledgeSource {
  id: KnowledgeSourceId
  workspaceId: WorkspaceId
  workspacePath: string
  path: string
  enabled: boolean
  revision: number
  versions: KnowledgeVersion[]
  lastAttempt?: KnowledgeAttempt
}
/** Source registration explicitly grants knowledge access to this file. */
export interface KnowledgeRegistration {
  id: KnowledgeSourceId
  workspaceId: WorkspaceId
  path: string
}
/** One expected-revision indexing request, recoverable through its caller identity. */
export interface KnowledgeIndexRequest {
  id: KnowledgeSourceId
  expectedRevision: number
  requestId: KnowledgeIndexId
}
/** Original completed attempt remains identifiable when newer metadata is returned on retry. */
export interface KnowledgeIndexResult {
  source: KnowledgeSource
  attempt: KnowledgeAttempt
}
/** Immutable citation; all fields are checked when read. */
export interface KnowledgeCitation {
  sourceId: KnowledgeSourceId
  version: number
  textSha256: string
  startLine: number
  endLine: number
}
/** Timestamped current file evidence does not overwrite the indexed capture. */
export interface KnowledgeFreshness {
  sourceId: KnowledgeSourceId
  state: 'matching' | 'different'
  textSha256: string
  observedAt: number
}
/** Exact inert lines from a retained capture with a current read authorization. */
export interface KnowledgeExcerpt {
  citation: KnowledgeCitation
  path: string
  text: string
  current: KnowledgeFreshness
}
/** Literal search in one workspace's latest enabled captures. */
export interface KnowledgeSearch {
  workspaceId: WorkspaceId
  text: string
  limit: number
}
/** Search failures remain distinct from no matches and from stale captured text. */
export interface KnowledgeSearchResult {
  hits: { citation: KnowledgeCitation; path: string; text: string }[]
  more: boolean
  current: KnowledgeFreshness[]
  excluded: { sourceId: KnowledgeSourceId; message: string }[]
  observedAt: number
}
/** Complete-value deployment limits advertised to clients. */
export interface KnowledgeOptions {
  maxSources: number
  maxVersions: number
  maxFileBytes: number
  maxQueryBytes: number
  maxHits: number
}
