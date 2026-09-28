/**
 * Local-runtime sensing daemon for DeepSeek Harness, mirroring the multica
 * daemon's model: a background process probes a fixed catalog of local-CLI
 * runtimes on an interval and publishes the report over a loopback health
 * endpoint; the CLI spawns, stops, and queries it, and configuration
 * surfaces prefer its answers over per-page probing.
 * @module @deepseek-ai/dsh-daemon
 */

export {
  DAEMON_PROBE_CATALOG,
  DEFAULT_DAEMON_INTERVAL_MS,
  DEFAULT_DAEMON_PORT,
  type DaemonCatalogEntry,
} from './catalog.ts'
export { commandPresent, type CommandPresenceInternals } from './presence.ts'
export {
  probeRuntimes,
  startProbeLoop,
  type DaemonProbeLoop,
  type DaemonReport,
  type DaemonRuntimeProbe,
  type ProbeLoopOptions,
  type ProbeLoopTimers,
} from './report.ts'
export { createDaemonServer, type DaemonHealth, type DaemonServer, type DaemonServerOptions } from './server.ts'
export {
  clearDaemonState,
  daemonDir,
  daemonLogPath,
  daemonStatePath,
  daemonStateSchema,
  readDaemonState,
  writeDaemonState,
  type DaemonState,
} from './state.ts'
export {
  daemonHealthSchema,
  daemonRuntimeProbeSchema,
  probeDaemonHealth,
  requestDaemonShutdown,
  type DaemonProbe,
  type ProbeDaemonOptions,
  type ShutdownDaemonOptions,
} from './client.ts'
export { installShutdownSignals, runDaemon, type RunDaemonOptions } from './run.ts'
export {
  daemonStatus,
  DSH_DAEMON_INTERVAL_ENV,
  DSH_DAEMON_PORT_ENV,
  formatUptime,
  renderStatusTable,
  startDaemon,
  stopDaemon,
  tailDaemonLog,
  type DaemonLifecycleInternals,
  type DaemonStatusView,
  type StartDaemonOptions,
  type StartDaemonResult,
  type StopDaemonResult,
  type TailDaemonLogInternals,
  type TailDaemonLogOptions,
  type TailDaemonLogResult,
} from './lifecycle.ts'
