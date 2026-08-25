# Agent Note: tui-agent renders the SDK runtime in a terminal

Status: implemented

English | [中文](2026-08-25-tui-agent-terminal-ui.zh.md)

## Problem

The repository ships three ways to drive a harness — the Web GUI, the ACP automation server, and the JSON-RPC SDK runtimes consumed by the Python/TypeScript SDKs — but no terminal frontend. A TUI would otherwise tempt an author to mount an interaction plugin inside a new composition (duplicating the agent spine) or to read the session log from disk after the fact (no live streaming). Both paths bypass the one surface every external consumer already shares: the newline-delimited JSON-RPC runtime protocol.

## Decision

`examples/tui-agent` is an example leaf, not a package: the TUI is a client-process program with no Cordis context, exactly like the SDK clients it consumes. It spawns the existing `dsh-jsonrpc-agent` bin (`packages/examples/jsonrpc-demo/src/bin.ts`) with the leaf's own `cordis.yml` — the same plugin set as [jsonrpc-agent](../../../../examples/jsonrpc-agent/README.md), because the deployment differs only in who drives the turns — and speaks the SDK wire through the low-level `HarnessClient` from `@deepseek-ai/dsh-sdk-client`.

The low-level client, not `DeepSeekHarness.run()`, is load-bearing: `run()` owns one collected activity interval and returns when the agent idles, while a UI is a long-lived subscription that renders every notification as it arrives and keeps accepting input across turns. The TUI subscribes globally, filters `session.event` to the current root session, and keys its prompt visibility off `session.status`: `running` hides the input line (readline paused, current line cleared with one ANSI erase), `idle` ends the stream, prints the per-turn summary (reason, token accounting accumulated from `assistant/message` events, reasoning character count), and restores the prompt with the buffered input intact.

Rendering decisions that are part of this note's contract: streamed `text-delta` chunks are written verbatim; `assistant/message` is a fallback only for steps that streamed no deltas (adapters that never chunk); `reasoning-delta` text is counted, never echoed; `tool/call` and `tool/result` render one summary line each with truncated argument/result briefs; `todo/write` renders the whole-list snapshot. All model- or tool-authored text passes a sanitizer that strips ANSI escapes, OSC replies, and control characters except tab and newline, so streamed content cannot restyle or move the cursor. The event map is merge-extensible, so the render switch falls through a documented default — unknown plugin events carry no row. Styling is `NO_COLOR`-respecting and disabled on non-TTY stdout, which is also what makes the keyless smoke assertable over pipes.

The TUI and its runtime child both run under `node --import tsx` with cwd pinned to the repository root, so workspace imports resolve through the root tsconfig paths (the same source-launch contract as `dsh`). `Ctrl+C` and `/exit` are clean shutdowns through `HarnessClient.close()` — the wire has no prompt-cancel method, so an in-flight turn is never cancelled, only abandoned with the runtime.

## Verification

The keyless smoke (`examples/tui-agent/tests/keyless-smoke.e2e.ts`) boots the real TUI through a mock SSE model endpoint over pipes: it asserts the banner, the echoed prompt, the streamed reply, the `completed` turn summary, the model route and tool roster reaching the provider request, and exit code 0 after `/exit`. Real-terminal verification ran the same flow under a pseudo-terminal via node-pty: colors active, tool-call and tool-result rows rendered, a real `bash` tool round-trip executed (`echo` output shown as the result row), token summary present, clean exit — seven checks passing.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| A `dsh-tui` package with an interaction plugin | Duplicates the agent spine and adds a product surface before any consumer asks for one; examples own composition wiring. |
| Mount the TUI inside the runtime as a plugin | The runtime's stdout is reserved for JSON-RPC; a UI must live in the client process. |
| `DeepSeekHarness.run()` per input line | The owned-run API collects one interval to idle; it cannot render live notifications or accept input mid-collection. |
| Render from the persisted JSONL log | No live streaming; durable reads race the in-flight turn. |
| A TUI framework dependency (Ink, blessed) | The rendered surface is one scrolling transcript plus an input line; `node:readline` plus escapes carries no dependency or React runtime. |

## Consequences

The leaf demonstrates the low-level SDK client as the supported seam for interactive frontends, and its smoke test doubles as the pipe-mode consumer check for the TUI's rendering contract. Session resume is deliberately absent: the JSON-RPC server lazily creates sessions by id and does not replay history, so `/new` starts a fresh session and durable logs serve audit only. When a prompt-cancel method lands on the wire, `Ctrl+C` should grow a mid-turn cancel path and this note owns that follow-up.
