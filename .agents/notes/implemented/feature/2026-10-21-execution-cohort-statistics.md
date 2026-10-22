# Agent Note: Execution cohorts with attributed usage observations

Status: implemented

English | [中文](2026-10-21-execution-cohort-statistics.zh.md)

## Problem

Whole-host session totals cannot answer how much work one workspace or collaborator submitted during a date range. Session totals also include later conversation work and cannot establish one execution's consumption. Missing reports and inaccessible sources must not make an incomplete cohort appear complete.

## Decision

[Work Center statistics](../../../../packages/business/work-center/README.md#run-statistics) select submission-time cohorts through execution owners. Inclusive start and exclusive end bounds, workspace, source, and source-qualified executor filters apply before pagination. A changed continuation or source capacity error discards that source's partial cohort. Available sources remain independent; complete report group or UTF-8 byte overflow rejects rather than truncates. No aggregate history is persisted.

Queued, active, and settled counts partition executions. Waiting is a subset of active: workflow waiting is durable; agent attention is observed through the current connection. Execution success does not establish verification assertions or human acceptance. Task/design and execution/verification counts retain their distinct meanings. Elapsed samples measure submission to settlement, including queueing and human waiting; queue samples measure submission to first recorded start. Missing timestamps do not become zero-duration samples.

Counts do not read logs. A separate explicit usage read inspects original agent logs through their exact settlement event and direct workflow child logs within known node intervals. Missing logs, unknown intervals, and exhausted session-read budgets stay explicit. A partial read retains its observed usage with incomplete coverage. Session attempts and the configured limit describe the read's scope.

The [token projection decision](../architecture/2026-07-29-projected-token-usage-and-request-context.md) continues to own canonical turn/step replacement and failed-stream samples. The public pure types entry and interval helper reuse those rules without installing a second meter. Reported usage does not establish complete billing: missing requests and nested delegation remain outside the observed total. Whole-host session summaries retain their independent all-time scope.

The existing Statistics module declares its run-cohort child slot. A React-free manager owns observations and late-read rejection; the declared view store owns unsent date and dimension controls. Source, filter, attention-set, and reconnect changes mark held reports stale without automatically reading logs. Original submitted filters remain with retained results. The [intake decision](2026-10-20-work-center-intake-and-review.md) owns execution aggregation and review separation; [task inspection](2026-10-20-workbench-agent-task-inspection.md) owns per-identity history and thirty-day activity. These records retain independent responsibilities.

## Alternatives considered

**Use whole-session usage as per-run consumption.** Later conversation turns and unrelated session work can inflate the selected execution's total.

**Aggregate browser-loaded run pages.** Paging and source failures would change denominators without establishing a complete selected cohort. Owners filter before bounded pagination instead.

**Inspect every log on page refresh.** Counts do not need transcripts. An explicit bounded evidence read makes cost and incomplete coverage visible without another persisted usage copy.

**Persist another metrics history.** A second mutable execution ledger would require reconciliation with run owners and session logs. Bounded on-demand cohorts satisfy the current local consumer.

## Consequences

Users compare known work across workspace, collaborator, workflow, and local submission date while keeping unknown measures visible. Oversized cohorts require narrower filters. Direct child intervals do not provide recursive delegation accounting or historical human response times. Monetary cost needs an authoritative pricing source. The feature adds no durable format, model request, or external telemetry.

## Verification

Source-owner tests prove filters precede pagination, retained generations reject changed continuations, and workflow catalogs exclude graphs and history. Aggregate tests cover source failures, qualified identities, timing samples, IANA dates, exact group and UTF-8 limits, original interval attribution, and read-budget exhaustion. Manager and component tests cover stale results, retained filters, missing evidence, and source failure presentation. A keyless shipped-composition browser scenario executes multiple collaborators, a configuration design, an acceptance case, and a waiting workflow, then compares counts and five usage reports without issuing further model calls. Chinese and narrow layouts use the same assembled application.
