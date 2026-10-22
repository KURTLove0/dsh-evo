# Agent Note: Evidenced work diagnosis and explicit full retry

Status: implemented

English | [中文](2026-10-21-evidenced-work-diagnosis.zh.md)

## Problem

An execution's error text does not prove its cause. A denied tool can coexist with a successful result, and later session messages can describe unrelated work. Retrying after an uncertain transport response can also duplicate external effects unless the execution owner recognizes the original request.

## Decision

[Work Center](../../../../packages/business/work-center/README.md#diagnosis-and-full-retry) projects source-owned run records and durable events on explicit request. Stable codes and end reasons determine categories; prose remains original evidence with an unknown category. Terminal run/turn facts remain distinct from observed tool, model-attempt, node, and assertion failures. A recovered observation never makes a completed execution fail. Tool policy denial and result blocking carry stable codes while retaining their existing model-visible content.

Agent observations stop at the recorded settlement sequence. Workflow child observations require recorded node timestamps. Missing logs, unknown intervals, and oversized individual projections stay explicit; child fanout is bounded before reads and complete-report overflow rejects rather than truncates. Reports are timestamped last-known observations. Refresh and reconnect invalidate them without invoking a model, probing a connection, or diagnosing again automatically.

Retry is an explicit full new execution, with a warning about repeated side effects and sanitized configuration shown before admission. Agent owners check the confirmed current revision and capture it at admission for structured and free-form work. Workflow owners retain the original immutable publication, inputs, feedback, and execution route. A failed acceptance case retains verification mode and assertion in a new batch. Neither path resumes a node.

Caller-owned retry identities are persisted with source lineage. Identical commands return the committed receipt before current archive or configuration checks; conflicting reuse rejects. Browser view stores retain the pending command across page remounts and selection changes. A lost acknowledgment exposes manual recovery of the same request. Remount and reconnect never submit it automatically. Full application reload discards the browser draft.

The [intake and review decision](2026-10-20-work-center-intake-and-review.md) retains ownership of independent human assessments, immutable delivery evidence, and structured intake. [Task inspection](2026-10-20-workbench-agent-task-inspection.md) retains composer and captured-configuration ownership. [Bounded model-request recovery](../architecture/2026-06-21-bounded-llm-request-recovery.md) owns automatic request attempts inside an execution. These remain independently useful decisions; full execution retry does not replace them.

## Alternatives considered

**Classify error wording.** User text and provider prose are not machine facts and cannot establish configuration, permission, or provider causes.

**Treat every failed tool as the execution cause.** Models can recover or complete without a denied tool. Observation and terminal status must remain separate.

**Allocate a new request after an uncertain response.** The original execution can already be committed. Reusing its identity permits recovery without duplicating admitted work.

**Resume a failed node or change verification into ordinary execution.** Node resumption needs its own side-effect and checkpoint semantics; changing modes discards the assertion the user intended to validate.

## Consequences

Evidence reads and retries reuse execution owners instead of adding another history or scheduler. Agent storage format 5 and workflow storage format 3 reject older pre-release data without migration. Retry identity guarantees one admitted run per request, not exactly-once external effects within that run. Configuration credentials remain host data and are excluded from diagnostic configuration previews.

## Verification

Owner tests cover exact-code projection, bounded source intervals, unavailable evidence, concurrent and conflicting requests, stale revisions, restart recovery, and preserved verification semantics. Both SDKs retain retry checkpoint metadata. Keyless shipped-composition browser scenarios exercise authentication failure, denied-tool recovery, a committed retry with a lost acknowledgment, manual recovery after page remount, and failed acceptance-case retry. UI and manager tests cover stale evidence, repair navigation, and pending command retention.
