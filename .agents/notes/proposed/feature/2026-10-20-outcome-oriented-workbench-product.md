# Agent Note: Outcome-oriented workbench product plan

Status: proposed

English | [中文](2026-10-20-outcome-oriented-workbench-product.zh.md)

The first-priority intake and acceptance mechanisms are implemented in [Work Center](../../implemented/feature/2026-10-20-work-center-intake-and-review.md). Unimplemented follow-up capabilities retain proposed status.

Template reuse is recorded by the [private work templates decision](../../implemented/feature/2026-10-21-private-work-templates.md). Capability checks are recorded by the [capability observations decision](../../implemented/feature/2026-10-21-capability-observations.md). F01–F11 now have implemented decisions linked in their sections. On 2026-10-22 the operator selected local workflow completion and deferred F12 external-system intake and team collaboration. No external connector is part of this delivery; F12 remains conditional on a named source and demonstrated multi-user demand.

## Problem

The project already has conversations, independent agents, durable execution queues, published workflows, and human confirmation. Its user journeys are organized mainly by technical capability. Users visit conversations, agents, and workflows separately to find blocked work, inspect results, and reuse successful approaches. Execution ending does not establish business acceptance.

The initial audience hypothesis is individual developers, AI practitioners, and workflow builders using a local-first application. The proposed positioning is “configure dependable AI collaborators and turn goals into inspectable, reusable deliverables.” This is a product judgment grounded in current code, without user interviews or usage-data validation. It makes no market-size, return, or delivery-date claims. Follow-up additions without an implemented decision remain proposed.

## Proposal

### Existing capabilities and actual gaps

| Area | Current evidence | Addition |
|---|---|---|
| Agents | The [service](../../../../packages/business/workbench-agent/README.md) and [browser page](../../../../packages/client/ui-workbench-agent/README.md) support identities, skills, MCP, local runtimes, queueing, stop, retry, history, and thirty-day statistics | A cross-agent/workflow work entry point, explicit delivery criteria, and human review records |
| Workflows | The [workbench](../../../../packages/client/ui-business-workflow/README.md) supports drafts, immutable publications, a canvas, input bindings, human nodes, execution, and acceptance cases | Starter templates, form-based task intake, and comparisons across results; keep execution and acceptance assertions separate |
| Runtimes | The [directory](../../../../packages/client/ui-settings-runtimes/README.md) supports local executable profiles, remote machine catalogs, and opening remote applications | Unified readiness checks; remote dispatch still needs an execution protocol and provider, because catalog reachability is not execution support |
| Conversations and attention | The [workspace UI](../../../../packages/client/ui-workspace/README.md) supports search, fork, archive, and approval/question/plan-review indicators | An aggregated attention entry point and archive browsing/restoration; reuse existing search and approval mechanisms |
| Artifacts | [Deliverable links](../../../../packages/client/ui-deliverables/README.md) derive references from successful file-mutation locations | An independent delivery manifest and acceptance evidence; terminal-created files are currently absent from that vocabulary |
| Automation | [Schedule](../../../../packages/schedule/schedule/README.md) supports session-local delays, absolute targets, and fixed intervals | Durable triggers independent of session lifetime; current reminders are not an offline scheduler |
| Statistics | The [statistics page](../../../../packages/client/ui-settings-stats/README.md) aggregates sessions and tokens, explicitly leaving cost unavailable | Date ranges, run dimensions, and source completeness; show monetary estimates only after a reliable pricing source exists |
| Project knowledge | [Third-party memory examples](../../implemented/feature/2026-07-31-third-party-memory-mcp-examples.md) demonstrate MCP integration | Managed project knowledge sources, versions, and citations, preferably using an existing retrieval provider |

### User journey and information architecture

The primary journey is: choose workspace → describe goal, materials, and acceptance criteria → check dependencies → execute → answer necessary human requests → inspect artifacts and evidence → accept or request changes → save an effective approach as a template.

Retain current conversations and workspaces. Add a Work Center with Needs attention, In progress, and Finished views. Agents owns collaborator configuration and per-identity history; Workflows owns repeatable process design and execution. Add an Artifacts entry once delivery manifests exist. Runtimes, plugins, and statistics remain configuration modules. Execution approval and post-execution review use distinct labels and actions.

### Priorities and delivery order

Priority considers user blockage, reuse of current implementation, data dependencies, and additional execution risk. Relative effort is an engineering judgment, not a schedule. P0 ordering expresses dependencies rather than a parallel-delivery commitment.

