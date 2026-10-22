/** Temporary MCP initialization and ping without tool registration or execution. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { clampTimeout, deadline, timeoutOf, MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { createTransport } from './transport.ts'
import type { Config } from './index.ts'

/** Explicit deployment bounds and caller cancellation for one probe. */
export interface McpProbeOptions {
  /** Positive total initialization/ping deadline, bounded by Node timer limits. */
  timeoutMs: number
  /** Positive close-event wait after the SDK shutdown sequence has settled. */
  closeTimeoutMs: number
  signal?: AbortSignal
}
/** Safe connection observations; protocol failures never return server text or secrets. */
export interface McpProbeOutcome {
  startedAt: number
  checkedAt: number
  status: 'connected' | 'failed' | 'timed-out' | 'cancelled'
  /** A caller must refuse overlapping retries after failed cleanup. */
  cleanup: 'closed' | 'failed'
}

/**
 * Initialize and ping one configured server, then wait for its transport to close.
 * No tools are listed, registered, or invoked; stdio stderr is suppressed.
 * @param config - resolved connection configuration, including explicit credentials and cwd.
 * @param options - probe deadline, close barrier bound, and caller cancellation.
 * @returns separate connection and cleanup outcomes without server-controlled diagnostics.
 */
export async function probeMcp(config: Config, options: McpProbeOptions): Promise<McpProbeOutcome> {
  const timeoutMs = clampTimeout(options.timeoutMs, options.timeoutMs, MAX_TIMER_DELAY_MS, 'timeoutMs')
  const closeTimeoutMs = clampTimeout(options.closeTimeoutMs, options.closeTimeoutMs, MAX_TIMER_DELAY_MS, 'closeTimeoutMs')
  const startedAt = Date.now()
  using timer = deadline(options.signal, timeoutMs, 'MCP_PROBE_TIMEOUT')
  let status: McpProbeOutcome['status'] = 'failed'
  let cleanup: McpProbeOutcome['cleanup'] = 'closed'
  if (options.signal?.aborted === true) return { startedAt, checkedAt: Date.now(), status: 'cancelled', cleanup }
  const client = new Client({ name: 'dsh-mcp-probe', version: '0.0.1' }, { capabilities: {} })
  let finish: (() => Promise<void>) | undefined
  try {
    const transport = createTransport(config, true)
    const closed = Promise.withResolvers<void>()
    transport.onclose = () => { closed.resolve() }
    const originalClose = transport.close.bind(transport)
    let closing: Promise<void> | undefined
    let closeFailed = false
    // SDK initialization may close on failure concurrently with cancellation and final cleanup.
    transport.close = () => closing ??= originalClose().catch(() => { closeFailed = true })
    const cancel = () => { void transport.close() }
    timer.signal.addEventListener('abort', cancel, { once: true })
    finish = async () => {
      timer.signal.removeEventListener('abort', cancel)
      await transport.close()
      using closeTimer = deadline(undefined, closeTimeoutMs, 'MCP_PROBE_CLOSE_TIMEOUT')
      const stopped = await new Promise<boolean>((resolve) => {
        const expired = () => { resolve(false) }
        closeTimer.signal.addEventListener('abort', expired, { once: true })
        void closed.promise.then(() => {
          closeTimer.signal.removeEventListener('abort', expired); resolve(true)
        })
      })
      if (!stopped || closeFailed) cleanup = 'failed'
    }
    await client.connect(transport, { signal: timer.signal, timeout: timeoutMs })
    await client.ping({ signal: timer.signal, timeout: timeoutMs })
    status = 'connected'
  } catch {
    // Only SDK/transport setup and ping run here; server diagnostics can contain configured secrets.
    status = timer.signal.aborted
      ? timeoutOf(timer.signal, 'MCP_PROBE_TIMEOUT') === undefined ? 'cancelled' : 'timed-out'
      : 'failed'
  } finally { await finish?.() }
  return { startedAt, checkedAt: Date.now(), status, cleanup }
}
