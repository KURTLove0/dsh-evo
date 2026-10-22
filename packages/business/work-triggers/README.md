# @deepseek-ai/dsh-work-triggers

English | [中文](README.zh.md)

Host-owned time and execution-settlement triggers with idempotent native admissions and retained in-app notices. `workTriggers` and `workTriggerGateway` require storage, workbench agents, the workflow workbench, Work Center metadata, and workspace services. The default Web composition mounts the provider and [browser controls](../../client/ui-work-triggers/README.md). The [F09 proposal](../../../.agents/notes/proposed/feature/2026-10-20-outcome-oriented-workbench-product.md#f09-durable-work-triggers) owns the full product scope.

## Definitions and controls

A fixed definition names a workspace and either a structured task with executor revision or an immutable workflow publication with inputs. Creation checks current readiness without model execution or MCP probes. Native owners revalidate actual admission and retain existing permissions and human approvals. Executor revisions bind saved identity fields; external provider configuration and workflow execution routes remain resolved by their owners at admission. No credentials are copied into trigger records.

Rules accept a future UTC epoch millisecond target, a fixed interval anchored at `firstAt`, or settlement of one exact source execution. Settlement includes every terminal outcome and does not imply source success. An already terminal selected source becomes eligible on the first worker read. Changing a definition requires a new trigger. A caller-owned UUID identifies creation; identical canonical input returns the original revision-1 receipt after newer controls or restart, while conflicting reuse rejects.

Pause/resume uses `expectedRevision` and increments only the control revision. Stale controls reject and require an authoritative refresh; a lost control response does not prove failure. Pausing preserves nominal time and history, stops future handoffs, and continues observing admitted native runs. It does not cancel those runs. Notification acknowledgment records its first read time and repeats without another write.

Preparation reads original execution content without admission. Agent targets use the current saved identity revision; design runs and missing or archived agents reject. Workflow targets use the original formal execution publication and inputs; verification runs reject. The complete prepared response remains bounded. Creation rechecks readiness.

## Occurrences and recovery

One record atomically retains the fixed definition, next nominal target, occurrences, and notices. Reserve an occurrence and a native request UUID before calling an execution owner. Persist an unconfirmed phase before handoff. An accepted receipt records a source-qualified run identity and acceptance time; it does not establish execution success. Timestamped source reads retain terminal outcomes separately. A source lookup failure retains the previous observation and marks it unavailable; observation time is not the source's settlement time.

An unconfirmed handoff blocks subsequent occurrences and creates one retained notice. Explicit recovery compares `expectedAttempt` and reuses the original native request and target. Concurrent duplicate recovery controls coalesce while pending; an older attempt cannot authorize another retry. Native idempotence recovers an already committed run after a lost acknowledgment, even if persisting the trigger's accepted phase failed. A reserved pending occurrence resumes after restart; an unconfirmed occurrence waits for explicit recovery. Notices retain the observed historical uncertainty even after recovery succeeds. Settled occurrences add a notice with their exact terminal status.

Only one unfinished occurrence exists per trigger. Overdue intervals select the latest anchor-aligned due target, record skipped intervals, and advance directly to the first future target. They do not create a catch-up burst. Paused targets retain their nominal time, so resuming may make work immediately due. One-shot and selected-settlement rules remain consumed after their first reservation. Directory consumption and pause state are independent from the latest occurrence's admission and execution state.

The worker rereads the wall clock and uses one serialized queue for controls, reservation, and source observations. Unloading stops new handoffs, cancels the timer, and awaits admitted work before closing storage. Post-commit observer failures do not invalidate committed data. The provider is a single-owner local process and does not claim distributed or arbitrary external exactly-once effects.

## Bounds and query freshness

Configuration uses positive integers: `pollIntervalMs` (1000, bounded by Node's timer range), `minIntervalMs` (300000 for new interval definitions), `maxTriggers` (100), `maxDefinitionBytes` (262144 for each complete new definition), `maxOccurrences` (100 per trigger), `maxOccurrenceBytes` (16384 for each complete new or changed occurrence, including private request identity and notices), and `maxResponseBytes` (1048576 for each complete response). Startup rejects a response cap unable to represent options or a fixed-size control receipt. Lowering definition or occurrence capacity does not block a pause that leaves existing content unchanged. Capacity errors preserve history and stop new affected admissions without eviction.

Queries apply explicit text, workspace, and enabled filters before bounding their complete response. Directory rows exclude task text, workflow inputs, and complete histories. Reads return detached retained data without creation hashes or native submission identities. Metadata reads do not poll native owners. Per-trigger worker errors are labeled current-process observations, not durable execution outcomes; repeated failures do not prevent unrelated rules from advancing. No model message is inferred from a notice.

## Model Experience

Indirectly, through [dsh-workbench-agent](../workbench-agent/README.md#model-experience) and [dsh-business-workflow-local](../business-workflow-local/README.md), which log explicitly authorized task content and native workflow execution input through their existing paths.

#### KV Cache effect

Registration, controls, and observations make no model request. Due admissions create independent native sessions; the owning executors determine their logged prompts and request prefixes.

## Known Limitations and Deferred Work

- The Host must run to dispatch or observe work. No operating-system wake, multi-process lease, arbitrary event subscription, calendar recurrence, webhook, external notification, editing, deletion, or history archival is provided. Histories are bounded; capacity requires deployment adjustment or a separate trigger, rather than automatic evidence deletion. Unconfirmed native admissions require explicit recovery; no claim is made about exactly-once external side effects inside a task. Current-process worker failures reset after restart and are observed again if the condition persists.
