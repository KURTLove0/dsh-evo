/**
 * Daemon state files: the daemon publishes its identity under the harness
 * home so the CLI and the API proxy can find the health endpoint. An absent
 * or unreadable state document means "no daemon" — consumers never guess a
 * port.
 * @module @deepseek-ai/dsh-daemon/state
 */

import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Identity the daemon publishes about itself once it serves. */
export interface DaemonState {
  /** Process id of the running daemon. */
  pid: number
  /** Loopback port the health endpoint bound. */
  port: number
  /** CLI version that started the daemon. */
  version: string
  /** ISO timestamp of the daemon's start. */
  startedAt: string
}

/** Zod schema for the on-disk daemon state document. */
export const daemonStateSchema = z.object({
  pid: z.number().int().positive(),
  port: z.number().int().min(1).max(65_535),
  version: z.string(),
  startedAt: z.string().min(1),
}) satisfies z.ZodType<DaemonState>

/**
 * Directory holding the daemon's state files.
 * @returns `<harness home>/daemon` for the current environment.
 */
export function daemonDir(): string {
  return join(resolveDshHome(), 'daemon')
}

/**
 * Absolute path of the daemon state document.
 * @returns the state document path for the current environment.
 */
export function daemonStatePath(): string {
  return join(daemonDir(), 'daemon.json')
}

/**
 * Absolute path of the daemon log file the background child's output lands in.
 * @returns the log file path for the current environment.
 */
export function daemonLogPath(): string {
  return join(daemonDir(), 'daemon.log')
}

/**
 * Read the daemon's published state.
 * @returns the parsed state, or `undefined` when the document is absent,
 * unreadable, malformed, or fails validation — all spellings of "no daemon".
 */
export async function readDaemonState(): Promise<DaemonState | undefined> {
  let raw: string
  try {
    raw = await readFile(daemonStatePath(), 'utf8')
  } catch {
    // Absence (and any read failure) is the "no daemon" answer; the state
    // document is the daemon's own claim, never a consumer's guess.
    return undefined
  }
  try {
    const parsed = daemonStateSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : undefined
  } catch {
    // Malformed JSON is a torn write or a foreign file — not a daemon.
    return undefined
  }
}

/**
 * Publish the daemon's state atomically, owner-only.
 * @param state - the identity to publish.
 * @returns nothing after the document is replaced.
 */
export async function writeDaemonState(state: DaemonState): Promise<void> {
  await writeFileAtomic(daemonStatePath(), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
}

/**
 * Drop the published state. Absent documents are fine — clearing is
 * idempotent, so a crashed daemon's leftover and a clean exit's sweep share
 * this one path.
 * @returns nothing after the document is gone.
 */
export async function clearDaemonState(): Promise<void> {
  await rm(daemonStatePath(), { force: true })
}
