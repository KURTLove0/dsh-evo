# 项目产物

[English](work-artifacts.md) | 中文

[Work Artifacts](../../packages/business/work-artifacts/README.zh.md) 负责显式不可变文件登记、来源及带时间的当前文件观察。[浏览器插件](../../packages/client/ui-work-artifacts/README.zh.md) 提供目录及可选工作中心登记控件。

已验收评审提升使用已提交评审中保留的原始字节。当前文件登记显式读取已结束执行的工作空间，不证明文件作者，也不授予验收。元数据查询和历史预览不读取当前文件，也不修改会话输入。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxworkartifacts--workartifacts-abstract-seam"></a>

### `ctx.workArtifacts` — `WorkArtifacts` (abstract seam)

Registration never executes work or rewrites source files.

```ts cordis-catalog
/**
 * Read deployment-selected directory and capture limits.
 * @returns the browser's explicit page size and per-file byte limit.
 */
abstract options(): ArtifactOptions

/**
 * Query bounded latest-version metadata without reading source files.
 * @param request - explicit text, workspace, source, origin, and page selection.
 * @returns detached metadata with a generation-bound continuation.
 */
abstract query(request: ArtifactQuery): Promise<ArtifactPage>

/**
 * Read one retained version and its content-free history.
 * @param id - registered file identity.
 * @param version - exact immutable capture number.
 * @returns stored bytes and provenance, independent of live file availability.
 */
abstract read(id: WorkArtifactId, version: number): Promise<ArtifactDetail>

/**
 * Commit an explicit snapshot or promote one accepted review's retained file.
 * @param request - source, exact path, expected version, and idempotency identity.
 * @returns the original receipt on identical retries, including after restart.
 */
abstract register(request: ArtifactRegistration): Promise<ArtifactReceipt>

/**
 * Explicitly compare a current workspace file with one retained version.
 * @param id - registered file identity.
 * @param version - immutable capture to compare against.
 * @returns timestamped current-file evidence; history and acceptance remain unchanged.
 */
abstract inspectCurrent(id: WorkArtifactId, version: number): Promise<ArtifactObservation>
```

Source: [`packages/business/work-artifacts/src/service.ts`](../../packages/business/work-artifacts/src/service.ts)

<a id="work-artifact-events"></a>

### `work-artifact/*` events

<a id="work-artifactchanged--emit"></a>

#### `work-artifact/changed` — emit

An explicit file registration committed.

```ts cordis-catalog
/**
 * An explicit file registration committed.
 * @mode emit
 * @param id - changed registration identity.
 */
'work-artifact/changed'(id: WorkArtifactId): void
```

Source: [`packages/business/work-artifacts/src/types.ts`](../../packages/business/work-artifacts/src/types.ts)
<!-- END GENERATED cordis-surface -->
