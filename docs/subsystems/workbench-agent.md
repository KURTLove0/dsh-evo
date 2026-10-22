# Workbench agents

English | [中文](workbench-agent.zh.md)

Independent collaborator identities and execution history are owned by [dsh-workbench-agent](../../packages/business/workbench-agent/README.md); the browser consumer is [ui-workbench-agent](../../packages/client/ui-workbench-agent/README.md). Plugin presets remain deployment-owned composition, separate from collaborator identity.

`WorkbenchAgents.snapshot()` reads the directory, workload, runtime availability, concurrency limits, and selected history. `command()` creates, revision-checks saves, copies, archives, restores, submits tasks, designs configuration candidates, stops, and retries. Run records retain their identity and captured configuration across later edits. The native provider owns persistence, scheduling, transcript sessions, and teardown.

Structured `TaskBrief` stores goal, background, file declarations, acceptance criteria, and constraints with the run. `TaskPreflight` returns dependency issues, an executor revision, unchecked MCP names, and optional exact prompt preview. `TaskRequestId` makes structured submission idempotent. `AgentRunQuery` and `AgentRunPage` provide bounded sanitized summaries; `AgentRunPosition` orders attention before descending execution updates, while `AgentRunRevision` rejects continuations after committed run changes or host restart. Summary `updatedAt` derives from creation, start, and settlement. `AgentRunSummary` excludes captured definitions and candidates, with optional sanitized inspection configuration. Runs retain optional submission, revision origin, and durable settlement sequence. See [Work Center](work-center.md) for delivery inspection and independent acceptance.

`AgentRunQuery` filters `agentId` and inclusive `createdFrom` / exclusive `createdBefore` submission times before pagination; these are independent of execution update ordering.

## WorkbenchAgentId

Stable branded collaborator identity, independent of preset ids.

## AgentRunId

Branded identity for one submitted task or design request.

## AgentDefinition

Editable name, avatar, display-only description, instructions, native runtime, optional model route and reasoning effort, skill names, MCP servers, up to three labelled starter prompts, and a positive concurrency limit.

## AgentMcpServer

A named task-owned stdio connection with a command, arguments, and environment values, or a Streamable HTTP connection with an HTTP(S) endpoint and headers. Stdio uses the task workspace as its working directory.

## AgentMcpVariable

A name and value used for one explicitly supplied environment variable or HTTP header.

## AgentCapabilities

User-invocable skill names, descriptions, and sources discovered through the configured runtime and selected workspace before identity creation.

## WorkbenchAgent

An AgentDefinition plus stable id, revision, archived flag, and creation and update timestamps. Edits compare the expected revision; copying creates another identity.

## AgentRun

Task text, owning identity, workspace and session ids, timestamps, status, optional captured definition, error, retry origin, design purpose, and generated candidate. Status is queued, running, completed, failed, cancelled, or interrupted.

## AgentCommand

Create and save accept a definition; copy supplies a new name; archive and save require revisions; run and design supply a workspace and prompt; stop names an existing run; retry additionally requires a caller-owned `TaskRequestId` and confirmed current `expectedRevision`. `AgentRun.retryRequest` durably associates the request with its captured configuration revision.

## AgentReceipt

The committed agent id and optional run id. A receipt acknowledges persistence, not execution completion.

## AgentDirectory

Committed identities, selected run history, per-identity running and queued counts, native runtime availability, and effective concurrency defaults and limits.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxworkbenchagents--workbenchagents-abstract-seam"></a>

### `ctx.workbenchAgents` — `WorkbenchAgents` (abstract seam)

Providers commit mutations before notifying directory consumers.

```ts cordis-catalog
/**
 * Read identities, workload, and one identity's history.
 * @param id - omit to read only directory and workload.
 * @returns detached committed data.
 */
abstract snapshot(id?: WorkbenchAgentId): Promise<AgentDirectory>

/**
 * Manage identities or submit, retry, or cancel a task.
 * @param command - operation with an expected revision for edits.
 * @returns committed identities; execution remains host-owned.
 */
abstract command(command: AgentCommand): Promise<AgentReceipt>

/**
 * Discover local CLI services from the live provider directory.
 * @returns declared local routes, native defaults, model choices, and availability.
 */
abstract runtimes(): Promise<AgentRuntime[]>

/**
 * Discover selectable skills through the deployment composition in a workspace.
 * @param workspaceId - workspace whose project and deployment skills are merged.
 * @returns user-invocable skill summaries without creating an agent or session.
 */
abstract capabilities(workspaceId: WorkspaceId): Promise<AgentCapabilities>

/**
 * Read a bounded cross-identity history page, excluding captured credentials.
 * @param request - generation-scoped attention/update cursor, optional workspace, and explicit page limit.
 * @returns detached run summaries and continuation position.
 */
abstract queryRuns(request: AgentRunQuery): Promise<AgentRunPage>

/**
 * Read one committed run without captured credentials.
 * @param id - original execution identity.
 * @returns detached run summary; unknown identities reject.
 */
abstract inspectRun(id: AgentRunId): Promise<AgentRunSummary>

/**
 * Check current task dependencies without executing work or probing MCP.
 * @param request - selected identity and workspace.
 * @returns timestamped issues, captured revision, and unchecked MCP names.
 */
abstract preflight(request: { id: WorkbenchAgentId; workspaceId: WorkspaceId; brief?: TaskBrief }): Promise<TaskPreflight>
```

Types: [WorkspaceId](workspace.md)

Source: [`packages/business/workbench-agent/src/service.ts`](../../packages/business/workbench-agent/src/service.ts)

<a id="workbench-agent-events"></a>

### `workbench-agent/*` events

<a id="workbench-agentchanged--emit"></a>

#### `workbench-agent/changed` — emit

A directory record or execution status committed.

```ts cordis-catalog
/**
 * A directory record or execution status committed.
 * @mode emit
 * @param id - affected stable agent identity.
 */
'workbench-agent/changed'(id: WorkbenchAgentId): void
```

Source: [`packages/business/workbench-agent/src/types.ts`](../../packages/business/workbench-agent/src/types.ts)
<!-- END GENERATED cordis-surface -->
