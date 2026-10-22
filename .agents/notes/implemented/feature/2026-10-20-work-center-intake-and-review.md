# Agent Note: Work Center intake and delivery acceptance

Status: implemented

English | [中文](2026-10-20-work-center-intake-and-review.zh.md)

## Problem

Independent agent and workflow directories do not provide one place to find waiting work, submit reviewable task criteria, or preserve a human assessment of a concrete delivery. Execution success alone cannot establish acceptance, and current workspace files cannot stand in for historical review evidence.

## Decision

The [Work Center service](../../../../packages/business/work-center/README.md) merges bounded source queries while execution owners remain authoritative. Qualified source IDs prevent collisions. Filters precede pagination; failures remain explicit rather than producing a false empty complete directory. The browser exposes loaded counts and the connected-session scope of pending interactions. Pending running tasks and workflow confirmations precede descending committed execution updates. Creation and execution-update times have separate row labels; human review time does not rewrite execution history. Connection-observed pending sessions remain transient query input rather than persisted claims that could resurrect dead questions.

The agent owner atomically persists a structured brief, submitted configuration revision, idempotent request ID, and queued run. Preflight checks dependencies without execution or MCP connections. Preview and submission share one prompt formatter. Actual admission checks dependencies and revision again. A task's durable settlement sequence bounds its recorded assistant response even if its conversation continues later. Stop aborts the owned execution before awaiting its cancellation write, so slow storage cannot admit a new model request after cancellation.

Human assessments have their own serialized storage domain. A content hash identifies the recorded response or workflow outputs, submitted criteria, optional assertion, and explicitly requested inspection-time file evidence. Files retain bounded original bytes and hashes; unavailable expected files block acceptance. A decision compares delivery version and assessment revision, then atomically retains the complete evidence with its idempotent decision ID. File changes never rewrite stored review evidence. The local operator label does not imply a team identity.

Saving requested changes performs no execution. Creating a revision is explicit: agent tasks preview committed feedback and original output with original/current sanitized configuration; workflows rerun the original publication and inputs. Original runs and assessments remain intact. Native source submission IDs make transport retries safe.

The [product proposal](../../proposed/feature/2026-10-20-outcome-oriented-workbench-product.md) retains the broader roadmap. This implementation owns its first-priority work intake and acceptance mechanisms; later scheduling, integrations, cost accounting, and team capabilities remain proposals. The existing task-surface and execution-owner decisions retain their distinct responsibilities. [Evidenced diagnosis and full retry](2026-10-21-evidenced-work-diagnosis.md) owns failure observations and whole-execution retry identity.

## Consequences

The browser manager coalesces refreshes, serializes continuation reads, drops stale selection/query results, and invalidates pending previews when draft fields change. Pending-session set changes invalidate paging. Each source owns an opaque run-directory generation changed after committed run mutations and renewed on host restart; stale cursors reject instead of missing records moved above an update-time continuation. Source-qualified tie positions preserve deterministic merging without loading whole histories. Only view drafts enter the declared page store; authoritative execution and review state stays in the React-free manager and host services. UI composition uses existing sidebar and shell-page slots and shared cyber theme tokens.

Agent storage uses version 5 and durable workflow storage uses version 3. Pre-release older formats reject without migration. Review history and evidence have deployment-configured limits; capacity rejects new decisions rather than silently dropping old ones. Evidence is retained in host storage and carries the same local access assumptions as task transcripts.

## Verification

Real-owner tests cover structured admission without side effects, request replay across restart, source pagination, exact waiting-attempt decisions, logged revision feedback, stale file-version rejection, immutable review evidence, and explicit linked agent revisions. Browser coverage runs the shipped Web composition with a scripted keyless provider through intake, exact prompt preview, execution, requested changes without execution, explicit revision submission, and acceptance. A committed accessibility snapshot pins intake output; responsive checks cover 320px, 768px, and desktop. Manager tests cover stale reads, source failures, pagination invalidations, equivalent pending-session sets, and pending-preview invalidation. Source tests cover mixed attention/update ordering, stable ties, generation rejection after mutation and restart, and independently readable lifecycle timestamps. A deterministic storage barrier verifies immediate cancellation while persistence is pending.

## Alternatives considered

- A new execution scheduler in Work Center duplicates existing source ownership and cleanup.
- Mutable acceptance flags on run status conflate execution outcomes with human decisions.
- Saving only an output path cannot preserve the file a reviewer actually inspected.
- Automatically rerunning after feedback makes an assessment unexpectedly execute work.
- Truncating evidence before acceptance would assess an incomplete delivery as complete.
