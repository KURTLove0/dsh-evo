# Agent Note: Business-agent composition from prompts, skills, and MCP

Status: implemented

English | [中文](2026-10-20-business-agent-composition.zh.md)

## Problem

A reusable business identity needs its instructions, selected skills, and external tools to execute together. Discovering a project skill through a preset and loading it through an unrelated Context object gives different catalogs. Process-global MCP namespace reservations also prevent independent identities from using the same business connection name. Finally, removing an owned execution from the live registry must not hide its workspace-retained transcript.

## Decision

The workbench-agent definition owns MCP transport configuration alongside prompt instructions and skill names. Creation and editing use one schema and one Save operation. Capability discovery reads the configured preset's standing scope; execution reads the actual agent's scope, which inherits that preset. Discovery creates no session or model turn. The browser retains explicit names that another workspace cannot resolve, while execution rejects missing capabilities.

Each task mounts the existing MCP client plugin under its agent scope and waits for all required servers before publication. The agent factory owns rollback and quiescent disposal, including connections established before a later server fails. Stdio receives the task workspace and explicit environment values over the existing scrubbed environment; HTTP receives explicit headers. The deployment owns the MCP tool timeout. Configuration values remain in host storage and run snapshots, and are not inserted into model context. The domain uses version 3 and rejects older data.

An identity's runtime names a local provider in the same directory used by Runtimes. The provider declares its native default model; an override must name that provider, and a missing default requires an explicit choice. Execution rechecks the service and resolves this selection before creating the agent. Neither unavailable services nor defaults fall back to the deployment's global model. The browser pairs runtime and model selectors and clears the override when the service changes.

The base bundle includes an installed-command Codex model provider. It uses the shared subprocess and JSON-RPC services, discovers models through app-server, and executes ephemeral native threads with the task cwd and sandbox policy. It downloads no Codex wrapper. Native integrations follow Codex configuration; Harness MCP connections remain scope-owned, while the Codex adapter does not install their schemas as native dynamic tools.

MCP namespace reservations use the registration scope, with the app root for unscoped instances. A duplicate still fails within a scope; independent tasks may reuse a name and keep deterministic public tool names. This refines the namespace scope in the [MCP client decision](2026-07-07-mcp-client-plugin.md), retaining that note's transport, naming, reconnection, and output guarantees.

The Host stream derives retained session membership from the workspace registry. Disposing a workspace-owned activation emits idle status rather than removal, keeping completed task transcripts selectable. Unattached sessions retain removal semantics.

## Alternatives considered

**Only save MCP JSON.** Displaying configuration without mounting it leaves the business agent unable to use its declared tools and delays configuration errors until an unrelated consumer encounters them.

**Install identity connections globally.** Global tools expose one identity's business capabilities to other agents and collide when multiple identities use the same names. Execution ownership makes disposal and credentials independent.

**Treat runtime as a display label over a global model selection.** Saving a service label while dispatching another provider makes the selected runtime ineffective. Persisting the route and checking model ownership binds the configuration to execution.

**Generate a unique tool namespace for every task.** Run-specific names avoid a global reservation conflict but change tool names across otherwise identical executions and make permission policies unstable. Scope-local reservations match the existing ToolRuntime registration model.

**Remove every disposed session from the browser.** Live residency is insufficient evidence for deleting workspace-retained history. Workspace ownership supplies the committed relationship without reviving an agent or adding a wire format.

## Consequences

Users construct and save business agents through prompt, skill, and MCP fields in the initial creation form. Required connection failures prevent model execution, and finishing or stopping a task releases its connections. MCP environment and header values are host configuration data and are copied with definitions; they are not a separate credential vault. Existing task-composer and history ownership remains in the [task inspection decision](2026-10-20-workbench-agent-task-inspection.md).

## Verification

Provider tests drive real stdio and HTTP MCP connections through the Loader-backed workbench, inspect model context and durable tool results, read a customer report from disk, and verify independent same-name connections and rollback. UI tests cover creation with skills and both MCP transports. A keyless shipped-app browser scenario creates the identity, loads a project skill, executes the real MCP process against customer records, verifies the report and transcript, and snapshots creation and captured configuration. Its model responses are scripted; no real-model behavior is claimed.

Native runtime tests cover service binding, model ownership, provider defaults, malformed protocol data, catalog discovery, cancellation, and process cleanup. An opt-in read-only Codex inference validates the installed CLI's authentication and execution path. A browser preview reads its real model catalog and checks the Chinese creation window at desktop and narrow viewport widths.
