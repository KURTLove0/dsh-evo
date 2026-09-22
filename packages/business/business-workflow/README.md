# @deepseek-ai/dsh-business-workflow

English | [中文](README.zh.md)

Service Definition for the business-workflow capability seam (`ctx.businessWorkflows`): the contract that turns a stated business need into a verified step orchestration through three capabilities — requirement clarification, workflow composition, and effect verification. This package owns the contract only; load a Service Provider such as [`@deepseek-ai/dsh-business-workflow-local`](../business-workflow-local/README.md) as a plugin, and the model reaches the seam through [`@deepseek-ai/dsh-tool-business-workflow`](../tool-business-workflow/README.md).

## The three capabilities

One record moves through a closed stage union — `clarifying`, `ready`, `composed`, `verified`:

- **Requirement clarification** (`submitRequirement`): the model submits a full requirement draft (summary, objectives, inputs, outputs, optional constraints, acceptance cases); the runtime validates it, reports deterministic clarification gaps as actionable questions, and records the spec once no gap remains (`clarifying` → `ready`). A resubmission is a whole-value replacement: it increments the revision and discards any accepted composition, because that composition was validated against the previous requirement.
- **Workflow composition** (`compose`): the model submits an orchestration draft (steps with dependencies, inputs, and objective coverage, plus final output bindings); the runtime validates its structure deterministically (identity, dependency closure and acyclicity, source resolvability with explicit dependencies, objective coverage, output binding completeness) and either accepts it (`ready` → `composed`) or returns every defect with its remedy, replacing nothing.
- **Effect verification** (`verify`): static case checks gate a dry-run that executes every step per acceptance case in dependency order through a caller-supplied `runStep` runner, then asserts the bound final outputs against each case's expectation (`nonEmpty` or `contains`). Assertion and execution failures settle into a report with fix hints; a passing report promotes the record to `verified`, a failing one keeps or demotes it to `composed`.

The model and the runtime split the work along one line: the model writes the content (the drafts, and each step's output through a delegated runner), while the runtime owns record identity, stage transitions, and every deterministic check.

## API

`BusinessWorkflowRuntime` extends the Cordis `Service` and mounts as `ctx.businessWorkflows`:

- `submitRequirement(request): RequirementAnalysis` — validate a draft, analyze gaps, create or update one record.
- `compose(request): CompositionOutcome` — validate and record an orchestration, or report its defects.
- `verify(request): Promise<VerificationReport>` — static checks plus the case dry-run and acceptance assertions.
- `get(id): BusinessWorkflowSnapshot` / `list(): BusinessWorkflowSnapshot[]` — fresh read-only projections.

Errors are `BusinessWorkflowError` (extends `HarnessError`) with machine-routable codes: `REQUIREMENT_INVALID`, `COMPOSITION_INVALID`, `UNKNOWN_WORKFLOW`, `STAGE_VIOLATION`, `CAPACITY`, `ABORTED`. Structural composition defects and verification failures are ordinary outcomes (`issues`, failing reports), never errors.

## Events

Both events carry identity data, never live records, and dispatch with per-listener containment:

- `business-workflow/stage(info)` — one record's stage changed; `info.stage` is the value after the transition.
- `business-workflow/verification(info, summary)` — one verification settled, after its report is recorded and any stage transition published.

`isBusinessWorkflowStageTransition(from, to)` is the exported transition predicate the invariant companion and consumers may reuse.

## Extension points

- A Service Provider implements the five abstract methods and honors the stage-transition, whole-value-submission, and report-settlement semantics stated on the class.
- Consumers observe the two events; a UI can render the pipeline from stage events and verification summaries alone.
- Mounting this abstract package directly fails loudly at load — a stale composition row gets a pointer to a Service Provider instead of a half-registered `ctx.businessWorkflows`.

## Model Experience

Indirectly, through [`dsh-tool-business-workflow`](../tool-business-workflow/README.md), which owns the model-facing schemas, tool descriptions, and rendered reports.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Records are caller-held only** — the seam defines no persistence or cross-restart identity; a durable backend owns that design and may require contract additions.
- **Verification dry-runs are caller-supplied** — the seam executes no work itself; a provider that wants worker-side execution must wrap its own runner, and per-step resource caps beyond `signal` cancellation are not part of the contract yet.
