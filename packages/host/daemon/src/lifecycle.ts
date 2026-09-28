/**
 * CLI side of the daemon lifecycle: spawn the background daemon, stop it,
 * report its status, and tail its log. The daemon process is this same CLI
 * re-invoked as `daemon start --foreground` with its settings carried by
 * environment, so the child and the foreground invocation share one
 * resolution path. The health endpoint is the only liveness oracle; the
 * state document is the only rendezvous.
 * @module @deepseek-ai/dsh-daemon/lifecycle
 */

import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { probeDaemonHealth, requestDaemonShutdown, type DaemonProbe, type ProbeDaemonOptions, type ShutdownDaemonOptions } from './client.ts'
import { clearDaemonState, daemonDir, daemonLogPath } from './state.ts'
import type { DaemonHealth } from './server.ts'

/** Environment variable carrying the daemon's bind port to the child. */
export const DSH_DAEMON_PORT_ENV = 'DSH_DAEMON_PORT'
/** Environment variable carrying the daemon's probe interval (milliseconds) to the child. */
export const DSH_DAEMON_INTERVAL_ENV = 'DSH_DAEMON_INTERVAL_MS'

/** Test seams over process spawn, the health client, signals, and clocks. */
export interface DaemonLifecycleInternals {
  /** Child-process spawn; defaults to {@link spawn}. */
  spawn?: typeof spawn
  /** Health probe; defaults to {@link probeDaemonHealth}. */
  probe?: (options?: ProbeDaemonOptions) => Promise<DaemonProbe>
  /** Graceful-shutdown request; defaults to {@link requestDaemonShutdown}. */
  shutdown?: (port: number, options?: ShutdownDaemonOptions) => Promise<boolean>
  /** Poll clock; defaults to a real sleep. */
  sleep?: (ms: number) => Promise<void>
  /** Signal sender for the ungraceful fallback; defaults to {@link process.kill}. */
  kill?: (pid: number) => void
  /** State sweeper; defaults to {@link clearDaemonState}. */
  clearState?: () => Promise<void>
  /** Budget waiting for a spawned daemon to report running; defaults to 10s. */
  startupTimeoutMs?: number
  /** Budget waiting for a stopping daemon to go quiet; defaults to 5s. */
  stopTimeoutMs?: number
}

/** Options for {@link startDaemon}. */
export interface StartDaemonOptions {
  /** Absolute path of this CLI's bin script the background child re-runs. */
  binPath: string
  /** Loopback port the daemon binds. */
  port: number
  /** Probe interval in milliseconds. */
  intervalMs: number
}

/** Outcome of one {@link startDaemon} attempt. */
export type StartDaemonResult =
  | { ok: true; pid: number; logPath: string }
  | { ok: false; reason: 'already-running'; pid: number }
  | { ok: false; reason: 'spawn-failed'; logPath: string; message: string }
  | { ok: false; reason: 'start-timeout'; logPath: string }

/** Outcome of one {@link stopDaemon} attempt. */
export type StopDaemonResult =
  | { ok: true }
  | { ok: false; reason: 'not-running' }
  | { ok: false; reason: 'stop-timeout' }

const defaultSleep = (ms: number): Promise<void> => new Promise<void>((resolve) => { setTimeout(resolve, ms) })

const defaultKill = (pid: number): void => { process.kill(pid) }

/**
 * Start the daemon in the background: refuse a live one, spawn this CLI as
 * `daemon start --foreground` detached with output to the log file, release
 * it, and wait for its health answer. A start that never reports healthy is
 * left running — its log names the failure, matching the multica daemon's
 * supervisor stance.
 * @param options - bin path, port, and probe interval.
 * @param internals - spawn/probe/clock seams.
 * @returns the spawn outcome.
 */
export async function startDaemon(options: StartDaemonOptions, internals: DaemonLifecycleInternals = {}): Promise<StartDaemonResult> {
  const probe = internals.probe ?? probeDaemonHealth
  const sleep = internals.sleep ?? defaultSleep
  const existing = await probe()
  if (existing.running) return { ok: false, reason: 'already-running', pid: existing.health.pid }
  mkdirSync(daemonDir(), { recursive: true, mode: 0o700 })
  const logPath = daemonLogPath()
  const logFd = openSync(logPath, 'a')
  let child: ReturnType<typeof spawn>
  try {
    child = (internals.spawn ?? spawn)(
      process.execPath,
      [...process.execArgv, options.binPath, 'daemon', 'start', '--foreground'],
      {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        windowsHide: true,
        env: {
          ...process.env,
          [DSH_DAEMON_PORT_ENV]: String(options.port),
          [DSH_DAEMON_INTERVAL_ENV]: String(options.intervalMs),
        },
      },
    )
  } catch (error) {
    closeSync(logFd)
    return { ok: false, reason: 'spawn-failed', logPath, message: error instanceof Error ? error.message : String(error) }
  }
  // The child inherited its own descriptor; the parent's copy must go or the
  // log stays open here forever.
  closeSync(logFd)
  child.unref()
  const deadline = Date.now() + (internals.startupTimeoutMs ?? 10_000)
  while (Date.now() < deadline) {
    await sleep(200)
    const attempt = await probe({ timeoutMs: 500 })
    if (attempt.running) return { ok: true, pid: attempt.health.pid, logPath }
  }
  return { ok: false, reason: 'start-timeout', logPath }
}

/**
 * Stop the running daemon: graceful `/shutdown` first, a plain SIGTERM when
 * the endpoint cannot be reached, and a bounded wait for silence. A clean
 * stop sweeps the state document too, covering a daemon that died before its
 * own cleanup.
 * @param internals - probe/shutdown/kill/clock seams.
 * @returns the stop outcome.
 */
