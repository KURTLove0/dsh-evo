# dsh-workbench-agent

English | [中文](README.zh.md)

Independent workbench collaborators, with a replaceable service, native Harness provider, and typed Remote consumer. Agent identities, editable configuration, and run history live in the versioned `workbench_agents` storage domain. Plugin-composition [presets](../../preset/agent-presets/README.md) remain a separate feature.

## Configuration and execution

`runtimePreset` is required: it provisions the deployment's native tools, never identifies a workbench agent. Capacity defaults are 200 identities, 10,000 runs, eight active runs, six concurrent tasks per new identity, and 1 MiB per serialized record. All are configurable. The directory exposes the effective concurrency defaults and ceiling. `mcpToolCallTimeoutMs` bounds identity-owned MCP tool calls and defaults to 60,000 ms.

Names are unique, including archived identities. Edits compare the captured revision; conflicts reject without overwriting another editor. Copies receive new identities and empty histories. Archive preserves history, rejects new tasks, and cancels unfinished work; restore re-enables assignment.

Each submitted task receives a durable queued record and an independently owned session. The scheduler enforces global and per-agent concurrency and serializes tasks sharing a workspace directory. Free-text tasks capture configuration when starting execution; structured briefs capture it atomically at submission, so later edits cannot change checked work. A run covers its submitted message through whole-agent idle, including any follow-up or steering delivered during that interval. Stop immediately aborts the owned execution, then persists cancellation before acknowledging the command; its capacity remains occupied until cleanup completes. Retry creates a new record using the current configuration.

Instructions and selected skill bodies enter the session through logged context messages. Description and avatar are display-only. Missing or non-user-invocable skills fail execution explicitly. The runtime field names a declared local provider service. Execution uses that service with its declared native default or a model override whose provider must match the selected service. Missing services and undeclared defaults fail explicitly; the global default model is never substituted. Transcript persistence must succeed before completion is reported. Host restart marks running records interrupted; queued tasks remain eligible. Provider teardown cancels and drains live sessions before closing storage.

`capabilities(workspaceId)` discovers user-invocable skills from the configured runtime's standing scope and the selected project directory, without creating an identity, session, or model turn. Execution resolves those names through the task agent's inherited scope, so project and preset skills selected in the editor remain available to the task.

Each definition includes `mcpServers`. Stdio entries supply a name, command, argument array, and named environment values; Streamable HTTP entries supply a name, HTTP(S) URL, and named headers. Names are unique within the definition. Variables and headers reject duplicate names, and headers compare names without case. Task startup mounts the existing MCP client plugin under the task's scope and awaits every connection before publishing the agent. Stdio uses the task workspace and a scrubbed parent environment plus explicit values. A failed required connection rolls back all earlier connections and fails the run before a model request. Completion, cancellation, and teardown close the task's connections; independent tasks can reuse the same server names.

MCP environment and header values are stored in the host domain, captured in run definitions, and copied with the identity. They are returned to configuration consumers, but excluded from model context and the history summary. The browser masks their input values. The storage domain is version 5; older data is rejected rather than migrated.

AI design tasks run with no tools, request a complete configuration as strict JSON, and retain the validated candidate in history. Only an explicit subsequent Save changes the identity; malformed candidates fail the design run. The Remote API uses the same service operations as other consumers.

`runtimes()` reads local services from the same LLM provider directory used by Runtimes, including availability, advisory models, and provider-declared defaults. A catalog failure is displayed against its service. API providers without a local command are excluded.

## Structured task submission

`preflight` checks the explicit workspace, executor archive/revision, local runtime and model route, and selected user-invocable skills without creating a session, calling a model, or connecting MCP. It returns a timestamp, dependency issues, MCP names marked `not-checked`, and the canonical prompt when a brief is supplied. `submit-task` repeats dependency and revision checks, then atomically stores `TaskBrief`, the submitted configuration, and a nonempty `TaskRequestId` with the queued run. An identical request returns its original receipt across retries and restart; reusing its ID with different fields rejects. A stale configuration revision rejects. `revisionOf` names a settled run of the same agent and workspace. Retry retains structured criteria and file declarations with a fresh request identity and current configuration.

