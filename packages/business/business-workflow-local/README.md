# @deepseek-ai/dsh-business-workflow-local

English | [中文](README.zh.md)

Process-local implementation of the [`@deepseek-ai/dsh-business-workflow`](../business-workflow/README.md) runtime contract: `LocalBusinessWorkflowRuntime` keeps every record in memory, issues `bw-N` ids, and drives the three-capability pipeline — requirement clarification through deterministic gap analysis, composition through structural validation, and verification through case-gated dry-run execution with acceptance assertions. Load it as a plugin and it registers as `ctx.businessWorkflows`.

## Durable workbench entry

Load `@deepseek-ai/dsh-business-workflow-local/workbench` for workspace workflows. It mounts the durable `workflowWorkbench` provider and the generated `workflowGateway` Remote consumer. The Web bundle includes this entry with the `standard` preset. The package root retains the conversation tool pipeline described below.

Required configuration: `presets` is the server-approved preset roster, `generatorPreset` selects one of those presets, and `subagentProvider` names the registered delegation provider. Positive integer limits are `maxWorkflows` (200), `maxRecordBytes` (4194304), `maxActiveRuns` (8), and `nodeTimeoutMs` (300000). The provider requires storageDomain, session persistence, workspace registry, Agent factories, default model configuration, preset registry, tools, and subagents.

The `business_workflows` domain, format 1, stores draft/publication aggregates, run reservations, and generation operations through the deployment's storage backend. Revision checks execute on its serialized write queue. Each execution has an independent audit Session; checkpoint flush must succeed before starting downstream work or notifying clients. A pending reservation bridges audit creation and index publication. Restart marks unfinished execution interrupted, preserves committed human waiting, and interrupts incomplete generation. A rejected audit flush stops further mutations until Host restart; committed snapshots remain inspectable. Unsupported stored formats reject at open.

Nodes and verification cases run sequentially. A workspace admits one unfinished workflow at a time, including human waiting; different workspaces share `maxActiveRuns`. Human decisions require the exact waiting attempt. Cancellation first records stopping, aborts the owned child, and records cancellation after cleanup. Leaving the page does not cancel execution. AI generation disables tools and retains a validated candidate with its source revision; it never overwrites the draft.

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

- The root entry keeps conversation pipeline records in memory. Use the workbench entry for durable workspace workflows.
- Workflow execution is single-Host. Automatic node replay, single-node retries, conditional branches, loops, and distributed locking are not supported.
- Full checkpoints retain outputs in the audit log; oversized results fail at `maxRecordBytes`. Paginated large-output inspection is deferred.
- **Cases run sequentially per verification** — acceptance cases execute one after another and steps within a case follow the dependency topology; independent-case concurrency is deferred until a consumer needs it.
