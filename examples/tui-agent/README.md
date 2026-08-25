# tui-agent

English | [中文](README.zh.md)

An interactive terminal UI over the SDK JSON-RPC runtime. The TUI spawns the [`dsh-jsonrpc-agent`](../../packages/examples/jsonrpc-demo/README.md) bin with this leaf's [`cordis.yml`](cordis.yml) as a child process, renders the session event stream live (streamed assistant text, tool calls and results, todo snapshots, subagent rows, per-turn token summaries), and turns keyboard input into queued prompts. It has no UI dependencies: `node:readline` plus ANSI escape sequences, styled on a TTY and plain under `NO_COLOR` or pipes.

## Run

From the repository root (tsx resolves workspace imports through the root tsconfig):

```sh
DEEPSEEK_API_KEY=... node --import tsx examples/tui-agent/src/tui.ts
```

The runtime child inherits the environment:

| Variable | Purpose |
|---|---|
| `DEEPSEEK_API_KEY` | Credential passed to the OpenAI-compatible host endpoint |
| `DEEPSEEK_BASE_URL` | Host endpoint used by `dsh-llm-deepseek` |
| `DSH_CWD` | Agent workspace for bash and filesystem tools (default: the TUI's cwd) |
| `DSH_MODEL` | Model route for every session (default `deepseek-v4-flash`) |
| `DSH_SESSION_ROOT` | JSONL session directory (default `<workspace>/.dsh-tui-sessions`) |
| `DSH_SYSTEM_PROMPT` | Deployment-provided coding persona |
| `DSH_TUI_SESSION_ID` | Fixed session id override (test hook) |
| `NO_COLOR` | Disable styling |

Input is one prompt per line; `/new` starts a fresh session, `/clear` resets the screen, `/exit` (or Ctrl+C) closes the runtime through the SDK client's shutdown-and-reap ladder and exits 0. `Ctrl+C` is a clean shutdown, not a mid-turn cancel — the wire has no prompt-cancel method ([protocol limitations](../../packages/sdk/protocol/README.md)).

The composition mirrors [jsonrpc-agent](../jsonrpc-agent/README.md): `bash`, `read`/`write`/`edit`, foreground `subagent`, and `todo_write`, with JSONL persistence and automatic context compaction. The TUI consumes the low-level [`HarnessClient`](../../packages/sdk/client/README.md) rather than the owned-run API because rendering is a long-lived subscription across turns, not one collected activity interval. Turn summaries read token accounting from `assistant/message` events; reasoning text is counted, not echoed.
