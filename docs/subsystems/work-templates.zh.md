# 私有工作模板

[English](work-templates.md) | 中文

[工作模板](../../packages/business/work-templates/README.zh.md)拥有有界、不可变的任务与工作流内容历史，以及带修订的归档状态，不拥有执行。[浏览器插件](../../packages/client/ui-work-templates/README.zh.md)通过声明的插槽提供模板库页面与可选工作中心任务控件。

载入并提交任务简报时，保留明确的来源模板与版本。复用工作流创建独立、未发布的草稿，保留来源发布及模板版本。就绪检查、发布、取消与持久化继续由各自执行服务负责。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxworktemplates--worktemplates-abstract-seam"></a>

### `ctx.workTemplates` — `WorkTemplates` (abstract seam)

Saved content does not include executor configuration or workspace assignments.

```ts cordis-catalog
/**
 * List committed summaries without downloading complete histories.
 * @returns the bounded private directory, including archived records.
 */
abstract list(): Promise<TemplateSummary[]>

/**
 * Read an immutable content history.
 * @param id - private template identity.
 * @returns detached content snapshots and the current archive revision.
 */
abstract read(id: WorkTemplateId): Promise<TemplateRecord>

/**
 * Commit an idempotent content or archive mutation.
 * @param request - explicit revision and mutation identity.
 * @returns the original committed receipt on identical transport retries.
 */
abstract command(request: TemplateMutation): Promise<TemplateReceipt>

/**
 * Copy an immutable workflow publication into an independent editable draft.
 * @param request - pinned template version, destination, name, and idempotent copy identity.
 * @returns the created draft; this operation never publishes or executes it.
 */
abstract copyWorkflow(request: TemplateCopyRequest): Promise<WorkflowReceipt>

/**
 * Read immutable workflow source choices.
 * @returns available workflow names and publication IDs, excluding unpublished drafts.
 */
abstract sources(): Promise<TemplateWorkflowSource[]>

/**
 * Read editable starter instructions without checking execution capabilities.
 * @returns task-only examples that require a separately selected, checked executor.
 */
abstract examples(): TemplateExample[]
```

Types: [WorkflowReceipt](business-workflow.zh.md)

Source: [`packages/business/work-templates/src/service.ts`](../../packages/business/work-templates/src/service.ts)

<a id="work-template-events"></a>

### `work-template/*` events

<a id="work-templatechanged--emit"></a>

#### `work-template/changed` — emit

A template mutation has committed.

```ts cordis-catalog
/**
 * A template mutation has committed.
 * @mode emit
 * @param id - template whose content or archive state changed.
 */
'work-template/changed'(id: WorkTemplateId): void
```

Source: [`packages/business/work-templates/src/types.ts`](../../packages/business/work-templates/src/types.ts)
<!-- END GENERATED cordis-surface -->