| ID | Priority | Feature | First scope and value | Relative effort | Main dependency |
|---|---|---|---|---|---|
| F01 | P0 | Work Center and attention inbox | Aggregate agent tasks, workflow executions, and existing pending conversation interactions to locate actionable work | Medium | Bounded queries, typed run references, existing attention state |
| F02 | P0 | Structured intake and preflight | Capture goal, inputs, outputs, and acceptance criteria; expose workspace/runtime/skill problems before submission | Medium | F01 entry and execution capability catalogs |
| F03 | P0 | Delivery review | Accept a specific delivery version or request changes, linking outputs, evidence, and subsequent runs | Medium–high | F02 criteria, artifact references, durable review records |
| F04 | P1 | Private template library | Save task/workflow templates, run independent copies with source versions; begin with code review, document organization, and data-file report examples | Medium | F02/F03; examples must match installed capabilities |
| F05 | P1 | Capability and connection health | Summarize runtime, skill, MCP, and credential configuration with check timestamps and repair actions | Medium | Existing catalogs and credential describe operations; optional connection probes |
| F06 | P1 | Result and failure diagnosis | Distinguish evidenced configuration gaps, denial, timeout, model, and tool failures; preserve original evidence and correct retry actions | Medium | Existing run errors, logs, and retry identities |
| F07 | P1 | Filterable run statistics | Show volume, waiting, duration, and available token measures by workspace, agent, workflow, and date | Medium | F01 queries; missing measures remain unknown |
| F08 | P1 | Project artifacts and archive recovery | Index confirmed outputs with source runs and versions; preview artifacts and browse/restore archived sessions | Medium–high | F03, existence checks, explicit artifact registration |
| F09 | P2 | Durable triggers and notifications | Time/event triggers independent of sessions, with pause, next execution, and failure records; start with in-app notices and authorize external channels separately | High | Durable scheduling provider, idempotent requests, notification consumers |
| F10 | P2 | Remote execution | Name the target machine, capabilities, working directory, and credential owner; dispatch traceable remote runs | High | Dedicated execution provider, authentication/authorization, disconnection and file-access protocols |
| F11 | P2 | Project knowledge directory | Select sources, inspect indexing status/versions, and cite exact materials separately from conversation context | Medium–high | Retrieval provider, source permissions, citation protocol |
| F12 | Conditional | External work intake and team collaboration | Start with one work-item source users actually use; scope team identities, roles, and sharing only after validating multi-user demand | High | User validation, connector, independent access model |

### F01: Work Center minimum PRD

**User story.** A user running several tasks opens the application, handles questions and reviews first, then inspects outputs without visiting each agent.

**Presentation.** Each row shows a name or task summary, source type, workspace, original execution status, attention category, creation time, and last known update time. Filters cover workspace, source, execution status, and attention category. Attention comes first; other rows sort by an evidenced update timestamp. Ordinary chat contributes existing pending interactions without turning every conversation into a fabricated task. A disconnected browser displays last-known data and its disconnection state.

**Interaction.** Details open the owning agent, workflow, or conversation. Answers, approvals, cancellation, and retries execute through their existing owners. Workflow decisions carry the exact run and waiting attempt; ordinary approval retains one-shot authorization semantics. Stale pages cannot act again on a settled interaction. Bulk approval is outside the first version.

**Implementation.** Add a global read-only aggregate query and client plugin using existing Remotes, run storage, and pendingInteraction. Run references include a source discriminant and the original branded ID; equal string IDs from different sources never merge. Execution status comes from its owner, with attention and review shown as independent dimensions. Provide bounded pagination and stable cursors rather than downloading every agent's full history or persisting another mutable execution-state copy. The global agent directory currently omits run history, so a new read API is required.

**Empty and failure states.** Empty data offers creation; empty filters offer reset. A failed source is explicitly unavailable rather than “everything handled.” An archived or unreadable detail retains an explanation without deleting source records.

### F02: Structured intake minimum PRD

**User story.** Users know their intended delivery but do not understand runtime, prompt, or plugin configuration. Before starting they can confirm the workspace, executor, and completion criteria.

**Fields.** Require goal, workspace, and executor. Offer background materials, expected file paths/formats, acceptance criteria, and constraints. First-version criteria are explicit text items, without claiming arbitrary natural-language assertions are executable. Secrets use credential references rather than prompt, template, or exported configuration values. Explain unsubmitted-draft retention; existing in-application drafts do not establish reload durability.

