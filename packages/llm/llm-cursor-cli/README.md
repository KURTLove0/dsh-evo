# @deepseek-ai/dsh-llm-cursor-cli

English | [中文](README.zh.md)

Cursor CLI as a local agentic model runtime on `ctx.llm`. When `cursor-agent` is executable, the plugin registers provider `cursor-cli`; otherwise it leaves a dormant configurable-provider entry so runtime settings can explain that the Host dependency is missing. Every request starts a fresh `cursor-agent --print --output-format stream-json --stream-partial-output` process and replays the complete Harness conversation through stdin. Cursor's native command, file, search, and agent work is returned as provider-neutral trajectory interactions rather than Harness tool calls.

## Config

```yaml
- id: llm-cursor-cli
  name: '@deepseek-ai/dsh-llm-cursor-cli'
  config:
    command: cursor-agent
    provider: cursor-cli
    timeoutMs: 900000
    catalogTimeoutMs: 30000
    extraArgs: []
    env: {}
    models:
      - id: auto
        name: Auto
```

The adapter probes `cursor-agent models` for the selector and appends configured fallback entries not reported by the CLI. Catalog membership is advisory; any selected model id passes through to `--model`. Native authentication and Cursor configuration remain authoritative. The child receives the shared subprocess service's credential-scrubbed parent environment; `env` is the explicit way to forward `CURSOR_API_KEY` or another credential.

Harness `read-only` maps to Cursor `--mode ask --sandbox enabled --trust`; `workspace-write` maps to `--force --sandbox enabled`; `danger-full-access` maps to `--force --sandbox disabled`. Auxiliary title and compaction requests always use the trusted, sandboxed ask mode. A request without a sandbox mode fails closed to the same read-only mode because a headless process cannot answer Cursor's workspace-trust prompt. `--trust` acknowledges the selected cwd but does not grant writes in ask mode. The adapter does not resume a Cursor session or persist Cursor-side conversation state.

`temperature`, `maxTokens`, stop sequences, reasoning-effort selection, and image input fail before spawning because Cursor's headless CLI does not provide corresponding request controls. Harness tool schemas are not forwarded: Cursor owns its native tool loop and permission decisions, while the Harness session records only Cursor's returned answer, usage, and activity trajectory.

## Model Experience

### Request

#### What the model sees

`cursor-agent` receives the Harness system prompt and durable message history as one deterministic role-delimited stdin prompt. Text, reasoning, tool-call arguments, and tool results remain visible; image input is rejected.

#### Token effect

The full conversation is replayed on every request. Cursor reports its native input, output, and cache token counts when available.

#### KV Cache effect

Stable history produces a stable prompt prefix, but cache ownership and reuse remain inside the selected Cursor model runtime.

### Response

#### What the model sees

Cursor performs its native agent loop before returning the final answer. Native tool activity does not become a later model message.

#### Token effect

After a successful terminal result, the adapter emits the final assistant text and reasoning as durable Harness content; native activity is trajectory metadata and adds no replay tokens. Response content is buffered so Cursor connection retries cannot duplicate or retain an abandoned attempt.

#### KV Cache effect

Only retained response content appends to the next replayed prompt; trajectory interactions do not affect the next cache prefix.

## Known Limitations and Deferred Work

- Cursor CLI is a Host dependency; this package neither installs it nor authenticates it.
- Cursor owns tool execution and permissions. Harness tool schemas, approvals, and file sandboxing do not mediate the native agent loop.
- Each request is stateless on the Cursor side. A large Harness history is folded into one prompt rather than resumed through a Cursor session id.
- Assistant text and reasoning are emitted after Cursor's terminal result rather than token-by-token because stream-json can replay a completed attempt before a connection retry.
- Native model discovery is parsed from the current human-readable `cursor-agent models` output because the CLI exposes no JSON catalog format.
