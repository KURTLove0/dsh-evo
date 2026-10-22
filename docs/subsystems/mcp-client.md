# MCP client

English | [中文](mcp-client.zh.md)

[The MCP client](../../packages/mcp/mcp-client/README.md) bridges tools through the official SDK. The plugin owns tool bridging and reconnection; temporary `probeMcp` only initializes and pings, without discovering, registering, or calling tools. Stdio uses the explicit working directory and configured environment, with diagnostic output suppressed.

Probe results contain start/completion times, connection outcome, and independent cleanup outcome without server error text. Callers supply the probe deadline, close-event wait after SDK shutdown, and optional cancellation. Unconfirmed cleanup requires the caller to refuse overlapping retries.

```ts type-equiv
/** Explicit deployment bounds and caller cancellation for one probe. */
interface McpProbeOptions {
  /** Positive total initialization/ping deadline, bounded by Node timer limits. */
  timeoutMs: number
  /** Positive close-event wait after the SDK shutdown sequence has settled. */
  closeTimeoutMs: number
  signal?: AbortSignal
}
```

```ts type-equiv
/** Safe connection observations; protocol failures never return server text or secrets. */
interface McpProbeOutcome {
  startedAt: number
  checkedAt: number
  status: 'connected' | 'failed' | 'timed-out' | 'cancelled'
  /** A caller must refuse overlapping retries after failed cleanup. */
  cleanup: 'closed' | 'failed'
}
```