**Preflight.** Check that workspace and executor still exist, the identity is active, runtime is available, model routing matches, and selected skills are discoverable. Catalog availability establishes configuration readiness only. MCP connectivity requires a separately timestamped probe; absent a user-triggered probe, show Not checked. Do not probe by issuing real business commands. Execution revalidates concurrent changes even after a successful preflight.

**Submission and data.** Show the final task content before using the existing executor. The visible goal, constraints, and acceptance text must reach actual model input and the session log. Add a versioned task brief bound to the new run. Use an idempotent request ID, retain drafts on rejection, and prevent transport retries from creating duplicate runs. Persist the brief/run association through one recoverable submission operation; cross-store writes need defined failure recovery rather than browser-only association.

### F03: Delivery review minimum PRD

**User story.** Users determine whether delivery meets the request, identify concrete defects, and send follow-up work without reading the complete technical transcript.

**Review page.** Present the submitted goal/criteria, execution summary, verifiable artifacts, actual checks and results, and remaining human judgments together. Model-generated summaries identify their source; a passing check requires its corresponding check record. Workflow assertions, execution status, and human acceptance stay separate.

**Decisions.** A settled task with a delivery version supports Accept or Request changes; requesting changes requires a reason. Reviews reference an exact run, delivery version, and brief version, with time and local-operator context rather than invented multi-user identity. Independent review states are Pending review, Accepted, and Changes requested. Subsequent retries cannot silently replace an accepted version. Concurrent reviews use revision checks; transport retries reuse a decision ID.

**Follow-up and side effects.** Request changes records feedback only. Create revision task is a distinct explicit action producing a linked new run and retaining the original delivery. The first version uses current executor configuration and shows differences before submission. Successful mutation locations can nominate artifacts; terminal-created files, external links, and model claims require explicit registration with verifiable existence/version data. A failed read-only preview reports Inaccessible. Current file contents cannot impersonate a historical version. First-version review never automatically sends deliverables, merges code, publishes, or deploys.

### F05: capability health checks

**Scope.** A workspace and saved executor select task readiness, selected skills, and configured MCP servers. A separate provider summary describes registered model/runtime catalogs and their declared credential references or stored authorization records. Missing ownership or ambient CLI authentication stays explicitly unverified. Remote host directory reachability never implies remote execution.

**Checks.** A user-triggered configuration read returns its observation time and source-local failures without creating sessions or sending model requests. Credential checks use describe operations and never return values. The page distinguishes configured, missing, failed, and unverified results and offers the existing Agents, Runtimes, Models, and settings routes as remedies. Source or executor changes mark held observations stale; disconnect preserves last-known results with their timestamps.

**MCP probe.** Explicitly probing one saved server checks the selected executor revision and workspace, performs initialization and ping, then closes the temporary connection. No tools are registered or called. A configured server remains untested before that action. Probe duration, observation time, cancellation/timeout, and cleanup outcome remain separate facts. Configurable deadlines and concurrency limits bound owned work; teardown cancels and awaits probes. A cleanup failure prevents further probes until the host reloads. Browser retries do not automatically repeat a probe whose response was lost.

**Verification.** Host tests cover missing dependencies, secret-free results, independent source failures, stale revisions, cancellation/timeouts, and probe cleanup. A keyless browser scenario boots the real composition, distinguishes an untested server from an actual successful/failed probe, follows repair navigation, and covers reconnect and narrow screens.

### F06: result and failure diagnosis

Implemented by [evidenced diagnosis and explicit full retry](../../implemented/feature/2026-10-21-evidenced-work-diagnosis.md).

**Scope and evidence.** Work Center offers an explicit diagnostic read for one typed run. It retains the original run error and links each observed failure to a recorded session/event or workflow node. Stable error codes and durable end reasons classify configuration gaps, denial, timeout, model/tool failure, cancellation, interruption, and output limits. Error wording alone never establishes a category. Tool failures remain observations even when execution succeeds; absent or inaccessible logs remain explicit, and a current configuration gap is not a historical cause.

**Reads and presentation.** Diagnostics are timestamped on-demand reads, with configured complete-report byte, finding, and source bounds. Individual projection overflow leaves its source unavailable; aggregate finding or complete-report overflow rejects the read rather than silently truncating evidence. Selection changes, source changes, and reconnect invalidate held reports; stale/disconnected results remain last-known observations. The page shows original evidence, codes, node and session references, unavailable sources, and the appropriate existing configuration or transcript entry point. No diagnosis calls a model, probes MCP, changes configuration, or automatically retries work.

