/**
 * Periodic runtime sensing: probe the fixed catalog now and on an interval,
 * keeping the latest report in memory for the health endpoint to serve. The
 * loop is the daemon's only clock; consumers never re-probe what it already
 * answers.
 * @module @deepseek-ai/dsh-daemon/report
 */

import { DAEMON_PROBE_CATALOG } from './catalog.ts'
import { commandPresent, type CommandPresenceInternals } from './presence.ts'

/** One catalog runtime's latest probe answer. */
export interface DaemonRuntimeProbe {
  /** Executable that was probed. */
  command: string
  /** Human-readable runtime label. */
  label: string
  /** Whether the executable resolved at the latest probe. */
  present: boolean
  /** ISO timestamp of the latest completed probe. */
  checkedAt: string
}

/** The daemon's latest full sensing report. */
export interface DaemonReport {
  /** One row per catalog runtime, in catalog order. */
  runtimes: DaemonRuntimeProbe[]
}

/**
 * Probe every catalog runtime once.
 * @param internals - platform/spawn/access seam for deterministic probes.
 * @param now - probe timestamp; defaults to the current time.
 * @returns the fresh report rows, in catalog order.
 */
export function probeRuntimes(internals: CommandPresenceInternals = {}, now: Date = new Date()): DaemonRuntimeProbe[] {
  const checkedAt = now.toISOString()
  return DAEMON_PROBE_CATALOG.map(entry => ({
    command: entry.command,
    label: entry.label,
    present: commandPresent(entry.command, internals),
    checkedAt,
  }))
}

/** A running sensing loop: the latest report, plus its stop. */
export interface DaemonProbeLoop {
  /**
   * The latest completed probe report.
   * @returns the report as of the last finished probe tick.
   */
  report(): DaemonReport
  /** Stop the interval; the last report stays readable. */
  stop(): void
}

/** Timer pair the loop schedules through; defaults to the platform timers. */
export interface ProbeLoopTimers {
  /** Interval scheduler. */
  setInterval: typeof globalThis.setInterval
  /** Interval canceller. */
  clearInterval: typeof globalThis.clearInterval
}

/** Options for {@link startProbeLoop}. */
export interface ProbeLoopOptions {
  /** Probe interval in milliseconds. */
  intervalMs: number
  /** Platform/spawn/access seam for deterministic probes. */
  internals?: CommandPresenceInternals
  /** Timer seam for deterministic loops; defaults to the platform timers. */
  timers?: ProbeLoopTimers
}

/**
 * Start the sensing loop: probe immediately, then every `intervalMs`. The
 * interval is unref'd — the health server, not the clock, owns the daemon
 * process's lifetime.
 * @param options - interval and seams.
 * @returns the running loop.
 */
export function startProbeLoop(options: ProbeLoopOptions): DaemonProbeLoop {
  const internals = options.internals ?? {}
  const timers = options.timers ?? globalThis
  let latest: DaemonReport = { runtimes: probeRuntimes(internals) }
  const timer = timers.setInterval(() => {
    latest = { runtimes: probeRuntimes(internals) }
  }, options.intervalMs)
  timer.unref()
  return {
    report: () => latest,
    stop: () => { timers.clearInterval(timer) },
  }
}
