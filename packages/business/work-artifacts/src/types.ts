/** Immutable project file versions and separately observed current-file availability. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { WorkReference, WorkSource, DeliveryVersion } from '@deepseek-ai/dsh-work-center/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
/** Stable project file registration identity. */
export type WorkArtifactId = Branded<'WorkArtifactId'>
/** Caller-owned idempotent registration identity. */
export type ArtifactRequestId = Branded<'ArtifactRequestId'>
/** Directory generation changes after a write or provider restart. */
export type ArtifactGeneration = Branded<'ArtifactGeneration'>
/** Evidence source is independent of the current file and later human decisions. */
export type ArtifactOrigin =
  | { kind: 'current-file'; source: WorkSource }
  | { kind: 'accepted-review'; source: WorkSource; reviewRevision: number; deliveryVersion: DeliveryVersion; reviewedAt: number }
/** Content-free metadata for one immutable file capture. */
export interface ArtifactVersion {
  version: number
  capturedAt: number
  sha256: string
  bytes: number
  encoding: 'utf-8' | 'base64'
  origin: ArtifactOrigin
}
/** Registration identity is the exact operator-supplied path within one workspace. */
export interface ArtifactSummary {
  id: WorkArtifactId
  workspaceId: WorkspaceId
  workspacePath: string
  path: string
  latest: ArtifactVersion
}
/** Historical preview is inert content, never a live file URL. */
export interface ArtifactDetail {
  entry: ArtifactSummary
  versions: ArtifactVersion[]
  snapshot: ArtifactVersion & { content: string }
}
/** A continuation is valid only for its complete selection and directory generation. */
export interface ArtifactCursor { generation: ArtifactGeneration; query: string; after: WorkArtifactId }
/** Filtering reads registration metadata only; every caller supplies its page bound. */
export interface ArtifactQuery {
  text: string
  limit: number
  workspaceId?: WorkspaceId
  source?: WorkReference['kind']
  origin?: ArtifactOrigin['kind']
  cursor?: ArtifactCursor
}
/** Complete bounded metadata page; stale continuations reject instead of skipping records. */
export interface ArtifactPage { items: ArtifactSummary[]; observedAt: number; next?: ArtifactCursor }
/** Promotion selects exact retained review bytes; current-file capture reads disk explicitly. */
export interface ArtifactRegistration {
  id?: WorkArtifactId
  expectedVersion: number
  requestId: ArtifactRequestId
  path: string
  source: { kind: 'current-file'; ref: WorkReference } | { kind: 'accepted-review'; ref: WorkReference; reviewRevision: number }
}
/** Identical registration retries return the original version after newer edits or restart. */
export interface ArtifactReceipt { id: WorkArtifactId; version: number }
/** Live file observations never update retained versions or human review status. */
export type ArtifactObservation = { id: WorkArtifactId; version: number; observedAt: number } & (
  | { state: 'matching' | 'different'; sha256: string; bytes: number }
  | { state: 'missing' }
  | { state: 'unavailable'; message: string }
)
/** Deployment-selected directory and per-file limits for the current consumer. */
export interface ArtifactOptions { pageSize: number; maxFileBytes: number }
declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * An explicit file registration committed.
     * @mode emit
     * @param id - changed registration identity.
     */
    'work-artifact/changed'(id: WorkArtifactId): void
  }
}