**Retry.** A retry is a separate explicit full new run, with a side-effect warning and captured-versus-current configuration shown before submission. Agent retries check the current executor revision and retain a caller-owned request identity; identical retries recover the same run across lost responses and host restart, including free-form tasks. Conflicting identities reject. Workflow retries preserve the original immutable publication, inputs, feedback, and execution route through an idempotent full-retry operation. A failed acceptance case retains its verification mode, case, and assertion in a new batch. No failed node is resumed in place. Browser remount or reconnect does not automatically resubmit an uncertain retry.

**Verification.** Host tests cover exact-code classification, unknown wording, recovered tool failures, settled event limits, missing/oversized sources, source-kind identity, and complete bounds. Retry owner tests cover stale configuration, duplicate/conflicting identities, concurrent commands, restart, and lost responses. Keyless shipped-composition browser scenarios cover failed execution evidence, successful execution with a tool failure observation, explicit full retry, preserved source lineage, a lost acknowledgment, stale report handling, repair navigation, and narrow layouts. Existing original logs and human delivery review remain independent.

### F07: filterable run statistics

Implemented by [execution cohort statistics](../../implemented/feature/2026-10-21-execution-cohort-statistics.md).

**Scope.** Statistics select submission dates, workspace, execution source, and source-qualified collaborator or workflow. Local date inputs resolve to inclusive start and exclusive next-day midnight, with an explicit IANA time zone. Owners filter before generation-checked pagination. Complete bounded cohorts produce consistent totals and executor/workspace/date groups; excluded, available, and unavailable sources remain distinct. Capacity errors require narrower filters rather than a silent partial denominator.

**Measures.** Queued, active, and settled work partition the cohort; waiting is a subset of active and ordinary conversations are not fabricated as runs. Execution success remains distinct from verification assertions and human acceptance. Work types stay explicit. Total elapsed time includes queueing and human waiting; queue samples stop at first recorded start. Every duration includes a sample count, and missing or inconsistent timestamps remain unknown.

**Usage and freshness.** Counts do not inspect logs. An explicit bounded usage read reuses the canonical meter over owned agent settlement sequences and known direct workflow child intervals. Coverage, missing sources, unknown intervals, and uninspected runs remain visible. Provider reports can omit requests and nested delegation and are not monetary totals. Source, filter, attention, and connection changes invalidate held observations without automatically reading logs. View controls survive page remounts within the application; old results retain their original submitted filters. Whole-host session usage keeps its independent all-time scope.

**Verification.** Source-owner, aggregate, manager, and component coverage checks filters, complete pagination, distinct IDs, timing semantics, IANA dates, capacity errors, interval attribution, and missing evidence. A keyless assembled browser flow executes ordinary tasks, configuration design, acceptance verification, and human waiting, compares real run and usage counts, exercises filters, and checks Chinese and narrow layouts.

### F08: project artifacts and archive recovery

Archive recovery is recorded by [archived-session recovery](../../implemented/feature/2026-10-21-archived-session-recovery.md), and the project directory by [explicit project artifacts](../../implemented/feature/2026-10-21-explicit-project-artifacts.md).

**Artifact scope.** A project directory indexes explicitly registered file snapshots with their source execution, workspace, capture time, digest, and immutable version. Promoting an accepted review uses its retained bytes and exact review/delivery version; manually registering a terminal-created file captures its current bytes and states that execution provenance and human acceptance are separate. Missing files, unavailable workspaces, oversized captures, and paths outside the selected workspace reject registration. Text previews remain inert; binary content is identified without executing HTML, scripts, or documents. Current-file availability is an on-demand timestamped observation, never proof of historical contents. Registration is revision checked and idempotent; lost responses recover the original receipt instead of creating another version.

**Archive recovery.** A dedicated archive page lists the registry-global archived set using the existing session and workspace baselines. Title/ID and workspace filters operate on metadata, with a bounded visible prefix and a refine-filter message. Unknown session metadata remains explicit. Restoring removes only archive membership; it preserves session logs, workspace accounting, and manual order, and does not execute work or open the session automatically. Repeated restoration is a no-op for a known session; missing logs remain unavailable. The page shows disconnected or failed baselines and disables restoration until the workspace baseline and session metadata are ready. A committed Host response or archive-change frame updates all connected views; reconnect re-reads authoritative membership.

**Verification.** Registry and transport tests prove restore durability, idempotence, failure propagation, and unchanged accounting. Runtime tests cover response/frame races and reconnect. Component and real-composition browser scenarios archive multiple sessions, filter and restore them, check a second connected page, retain original order across restart, and exercise Chinese, keyboard focus, light/dark schemes, and narrow screens. Artifact registration tests verify exact bytes and versions, missing/outside paths, optimistic version checks, idempotent receipts across restart and lost responses, inert previews, and durable provenance. The browser scenario generates files through the terminal and preserves accepted bytes after removal.

