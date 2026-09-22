# Agent Note: The business-workflow capability family (`dsh-business-workflow` / `-local` / `tool-`)

Status: implemented

English | [中文](2026-09-21-business-workflow-seam.zh.md)

## Problem

The harness had two orchestration capabilities — `ctx.jobs` for background work and `ctx.workflowEngine` for model-written fan-out scripts — but neither turns a *stated business need* into a *verified* orchestration. A model asked to "build a lead-ranking workflow" today improvises: it gathers requirements conversationally with no recorded completeness criteria, invents an ad-hoc step plan with no structural validation, and presents the result as done without measuring it against anything. Nothing in the session records what the requirement was, whether the orchestration actually covers it, or whether it produces the promised effect on sample inputs. The three concerns — what the business needs, how the work is arranged, and whether the arrangement works — need one durable pipeline with deterministic gates at each boundary, or "workflow" stays an unverified promise.

## Decision

`packages/business/` is a three-package capability family in the jobs-trio shape, with one record moving through a closed stage union — `clarifying` → `ready` → `composed` → `verified`:

- **`@deepseek-ai/dsh-business-workflow` (Service Definition)** — the abstract `BusinessWorkflowRuntime` owning `ctx.businessWorkflows`, the five-method contract (`submitRequirement`, `compose`, `verify`, `get`, `list`), the whole vocabulary (`BusinessWorkflowId`, the stage union, `RequirementSpec`, `WorkflowComposition`, `VerificationReport`, the 14-code `CompositionIssueCode` union), the two contained events (`business-workflow/stage`, `business-workflow/verification`), the transition predicate `isBusinessWorkflowStageTransition`, and the event-invariant companion (transition legality, verification-vs-stage consistency).
- **`@deepseek-ai/dsh-business-workflow-local` (Service Provider)** — `LocalBusinessWorkflowRuntime`: the in-memory store, `bw-N` ids, deterministic gap analysis (presence checks over objectives/inputs/outputs/acceptance cases, one actionable question per gap), structural composition validation (identity, dependency closure and acyclicity via Kahn peeling, input-source resolvability with the explicit-dependency rule, objective coverage, output binding completeness), and case-gated verification: a static `case-input-coverage` check gates a dry-run that executes steps in dependency order through a caller-supplied `runStep` runner and asserts bound final outputs against each case's `nonEmpty`/`contains` expectation.
- **`@deepseek-ai/dsh-tool-business-workflow` (Consumer)** — the `business_workflow_clarify` / `_compose` / `_verify` tools: model-facing schemas, verbatim descriptions that ARE the authoring spec, deterministic-result rendering, one usage-policy prompt section, and a `runStep` runner that delegates each step to a fresh subagent through `ctx.subagents` (`subagentProvider` config, default `spawn`).

The load-bearing line is **model authors content, runtime owns judgment**. The model writes the requirement draft, the orchestration draft, and each step's output; the runtime alone decides record identity, stage transitions, gap analysis, structural validity, execution order, and acceptance. That split is why the gates are honest: no submission can pass by asserting its own correctness. Submissions are whole-value replacements — a requirement revision discards the accepted composition (it was validated against the previous requirement), a rejected composition draft replaces nothing, and a failing re-verification demotes `verified` back to `composed`.

## Alternatives considered

**Extend `ctx.workflowEngine` with requirement/verification hooks.** Rejected: that seam's contract is "execute this script," and its meta block is display vocabulary with no execution semantics. Requirement completeness and acceptance assertion are a different lifecycle over different data; bolting them on would make the script engine the owner of a stage machine it never executes.

**A single package combining definition and provider (the pre-seam `dsh-jobs` shape).** Rejected for the same reason the job registry split: swapping the storage or execution backend would churn the package whose types every consumer imports, and the repository convention treats swappable capabilities as three packages by default. The abstract-constructor fence (mounting the definition fails loudly) keeps a stale composition row from half-registering `ctx.businessWorkflows`.

**LLM-judged clarification and verification (the model grades its own drafts).** Rejected as the *gates*: model judgment is exactly what the pipeline exists to check. Gap analysis is presence-based and composition validation structural precisely so a passing record means a machine-checked fact; the model's judgment stays where it belongs — writing the drafts and producing step outputs through the delegated runner.

**Durable session events for every stage transition (the `tool-workflow/*` shape).** Deferred, recorded as the consumer's Known Limitation: the tools project results through the tool pipeline only. The record is model-visible through results and renderable through the two live events; a durable `business-workflow/*` SessionEventMap extension lands when a UI needs log replay, and it can be added to the Consumer without touching the seam contract.

## Consequences

Bought: a business workflow reaches "done" only through machine-checked gates — every requirement objective covered by a step, every output bound, every acceptance case executed and asserted on the recorded orchestration — and revision loops are cheap (resubmit, re-compose, re-verify) because rejected drafts replace nothing. The seam is provider-swappable: a durable or worker-executing backend implements five methods, and neither the tools nor the events change. Step execution is also runner-injected, so verification runs today on subagent delegation and tomorrow on a sandboxed executor without touching the pipeline.

Cost: three more packages with the full manifest/tsconfig/README/invariant-companion weight; one more `ctx` key (`businessWorkflows`); and the stage machine is a new vocabulary consumers must learn. The dry-run is sequential per case and per step, and records are process-local — both recorded as the provider's Known Limitations rather than pre-designed away.

## Testing

The seam's stub-subclass suite pins `ctx.businessWorkflows` registration, duplicate-service rejection, and the abstract-mount fence; the probe-based invariant suite pins every transition-and-report rejection path. The provider's behavior suite covers the full pipeline — gap iteration, revision discarding, every composition issue code, the topological order, verification promotion/demotion, static-check skipping, step-failure settlement, abort-before-step and abort-mid-run, capacity, and teardown — plus a real-Loader composition test applying the provider-owned config from a Cordis row. The consumer's suite drives all three tools through `ctx.tools.execute` against a scripted subagent provider, including the delegated prompt's content, the rendered reports, both load-time config fences, and the agent/provider-absence failures. All three packages hold the per-file 100% coverage gate.
