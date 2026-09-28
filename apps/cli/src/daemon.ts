/**
 * Daemon command dispatch: resolve the invocation's port and interval from
 * flags, environment, and defaults (one path for foreground and background),
 * then run the lifecycle operation through `@deepseek-ai/dsh-daemon`. The
 * background child is this same bin re-run as `daemon start --foreground`.
 * @module @deepseek-ai/dsh/daemon
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_DAEMON_INTERVAL_MS,
  DEFAULT_DAEMON_PORT,
  DSH_DAEMON_INTERVAL_ENV,
  DSH_DAEMON_PORT_ENV,
  daemonStatus,
  renderStatusTable,
  runDaemon,
  startDaemon,
  stopDaemon,
  tailDaemonLog,
} from '@deepseek-ai/dsh-daemon'
import { readDshVersion, type DaemonInvocation } from './args.ts'

/** Injectable operations, defaulting to the real daemon lifecycle (tests stub at this boundary). */
export interface DaemonCommandOperations {
  /** Foreground runner. */
  run: typeof runDaemon
  /** Background spawner. */
  start: typeof startDaemon
  /** Stopper. */
  stop: typeof stopDaemon
  /** Status snapshot. */
  status: typeof daemonStatus
  /** Log tail. */
  tail: typeof tailDaemonLog
  /** Version source for the daemon's health identity. */
  version: () => string
}

const REAL_OPERATIONS: DaemonCommandOperations = {
  run: runDaemon,
  start: startDaemon,
  stop: stopDaemon,
  status: daemonStatus,
  tail: tailDaemonLog,
  version: readDshVersion,
}

/**
 * The bin script the background daemon child re-runs: the bundled `bin.js`
 * beside this module's chunk when built, otherwise the source `bin.ts`.
 * @returns the absolute bin path.
 */
export function daemonBinPath(): string {
  const built = fileURLToPath(new URL('./bin.js', import.meta.url))
  return existsSync(built) ? built : fileURLToPath(new URL('./bin.ts', import.meta.url))
}

/**
 * Resolve the daemon's bind port: flag, then `$DSH_DAEMON_PORT`, then the
 * default. A malformed env value fails loud — a daemon on a surprising port
 * is worse than no daemon.
 * @param invocation - the parsed daemon invocation.
 * @param env - environment mapping; defaults to the process's.
 * @returns the port to bind (`0` picks a free port).
 */
export function resolveDaemonPort(invocation: DaemonInvocation, env: Record<string, string | undefined> = process.env): number {
  if (invocation.port !== undefined) return invocation.port
  const fromEnv = env[DSH_DAEMON_PORT_ENV]
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    const port = Number(fromEnv)
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      throw new Error(`dsh: ${DSH_DAEMON_PORT_ENV} needs an integer 0-65535, got ${JSON.stringify(fromEnv)}`)
    }
    return port
  }
  return DEFAULT_DAEMON_PORT
}

/**
 * Resolve the daemon's probe interval in milliseconds: flag seconds, then
 * `$DSH_DAEMON_INTERVAL_MS`, then the default. A malformed env value fails
 * loud, mirroring the port.
 * @param invocation - the parsed daemon invocation.
 * @param env - environment mapping; defaults to the process's.
 * @returns the probe interval in milliseconds.
 */
export function resolveDaemonIntervalMs(invocation: DaemonInvocation, env: Record<string, string | undefined> = process.env): number {
  if (invocation.intervalSeconds !== undefined) return invocation.intervalSeconds * 1000
  const fromEnv = env[DSH_DAEMON_INTERVAL_ENV]
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    const intervalMs = Number(fromEnv)
    if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
      throw new Error(`dsh: ${DSH_DAEMON_INTERVAL_ENV} needs a positive integer of milliseconds, got ${JSON.stringify(fromEnv)}`)
    }
    return intervalMs
  }
  return DEFAULT_DAEMON_INTERVAL_MS
}

/**
 * Run one daemon lifecycle command.
 * @param invocation - the parsed daemon invocation.
 * @param operations - lifecycle operations; defaults to the real ones.
 * @returns the process exit code.
 */
export async function runDaemonCommand(
  invocation: DaemonInvocation,
  operations: DaemonCommandOperations = REAL_OPERATIONS,
): Promise<number> {
  switch (invocation.command) {
    case 'start':
      return startDaemonFlow(invocation, operations)
    case 'restart': {
      // A restart over a stopped daemon is just a start.
      await operations.stop()
      return startDaemonFlow(invocation, operations)
    }
    case 'stop': {
      const result = await operations.stop()
      if (result.ok) {
        process.stderr.write('Daemon stopped.\n')
        return 0
      }
      if (result.reason === 'not-running') {
        process.stderr.write('Daemon is not running.\n')
        return 0
      }
      process.stderr.write('Daemon is still stopping. It may be finishing work; check `dsh daemon status`.\n')
      return 1
    }
    case 'status': {
      const view = await operations.status()
      if (invocation.output === 'json') {
        process.stdout.write(`${JSON.stringify(view.running ? view.health : { status: 'stopped' }, null, 2)}\n`)
        return 0
      }
      process.stdout.write(`${renderStatusTable(view)}\n`)
      return 0
    }
    case 'logs': {
      const result = await operations.tail({ lines: invocation.lines, follow: invocation.follow })
      if (!result.ok) {
        process.stderr.write(`No daemon log at ${result.logPath} — start the daemon in the background first (dsh daemon start).\n`)
        return 1
      }
      return 0
    }
    default:
      invocation.command satisfies never
      throw new Error(`dsh: unhandled daemon command ${JSON.stringify(invocation)}`)
  }
}

/** The start/restart shared flow: foreground runs in-process, background spawns. */
async function startDaemonFlow(invocation: DaemonInvocation, operations: DaemonCommandOperations): Promise<number> {
  const port = resolveDaemonPort(invocation)
  const intervalMs = resolveDaemonIntervalMs(invocation)
  if (invocation.foreground) {
    return operations.run({ port, intervalMs, version: operations.version() })
  }
  const result = await operations.start({ binPath: daemonBinPath(), port, intervalMs })
  if (result.ok) {
    process.stderr.write(`Daemon started (pid ${result.pid})\nLogs: ${result.logPath}\n`)
    return 0
  }
  if (result.reason === 'already-running') {
    process.stderr.write(`Daemon is already running (pid ${result.pid}). Use 'dsh daemon restart' to restart it.\n`)
    return 1
  }
  if (result.reason === 'spawn-failed') {
    process.stderr.write(`Daemon failed to start: ${result.message}\n`)
    return 1
  }
  process.stderr.write(`Daemon may not have started. Check logs: ${result.logPath}\n`)
  return 1
}
