/**
 * Host-subprocess plumbing for the desktop shell, kept Electron-free so the
 * unit suite covers it under plain Node: the launch vector for the real
 * `dsh web` composition, the settled-ready URL-line parser, and bounded stop
 * semantics.
 * @module @deepseek-ai/dsh-desktop/launcher
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The ChildProcess surface {@link stopHost} depends on, as a structural type:
 * a `ChildProcess` satisfies it, and unit tests stub it to drive the
 * escalation decisions without the vitest worker's grandchild-signal
 * environment (the real signal chain is covered by the web-launch e2e).
 */
export interface StoppableChild {
  /** The child's exit code, or null while it runs. */
  readonly exitCode: number | null
  /** The signal that killed the child, or null. */
  readonly signalCode: NodeJS.Signals | null
  /** Deliver one signal to the child. */
  kill(signal: NodeJS.Signals): boolean
  /** Subscribe to the terminal close event (fires for spawn failure too). */
  once(event: 'close', listener: () => void): void
}

/** The dsh source launcher's entry, relative to the repository root (the root `dsh` script's target). */
const DSH_SOURCE_BIN = 'apps/cli/src/bin.ts'

/** File this shell's pack step drops beside the packaged bundle: the checkout the app hosts. */
const PACKAGED_REPO_ROOT_FILE = 'repo-root'

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

/** Inputs to {@link resolveRepoRoot}, one per resolution source. */
export interface RepoRootInputs {
  /** `DSH_REPO_ROOT` override from the launching environment, when set. */
  envRoot: string | undefined
  /** Whether the shell runs from a packaged application bundle (`app.isPackaged`). */
  packaged: boolean
  /** Packaged bundle's Resources directory (`process.resourcesPath`), when packaged. */
  resourcesPath: string | undefined
  /** Dev-mode anchor: the main-process module's URL, two directories under the repository root. */
  moduleUrl: string
}

/** Resolution outcome: the checkout to host, or a user-actionable message. */
export type RepoRootResolution = { root: string } | { error: string }

/** Whether a directory is a repository checkout this shell can launch. */
function isRepoRoot(dir: string): boolean {
  return existsSync(join(dir, DSH_SOURCE_BIN))
}

/**
 * Resolve the repository checkout this shell hosts. The environment override
 * wins; a packaged bundle reads the marker its pack step recorded; a checkout
 * run derives the root from its own module URL. Every accepted path is
 * validated against the launch target, so a moved checkout fails loud instead
 * of spawning from a stale path.
 * @param inputs - the three resolution sources plus the dev-mode module URL.
 * @returns the repository root, or a message naming the fix.
 */
export function resolveRepoRoot(inputs: RepoRootInputs): RepoRootResolution {
  const validate = (dir: string, origin: string): RepoRootResolution =>
    isRepoRoot(dir)
      ? { root: dir }
      : { error: `${origin} does not name a deepseek-harness checkout (missing ${DSH_SOURCE_BIN}): ${dir}` }
  if (inputs.envRoot !== undefined) {
    if (!inputs.envRoot.startsWith('/')) {
      return { error: `DSH_REPO_ROOT must be an absolute path, got ${JSON.stringify(inputs.envRoot)}` }
    }
    return validate(inputs.envRoot, 'DSH_REPO_ROOT')
  }
  if (inputs.packaged) {
    if (inputs.resourcesPath === undefined) {
      return { error: 'packaged shell without a resources path; set DSH_REPO_ROOT to a deepseek-harness checkout' }
    }
    const marker = join(inputs.resourcesPath, PACKAGED_REPO_ROOT_FILE)
    if (!existsSync(marker)) {
      return { error: 'this app was packed without a repository marker; set DSH_REPO_ROOT to a deepseek-harness checkout' }
    }
    return validate(readFileSync(marker, 'utf8').trim(), 'the repository recorded at pack time')
  }
  return validate(fileURLToPath(new URL('../../..', inputs.moduleUrl)), 'the checkout this shell runs from')
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
export async function stopHost(child: StoppableChild, options: StopHostOptions): Promise<void> {
  // A close already observed (orderly exit, kill by another signal, or a
  // failed spawn, where close alone fires and exitCode carries the errno)
  // leaves nothing to stop.
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
