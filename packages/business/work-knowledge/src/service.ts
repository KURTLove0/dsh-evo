/** Replaceable project knowledge provider; conversation context remains separately owned. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { KnowledgeCitation, KnowledgeExcerpt, KnowledgeIndexRequest, KnowledgeIndexResult, KnowledgeOptions, KnowledgeRegistration, KnowledgeSearch, KnowledgeSearchResult, KnowledgeSource, KnowledgeSourceId } from './types.ts'
declare module '@deepseek-ai/cordis' { interface Context { workKnowledge: WorkKnowledge } }
/** Executors enforce enabled grants, original workspace identity, and current file readability. */
export abstract class WorkKnowledge extends Service {
  constructor(ctx: Context) { super(ctx, 'workKnowledge') }
  /**
   * Read complete-value limits without indexing files.
   * @returns deployment limits for complete sources, queries, and results.
   */
  abstract options(): KnowledgeOptions
  /**
   * List content-free source metadata, including disabled grants and completed attempts.
   * @param workspaceId - exact workspace selection.
   * @returns bounded detached source metadata; no live files are read.
   */
  abstract sources(workspaceId: WorkspaceId): Promise<KnowledgeSource[]>
  /**
   * Register one fixed readable-file target without capturing its text.
   * @param request - caller identity, workspace, and relative path; registration grants access.
   * @returns current metadata on identical retries; conflicting identities reject.
   */
  abstract register(request: KnowledgeRegistration): Promise<KnowledgeSource>
  /**
   * Change future content access without erasing captures or prior session results.
   * @param request - source identity, expected metadata revision, and desired grant.
   * @returns committed source metadata; stale revisions reject.
   */
  abstract setEnabled(request: { id: KnowledgeSourceId; expectedRevision: number; enabled: boolean }): Promise<KnowledgeSource>
  /**
   * Await a bounded text capture; failed attempts preserve earlier successful versions.
   * @param request - exact source revision and caller-owned attempt identity.
   * @returns committed metadata, including the ready or failed attempt; storage failures reject.
   */
  abstract index(request: KnowledgeIndexRequest): Promise<KnowledgeIndexResult>
  /**
   * Match a literal substring in latest enabled captures, reporting inaccessible sources separately.
   * @param request - workspace, literal text, and explicit hit limit.
   * @returns stable source/line ordering, current-file evidence, and exclusions.
   */
  abstract search(request: KnowledgeSearch): Promise<KnowledgeSearchResult>
  /**
   * Read complete cited lines after rechecking the current file grant and access.
   * @param workspaceId - caller-authorized workspace; cannot be widened by the citation.
   * @param citation - immutable source, version, digest, and inclusive one-based range.
   * @returns retained inert text with independently observed current-file freshness.
   */
  abstract read(workspaceId: WorkspaceId, citation: KnowledgeCitation): Promise<KnowledgeExcerpt>
}
