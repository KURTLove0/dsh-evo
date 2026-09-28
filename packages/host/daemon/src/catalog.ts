/**
 * Fixed local-runtime probe catalog for the daemon: the local-CLI runtimes
 * the harness can route to, sensed on an interval and published over the
 * daemon's health endpoint. A new local-CLI adapter extends this list in the
 * same change that teaches the harness to route to it.
 * @module @deepseek-ai/dsh-daemon/catalog
 */

/** One local-CLI runtime the daemon senses. */
export interface DaemonCatalogEntry {
  /** Executable resolved through the platform PATH probe. */
  command: string
  /** Human-readable runtime label for status output. */
  label: string
}

/** The local-CLI runtimes the harness can route to today. */
export const DAEMON_PROBE_CATALOG: readonly DaemonCatalogEntry[] = [
  { command: 'claude', label: 'Claude CLI' },
  { command: 'codex', label: 'Codex CLI' },
]

/** Default loopback port the daemon binds when start carries no override (the dsh web UI's 3080 neighbor). */
export const DEFAULT_DAEMON_PORT = 3081

/** Default probe interval in milliseconds when start carries no override. */
export const DEFAULT_DAEMON_INTERVAL_MS = 15_000
