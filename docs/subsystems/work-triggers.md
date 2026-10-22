# Durable work triggers

English | [中文](work-triggers.zh.md)

[Work Triggers](../../packages/business/work-triggers/README.md) owns host-persisted rules, reserved native admissions, source observations, and in-app notice acknowledgments. Session-local [Schedule](schedule.md) retains its separate conversation-reminder ownership.

The default Web composition mounts the provider, generated Remote, and [browser controls](../../packages/client/ui-work-triggers/README.md). Native agent and workflow services own execution, permissions, logs, and human approvals. The [F09 product proposal](../../.agents/notes/proposed/feature/2026-10-20-outcome-oriented-workbench-product.md#f09-durable-work-triggers) owns the product scope.

Preparation returns the original task content with the current agent revision, or the original formal workflow publication and inputs. It does not admit work; creation rechecks readiness.

## Data types

`WorkTriggerId`, `TriggerOccurrenceId`, and `TriggerNoticeId` are separate branded identities. A `TriggerDefinition` groups the name, `TriggerRule`, and `TriggerTarget`. Rules select `at`, `every` with an explicit first target and interval, or `on-settled` with a source-qualified run. Targets name a workspace and either an executor/revision/task brief or a workflow/publication/JSON input set.

`WorkTrigger` retains the fixed definition, control revision, enabled flag, creation and update times, optional next nominal time, and `TriggerOccurrence` history. Each occurrence records due and claim times, skipped intervals, attempts, `TriggerAdmission`, and notices. Admission distinguishes pending, unconfirmed, admitted with a native run, and settled with a `TriggerTerminalStatus`. `TriggerObservation` timestamps a source read; unavailable metadata does not replace it with a fabricated terminal result. `TriggerNotice` records historical uncertainty or a terminal status, with an optional first-read time.

`TriggerQuery` selects text, workspace, and enabled state. `TriggerSummary` excludes complete input and history while retaining control state, the latest occurrence, and unread count. Its consumed status describes a one-shot rule, independently of the occurrence outcome. `TriggerDirectory` adds observation time and current-process worker failures. `TriggerOptions` advertises polling, minimum interval, and history count. `TriggerCommand` and `TriggerReceipt` carry the creation identity, control revision, occurrence attempt, or notice identity needed for each operation.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxworktriggers--worktriggers-abstract-seam"></a>

### `ctx.workTriggers` — `WorkTriggers` (abstract seam)

Durable triggers require a running host, independently of browser and session lifetime.

```ts cordis-catalog
/**
 * Read deployment-selected polling and interval bounds.
 * @returns limits without observing files, sessions, or execution state.
 */
abstract options(): TriggerOptions

/**
 * Prepare a fixed target from an original execution without starting work.
 * @param source - exact original agent or formal workflow execution.
 * @returns original content and current agent revision, or the original workflow publication.
 */
abstract prepare(source: WorkReference): Promise<Pick<TriggerDefinition, 'name' | 'target'>>

/**
 * Query retained metadata and process-local worker failures.
 * @param request - explicit text and optional workspace/enabled filters.
 * @returns bounded detached metadata; no source reads occur.
 */
abstract query(request: TriggerQuery): Promise<TriggerDirectory>

/**
 * Inspect one immutable definition, occurrences, and in-app notices.
 * @param id - trigger identity.
 * @returns detached committed state, excluding private native submission identities.
 */
abstract read(id: WorkTriggerId): Promise<WorkTrigger>

/**
 * Create, pause/resume, recover an uncertain handoff, or acknowledge one notice.
 * @param request - caller identity, control revision, or exact occurrence attempt.
 * @returns a committed receipt; stale revisions reject without another admission.
 */
abstract command(request: TriggerCommand): Promise<TriggerReceipt>
```

Types: [WorkReference](work-center.md)

Source: [`packages/business/work-triggers/src/service.ts`](../../packages/business/work-triggers/src/service.ts)

<a id="work-trigger-events"></a>

### `work-trigger/*` events

<a id="work-triggerchanged--emit"></a>

#### `work-trigger/changed` — emit

A trigger, occurrence, or notice has committed.

```ts cordis-catalog
/**
 * A trigger, occurrence, or notice has committed.
 * @mode emit
 * @param id - trigger whose retained data changed.
 */
'work-trigger/changed'(id: WorkTriggerId): void
```

Source: [`packages/business/work-triggers/src/types.ts`](../../packages/business/work-triggers/src/types.ts)
<!-- END GENERATED cordis-surface -->
