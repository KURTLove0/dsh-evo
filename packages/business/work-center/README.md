# @deepseek-ai/dsh-work-center

English | [中文](README.zh.md)

Cross-executor directory and durable human delivery review. The Web bundle mounts the `workCenter` provider and generated `workCenterGateway` Remote consumer over the existing [agent](../workbench-agent/README.md) and [workflow](../business-workflow-local/README.md) execution services. Sources own execution; this package owns assessments.

## Directory and intake

`query` filters source, workspace, and execution state before merging bounded source pages. Workflow confirmations and running tasks with a connection-observed `attentionSessionIds` entry come first; other records follow by descending committed execution update. Agent updates derive from creation/start/settlement; workflow updates come from durable checkpoints. Human review time remains separate. IDs include their source kind. Cursors belong to the original filter, limit, pending-session set, and both source directory generations. Execution mutations or host restart invalidate them instead of silently skipping moved records; callers must refresh. Absent pending-session observations imply no known agent interactions. Source failures remain explicit and suppress continuation until refresh; an empty successful source does not conceal a failed peer. `executors` returns names, revisions, instructions, runtime/model, skills, and MCP names, excluding connection environment and header values. `options` advertises the configured page size.

The browser submits structured briefs through the agent owner. Preflight and prompt preview do not execute work; actual submission checks the executor revision and dependencies again. Ordinary conversation approvals, questions, and plan reviews remain with their source sessions. Workflow decisions forward the exact waiting attempt.

## Evidence and assessment

`detail` reads the final durable assistant response within the agent run's recorded sequence interval, or the committed terminal workflow outputs. Agent briefs may name workspace files. These files are read during inspection, bounded individually, and retained as UTF-8 or base64 bytes with SHA-256 hashes. They are inspection-time evidence, not execution-time file history. Missing, outside-workspace, oversized, or unreadable files stay explicit; acceptance rejects unavailable expected files. Binary content is retained without rendering or executing it. Oversized complete deliveries are unavailable for assessment rather than truncated.

Each delivery version hashes its source reference, recorded output, criteria, assertion, and artifact evidence. A review compares that version and the current assessment revision, then atomically retains the complete delivery and decision in the `work_center_reviews` domain, format 1. Conflicting decisions reject; an identical decision ID returns its committed receipt across retries and restart. Historical review evidence never follows subsequent workspace edits. Actor attribution is the local host operator, not an authenticated team identity.

Saving feedback does not execute work. An explicit revision action creates a new linked agent task or reruns the original workflow publication and inputs with recorded feedback and original output. Agent revisions preview the exact augmented brief and require the currently selected configuration revision. The original run and its assessment remain independent.

## Diagnosis and full retry

`diagnose` reads one source-owned execution and its durable evidence without invoking models, tools, or MCP. Categories follow stable error codes and recorded end reasons; unclassified text remains unknown. Failed tools and model attempts are observations, including in successful runs. Agent sessions stop at the run's `settledSeq`; workflow child observations use recorded node start/end timestamps. Missing evidence, unknown intervals, and oversized individual projections stay explicit. Aggregate finding or complete-report byte overflow rejects the read rather than returning truncated evidence. `maxDiagnosisSources` (50) bounds child-session fanout, `maxDiagnosisFindings` (200) bounds observations, and `maxDiagnosisBytes` (262144) bounds UTF-8 JSON evidence.

Explicit retry commands forward caller-owned request identities to execution owners. Agent retry requires the confirmed current configuration revision. Workflow retry preserves the original immutable publication, inputs, feedback, execution route, and verification assertion when applicable. Each retry creates a full new run; it never resumes a node or changes the original assessment. The browser displays sanitized configuration and warns about repeated side effects before admission.

## Run statistics

`statistics` selects a submission-time cohort using inclusive `from`, exclusive `to`, workspace, source, and source-qualified executor filters. Owners filter before bounded pagination; a changed continuation or oversized source is unavailable as a whole. Available sources contribute independently, so unavailable sources do not imply zero work. Dates group in the requested IANA time zone. The same cohort produces totals and day/workspace/executor groups. The most recently submitted run's observed executor name labels each group; source-qualified IDs remain distinct. Executor groups sort by observed name, then qualified identity.

Queued, active, and settled counts partition runs. Waiting is a subset of active: workflow waiting is durable, while agent attention is a current connection observation. Success follows execution status, separately from verification assertions and human acceptance. Task/design and execution/verification counts remain explicit. Elapsed samples run from submission to settlement, including queueing and human waiting; queue samples stop at the first recorded start. Missing or inconsistent timestamps are excluded, with sample counts retained.

Counts never inspect transcripts. `usage: recorded` explicitly reads original logs within `maxStatisticsSessions` (100). Agent logs stop at their exact recorded settlement event; workflow direct-child logs use known node start/end timestamps. Unknown intervals and read failures remain unavailable; exhausted read budgets remain unchecked. Already observed partial usage is retained with that coverage. Attempted session reads and the limit are returned. The canonical token-meter fold replaces repeated turn/step samples and retains usage chunks from failed streams. Missing reports, later conversation work, and nested delegation are not invented or counted as complete billing. `statisticsChoices` returns safe names and identities without configuration or history.

`maxStatisticsRuns` (5000 per source), `maxStatisticsGroups` (1000 across all three dimensions), and `maxStatisticsBytes` (1048576 UTF-8 bytes for the complete response) bound reads and output. Source overflow discards that source's partial cohort; group/byte overflow rejects the report. No aggregates are persisted.

## Configuration

All limits are positive integers: `pageSize` (25), `maxPageSize` (100), `maxReviewDecisions` (10000), `maxRecordBytes` (4194304 per source's assessment history), `maxDeliveryBytes` (262144 for complete delivery evidence), and `maxArtifactBytes` (131072 per file). `pageSize` must not exceed `maxPageSize`; source providers must permit the selected page size. Capacity errors reject further writes without deleting history. Teardown drains serialized decisions before closing storage.

`source` exposes detached execution identity, name, workspace, session, and status without reading transcript or files. `review` reads one exact committed review revision without recapturing its bytes. These methods support explicit artifact registration by a separate provider.

## Model Experience

Indirectly, through [dsh-workbench-agent](../workbench-agent/README.md#model-experience) and [dsh-business-workflow-local](../business-workflow-local/README.md), which log explicitly submitted revision feedback and original recorded output into new execution sessions. Directory reads, preflight, and human reviews do not call a model.

#### KV Cache effect

Revision tasks establish new execution sessions. Assessment writes do not invalidate an existing model request prefix.

## Known Limitations and Deferred Work

- Single-host operation; no team authorization, remote-host aggregation, offline notifications, historical filesystem recovery, or automatic merging and publishing. File inspection is opt-in through expected paths. Workflow string outputs are retained directly and are not interpreted as filesystem paths. Review history and evidence are capacity bounded; archival and export are separate future work.
