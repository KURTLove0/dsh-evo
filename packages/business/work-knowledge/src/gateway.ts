/** Typed browser access to explicit file grants, capture versions, and inert line citations. */
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type {} from './service.ts'
import type { KnowledgeCitation, KnowledgeExcerpt, KnowledgeIndexRequest, KnowledgeIndexResult, KnowledgeOptions, KnowledgeRegistration, KnowledgeSearch, KnowledgeSearchResult, KnowledgeSource, KnowledgeSourceId } from './types.ts'
/** Knowledge browsing never changes conversation context or starts a model request. */
export class WorkKnowledgeGateway extends TypertRemoteService {
  static inject = ['workKnowledge']
  constructor(ctx: Context) { super(ctx, 'workKnowledgeGateway') }
  /**
   * Read deployment limits without accessing files.
   * @param _request - empty options request.
   * @returns complete-value deployment limits.
   */
  @Remote('options')
  options(_request: Record<string, never>): KnowledgeOptions { return this.ctx.workKnowledge.options() }
  /**
   * List content-free grants and capture history.
   * @param request - exact workspace.
   * @returns content-free source metadata.
   */
  @Remote('sources')
  sources(request: { workspaceId: WorkspaceId }): Promise<KnowledgeSource[]> { return this.ctx.workKnowledge.sources(request.workspaceId) }
  /**
   * Grant knowledge access to one explicit file.
   * @param request - fixed file grant and caller identity.
   * @returns committed metadata.
   */
  @Remote('register')
  register(request: KnowledgeRegistration): Promise<KnowledgeSource> { return this.ctx.workKnowledge.register(request) }
  /**
   * Commit a revision-checked grant change.
   * @param request - expected revision and grant.
   * @returns committed source metadata.
   */
  @Remote('setEnabled')
  setEnabled(request: { id: KnowledgeSourceId; expectedRevision: number; enabled: boolean }): Promise<KnowledgeSource> {
    return this.ctx.workKnowledge.setEnabled(request)
  }
  /**
   * Capture text or recover the original completed attempt.
   * @param request - exact indexing attempt.
   * @returns completed attempt and version metadata.
   */
  @Remote('index')
  index(request: KnowledgeIndexRequest): Promise<KnowledgeIndexResult> { return this.ctx.workKnowledge.index(request) }
  /**
   * Search currently readable enabled captures.
   * @param request - literal workspace query.
   * @returns retained line hits with independent access evidence.
   */
  @Remote('search')
  search(request: KnowledgeSearch): Promise<KnowledgeSearchResult> { return this.ctx.workKnowledge.search(request) }
  /**
   * Read immutable lines after current access checks.
   * @param request - caller workspace and immutable citation.
   * @returns complete inert captured lines.
   */
  @Remote('read')
  read(request: { workspaceId: WorkspaceId; citation: KnowledgeCitation }): Promise<KnowledgeExcerpt> {
    return this.ctx.workKnowledge.read(request.workspaceId, request.citation)
  }
}