<a id="f09-durable-work-triggers"></a>

### F09: durable work triggers and in-app notices

The default Web provider, native handoff protocol, and browser interface are recorded by [durable native trigger admissions](../../implemented/feature/2026-10-21-durable-native-trigger-admissions.md).

**Scope and deployment.** Host-owned triggers survive browser and session closure and are restored after Host restart. The Host must be running to dispatch or observe executions; this is not an operating-system wake service. First rules cover a future UTC instant, an anchor-aligned fixed interval, and settlement of one explicitly selected agent or workflow run. A settlement rule reacts to any terminal outcome, rather than implying success. Arbitrary event subscriptions, webhooks, operating-system startup, and external notification channels require separate providers and remain deferred.

**Target and authorization.** Each immutable trigger names a workspace and either a structured task plus executor revision or an immutable workflow publication plus input values. Creation checks existing readiness without model execution or MCP probes. Enabling a trigger explicitly authorizes subsequent admissions of that fixed target. Native execution owners revalidate actual admission and retain their ordinary permission and approval behavior. Changing the rule or target creates a separate trigger; pausing preserves history and does not cancel already admitted work.

**Occurrence and restart.** Reserve an occurrence, its native request identity, and the next nominal target in one durable write before invoking an executor. Persist an unconfirmed phase before handing off. Native idempotent submission recovers the same run if the Host loses the receipt. An unconfirmed handoff blocks later occurrences until explicit recovery; recovery keeps the same target and request identity. Never report acceptance as execution success. Record the owning run and timestamped terminal observations separately. Missing source metadata remains unavailable, without changing the last known run outcome.

**Intervals and concurrency.** A rule admits at most one unfinished occurrence. Missed intervals coalesce to the latest anchor-aligned due occurrence; retain the number skipped and advance to the first future target without a catch-up burst. Pause retains nominal time; resume can make work immediately due. One-shot and settlement rules remain consumed after their first reserved occurrence, even after pause/resume. The provider rereads the wall clock, uses deployment-configured polling and interval bounds, stops new admissions during unload, and awaits admitted management or handoff work before closing storage.

**Persistence and bounds.** A caller-owned trigger identity makes creation recoverable after newer control decisions and restart; conflicting definitions reject. Pause/resume uses a control revision so an older action cannot overwrite a newer decision. Explicit handoff recovery compares the occurrence attempt number. Notification acknowledgment is idempotent. Store each trigger's fixed definition, occurrence history, and notices together so reservation, advancement, and notices cannot partially commit. Bound trigger count, complete definition bytes, occurrence count, complete occurrence bytes, and complete responses; capacity stops new admissions without evicting evidence. Do not require an ever-growing management receipt journal to pause work.

**Presentation.** Add a separate trigger page and an optional Work Center contribution for the selected execution. Show the fixed target, source publication or executor revision, interpreted time zone and UTC target, next nominal occurrence, pause state, in-flight or unconfirmed admission, skipped intervals, original run link, failure outcomes, and retained in-app notices with acknowledgment. Explain that admission and execution success are independent and that the Host must remain running. Read errors and disconnected state preserve last-known data. Keep unacknowledged create/control inputs across page remounts; no reconnect automatically resubmits an uncertain user command. Use existing cyber theme tokens, visible focus, bilingual controls, both schemes, and stacked narrow-screen layouts.

**Verification.** Owner tests cover restart, due-time boundaries, clock jumps, pause/resume, missed intervals, selected-source settlement, idempotent native handoff, lost receipts, concurrent commands, capacity, source failures, post-commit observer containment, and teardown. Keyless real-composition scenarios create agent and workflow executions, preserve approval behavior, close/reopen the browser, and demonstrate notices and recovery without duplicate native runs. Browser and runtime tests cover stale reads, retained uncertain input, keyboard interaction, Chinese, light/dark themes, and 320/375/414/768px layouts.

<a id="f10-authenticated-remote-work"></a>

### F10: authenticated native remote work

The authenticated transport, opt-in native receiver, remote execution page and empty-by-default calling composition are recorded by [authenticated native remote admissions](../../implemented/feature/2026-10-21-authenticated-native-remote-admissions.md). The page preserves fixed authority and uncertain input across remounts, reads original native approval context, and requires explicit confirmation for controls.

