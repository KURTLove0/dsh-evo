# @deepseek-ai/dsh-llm-claude-cli

English | [中文](README.zh.md)

Local-CLI-backed LLM runtimes for the DeepSeek Harness LLM seam. One plugin, two CLI drivers, one shared contract: the CLI process is the model transport only — tool execution, approval, and logging stay on the harness side; the CLI's own agentic loop never runs; every call replays its history from the session log (no CLI-side session resume).

- **`claude`** ({@link ClaudeCliAdapter}, provider `claude-cli` by default): one `claude -p --output-format stream-json` subprocess per call. The conversation folds into a single stdin user frame; the process tree is killed at the first assistant frame (single-turn truncation), so tool calls it emits are executed by the harness, not by the CLI. Tools are exposed through the package's own schema-only MCP bridge (`./mcp-server`), and `--tools ""` removes the CLI's built-in tools from existence.
- **`codex`** ({@link CodexCliAdapter}, provider `codex-cli` by default): one `codex app-server --listen stdio://` JSON-RPC subprocess per call, driven through the initialize → thread/start → turn/start → turn/completed lifecycle. A private per-call `CODEX_HOME` (with a rendered `config.toml` `[mcp_servers.dsh]`) isolates the harness-managed session from the user's `~/.codex`, which also isolates authentication: deployment credentials must arrive through the driver config's `env` (API key) or `extraArgs` (`-c provider` overrides) — the interactive ChatGPT login state is not available.

The plugin layers its `cordis.yml` entry config under the optional `llm-claude-cli` user-settings section (`ctx.settings`): a changed command, catalog, or timeout reaches the very next request without restarting anything, and a `codex:` section appearing (or disappearing) activates (or deactivates) the codex route in place, while an in-flight stream keeps the facts it started with. The claude route registers whenever mounted (dormant catalog entry included); the codex route registers when its section is present or when a codex CLI is detected on this machine — detection alone activates with the driver defaults, and an explicit `codex:` section only ever overrides them (command, catalog, timeout), so a usable codex runtime never requires a `settings.yaml` entry. `retryPolicy` defaults to normal mode with five retries; both drivers default `timeoutMs` to 300000 and `contextWindow` to 200000. An advisory `models` catalog (e.g. `gpt-5-codex` for codex, `sonnet`/`opus`/`haiku` for claude) feeds discovery consumers; requests themselves stay unrestricted.

`attributionHeaders()` does not apply to either driver: the transport is a local subprocess, not a provider HTTP request.

## Model Experience

### CLI subprocess request

#### What the model sees

The selected CLI-backed model receives the harness system prompt, folded message history (one stdin user frame per call), and the MCP schema bridge's tool schemas without adapter-authored prompt prose. The claude driver disables the CLI's built-in tools (`--tools ""`), so the only tools in existence are the harness's own; the codex driver's private `CODEX_HOME` keeps the user's global MCP servers out, so the same holds there.

#### Token effect

Provider tokenization governs exact input inside the CLI process. The harness sends one folded user frame per call and re-folds the whole history next call, so the CLI-side prompt tokens are a function of the session log alone.

#### KV Cache effect

The harness assembles no provider wire; usage arrives translated into disjoint input/output accounting (codex reports `inputTokens` minus `cachedInputTokens` for the input side). Provider-side cache reuse is the CLI's own behavior and is not observable or steerable from this adapter.

### CLI subprocess response

#### What the model sees

claude stream-json frames and codex app-server item events become harness reasoning, text, tool-call, usage, and finish chunks; tool arguments arrive as raw JSON strings. The claude process tree is killed at the first assistant frame, and the codex turn ends at `turn/completed` — the CLI's own agentic loop never runs past one turn.

#### Token effect

Usage metadata is translated per driver (the codex cached-input subtraction above); no synthetic token counts are invented.

#### KV Cache effect

Same as the request side: provider-reported cache fields ride the CLI's usage only as translated.

## Known Limitations and Deferred Work

- **Codex authentication is isolated with the session** — the private `CODEX_HOME` keeps the user's global MCP servers out of managed sessions, and with them the interactive login state; an unauthenticated host converges each call to a single `error` finish rather than retrying forever. Provide `env`/`extraArgs` credentials in the driver section.
- **Claude's shell-function wrappers are not spawnable** — `command` resolves through the child-process spawn path; a shell function (e.g. an environment-wrapped `claude`) needs its underlying binary path.
