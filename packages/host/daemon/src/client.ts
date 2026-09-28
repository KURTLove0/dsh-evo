/**
 * Consumer side of the daemon's health endpoint: read the published state,
 * ask the endpoint, validate the answer. Every failure — no state document,
 * a dead port, a foreign service, malformed JSON — collapses to "not
 * running": only the daemon's own answer proves it alive.
 * @module @deepseek-ai/dsh-daemon/client
 */

import { z } from 'zod'
import type { DaemonHealth } from './server.ts'
import { readDaemonState, type DaemonState } from './state.ts'

/** Zod schema for one runtime row of the health answer. */
export const daemonRuntimeProbeSchema = z.object({
  command: z.string(),
  label: z.string(),
  present: z.boolean(),
  checkedAt: z.string(),
})

/** Zod schema for the daemon's health answer. */
export const daemonHealthSchema = z.object({
  status: z.literal('running'),
  pid: z.number().int(),
  version: z.string(),
  startedAt: z.string(),
  uptimeSeconds: z.number(),
  runtimes: z.array(daemonRuntimeProbeSchema),
}) satisfies z.ZodType<DaemonHealth>

/** The daemon probe's verdict. */
export type DaemonProbe =
  | { running: true; health: DaemonHealth; state: DaemonState }
  | { running: false }

/** Options for {@link probeDaemonHealth}. */
export interface ProbeDaemonOptions {
  /** Fetch implementation; defaults to the global fetch. */
  fetchImpl?: typeof fetch
  /** Health request budget in milliseconds; defaults to 300. */
  timeoutMs?: number
  /** State reader seam; defaults to {@link readDaemonState}. */
  readState?: () => Promise<DaemonState | undefined>
}

/**
 * Ask whether a daemon is alive and what it has sensed.
 * @param options - fetch/timeout/state seams.
 * @returns the validated health answer, or `running: false` for every
 * failure spelling.
 */
export async function probeDaemonHealth(options: ProbeDaemonOptions = {}): Promise<DaemonProbe> {
  const state = await (options.readState ?? readDaemonState)()
  if (state === undefined) return { running: false }
  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(
      `http://127.0.0.1:${state.port}/health`,
      { signal: AbortSignal.timeout(options.timeoutMs ?? 300) },
    )
  } catch {
    // A dead daemon refuses the connection; a slow one trips the timeout.
    return { running: false }
  }
  if (!response.ok) return { running: false }
  try {
    const parsed = daemonHealthSchema.safeParse(await response.json())
    return parsed.success ? { running: true, health: parsed.data, state } : { running: false }
  } catch {
    // A non-JSON answer means a foreign service owns the port now.
    return { running: false }
  }
}

/** Options for {@link requestDaemonShutdown}. */
export interface ShutdownDaemonOptions {
  /** Fetch implementation; defaults to the global fetch. */
  fetchImpl?: typeof fetch
  /** Shutdown request budget in milliseconds; defaults to 2000. */
  timeoutMs?: number
}

/**
 * Ask a daemon to shut down gracefully through its endpoint.
 * @param port - the loopback port from the daemon's state document.
 * @param options - fetch/timeout seams.
 * @returns whether the daemon accepted the request.
 */
export async function requestDaemonShutdown(port: number, options: ShutdownDaemonOptions = {}): Promise<boolean> {
  try {
    const response = await (options.fetchImpl ?? fetch)(
      `http://127.0.0.1:${port}/shutdown`,
      { method: 'POST', signal: AbortSignal.timeout(options.timeoutMs ?? 2000) },
    )
    return response.ok
  } catch {
    // The daemon is already gone, or never heard us — the caller falls back
    // to a signal.
    return false
  }
}
