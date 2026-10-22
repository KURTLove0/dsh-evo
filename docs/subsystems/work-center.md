# Work Center

English | [中文](work-center.zh.md)

The [work-center provider](../../packages/business/work-center/README.md) merges independently owned agent and workflow executions and persists human assessments. Its [browser consumer](../../packages/client/ui-work-center/README.md) supplies structured intake and pending-work navigation. Execution and human acceptance are separate facts.

## Source directory

`WorkReference` qualifies branded run IDs with `agent` or `workflow`. `WorkQuery` supplies a required limit, optional workspace/source/state filters and connection-observed `attentionSessionIds`, and `WorkCursor` scoped to the same query and source generations. `WorkItem` joins a sanitized source summary with `needsAttention` and an optional assessment summary. Attention precedes descending execution-update times; changes invalidate earlier continuations. `WorkPage` returns loaded records, observation time, explicit source failures, and optional continuation. `WorkExecutor` exposes the configuration needed for a revision preview without MCP environment or header values.

The [agent service](workbench-agent.md) owns `TaskBrief`, `TaskRequestId`, `TaskPreflight`, `AgentRunQuery`, and `AgentRunPage`. The [workflow service](business-workflow.md) owns `WorkflowRequestId`, `WorkflowRunQuery`, and `WorkflowRunPage`. Both filter before pagination and expose single-run inspection.

## Delivery assessment

`WorkDetail` combines source identity, execution status, optional submitted brief and sanitized configuration, recorded delivery availability, and the latest review. `DeliverySnapshot` contains content-addressed `DeliveryVersion`, recorded text outputs, submitted criteria, optional workflow assertion, and `DeliveryArtifact` records. Captured artifacts retain inspection-time bytes and hashes; unavailable files retain their error.

`DeliveryReview` retains the source, exact delivery, monotonically increasing revision, idempotent `ReviewDecisionId`, decision, feedback, operator attribution, and time. The atomic storage record retains every decision for an execution. Accepted execution success and accepted human review are not interchangeable.

`WorkCommand` distinguishes review, explicit agent/workflow revision creation and full retry, and exact-attempt workflow decisions. `WorkReceipt` returns the reviewed or newly submitted source and optional review revision. Review-only commands never execute new work. Evidence, persistence, resource bounds, conflicts, and revision prompt preparation are specified in the [provider README](../../packages/business/work-center/README.md).

## Failure evidence

`WorkDiagnosis` contains the typed source, status, observation time, `DiagnosticSource` availability, `DiagnosticFinding` observations, and `WorkRetryPreview`. `DiagnosticCategory` classifies recorded machine codes or end reasons; unknown text remains unknown. Findings distinguish terminal run/turn evidence from observed tool, model-attempt, node, and assertion failures. Source links retain exact session/event or node interval information. Full retry commands preserve caller request identities while execution owners validate admission. Resource limits and complete retry semantics are defined in the [provider](../../packages/business/work-center/README.md#diagnosis-and-full-retry).

## Run cohorts

`WorkStatisticsQuery` selects a submission-time range, IANA time zone, workspace, source, source-qualified `WorkStatisticsExecutor`, and explicit usage-read choice. `WorkStatisticsReport` retains the submitted query, independently available sources, aggregate `WorkStatisticsCounts`, three `WorkStatisticsGroup` dimensions, and the attempted session-read limit. `WorkDurationSamples` carries sample counts alongside elapsed sums; `WorkUsageCoverage` separates read, unavailable, and unchecked runs from provider reports. `WorkStatisticsChoices` exposes safe executor identities. See the [provider](../../packages/business/work-center/README.md#run-statistics) for scope, timing, and completeness semantics.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxworkcenter--workcenter-abstract-seam"></a>

### `ctx.workCenter` — `WorkCenter` (abstract seam)

Execution facts remain owned by their source services.

```ts cordis-catalog
/**
 * Aggregate a bounded submission-time cohort across execution owners.
 * @param request - date/time zone, workspace, executor, and explicit usage-read choice.
 * @returns counts and measurement coverage, with independent source failures.
 */
abstract statistics(request: WorkStatisticsQuery): Promise<WorkStatisticsReport>

/**
 * Read safe executor filter choices without loading their history or credentials.
 * @returns source-qualified identities and explicit directory failures.
 */
abstract statisticsChoices(): Promise<WorkStatisticsChoices>

/**
 * Merge bounded source pages with attention first, then latest execution updates.
 * @param request - explicit page limit and optional source/workspace scope.
 * @returns detached records, source failures, and an owned continuation.
 */
abstract query(request: WorkQuery): Promise<WorkPage>

/**
 * Read captured delivery evidence for one execution.
 * @param ref - typed original execution identity.
 * @returns detail, optional delivery, and review; unavailable evidence stays explicit.
 */
abstract detail(ref: WorkReference): Promise<WorkDetail>

/**
 * Read source execution metadata without inspecting transcripts or files.
 * @param ref - typed source execution.
 * @returns original execution identity, workspace, session, name, and status.
 */
abstract source(ref: WorkReference): Promise<WorkSource>

/**
 * Read one immutable committed human assessment without rereading its source.
 * @param ref - reviewed execution identity.
 * @param revision - exact committed review revision.
 * @returns detached retained assessment and its original captured bytes.
 */
abstract review(ref: WorkReference, revision: number): Promise<DeliveryReview>

/**
 * Inspect stable failure codes and original recorded evidence without executing work.
 * @param ref - original typed execution identity.
 * @returns bounded timestamped findings and explicit unavailable sources.
 */
abstract diagnose(ref: WorkReference): Promise<WorkDiagnosis>

/**
 * Record an assessment or explicitly request subsequent work.
 * @param command - revisioned decision or explicit source action.
 * @returns the committed reviewed or newly created execution identity.
 */
abstract command(command: WorkCommand): Promise<WorkReceipt>

/**
 * Read executor choices and configuration without connection credentials.
 * @returns committed identity names, revisions, archive flags, and runtime IDs.
 */
abstract executors(): Promise<WorkExecutor[]>

/**
 * Read deployment-selected directory paging settings.
 * @returns the explicit page size used by browser consumers.
 */
abstract options(): { pageSize: number }

/**
 * Prepare the exact revision brief including committed feedback and original output.
 * @param request - source assessment revision and editable task fields.
 * @returns the brief used by the subsequent explicit revision command.
 */
abstract revisionBrief(request: Pick<Extract<WorkCommand, { kind: 'revise-agent' }>, 'ref' | 'reviewRevision' | 'brief'>): Promise<TaskBrief>
```

Types: [TaskBrief](workbench-agent.md)

Source: [`packages/business/work-center/src/service.ts`](../../packages/business/work-center/src/service.ts)

<a id="work-center-events"></a>

### `work-center/*` events

<a id="work-centerchanged--emit"></a>

#### `work-center/changed` — emit

A human delivery assessment committed.

```ts cordis-catalog
/**
 * A human delivery assessment committed.
 * @mode emit
 * @param ref - reviewed source execution.
 */
'work-center/changed'(ref: WorkReference): void
```

Source: [`packages/business/work-center/src/types.ts`](../../packages/business/work-center/src/types.ts)
<!-- END GENERATED cordis-surface -->
