# Business workflow

English | [中文](business-workflow.zh.md)

The business-workflow seam turns a stated business need into a verified step orchestration through three capabilities over one record: requirement clarification, workflow composition, and effect verification. Like [workflow](workflow.md) it is **one optional capability**, not part of the agent loop; unlike it, the model never writes executable code — it submits drafts (a requirement, an orchestration) and the runtime alone judges record identity, stage transitions, structural validity, execution order, and acceptance.

Service Definition: [dsh-business-workflow](../../packages/business/business-workflow) (`ctx.businessWorkflows` + the vocabulary below). The Service Provider is [dsh-business-workflow-local](../../packages/business/business-workflow-local) (in-memory records); the model-facing Consumer is [dsh-tool-business-workflow](../../packages/business/tool-business-workflow). The decision and rationale: [the business-workflow Agent Note](../../.agents/notes/implemented/feature/2026-09-21-business-workflow-seam.md).

Sources: the seam vocabulary in [`packages/business/business-workflow/src/types.ts`](../../packages/business/business-workflow/src/types.ts).

## The stage union

One record moves through a closed stage union; a stage event fires exactly on change:

```ts type-equiv
/**
 * Lifecycle stage of one business-workflow record. CLOSED union:
 * `clarifying` = the requirement draft still has gaps; `ready` = the
 * requirement is complete but no composition is accepted; `composed` = a
 * composition passed structural checks; `verified` = verification passed.
 * A requirement revision discards the composition and returns to
 * `clarifying` or `ready`.
 */
type BusinessWorkflowStage = 'clarifying' | 'ready' | 'composed' | 'verified'
```

Transitions: a complete requirement moves `clarifying`→`ready`; an accepted composition moves `ready`→`composed`; a passing verification moves `composed`→`verified`; a requirement revision discards the composition and returns to `ready`/`clarifying`; a failing re-verification demotes `verified`→`composed`. Submissions are whole-value replacements — a requirement submission always replaces the previous draft, and a rejected composition draft replaces nothing.

## The requirement vocabulary

What the model submits each clarification round; the presence of each aspect is what gap analysis checks:

```ts type-equiv
/**
 * A model-authored requirement draft, submitted in full each round (a
 * submission replaces the previous draft, so clarification rounds are
 * idempotent resubmissions rather than patches).
 */
interface RequirementSubmission {
  /** One-sentence summary of the business need. */
  summary: string
  /** The objectives the workflow must achieve. */
  objectives: RequirementObjective[]
  /** The named input fields the workflow consumes. */
  inputs: RequirementDataItem[]
  /** The named output fields the workflow produces. */
  outputs: RequirementDataItem[]
  /** Optional business constraints carried into prompts and reports. */
  constraints?: string[]
  /** The acceptance cases verification runs. */
  acceptanceCases: AcceptanceCase[]
}
```

Gap analysis is presence-based and deterministic: one actionable question per missing aspect (objectives, inputs, outputs, acceptance cases). The recorded spec is the submission with optional fields resolved; a revision increments the record's revision counter.

## The orchestration vocabulary

What the model submits as a composition; validation is structural and deterministic:

```ts type-equiv
/** A model-authored orchestration: steps plus final output bindings. */
interface WorkflowComposition {
  /** The steps, in any order (execution order is the dependency topology). */
  steps: WorkflowStep[]
  /** One binding per requirement output field. */
  finalOutputs: FinalOutputBinding[]
}
```

Validation reports a closed union of issue codes — `STEPS_EMPTY`, `STEP_ID_EMPTY`, `STEP_ID_DUPLICATE`, `DEPENDENCY_UNKNOWN`, `DEPENDENCY_CYCLE`, `IMPLICIT_DEPENDENCY`, `INPUT_NAME_DUPLICATE`, `INPUT_SOURCE_UNKNOWN`, `OBJECTIVE_UNKNOWN`, `OBJECTIVE_UNCOVERED`, `OUTPUT_UNBOUND`, `OUTPUT_NAME_UNKNOWN`, `OUTPUT_DUPLICATE`, `OUTPUT_SOURCE_UNKNOWN` — each with its location and a concrete remedy. A rejected draft changes nothing.

## The verification report

Static case checks gate a dry-run that executes every step per acceptance case in dependency order through a caller-supplied runner, then asserts the bound final outputs:

```ts type-equiv
/** The full verification report. */
interface VerificationReport {
  /** The verified record. */
  id: BusinessWorkflowId
  /** Whether every static check and every case passed. */
  passed: boolean
  /** The static checks that ran. */
  staticChecks: StaticCheck[]
  /** One result per acceptance case, in requirement order. */
  caseResults: CaseResult[]
  /** Deterministic repair guidance for every failure. */
  fixHints: string[]
  /** Whether the dry-run executed (static checks passed); a static failure skips it. */
  dryRun: boolean
}
```

A passing report promotes the record to `verified`; a failing one keeps or demotes it to `composed` with fix hints.

## Events

Both events carry identity data, never live records, and dispatch with per-listener containment:

- `business-workflow/stage(info)` — one record's stage changed, after the record is committed.
- `business-workflow/verification(info, summary)` — one verification settled, after the report is recorded and any stage transition published.

