# Agent Note: Native CLI configuration, reasoning summaries, and agent trajectory records

Status: implemented

English | [中文](2026-10-14-native-cli-reasoning-and-agent-trajectory.zh.md)

## Problem

The local CLI adapter treated Harness `settings.yaml` as a second control plane for runtimes that already own login, model selection, MCP servers, skills, and project configuration. The Codex adapter also converted Harness tools through a one-turn bridge, so native Codex agent work was neither executed by its own runtime nor visible in Trajectory. Reasoning text was already representable in the session log and Chat, but the Codex bridge did not request or translate the app-server reasoning summaries that the product can expose.

## Decision

Local CLI providers use the installed runtime's ambient configuration. Mounting `@deepseek-ai/dsh-llm-claude-cli` registers every installed supported CLI; its configurable-provider entries use an empty settings namespace and path, while Cordis profile configuration remains available for deployment composition. Claude runs in the request working directory. Codex app-server inherits the launching environment and normal Codex home, reads its model catalog through `model/list`, starts an ephemeral thread in the request working directory, and uses the request's sandbox with `approvalPolicy: never`. The client rejects unexpected server requests instead of manufacturing a generic approval response.

Mounting `@deepseek-ai/dsh-llm-cursor-cli` always declares the `cursor-cli` configurable route and activates it when `cursor-agent` resolves in the Host subprocess world. Each request starts a fresh print-mode process, folds the durable Harness conversation into one stdin prompt, and translates Cursor stream-json output. Cursor retains its login, model configuration, native tools, and permission behavior; Harness sandbox modes select Cursor ask mode or its sandbox and force flags, but Harness tool schemas and approvals do not mediate native work. Read-only and policy-free requests pass workspace trust while remaining in sandboxed ask mode so a headless process cannot stop at Cursor's trust prompt; write-capable requests use the corresponding force mode. Response content remains buffered until a successful result because Cursor may replay a completed assistant attempt before a connection retry. Native command, file, search, tool, and child-agent events become the same provider-neutral `AgentInteraction` records used by Codex.

Codex requests detailed reasoning summaries and maps only `item/reasoning/summaryTextDelta` plus a completed reasoning item's `summary` into Harness reasoning blocks. Raw reasoning content is ignored. This preserves provider disclosure rules: Chat can display the summary text that Codex emits, but the adapter does not claim access to hidden chain-of-thought.

Codex native command, file-change, web-search, MCP/dynamic-tool, collaboration, and subagent items project to provider-neutral `AgentInteraction` records on the terminal `StreamChunk`. The session log retains those records with the finish chunk, the conversation projection keeps them beside the finalized Assistant node, and Trajectory expands them into Agent rows with status, details, and timing. They are diagnostic records, not assistant message content, and never enter a later model request.

This note partially supersedes the `settings.yaml` and private-`CODEX_HOME` ownership described in [the artifact-carried Codex runtime note](../architecture/2026-09-24-llm-claude-cli-codex-runtime.md), and the local-runtime override channel described in [the runtime-presence note](../architecture/2026-09-25-local-runtime-presence.md). Those notes remain active for package recovery and presence probing. The existing [Trajectory inspection ledger](2026-07-27-trajectory-inspection-ledger.md) remains the presentation authority; this decision adds a provider-side Agent record source.

## Alternatives considered

- **Keep `settings.yaml` as an override for command, model catalog, and CLI home.** Rejected because it duplicates runtime-owned state and prevents project-local configuration from following the request working directory.
- **Continue exposing Harness tools to Codex through a synthetic MCP bridge.** Rejected because one model call then represents only one delegated tool step, while app-server already owns shell, MCP, skills, and child-agent execution with richer lifecycle events.
- **Expose Cursor as a text-only adapter or translate its native activity into Harness tool calls.** Rejected because print mode owns the complete native loop and exposes observations rather than a protocol that lets Harness execute each call; claiming Harness mediation would misrepresent its permission and sandbox behavior.
- **Use the Cursor ACP subagent provider as the model route.** Rejected because subagent delegation and `ctx.llm` routing have different lifecycle and history ownership. The runtime must replay the current Harness conversation and return provider-neutral stream chunks.
- **Render completed Codex reasoning content as raw chain-of-thought.** Rejected because app-server exposes reasoning summaries for display; undisclosed raw reasoning is not a product surface.
- **Flatten native Agent activity into Assistant prose.** Rejected because commands, file changes, tools, and child-agent exchanges need independent status and timing without becoming model-visible history.

## Consequences

Local CLI behavior follows the corresponding CLI's login and configuration without requiring a settings section. Codex and Cursor model discovery and turn execution use their native runtime state. Sessions preserve displayable reasoning and provider-side Agent activity, and Trajectory exposes each interaction as an inspectable row. Cursor gains a normal model route, but its native tools remain outside Harness tool policy and every request replays the complete durable history into a fresh CLI session. A provider that does not emit interactions remains unchanged. Because `llm-claude-cli` remains artifact-carried, its runtime implementation is maintained in `lib/types/` and rebundled into `lib/index.js` until source reconstruction replaces that package-specific process.