`queryRuns` filters before pagination and caps `limit` through `maxRunPageSize` (100). Running tasks with a connection-observed `attentionSessionIds` entry come first; other tasks follow by descending `updatedAt` and id. `attentionOnly` restricts results to those pending tasks. Summary `updatedAt` is the latest creation, start, or settlement timestamp. Each page and continuation carries `AgentRunRevision`; any committed run mutation or host restart invalidates earlier continuations, requiring refresh. Summaries exclude captured definitions, candidates, and MCP credential values. `inspectRun` additionally returns sanitized captured configuration. `settledSeq` identifies the durable end of this task's execution interval, so delivery inspection excludes subsequent conversation messages.

`queryRuns` additionally filters `agentId` and inclusive `createdFrom` / exclusive `createdBefore` submission timestamps before sorting and pagination. Supplied time bounds must be finite and increasing. These fields select retained executions, including archived identities; they do not reinterpret completion times as submission times.

Task briefs optionally retain the source template ID and content version. The public `./brief` decoder is shared with private template storage; loading or editing a template does not bypass submission checks.

## Full retry identity

`retry` requires a nonempty `requestId` and `expectedRevision` for a failed, cancelled, or interrupted run. Admission repeats dependency checks and captures the confirmed current configuration, including for free-form tasks. Structured retries retain the brief, template, and revision origin. `retryOf` and `retryRequest` durably identify the source and confirmed revision. Identical requests return the original receipt before current configuration or archive checks, including after restart; conflicting reuse with another run, revision, or ordinary submission rejects. Uncertain clients explicitly recover the same request rather than allocate another identity.

## Model Experience

### Task context

#### What the model sees

A logged user-role context begins with `Agent: {name}`, `Identity: {id}`, and `Revision: {revision}`, followed by instructions and each selected `Skill: {name}` rendered through the skill service's canonical `skill_content` block, including resource-base guidance for referenced scripts and files. The submitted task follows as its own message. Preflight preview and submission share one formatter. Display descriptions are excluded. Connected MCP tools join the scoped tool directory; environment and header values are not injected. A structured brief includes empty optional sections.

##### Structured task brief

```markdown
Goal:
{goal}

Background:
{background}

Expected deliverables:
{one file path per line}

Acceptance criteria:
{one criterion per line}

Constraints:
{constraints}
```


#### Token effect

One context message per task session; its token cost grows with the instructions and loaded skill bodies. MCP tool schemas add the bridge's normal tool-directory cost. Transcript replay preserves the captured text.

#### KV Cache effect

Each task establishes an independent request prefix. Instructions, skills, model, or runtime composition changes affect new starts; they do not rewrite existing transcripts.

### Configuration design

#### What the model sees

The builder receives the following instruction, followed by the generated configuration JSON Schema and the user's design request.

##### Builder instruction

```markdown
Design an agent configuration from the user's request. Return ONLY a JSON object matching this schema. Keep runtime {selected runtime}. Keep its model provider unchanged. Suggest no skills unless the user names them. Do not execute tasks. The result is a draft for human review.
```

#### Token effect

An independent design request adds the builder instruction, configuration JSON Schema, and user request. Its tool allowlist is empty.

#### KV Cache effect

Design uses an independent session and does not alter a task session's reusable prefix.

## Known Limitations and Deferred Work

- Local execution uses the current host’s registered CLI providers. Remote runtime execution, per-identity runtime environment/argument management, multi-user Access rules, issues, mentions, squads, and scheduled triggers require their own providers and product capabilities.
- Identity creation is manual; AI design operates on a saved identity and returns a reviewable candidate.
- Queued and interrupted records retain task text and snapshots; capacity rejects new tasks rather than deleting history automatically.
