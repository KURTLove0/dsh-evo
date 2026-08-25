/**
 * Host-subprocess plumbing for the desktop shell, kept Electron-free so the
 * unit suite covers it under plain Node: the launch vector for the real
 * `dsh web` composition, the settled-ready URL-line parser, and bounded stop
 * semantics.
 * @module @deepseek-ai/dsh-desktop/launcher
 */

import type { ChildProcess } from 'node:child_process'
import { join } from 'node:path'

/** The dsh source launcher's entry, relative to the repository root (the root `dsh` script's target). */
const DSH_SOURCE_BIN = 'apps/cli/src/bin.ts'

/**
 * The settled-ready line `dsh web` prints after its Loader tree settles. The
 * loopback URL always renders as the 127.0.0.1 literal; an all-interfaces bind
 * appends a display-only ` (LAN: …)` suffix that carries no part of the URL
 * this shell loads.
 */
const WEB_URL_LINE = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)(?: \(LAN: .*)?\r?$/m

/** One spawnable description of the `dsh web` child process. */
export interface DshWebLaunch {
  /** Executable to run: the Electron binary in node mode from the desktop shell, plain Node elsewhere. */
  command: string
  /** Full argv after the executable. */
  args: readonly string[]
  /** Working directory anchoring source resolution: the repository root. */
  cwd: string
  /** Environment additions the caller merges into the child's environment. */
  env: NodeJS.ProcessEnv
}

/** Options for {@link stopHost}. */
export interface StopHostOptions {
  /** Grace period before escalating from SIGTERM to SIGKILL. */
  graceMs: number
}

/**
 * Build the launch vector for one `dsh web` child process from a repository
 * checkout: the source-launch contract of the root `dsh` script
 * (`node --import tsx/esm apps/cli/src/bin.ts`) plus two shell-owned
 * additions. `--expose-internals` keeps the vendored Loader's internal-module
 * access working when its native addon cannot attach — always, under the
 * Electron binary this shell runs as its Node runtime, because the addon
 * needs an embedder slot plain Node provides and Electron node mode does not
 * ([branch](../../vendor/loader/src/internal.ts)); without the internal
 * loader, bare plugin names stop resolving and the tree fails to load.
 * `--port 0` asks the OS for a free port and `--no-open` suppresses the
 * default-browser handoff because the desktop window — not a browser — is
 * this host's consumer.
 * @param repoRoot - absolute repository root; the child's cwd.
 * @returns the executable, argv, cwd, and environment additions.
 */
export function buildDshWebLaunch(repoRoot: string): DshWebLaunch {
  return {
    command: process.execPath,
    args: [
      '--expose-internals',
      '--import', 'tsx/esm',
      join(repoRoot, DSH_SOURCE_BIN),
      'web', '--no-open', '--port', '0',
    ],
    cwd: repoRoot,
    // The Electron binary doubles as the child's Node runtime, keeping the
    // shell free of a separate system Node requirement; plain Node ignores
    // the variable, so the same vector runs in tests.
    env: { ELECTRON_RUN_AS_NODE: '1' },
  }
}

/**
 * Extract the settled-ready loopback URL from accumulated child stdout. The
 * line is a readiness signal: `dsh web` prints it only after the Loader tree
 * settles, so a parse means the webserver is listening.
 * @param stdout - everything the child has written to stdout so far.
 * @returns the loopback URL, or undefined while no ready line has appeared.
 */
export function parseWebUrlLine(stdout: string): string | undefined {
  return WEB_URL_LINE.exec(stdout)?.[1]
}

/**
 * Stop one `dsh web` child: SIGTERM first — the shipped launcher drains its
 * fiber tree and exits 0 — escalating to SIGKILL only after the grace period
 * expires. Resolves once the child is gone through either path.
 * @param child - the spawned `dsh web` process.
 * @param options - the grace period before forced termination.
 * @returns completion when the child has exited.
 */
export async function stopHost(child: ChildProcess, options: StopHostOptions): Promise<void> {
  // `close`, not `exit`: a spawn that failed before the process existed emits
  // `close` alone, and `exitCode` carries the negative spawn errno.
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => {
    child.once('close', () => { resolve() })
  })
  child.kill('SIGTERM')
  const timedOut = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => { resolve(true) }, options.graceMs)
    void exited.then(() => {
      clearTimeout(timer)
      resolve(false)
    })
  })
  if (timedOut) {
    child.kill('SIGKILL')
    await exited
  }
}
