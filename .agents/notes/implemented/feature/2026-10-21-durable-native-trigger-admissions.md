# Agent Note: Durable native trigger admissions

Status: implemented

English | [中文](2026-10-21-durable-native-trigger-admissions.zh.md)

## Problem

A Session-local reminder cannot own a task that must remain scheduled after that conversation closes. A host trigger also crosses two independent durable writes: reserving an occurrence and admitting a native agent or workflow run. Treating a lost handoff response as a failed execution can create another run or attach a successful label to an unknown outcome.

## Decision

The Work Triggers provider owns a separate storage domain whose single record contains a fixed target, rule, next nominal time, occurrence history, and notices. The native agent and workflow services retain execution, permissions, logs, and human approvals. The default Web composition mounts the provider, Remote consumer, and optional browser controls. The [F09 proposal](../../proposed/feature/2026-10-20-outcome-oriented-workbench-product.md#f09-durable-work-triggers) owns the product scope.

One serialized reservation commits the occurrence and next nominal target before handoff. Each occurrence retains one native request UUID. An unconfirmed phase is durable before calling the owner, and a later receipt records native admission separately from terminal observations. A lost response or failed receipt write preserves uncertainty. Explicit recovery compares the attempt number and uses the same native identity and fixed request. A reserved pending occurrence resumes on restart; unconfirmed handoffs wait for the operator. One unfinished occurrence blocks later work for that rule.

Fixed intervals coalesce overdue targets using anchor arithmetic and retain the skipped count. A selected-settlement rule watches one exact source run and reacts to any terminal status. Pause stops future handoffs without canceling admitted runs or resetting consumption. Native status observations and notice acknowledgments remain separate from control revisions and human delivery acceptance.

The caller's creation UUID and immutable input hash recover the revision-1 creation receipt across later controls and restart. Pause/resume uses a revision comparison; acknowledgment is idempotent, and handoff recovery uses the occurrence's attempt count. These bounded controls do not need an accumulating receipt journal. Definition and occurrence capacities protect their complete values without evicting history; unchanged history does not prevent pausing after a capacity reduction. Operation-local drafts are copied at each storage write so a later handoff mutation cannot change committed memory before durability.

[Durable Session-local reminders](2026-08-05-durable-web-schedule.md) and [conversational delivery](../simplification/2026-08-09-conversational-schedule-delivery.md) retain their conversation semantics and rejection of a reminder receipt. This provider owns independent native runs and explicitly acknowledged notices rather than presenting a Schedule dispatch as delivery. [Fixed-rate reminders](../simplification/2026-08-09-bounded-fixed-rate-schedule.md) retain batching in one conversation; independent task triggers do not share a model request. [Explicit time-zone interpretation](../simplification/2026-08-09-explicit-schedule-time-zone.md) remains separate from the UTC instant accepted by this provider. Those decisions are independently useful and are not superseded.

## Alternatives considered

**Extend a live Session's reminder owner.** Cold-session activation and task execution have different identities and persistence requirements; a conversation follow-up cannot serve as a recoverable native task receipt.

**Retry an uncertain handoff with a new request UUID.** The original task may already exist. Native idempotence can recover that identity, while another UUID authorizes another run.

**Commit only after native admission.** A crash between native commit and trigger persistence loses the original request identity. Reservation and an unconfirmed phase preserve it first.

**Replay every missed interval or overlap unfinished occurrences.** Downtime and slow approvals would create an execution burst. Coalescing retains the fixed cadence without inventing work for every missed slot.

**Keep mutable drafts in the domain table.** Subsequent phase edits would become visible before the next durable write, so a failed commit could leave memory ahead of storage.

## Consequences

The Host must be running; this is not an operating-system wake or distributed scheduling service. Definitions and histories have explicit capacities, and no exactly-once promise applies to external effects inside a native task. In-app notices record handoff uncertainty or a sourced terminal outcome without calling a model. External channels, arbitrary events, calendar recurrence, deletion, and history archival remain outside this provider implementation.

The browser keeps command input separate from authoritative records. Fixed-target preparation reads original execution content, captures the current agent revision or original workflow publication, and requires explicit creation. ISO time input includes an offset, avoiding ambiguous browser-local daylight-saving normalization. Read generations isolate directory, detail, and preparation; connection changes retain last-known records as stale. Page remounts preserve draft and uncertain command inputs. Creation retries reuse the same identity, then read current state rather than trusting the original revision-1 receipt. Controls and occurrence recovery require an authoritative read before another decision; reconnect never automatically resends commands. Historical uncertainty notices stay distinct from the recovered occurrence's current state.

## Verification

Real JSON-storage tests cover restart, fixed-rate catch-up, pause/resume, source settlement, immutable request recovery, stale controls, failed post-admission commits, complete byte bounds, strict durable decoding, observer containment, and quiescent disposal. The default real Web composition uses HTTP calls, real native executors, scripted external model responses, and the existing approval UI. It closes the browser before dispatch, recovers a lost native acknowledgment without another run, retains workflow approval and publication inputs, triggers dependent work after settlement, reconstructs notices after reload, and checks logged model input. Committed result snapshots record those assembled facts. Browser controls additionally recover lost creation and control acknowledgments, preserve the same native admission, retain original workflow approval, converge after an offline peer changes state, acknowledge notices, and cover keyboard interaction, both languages, both themes, and narrow widths.