**User journey.** Select an explicitly configured machine, inspect the authorized remote workspace path and executor/publication, and submit a fixed task. Machine-directory reachability does not authorize execution. Model credentials, tools, file operations, permissions, and logs stay with the remote deployment's native services. The first transport dispatches complete agent tasks and formal workflow publications; it does not transplant local process handles into the remote world.

**Identity and access.** A dedicated versioned machine endpoint requires a credential reference resolved by the calling Host, a pinned remote Host UUID, and a pinned remote principal. The receiver resolves its own bearer references and checks explicit workspace/executor grants in the operation that admits or controls work. Credentials never enter browser props, task content, URLs, durable requests, or result payloads. TLS protects non-loopback traffic; a loopback receiver can be exposed through a secured SSH tunnel or a TLS proxy forwarding only the machine endpoint. Ordinary browser trust fences remain separate from machine authentication. Remote submission does not grant workflow-decision or stop authority unless the principal explicitly has it.

**Durability and recovery.** A remote principal and caller UUID identify a submission. One durable record retains the fixed target and native request identity before handoff; a lost response retains uncertainty instead of asserting failure. Repeated equal creation recovers the retained record; conflicting content rejects. Recover is explicit, compares the recorded attempt, and uses the same native request. Native execution owners retain their existing idempotency, approvals, and session logs. Reconnect and process restart do not automatically repeat an uncertain command. Host identity and principal are checked before any mutation, not merely against its response.

**Observation and controls.** Read only that principal's currently authorized retained submissions. Query status and recorded textual delivery explicitly, with independent unavailable evidence and observation time. Admission, execution success, and human acceptance stay separate. Cancellation does not erase the original run. Workflow decisions name the original run and exact waiting attempt; a lost control acknowledgment requires another authoritative read. The remote deployment retains ordinary agent tool approvals and native review behavior.

**Files and limits.** The remote workspace is an explicitly named remote directory, not a local path to open or upload. No local credentials, directory synchronization, arbitrary remote file browsing, or automatic artifact download is implied. Recorded text output can cross the authenticated protocol; file bytes stay remote in the first version and their native UI owns access. Bound complete requests, retained records, histories, responses, and network time; overflow fails explicitly without evicting evidence. Redirects and origins carrying credentials or URL suffixes reject before sending a bearer.

**Presentation.** A dedicated page shows configured peer identity and credential presence, authorized workspace paths, execution choices, fixed content, submission uncertainty, original remote run/session, status, outputs, and explicit controls. Draft and uncertain request identity survive page remounts; stale reads and offline state never imply task failure. Use the established cyber tokens, bilingual text, both themes, keyboard focus, and narrow layouts. Only configured execution-capable peers are selectable; saved directory-only machines remain explicitly separate.

**Verification.** Exercise real HTTP between isolated Hosts with real native agent/workflow owners and scripted external model responses. Prove wrong token, Host, principal, revoked scope, unauthorized controls, redirects, body/response bounds, and credential rotation cannot bypass enforcement. Prove exactly one native admission across lost responses, concurrent identical submissions, restart, and explicit recovery; check original model input in the remote session log and absence of a local execution. Preserve workflow approval and recorded outputs, and prove denied operations create no native run. Source/HTTP tests do not substitute for the assembled two-Host scenario. The feature remains incomplete until its page and default composition are verified.

<a id="f11-project-knowledge"></a>

### F11: project knowledge directory

The provider, logged model tools, source-management page, and default Web composition are recorded by [explicit project knowledge](../../implemented/feature/2026-10-21-explicit-project-knowledge.md).

**Scope and journey.** The first sources are explicitly selected project-local UTF-8 text, Markdown, and code files. Select a workspace and one relative file path, enable its knowledge grant, explicitly index it, search the enabled corpus, and inspect or copy an exact versioned line citation. No recursive scanning, URL/MCP intake, Office conversion, embedding service, or ambient conversation-history indexing is implied. The complete feature includes a dedicated page; a provider-only milestone remains incomplete.

**Authority.** A source fixes its workspace identity, registered workspace path, canonical filesystem root/target identities, and operator path. The filesystem provider owns resolution, containment, UTF-8 decoding, binary rejection, and current read access. Registration reads metadata; new indexing attempts, search, and citation reads require an enabled grant and a fresh successful bounded text read in the original workspace. A changed workspace mapping, target rebinding, escaped symlink, missing or unreadable file excludes that source with an explicit diagnostic. Disabling is enforced inside the service executor for all subsequent content reads, including historical citations. It does not erase results already committed to earlier session logs. This is a private single-Host grant, not a multi-user ACL.

