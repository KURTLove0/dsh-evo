# @deepseek-ai/dsh-business-workflow-local

English | [中文](README.zh.md)

Process-local implementation of the [`@deepseek-ai/dsh-business-workflow`](../business-workflow/README.md) runtime contract: `LocalBusinessWorkflowRuntime` keeps every record in memory, issues `bw-N` ids, and drives the three-capability pipeline — requirement clarification through deterministic gap analysis, composition through structural validation, and verification through case-gated dry-run execution with acceptance assertions. Load it as a plugin and it registers as `ctx.businessWorkflows`.

## Admission

`maxWorkflows` is a positive safe integer and defaults to `200`. A create that would exceed it fails before id allocation with a `CAPACITY` error naming the limit; updates to existing records never consume capacity. `maxTraceChars` (default `2000`) caps each step's trace detail in verification reports.

## Lifecycle

Submissions are whole-value replacements. A requirement submission replaces the previous draft (the revision increments), discards the accepted composition and any verified timestamp — the orchestration was validated against the previous requirement — and re-runs gap analysis. A composition submission replaces the accepted composition only when the draft passes every structural check; a rejected draft returns its issues and changes nothing, so a `verified` record stays `verified` while its next revision draft is judged.

Stage transitions follow the Service Definition exactly: `clarifying`→`ready`, `ready`→`composed`, `composed`→`verified`, requirement revisions back to `ready`/`clarifying`, and a failing re-verification demoting `verified`→`composed`. A passing re-verification of an already-`verified` record records the new report without a stage event. Every transition emits `business-workflow/stage` after the record is committed; `business-workflow/verification` fires after the report is recorded and any promotion published.

Verification observes the caller signal before every step, through a method boundary so the abort check stays live across the run. A step failure settles its case with the failure trace and a fix hint; only invalid input and cancellation throw. Service disposal drops every record — verification holds no owned resources to clean up.

## Model Experience

Indirectly, through [`dsh-tool-business-workflow`](../tool-business-workflow/README.md), which renders clarification gaps, composition issues, and verification reports.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Records are process-local** — a harness restart loses every business-workflow record; durable records need a separate backend implementing the seam.
- **Cases run sequentially per verification** — acceptance cases execute one after another and steps within a case follow the dependency topology; independent-case concurrency is deferred until a consumer needs it.