export async function stopDaemon(internals: DaemonLifecycleInternals = {}): Promise<StopDaemonResult> {
  const probe = internals.probe ?? probeDaemonHealth
  const existing = await probe()
  if (!existing.running) return { ok: false, reason: 'not-running' }
  const graceful = await (internals.shutdown ?? requestDaemonShutdown)(existing.state.port)
  if (!graceful) (internals.kill ?? defaultKill)(existing.health.pid)
  const sleep = internals.sleep ?? defaultSleep
  const deadline = Date.now() + (internals.stopTimeoutMs ?? 5000)
  while (Date.now() < deadline) {
    await sleep(250)
    if (!(await probe()).running) {
      await (internals.clearState ?? clearDaemonState)()
      return { ok: true }
    }
  }
  return { ok: false, reason: 'stop-timeout' }
}

/** One daemon status snapshot for the CLI to render. */
export interface DaemonStatusView {
  /** Whether a daemon answered its health endpoint. */
  running: boolean
  /** The validated health answer; absent when not running. */
  health: DaemonHealth | undefined
  /** Log file path, named in both postures. */
  logPath: string
}

/**
 * Snapshot the daemon's status.
 * @param internals - probe seam.
 * @returns the status view.
 */
export async function daemonStatus(internals: DaemonLifecycleInternals = {}): Promise<DaemonStatusView> {
  const probe = await (internals.probe ?? probeDaemonHealth)()
  return probe.running
    ? { running: true, health: probe.health, logPath: daemonLogPath() }
    : { running: false, health: undefined, logPath: daemonLogPath() }
}

/**
 * Render whole seconds as the largest two units that still read well.
 * @param totalSeconds - uptime in seconds.
 * @returns `9s`, `3m 20s`, `2h 5m`, or `1d 2h`.
 */
export function formatUptime(totalSeconds: number): string {
  const seconds = Math.floor(totalSeconds)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

/**
 * Render a status snapshot as the human table (`dsh daemon status`).
 * @param view - the status snapshot.
 * @returns the table lines, joined by newlines.
 */
export function renderStatusTable(view: DaemonStatusView): string {
  if (!view.running || view.health === undefined) {
    return ['Daemon: stopped', 'Start it with: dsh daemon start'].join('\n')
  }
  const { health } = view
  const runtimes = health.runtimes.map(row => `${row.command} (${row.present ? 'present' : 'missing'})`).join(', ')
  return [
    `Daemon: running (pid ${health.pid}, uptime ${formatUptime(health.uptimeSeconds)})`,
    `Version: ${health.version}`,
    `Runtimes: ${runtimes}`,
    `Log: ${view.logPath}`,
  ].join('\n')
}

/** Options for {@link tailDaemonLog}. */
export interface TailDaemonLogOptions {
  /** How many trailing lines to print first; defaults to 50. */
  lines?: number
  /** Keep printing appended content until interrupted. */
  follow?: boolean
}

/** Test seams for {@link tailDaemonLog}. */
export interface TailDaemonLogInternals {
  /** Output sink; defaults to stdout. */
  write?: (text: string) => void
  /** Follow poll clock; defaults to a real sleep. */
  sleep?: (ms: number) => Promise<void>
  /** Follow continuation check; defaults to "forever" (a signal ends it). */
  shouldContinue?: () => boolean
  /** Follow poll interval in milliseconds; defaults to 500. */
  followIntervalMs?: number
}

/** Outcome of one {@link tailDaemonLog} call. */
export type TailDaemonLogResult =
  | { ok: true }
  | { ok: false; reason: 'no-log'; logPath: string }

/**
 * Print the log's trailing lines, optionally following appended content. A
 * truncated log (rotated or rewritten) restarts from the top rather than
 * skipping bytes.
 * @param options - line count and follow switch.
 * @param internals - write/clock/continuation seams.
 * @returns the tail outcome; `no-log` when no log file exists.
 */
export async function tailDaemonLog(
  options: TailDaemonLogOptions = {},
  internals: TailDaemonLogInternals = {},
): Promise<TailDaemonLogResult> {
  const logPath = daemonLogPath()
  const write = internals.write ?? ((text: string) => { process.stdout.write(text) })
  let content: string
  try {
    content = readFileSync(logPath, 'utf8')
  } catch {
    // Absence is the only expected read failure: the daemon was never
    // started in background mode on this home.
    return { ok: false, reason: 'no-log', logPath }
  }
  const allLines = content.endsWith('\n') ? content.slice(0, -1).split('\n') : content.split('\n')
  if (content !== '') write(`${allLines.slice(-(options.lines ?? 50)).join('\n')}\n`)
  if (options.follow === true) {
    const sleep = internals.sleep ?? defaultSleep
    const continueFollowing = internals.shouldContinue ?? (() => true)
    const intervalMs = internals.followIntervalMs ?? 500
    let offset = content.length
    while (continueFollowing()) {
      await sleep(intervalMs)
      let size: number
      try {
        size = statSync(logPath).size
      } catch {
        // The log vanished between polls (state cleanup, rotation); the next
        // tick either finds it again or keeps waiting.
        continue
      }
      if (size < offset) offset = 0
      if (size === offset) continue
      const fd = openSync(logPath, 'r')
      try {
        const buffer = Buffer.alloc(size - offset)
        readSync(fd, buffer, 0, buffer.length, offset)
        write(buffer.toString('utf8'))
      } finally {
        closeSync(fd)
      }
      offset = size
    }
  }
  return { ok: true }
}