**Versions and indexing.** Each explicit successful indexing command retains immutable decoded text, SHA-256 of that text, byte count, line count, capture time, and a contiguous version number. Decoding uses the filesystem provider's UTF-8 semantics; the digest is not advertised as a raw-file digest. Split lines on LF, retaining a preceding CR in the captured line. Indexing is a bounded awaited operation, not a durable background job or a fabricated progress percentage. Retain the last completed attempt independently from the latest successful version; a failed reindex never overwrites a successful capture. Caller identities and revision comparisons make retries recoverable without silently indexing newer disk contents. Capacity rejects without evicting retained evidence.

**Retrieval and citations.** Use SQLite FTS5 trigram literal substring matching over the latest enabled captures, with an explicit literal scan for queries shorter than three Unicode characters. Bind values, quote FTS expressions, and return stable source/line ordering without semantic-relevance claims. SQLite is a disposable derived index, not another durable authority. Search reports a bounded hit list, whether more hits exist, excluded sources, observation time, and whether each readable current file differs from its indexed capture. It never silently replaces a stale capture. A citation fixes source ID, capture version, text digest, and inclusive one-based line range; reading it verifies every field and returns the complete selected lines as inert text. Bound complete requests, sources, captures, retained histories, search scope, and responses; refuse an oversized complete result rather than truncate cited evidence. [SQLite FTS5](https://sqlite.org/fts5.html#the_trigram_tokenizer) documents trigram substring matching and the short-query limitation.

**Model input.** Separate model tools search and read citations using the initiating agent's workspace, with no model-supplied cross-workspace authority. Their ordinary tool calls/results preserve exact retrieved material in the session log. Do not inject the directory into all system prompts, infer trusted instructions from source contents, or modify the agent loop/session format. User-controlled files remain task material. The UI may copy a citation for explicit use; opening the page does not consume model tokens.

**Presentation and verification.** Use the established cyber tokens, bilingual labels, light/dark schemes, visible keyboard focus, and stacked narrow layouts. Show enabled state, immutable versions, last attempt, source errors, and independent current-file freshness. Retain uncertain mutations across page remounts; reconnect only refreshes reads. Provider tests cover disable/re-enable, escaped/rebound paths, deleted/unreadable/binary files, changed captures, digest/range rejection, cross-workspace denial, literal Chinese/code queries, restart, concurrent/repeated commands, complete-value bounds, storage failures, and quiescent disposal. A keyless Loader composition must exercise real filesystem/storage and ordinary model tool logging; the completed page additionally requires browser replay, inert previews, keyboard controls, both schemes, Chinese, and 320/375/414/768px layouts. Existing file-delivery registration and third-party memory MCP retain their independent roles.

### End-to-end example and product validation

Use local document organization as the first scenario. A user chooses a workspace, requests a document from specified materials, and names the source scope, output path, and two acceptance criteria. Work Center displays actual queue/execution state. A question opens its original conversation through the attention inbox. After execution the user checks the file and citations, records changes requested, explicitly creates a revision task, and accepts the new delivery. Template saving participates once F04 exists; the F01–F03 release ends at a durable delivery review.

Validate three observable hypotheses: a new user can complete a first delivery, a returning user can discover and handle waiting work, and a recurring task can produce repeated accepted delivery through a template. Interviews and usability walkthroughs use real workspace examples. Simulated clicks and completion-button counts are not substitutes for accomplishing the user's goal. Later code-review and data-report scenarios test code-check evidence and structured outputs respectively.

### Metrics and phase exit criteria

| Metric | Definition and limitations |
|---|---|
| Time to first value | First task configuration begins to first human-accepted delivery; incomplete cases are reported separately rather than hidden |
| Attention response time | Confirmed pending interaction to committed valid answer/decision, for records with complete timestamp evidence |
| Human acceptance rate | Accepted delivery versions / delivery versions with human review decisions; unreviewed versions remain separate from execution success |
| Execution success rate | Successful settled runs / all settled runs, separately per source; show cancellation and interruption categories explicitly |
| Template reuse | Tasks created from saved templates, subsequent acceptance results, and distinct reuse occurrences; opening a template is not reuse |
| Consumption | Sourced token and duration measures; missing values are not zero, and incomplete metering or absent pricing cannot produce definite costs |

Establish a baseline before setting growth or quality targets; invent no improvement percentages. Aggregate locally by default. Any external telemetry needs separately explained purpose and controls. P0 exits when the document-organization journey works through the real assembled application, including failure paths. P1 adds reuse and scalable reads after reliable intake/review. Each P2 capability separately validates demand, deployment, and responsibility for continuous operation; an existing catalog or reminder tool does not establish support.

### Implementation constraints and independent delivery units

Split work into aggregate reads/Work Center → briefs/intake → delivery/review records → template reuse. New capabilities compose Service Definition, Provider, and Consumer roles through plugin extension points; page entry points do not require agent-loop changes. Storage domains, Remote commands, and client plugins own persistence, validation, and presentation respectively.

Reviews and templates are new versioned business data with revision checks. Session logs remain authoritative for model input and execution facts. New model-visible input must be reconstructable from logs. Define pagination and source failures before UI counts. Work Center does not widen read authorization. Multi-user or remote aggregation requires corresponding access controls and execution providers first.

The [Task Surface proposal](2026-08-04-task-surface.md) continues to own temporary structured conversation interaction. This proposal owns work organization and delivery review across executions; neither replaces the other. The [agent task inspection note](../../implemented/feature/2026-10-20-workbench-agent-task-inspection.md) retains per-identity history and draft rules; global aggregation and durable briefs are additional scope. Existing workflow publication, approval, acceptance, session search, and third-party memory mechanisms retain their owners rather than gaining parallel implementations.

### External product evidence

GitHub's official flow combines task entry, execution tracking, and output review. This proposal borrows that journey without implying an existing GitHub integration. [GitHub documentation](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github)

LangGraph documents persistent interruption and resumption for human involvement. This supports requiring a persistence protocol for background waiting and recovery rather than browser-only notices. [LangGraph interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)

## Acceptance criteria

These requirements apply to future implementation; they do not claim the features are delivered.

1. F01 lists tasks from two independent agents and workflow executions in one workspace. Cross-source IDs cannot collide; filtering, pagination, and source-failure states work, and ordinary conversation attention opens the original interaction.
2. After another page settles an approval, a stale page cannot approve again. Disconnection exposes unconfirmed freshness, reconnect converges on authoritative data, and unavailable sources cannot imply no pending work.
3. F02 provides actionable failures for missing workspaces, archived identities, unavailable runtimes, mismatched models, and missing skills. Rejected submission retains inputs, repeated transport creates one run, and actual model input matches the visible brief and log reconstruction.
4. F03 keeps execution success, automatic assertions, and human review independent. Missing/inaccessible files, model-only check claims, and current files without historical snapshots are not presented as verified historical deliveries.
5. Requested changes bind to the original delivery; saving feedback does not execute work. Explicit revision-task creation links old/new runs, and review records survive browser refresh and Host restart.
6. F01–F03 provide visible focus, keyboard navigation, reduced motion, and both schemes, with primary actions visible and no page overflow at 320/375/414/768px and desktop widths.
7. Service behavior has boundary/lifecycle tests. Keyless browser snapshots use the real composition to cover the initial journey, invalid inputs, and stale decisions. Changes involving actual model behavior additionally exercise real providers. Update TypeScript/Python SDKs when corresponding log or lifecycle interfaces change.
8. F04–F12 receive their own detailed PRDs and required providers before implementation. Unfinished features remain explicitly unavailable rather than shipping empty clickable controls or fabricated metrics.

## Risks

- Global reads amplify history-download and log-reading costs; use bounded reads, explainable pagination, and on-demand details.
- A successful readiness check can be mistaken for lasting availability; disclose its timestamp/scope and revalidate at execution.
- Human review records opinion rather than proving external business effects; retain check evidence separately from judgment.
- Retrying or rerunning can repeat external side effects. Show full-rerun and configuration choices; do not promise arbitrary node resumption or exactly-once execution.
- Local paths, task background, and MCP configuration can contain sensitive material. Templates, sharing, and remote capabilities need explicit source permissions and credential-reference rules.
- Validate the target audience and first scenario through interviews. If use concentrates on infrastructure development, prioritize developer diagnostics/extensions and reassess workbench investment.

## Alternatives considered

- Expand dashboards alone: improves visibility without task criteria, actionable attention, or delivery review.
- Begin with collaboration and a marketplace: requires identity, authorization, publication review, and distribution before validating users and governance needs.
- Unify agent runs, workflow runs, and chat under another mutable task state machine: obscures their lifecycles and duplicates facts; use typed aggregate reads and independent review records.
- Automatically resume failed nodes: risks repeating external side effects; retain explicit new runs until side-effect, idempotency, and checkpoint rules exist.
