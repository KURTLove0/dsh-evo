# dsh-llm-codex-cli

English | [中文](README.zh.md)

Installed Codex app-server as a local LLM runtime. The plugin declares `codex-cli` in the runtime directory and activates the route when the configured executable resolves. It uses the shared subprocess service and JSON-RPC transport; it downloads no CLI or platform payload.

## Configuration

`command` defaults to `codex`, `provider` to `codex-cli`, `timeoutMs` to 900000, `catalogTimeoutMs` to 30000, `catalogCacheMs` to 60000, `graceMs` to 3000, and `diagnosticMaxBytes` to 65536. Successful native model catalogs are cached; failures remain retryable. The advisory catalog and reasoning efforts come from `model/list`. The directory advertises `defaultModel: default`; that selection leaves the native thread's model unset so Codex applies its own configuration. An explicit model is passed unchanged.

Each request starts an ephemeral app-server thread in the task cwd. The process inherits the user's Codex authentication and native integrations. Sandbox mode follows the Harness request, defaulting to read-only; auxiliary requests always use read-only. Approval policy is `never`; unsupported host-interaction requests fail instead of receiving approval. Completion, failure, cancellation, and an early stream-consumer return terminate and drain the process tree.

## Model Experience

### Native request

#### What the model sees

The system instructions and durable conversation are replayed as role-delimited text such as `[system]` and `[user]`. Native Codex configuration can add project instructions, skills, and MCP tools. Image input is rejected explicitly.

#### Token effect

Native usage is reported without synthetic estimates. Cached input is separated from uncached input. Native command and tool activity is retained as trajectory interactions and excluded from later model context.

#### KV Cache effect

Every request uses an ephemeral native thread; provider cache behavior belongs to Codex. The Harness conversation log remains the source of replayed text.

## Known Limitations and Deferred Work

- Native turns reject Harness temperature, stop-sequence, and maximum-token overrides.
- The adapter accepts text input and emits assistant text, usage, and public native activity. Private reasoning is not displayed.
- Native integrations follow the user's Codex configuration. Harness tool schemas are not installed as native dynamic tools by this adapter.
