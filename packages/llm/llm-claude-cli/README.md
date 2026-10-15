# @deepseek-ai/dsh-llm-claude-cli

English | [中文](README.zh.md)

Local Claude CLI and Codex CLI runtimes for the DeepSeek Harness LLM seam. The plugin detects installed commands and registers their provider routes without reading or writing `settings.yaml`. Each subprocess inherits the selected CLI's user authentication, native configuration, and runtime integrations. The active profile's `cordis.yml` entry remains an optional deployment override for the executable, provider id, environment, timeout, retry policy, and fallback catalog.

- **`claude`** ({@link ClaudeCliAdapter}, provider `claude-cli` by default): starts one `claude -p --output-format stream-json` subprocess per request. Harness tools are exposed through the package's schema-only MCP bridge, Claude's built-in tools are disabled, and the process stops after the first assistant frame so the harness continues to own tool execution and approval. The subprocess runs in the session cwd when one is available, so Claude's native user and project configuration apply.
- **`codex`** ({@link CodexCliAdapter}, provider `codex-cli` by default): starts one `codex app-server --listen stdio://` subprocess per request and drives `initialize` → `thread/start` → `turn/start` → `turn/completed`. It inherits the user's Codex login, `config.toml`, MCP servers, skills, and native agent tools. The request cwd and harness sandbox policy apply to the ephemeral thread. Commands, file changes, web searches, MCP or dynamic tool calls, and agent collaboration are retained as provider-neutral trajectory interactions.

An installed default command activates its route with no plugin configuration. Explicit driver fields only override that runtime. Codex model discovery calls the installed app-server's `model/list`, so model ids, names, modalities, and reasoning efforts follow the running CLI configuration; the configured catalog is only fallback metadata when a model omits a field. Claude retains its configured fallback catalog because stream-json has no equivalent model-list method. Claude defaults `timeoutMs` to 300000. Codex has no default wall-clock deadline because one request can contain a complete native Agent run; deployments may set a positive `codex.timeoutMs` when they require a bound. Both drivers use normal retry mode with five retries by default.

Every request is stateless at the CLI-session level. The harness replays conversation history from its durable session log, while Codex uses an ephemeral app-server thread and Claude uses a fresh print-mode process. `attributionHeaders()` does not apply because both transports are local subprocesses rather than provider HTTP requests.

## Model Experience

### CLI subprocess request

#### What the model sees

Both models receive the harness system instructions and folded durable conversation history. Claude additionally receives harness tool schemas through the schema-only MCP bridge. Codex receives the native CLI runtime environment selected by its user configuration, including enabled tools, skills, MCP servers, and project instructions, constrained by the harness-provided cwd, sandbox mode, and no-approval policy.

#### Token effect

Provider tokenization determines the exact input. The harness sends the complete folded durable history on every request; native CLI configuration may add provider-owned context that is not tokenized by this package.

#### KV Cache effect

The harness does not assemble the provider wire. Provider-side cache reuse is owned by the CLI and its backend; Codex cached input is translated into disjoint `inputTokens` and `cacheReadTokens` counts.

### CLI subprocess response

#### What the model sees

Claude `thinking` blocks become harness `reasoning` blocks. Codex requests a `detailed` reasoning summary and translates `item/reasoning/summaryTextDelta` plus the completed item's public `summary` into the same block type. Raw Codex reasoning content is deliberately ignored. Text and reasoning appear in the conversation; Codex's native tool and Agent activity appears in Trajectory and does not enter later model history as assistant content.

#### Token effect

Usage metadata is translated from the CLI protocol. No synthetic token counts are added.

#### KV Cache effect

Provider-reported cache fields are retained only through the translated usage values described above.

## Known Limitations and Deferred Work

- **Codex exposes reasoning summaries, not private chain of thought** — the app-server provides summary notifications when requested; raw reasoning tokens are not a supported display surface.
- **Native CLI configuration is ambient state** — authentication, MCP servers, skills, and project configuration can change outside the harness. Each new subprocess observes the current runtime state, while a running request keeps the state with which it started.
- **Claude's shell-function wrappers are not spawnable** — `command` resolves through child-process spawning; a shell function needs its underlying executable path in the active profile's plugin config.
