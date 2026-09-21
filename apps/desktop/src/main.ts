/**
 * The dsh desktop shell's Electron main process: boot the real `dsh web`
 * composition as a child process, load its settled loopback URL into a
 * BrowserWindow, and own the child's lifecycle for the window's lifetime. The
 * renderer keeps every default (sandboxed, context-isolated, no node
 * integration, no preload): it is the ordinary Web GUI on its ordinary
 * transport, not a native surface.
 * @module @deepseek-ai/dsh-desktop/main
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { app, BrowserWindow, dialog, net } from 'electron'
import { buildDshWebLaunch, parseWebUrlLine, resolveRepoRoot, stopHost } from './launcher.ts'

/** Bound for observing the settled-ready URL line (a source boot under tsx is seconds warm, tens cold). */
const URL_LINE_TIMEOUT_MS = 60_000
/** Bound for the first reachable page after the URL line. */
const PROBE_TIMEOUT_MS = 30_000
/** Probe cadence while the page is not yet reachable. */
const PROBE_INTERVAL_MS = 250
/** Grace period before SIGKILL escalation when stopping the host child. */
const HOST_STOP_GRACE_MS = 10_000
/** Bytes of host stderr kept for the failure dialog. */
const STDERR_TAIL_LIMIT = 2000

/** The `dsh web` host child, set once spawned; one shell lifetime boots one host. */
let host: ChildProcess | undefined
/** Deliberate stop in flight — memoized so every cleanup path shares one SIGTERM. */
let hostStop: Promise<void> | undefined
/** The shell's only window, or undefined while (re)creating or after it closed. */
let mainWindow: BrowserWindow | undefined
/** True once the before-quit flow owns process exit. */
let quitting = false
/** True once a failure dialog has been shown; one failure owns the exit. */
let failed = false
/** Tail of host stderr for the failure dialog. */
let stderrTail = ''
/** Routes host close events to the phase that owns them: boot rejection, ready-phase failure, or nothing while stopping. */
let onHostClose: (code: number | null, signal: NodeJS.Signals | null) => void = () => {}

/** Fail the shell: log, one dialog, a bounded host stop, and a nonzero exit. */
async function fail(message: string): Promise<void> {
  if (failed || quitting) return
  failed = true
  // stderr first: a dialog blocks until dismissed, and a headless launch
  // (open-packaged smoke, CI) reads the reason from the captured stream.
  console.error(`dsh desktop: ${message}`)
  dialog.showErrorBox('dsh desktop', `${message}\n\n${stderrTail.trim()}`)
  await stopHostIfAny()
  app.exit(1)
}

/**
 * Stop the host child once per lifetime: suppress close routing, then SIGTERM
 * with SIGKILL escalation. Later callers await the same stop.
 * @returns completion when the child is gone.
 */
async function stopHostIfAny(): Promise<void> {
  if (host === undefined) return
  if (hostStop === undefined) {
    onHostClose = () => {}
    hostStop = stopHost(host, { graceMs: HOST_STOP_GRACE_MS })
  }
  await hostStop
}

/**
 * Await the settled-ready URL line from the booting host. Rejects when the
 * child closes first or the bound elapses; settles the close routing to a
 * no-op so a later close cannot re-reject.
 * @param child - the booting `dsh web` child.
 * @returns the loopback URL the shell loads.
 */
function awaitReadyUrl(child: ChildProcess): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let stdout = ''
    const settle = (outcome: { error: Error } | { url: string }): void => {
      clearTimeout(timer)
      child.stdout?.off('data', onStdout)
      onHostClose = () => {}
      if ('error' in outcome) reject(outcome.error)
      else resolve(outcome.url)
    }
    const onStdout = (chunk: string): void => {
      stdout += chunk
      const url = parseWebUrlLine(stdout)
      if (url !== undefined) settle({ url })
    }
    const timer = setTimeout(() => {
      settle({ error: new Error(`dsh web did not print its ready URL within ${String(URL_LINE_TIMEOUT_MS / 1000)}s`) })
    }, URL_LINE_TIMEOUT_MS)
    onHostClose = (code, signal) => {
      settle({ error: new Error(`dsh web closed before its ready URL (code ${String(code)}, signal ${String(signal)})`) })
    }
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', onStdout)
  })
}

/**
 * Poll the loopback URL until the page answers. The URL line already means
 * the webserver listens; this bound covers a listen backlog or a sibling
 * route still mounting.
 * @param url - the settled-ready loopback URL.
 * @returns completion on the first 2xx answer.
 * @throws when the bound elapses without an answer.
 */
async function probeUntilReachable(url: string): Promise<void> {
  const deadline = Date.now() + PROBE_TIMEOUT_MS
  for (;;) {
    try {
      const response = await net.fetch(url)
      void response.body?.cancel().catch(() => {})
      if (response.ok) return
    } catch {
      // not listening yet or refused — retry until the deadline
    }
    if (Date.now() >= deadline) {
      throw new Error(`the Web UI at ${url} did not answer within ${String(PROBE_TIMEOUT_MS / 1000)}s`)
    }
    await new Promise<void>((resolve) => { setTimeout(resolve, PROBE_INTERVAL_MS) })
  }
}

/**
 * Create the shell's window over the ready URL. Hidden until its first paint
 * so the boot never shows a blank frame; every webPreferences default stands
 * (sandbox, context isolation, no node integration, no preload) because the
 * renderer is the ordinary Web GUI.
 * @param url - the settled-ready loopback URL.
 */
function createWindow(url: string): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
  })
  mainWindow = win
  win.once('ready-to-show', () => { win.show() })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = undefined
  })
  void win.loadURL(url).catch((error: unknown) => {
    void fail(`the window could not load ${url}: ${error instanceof Error ? error.message : String(error)}`)
  })
}

/** Boot the host child, wait for readiness, and open the window over it. */
async function start(): Promise<void> {
  const resolved = resolveRepoRoot({
    envRoot: process.env.DSH_REPO_ROOT,
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    moduleUrl: import.meta.url,
  })
  if ('error' in resolved) throw new Error(resolved.error)
  const launch = buildDshWebLaunch(resolved.root)
  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: { ...process.env, ...launch.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  host = child
  // stdio pipes are pinned above, so stdout/stderr are non-null by type.
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => { process.stdout.write(chunk) })
  child.stderr.on('data', (chunk: string) => {
    process.stderr.write(chunk)
    stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_LIMIT)
  })
  child.on('close', (code, signal) => { onHostClose(code, signal) })
  child.on('error', (error) => {
    void fail(`the dsh web host could not start: ${error.message}`)
  })

  const url = await awaitReadyUrl(child)
  // Past the boot phase an unrequested close is the GUI losing its server;
  // deliberate stops route through stopHostIfAny, which cleared this first.
  onHostClose = (code, signal) => {
    void fail(`dsh web exited unexpectedly (code ${String(code)}, signal ${String(signal)})`)
  }
  await probeUntilReachable(url)
  createWindow(url)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = mainWindow
    if (win === undefined) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
  app.on('window-all-closed', () => {
    // The window is the shell's whole surface: with it closed, a hidden host
    // child would only surprise the next user of that port. Quit on every
    // platform rather than keeping the app docked with no window.
    app.quit()
  })
  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()
    void stopHostIfAny().then(() => { app.quit() })
  })
  void app.whenReady().then(start).catch((error: unknown) => {
    // A quit already in flight owns the exit path; its stop is the reason the
    // boot rejected, so the failure dialog would only race the real cause.
    if (quitting) return
    void fail(error instanceof Error ? error.message : String(error))
  })
}
