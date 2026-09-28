/**
 * The daemon process itself: sense the catalog, serve the health endpoint,
 * publish the state document, and shut down cleanly from either a signal or
 * the endpoint. Signals and `/shutdown` share one exit path, so teardown —
 * loop stopped, listener closed, state cleared — happens exactly once.
 * @module @deepseek-ai/dsh-daemon/run
 */

import { DAEMON_PROBE_CATALOG } from './catalog.ts'
import { startProbeLoop } from './report.ts'
import { createDaemonServer, type DaemonServer } from './server.ts'
import { clearDaemonState, writeDaemonState } from './state.ts'

/** Options for {@link runDaemon}. */
export interface RunDaemonOptions {
  /** Loopback port to bind; `0` picks a free port. */
  port: number
  /** Probe interval in milliseconds. */
  intervalMs: number
  /** CLI version reported in health answers and the state document. */
  version: string
  /** Log sink; defaults to `console.log` (the background child's log file). */
  log?: (message: string) => void
  /** Signal installer seam; defaults to {@link installShutdownSignals}. */
  installSignals?: (shutdown: () => void) => () => void
  /** Called once the endpoint serves and the state document is published. */
  onReady?: (server: DaemonServer) => void
}

/**
 * Run the daemon until a signal or `/shutdown` asks it out.
 * @param options - port, interval, version, and seams.
 * @returns the process exit code: 0 for a clean shutdown, 1 when the
 * endpoint could not bind.
 */
export async function runDaemon(options: RunDaemonOptions): Promise<number> {
  const log = options.log ?? console.log
  const startedAt = new Date().toISOString()
  const loop = startProbeLoop({ intervalMs: options.intervalMs })
  const stopping = { requested: false }
  // Assigned synchronously by the promise executor below, before any caller.
  let requestStop!: (code: number) => void
  const stopped = new Promise<number>((resolve) => {
    requestStop = (code: number) => {
      if (stopping.requested) return
      stopping.requested = true
      resolve(code)
    }
  })
  let server: DaemonServer
  try {
    server = await createDaemonServer({
      port: options.port,
      version: options.version,
      startedAt,
      report: () => loop.report(),
      onShutdown: () => { requestStop(0) },
    })
  } catch (error) {
    loop.stop()
    // createDaemonServer only rejects with its own wrapped bind Error.
    log(`dsh daemon: ${(error as Error).message}`)
    return 1
  }
  const uninstallSignals = (options.installSignals ?? installShutdownSignals)(() => { requestStop(0) })
  try {
    await writeDaemonState({ pid: process.pid, port: server.port, version: options.version, startedAt })
    const commands = DAEMON_PROBE_CATALOG.map(entry => entry.command).join(', ')
    log(`dsh daemon: pid ${process.pid}, sensing ${commands} every ${options.intervalMs}ms, health on http://127.0.0.1:${server.port}/health`)
    options.onReady?.(server)
    return await stopped
  } finally {
    uninstallSignals()
    loop.stop()
    await server.close()
    await clearDaemonState()
  }
}

/**
 * Register the default SIGTERM/SIGINT shutdown handlers.
 * @param shutdown - invoked on the first of either signal.
 * @returns the uninstaller restoring the previous listener sets.
 */
export function installShutdownSignals(shutdown: () => void): () => void {
  const onSigterm = (): void => { shutdown() }
  const onSigint = (): void => { shutdown() }
  process.once('SIGTERM', onSigterm)
  process.once('SIGINT', onSigint)
  return () => {
    process.off('SIGTERM', onSigterm)
    process.off('SIGINT', onSigint)
  }
}
