# Agent Note: Native CLI configuration, reasoning summaries, and agent trajectory records

Status: implemented

English | [中文](2026-10-14-native-cli-reasoning-and-agent-trajectory.zh.md)

## Problem

The local CLI adapter treated Harness `settings.yaml` as a second control plane for runtimes that already own login, model selection, MCP servers, skills, and project configuration. The Codex adapter also converted Harness tools through a one-turn bridge, so native Codex agent work was neither executed by its own runtime nor visible in Trajectory. Reasoning text was already representable in the session log and Chat, but the Codex bridge did not request or translate the app-server reasoning summaries that the product can expose.

## Decision

Local CLI providers use the installed runtime's ambient configuration. Mounting `@deepseek-ai/dsh-llm-claude-cli` registers every installed supported CLI; its configurable-provider entries use an empty settings namespace and path, while Cordis profile configuration remains available for deployment composition. Claude runs in the request working directory. Codex app-server inherits the launching environment and normal Codex home, reads its model catalog through `model/list`, starts an ephemeral thread in the request working directory, and uses the request's sandbox with `approvalPolicy: never`. The client rejects unexpected server requests instead of manufacturing a generic approval response.

Codex requests detailed reasoning summaries and maps only `item/reasoning/summaryTextDelta` plus a completed reasoning item's `summary` into Harness reasoning blocks. Raw reasoning content is ignored. This preserves provider disclosure rules: Chat can display the summary text that Codex emits, but the adapter does not claim access to hidden chain-of-thought.

Codex native command, file-change, web-search, MCP/dynamic-tool, collaboration, and subagent items project to provider-neutral `AgentInteraction` records on the terminal `StreamChunk`. The session log retains those records with the finish chunk, the conversation projection keeps them beside the finalized Assistant node, and Trajectory expands them into Agent rows with status, details, and timing. They are diagnostic records, not assistant message content, and never enter a later model request.

This note partially supersedes the `settings.yaml` and private-`CODEX_HOME` ownership described in [the artifact-carried Codex runtime note](../architecture/2026-09-24-llm-claude-cli-codex-runtime.md), and the local-runtime override channel described in [the runtime-presence note](../architecture/2026-09-25-local-runtime-presence.md). Those notes remain active for package recovery and presence probing. The existing [Trajectory inspection ledger](2026-07-27-trajectory-inspection-ledger.md) remains the presentation authority; this decision adds a provider-side Agent record source.

## Alternatives considered

- **Keep `settings.yaml` as an override for command, model catalog, and CLI home.** Rejected because it duplicates runtime-owned state and prevents project-local configuration from following the request working directory.
- **Continue exposing Harness tools to Codex through a synthetic MCP bridge.** Rejected because one model call then represents only one delegated tool step, while app-server already owns shell, MCP, skills, and child-agent execution with richer lifecycle events.
- **Render completed Codex reasoning content as raw chain-of-thought.** Rejected because app-server exposes reasoning summaries for display; undisclosed raw reasoning is not a product surface.
- **Flatten native Agent activity into Assistant prose.** Rejected because commands, file changes, tools, and child-agent exchanges need independent status and timing without becoming model-visible history.

## Consequences

Local CLI behavior follows the corresponding CLI's login and configuration without requiring a settings section. Codex model discovery and turn execution now use the same native runtime state. Sessions preserve displayable Codex reasoning summaries and provider-side Agent activity, and Trajectory exposes each interaction as an inspectable row. A provider that does not emit interactions remains unchanged. Because the package remains artifact-carried, its runtime implementation is maintained in `lib/types/` and rebundled into `lib/index.js` until source reconstruction replaces that package-specific process.
