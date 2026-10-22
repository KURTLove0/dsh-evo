# 项目知识

[English](work-knowledge.md) | 中文

[Work Knowledge](../../packages/business/work-knowledge/README.zh.md) 负责显式本地文本授权、不可变捕获、字面检索和精确行引用。可选模型工具使用普通日志化工具结果，从执行会话取得工作空间权限。历史引用同样要求当前文件可读且授权启用；会话上下文与已验收交付产物各自独立。[浏览器页面](../../packages/client/ui-work-knowledge/README.zh.md) 管理来源、捕获版本和精确惰性预览；默认 Web Bundle 挂载三个角色。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxworkknowledge--workknowledge-abstract-seam"></a>

### `ctx.workKnowledge` — `WorkKnowledge` (abstract seam)

Executors enforce enabled grants, original workspace identity, and current file readability.

```ts cordis-catalog
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
```

Types: [WorkspaceId](workspace.zh.md)

Source: [`packages/business/work-knowledge/src/service.ts`](../../packages/business/work-knowledge/src/service.ts)
<!-- END GENERATED cordis-surface -->
