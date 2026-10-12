/**
 * Fixed local-runtime probe catalog for the daemon: local CLI executables
 * used by model and subagent providers, sensed on an interval and published
 * over the daemon's health endpoint.
 * @module @deepseek-ai/dsh-daemon/catalog
 */

/** One local-CLI runtime the daemon senses. */
export interface DaemonCatalogEntry {
  /** Executable resolved through the platform PATH probe. */
  command: string
  /** Human-readable runtime label for status output. */
  label: string
}

/** Local CLI executables used by the harness's model and subagent providers. */
export const DAEMON_PROBE_CATALOG: readonly DaemonCatalogEntry[] = [
  { command: 'claude', label: 'Claude CLI' },
  { command: 'codex', label: 'Codex CLI' },
  { command: 'cursor-agent', label: 'Cursor CLI' },
]

/** Default loopback port the daemon binds when start carries no override (the dsh web UI's 3080 neighbor). */
export const DEFAULT_DAEMON_PORT = 3081

/** Default probe interval in milliseconds when start carries no override. */
export const DEFAULT_DAEMON_INTERVAL_MS = 15_000
