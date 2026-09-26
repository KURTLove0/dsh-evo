/**
 * Local-command presence probe for the llm domain: whether the executable a
 * local-CLI runtime declares resolves on this host. The answer rides the
 * provider listing as a row fact; a missing CLI degrades the row to "not
 * present", it never fails the call.
 */

import { spawnSync } from 'node:child_process'
import { accessSync, constants } from 'node:fs'

/** Test seam over the platform answer, the PATH-resolver spawn, and path checks. */
export interface CommandPresenceInternals {
  /** Operating system selecting the PATH resolver; defaults to the host's. */
  platform?: NodeJS.Platform
  /** Spawn used for the PATH resolver; defaults to {@link spawnSync}. */
  spawn?: typeof spawnSync
  /** Access check used for commands naming a path; defaults to {@link accessSync}. */
  access?: typeof accessSync
}

/**
 * Whether `command` resolves to an executable on this host. A bare name goes
 * through the platform's own PATH resolver (`which`, or `where` on Windows);
 * a command containing a path separator is checked for the executable bit
 * directly. A backslash marks a Windows path on any host — a PATH command
 * never carries one.
 * @param command - the executable name or path the adapter declared.
 * @param internals - platform/spawn/access seam for deterministic tests.
 * @returns whether a request through this runtime can start at all.
 */
export function commandPresent(command: string, internals: CommandPresenceInternals = {}): boolean {
  if (command.includes('/') || command.includes('\\')) {
    try {
      (internals.access ?? accessSync)(command, constants.X_OK)
      return true
    } catch {
      // A missing or non-executable path is exactly the "not present" answer;
      // no other failure reaches accessSync on a path string the caller owns.
      return false
    }
  }
  const finder = (internals.platform ?? process.platform) === 'win32' ? 'where' : 'which'
  return (internals.spawn ?? spawnSync)(finder, [command], { stdio: 'ignore' }).status === 0
}
