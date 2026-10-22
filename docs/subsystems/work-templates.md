# Private work templates

English | [中文](work-templates.zh.md)

[Work Templates](../../packages/business/work-templates/README.md) owns bounded immutable task and workflow content histories and revisioned archive state. It does not own execution. [The browser plugin](../../packages/client/ui-work-templates/README.md) contributes a library page and optional Work Center intake controls through declared slots.

Task briefs retain an explicit source template/version when loaded and submitted. Workflow reuse creates an independent unpublished draft whose source publication and template version remain recorded. Source execution services continue to enforce readiness, publication, cancellation, and persistence.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [WorkflowReceipt](business-workflow.md)

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