The payload types: `BusinessWorkflowInfo` (id plus post-transition stage) and `VerificationSummary` (passed, caseCount, dryRun). The invariant companion asserts transition legality and verification-vs-stage consistency over the event stream.

## Error codes

Failures are `BusinessWorkflowError` with machine-routable codes — `REQUIREMENT_INVALID` (a malformed submission), `COMPOSITION_INVALID`, `UNKNOWN_WORKFLOW`, `STAGE_VIOLATION` (an operation the record's stage does not admit), `CAPACITY`, `ABORTED` — while structural defects and verification failures are ordinary outcomes, never errors.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbusinessworkflows--businessworkflowruntime-abstract-seam"></a>

### `ctx.businessWorkflows` — `BusinessWorkflowRuntime` (abstract seam)

Business-workflow Service Definition contract. Implementations must honor these semantics:

- Submissions are whole-value replacements: a requirement submission replaces the previous draft (revision increments) and discards any accepted composition; a composition submission replaces the accepted composition only when it passes validation. No call mutates a record partially.
- Invalid input throws before any state change; a rejected composition draft leaves the previously accepted composition and stage untouched.
- Stage transitions are exactly: `clarifying`→`ready` (a complete requirement), `ready`→`composed` (an accepted composition), `composed`/`verified`→`ready` (a requirement revision discarding the composition), and `composed`→`verified` (a passing verification). A passing verification of an already-`verified` record records the new report without a stage event.
- Verification awaits its dry-run work, observes the caller signal between steps, and settles a report (never a throw) for assertion and execution failures; only invalid input and cancellation throw.
- Snapshots are fresh objects; events carry identity data, never live records.

```ts cordis-catalog
/**
 * Submit a requirement draft (clarification round) and return the fresh
 * gap analysis. Creating a record and updating one take the same request;
 * the analysis states whether the requirement is complete.
 * @param request - the full replacement draft and, for an update, the record id.
 * @returns the record's stage, revision, remaining gaps, and recorded spec.
 */
abstract submitRequirement(request: RequirementSubmissionRequest): RequirementAnalysis

/**
 * Submit a composition draft and validate its structure. Validation is
 * deterministic (identity, dependency, source, binding, and coverage
 * rules); a rejected draft returns its issues and changes nothing.
 * @param request - the record id and the orchestration draft.
 * @returns the record's stage, the draft's issues, and its step count.
 */
abstract compose(request: CompositionRequest): CompositionOutcome

/**
 * Verify the accepted composition: static case checks always, plus a
 * dry-run through the supplied runner that executes every step per
 * acceptance case and asserts the bound final outputs. Assertion and
 * execution failures settle into the report; only invalid input and
 * cancellation throw.
 * @param request - the record id, an optional step runner, and an optional
 *   cancellation signal.
 * @returns the complete verification report.
 */
abstract verify(request: VerificationRequest): Promise<VerificationReport>

/**
 * Return one record's snapshot.
 * @param id - the record to look up.
 * @returns a fresh snapshot.
 */
abstract get(id: BusinessWorkflowId): BusinessWorkflowSnapshot

/**
 * List every record's snapshot in creation order.
 * @returns fresh snapshots.
 */
abstract list(): BusinessWorkflowSnapshot[]
```

Source: [`packages/business/business-workflow/src/index.ts`](../../packages/business/business-workflow/src/index.ts)

<a id="business-workflow-events"></a>

### `business-workflow/*` events

<a id="business-workflowstage--emit"></a>

#### `business-workflow/stage` — emit

One record's stage changed — clarification closed or reopened, a composition accepted, or verification promoted the record. Paired events carry the same BusinessWorkflowInfo#id; the stage is the value after the transition.

```ts cordis-catalog
/**
 * One record's stage changed — clarification closed or reopened, a
 * composition accepted, or verification promoted the record. Paired
 * events carry the same {@link BusinessWorkflowInfo#id}; the stage is the
 * value after the transition.
 * @param info - the record's identity and post-transition stage.
 * @mode emit
 */
'business-workflow/stage'(info: BusinessWorkflowInfo): void
```

Source: [`packages/business/business-workflow/src/index.ts`](../../packages/business/business-workflow/src/index.ts)

<a id="business-workflowverification--emit"></a>

#### `business-workflow/verification` — emit

One verification settled (pass or fail). Emitted after the report is recorded and any stage transition for it has been published, so an observer reading `stage` sees the promoted state. Paired with the record's earlier stage events by id.

```ts cordis-catalog
/**
 * One verification settled (pass or fail). Emitted after the report is
 * recorded and any stage transition for it has been published, so an
 * observer reading `stage` sees the promoted state. Paired with the
 * record's earlier stage events by id.
 * @param info - the record's identity and current stage.
 * @param summary - the report's headline.
 * @mode emit
 */
'business-workflow/verification'(info: BusinessWorkflowInfo, summary: VerificationSummary): void
```

Source: [`packages/business/business-workflow/src/index.ts`](../../packages/business/business-workflow/src/index.ts)
<!-- END GENERATED cordis-surface -->
