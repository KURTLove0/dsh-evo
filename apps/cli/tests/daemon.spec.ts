/**
 * Daemon command dispatch: port/interval resolution across flag, env, and
 * defaults; lifecycle outcomes mapped to exit codes and streams; the bin path
 * the background child re-runs; and a real foreground start stopped over its
 * own endpoint.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readDaemonState } from '@deepseek-ai/dsh-daemon'
import type { DaemonInvocation } from '../src/args.ts'
import {
  daemonBinPath,
  resolveDaemonIntervalMs,
  resolveDaemonPort,
  runDaemonCommand,
  type DaemonCommandOperations,
} from '../src/daemon.ts'

const invocation = (overrides: Partial<DaemonInvocation>): DaemonInvocation => ({
  mode: 'daemon',
  command: 'start',
  foreground: false,
  output: 'table',
  follow: false,
  lines: 50,
  ...overrides,
})

/** Recorded lifecycle calls, one array per operation. */
interface RecordedCalls {
  run: unknown[]
  start: unknown[]
  stop: unknown[]
  status: unknown[]
  tail: unknown[]
  version: unknown[]
}

/** Stub operations: every call recorded (overrides included), every outcome scripted. */
function stubOperations(overrides: Partial<DaemonCommandOperations> = {}): { operations: DaemonCommandOperations; calls: RecordedCalls } {
  const calls: RecordedCalls = { run: [], start: [], stop: [], status: [], tail: [], version: [] }
  const record = (name: keyof RecordedCalls) => (...args: unknown[]) => { calls[name].push(args) }
  const tape = (name: keyof RecordedCalls, fn: (...args: never[]) => unknown) => (...args: unknown[]) => {
    calls[name].push(args)
    return fn(...args as never[])
  }
  return {
    calls,
    operations: {
      run: (overrides.run === undefined ? record('run') : tape('run', overrides.run)) as never,
      start: (overrides.start === undefined ? record('start') : tape('start', overrides.start)) as never,
      stop: (overrides.stop === undefined ? record('stop') : tape('stop', overrides.stop)) as never,
      status: (overrides.status === undefined ? record('status') : tape('status', overrides.status)) as never,
      tail: (overrides.tail === undefined ? record('tail') : tape('tail', overrides.tail)) as never,
      version: (overrides.version === undefined ? record('version') : tape('version', overrides.version)) as never,
    },
  }
}

let stdout: ReturnType<typeof vi.spyOn>
let stderr: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('resolveDaemonPort / resolveDaemonIntervalMs', () => {
  it('prefers the flag, then the env, then the default', () => {
    expect(resolveDaemonPort(invocation({ port: 0 }), {})).toBe(0)
    expect(resolveDaemonPort(invocation({}), { DSH_DAEMON_PORT: '19999' })).toBe(19999)
    expect(resolveDaemonPort(invocation({}), {})).toBe(3081)
    expect(resolveDaemonPort(invocation({}), { DSH_DAEMON_PORT: '  ' })).toBe(3081)

    expect(resolveDaemonIntervalMs(invocation({ intervalSeconds: 30 }), {})).toBe(30_000)
    expect(resolveDaemonIntervalMs(invocation({}), { DSH_DAEMON_INTERVAL_MS: '4500' })).toBe(4500)
    expect(resolveDaemonIntervalMs(invocation({}), {})).toBe(15_000)
  })

  it('fails loud on malformed env values', () => {
    expect(() => resolveDaemonPort(invocation({}), { DSH_DAEMON_PORT: 'abc' })).toThrow('DSH_DAEMON_PORT needs an integer 0-65535')
    expect(() => resolveDaemonPort(invocation({}), { DSH_DAEMON_PORT: '70000' })).toThrow('DSH_DAEMON_PORT needs an integer 0-65535')
    expect(() => resolveDaemonIntervalMs(invocation({}), { DSH_DAEMON_INTERVAL_MS: 'fast' })).toThrow('DSH_DAEMON_INTERVAL_MS needs a positive integer')
    expect(() => resolveDaemonIntervalMs(invocation({}), { DSH_DAEMON_INTERVAL_MS: '-1' })).toThrow('DSH_DAEMON_INTERVAL_MS needs a positive integer')
  })
})

describe('daemonBinPath', () => {
  it('names the source bin.ts beside this module in the source tree', () => {
    expect(daemonBinPath()).toMatch(/apps[/\\]cli[/\\]src[/\\]bin\.ts$/)
  })
})

describe('runDaemonCommand', () => {
  it('starts in the background and reports pid and log path', async () => {
    const { operations, calls } = stubOperations({
      start: (() => Promise.resolve({ ok: true, pid: 4321, logPath: '/home/.dsh/daemon/daemon.log' })) as never,
    })
    const code = await runDaemonCommand(invocation({ command: 'start', port: 3081, intervalSeconds: 30 }), operations)
    expect(code).toBe(0)
    expect(calls.start[0]).toEqual([{ binPath: daemonBinPath(), port: 3081, intervalMs: 30_000 }])
    expect(stderr).toHaveBeenCalledWith('Daemon started (pid 4321)\nLogs: /home/.dsh/daemon/daemon.log\n')
  })

  it('maps start failures to exit 1 with actionable output', async () => {
    const already = stubOperations({
      start: (() => Promise.resolve({ ok: false, reason: 'already-running', pid: 4321 })) as never,
    })
    await expect(runDaemonCommand(invocation({ command: 'start' }), already.operations)).resolves.toBe(1)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('already running (pid 4321)'))

    const spawnFailed = stubOperations({
      start: (() => Promise.resolve({ ok: false, reason: 'spawn-failed', logPath: '/x', message: 'ENOEXEC' })) as never,
    })
    await expect(runDaemonCommand(invocation({ command: 'start' }), spawnFailed.operations)).resolves.toBe(1)
    expect(stderr).toHaveBeenCalledWith('Daemon failed to start: ENOEXEC\n')

    const timeout = stubOperations({
      start: (() => Promise.resolve({ ok: false, reason: 'start-timeout', logPath: '/x/daemon.log' })) as never,
    })
    await expect(runDaemonCommand(invocation({ command: 'start' }), timeout.operations)).resolves.toBe(1)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('/x/daemon.log'))
  })

  it('runs the foreground daemon in-process with the resolved options and version', async () => {
    const { operations, calls } = stubOperations({
      run: () => Promise.resolve(0),
      version: () => '9.9.9',
    })
    const code = await runDaemonCommand(invocation({ command: 'start', foreground: true }), operations)
    expect(code).toBe(0)
    expect(calls.run[0]).toEqual([{ port: 3081, intervalMs: 15_000, version: '9.9.9' }])
  })

  it('restarts by stopping first, then starting', async () => {
    const order: string[] = []
    const { operations } = stubOperations({
      stop: (() => { order.push('stop'); return Promise.resolve({ ok: true }) }) as never,
      start: (() => { order.push('start'); return Promise.resolve({ ok: true, pid: 1, logPath: '/x' }) }) as never,
    })
    await expect(runDaemonCommand(invocation({ command: 'restart' }), operations)).resolves.toBe(0)
    expect(order).toEqual(['stop', 'start'])
  })

  it('maps stop outcomes to exit codes', async () => {
    const stopped = stubOperations({ stop: (() => Promise.resolve({ ok: true })) as never })
    await expect(runDaemonCommand(invocation({ command: 'stop' }), stopped.operations)).resolves.toBe(0)
    expect(stderr).toHaveBeenCalledWith('Daemon stopped.\n')

    const notRunning = stubOperations({ stop: (() => Promise.resolve({ ok: false, reason: 'not-running' })) as never })
    await expect(runDaemonCommand(invocation({ command: 'stop' }), notRunning.operations)).resolves.toBe(0)
    expect(stderr).toHaveBeenCalledWith('Daemon is not running.\n')

    const timeout = stubOperations({ stop: (() => Promise.resolve({ ok: false, reason: 'stop-timeout' })) as never })
    await expect(runDaemonCommand(invocation({ command: 'stop' }), timeout.operations)).resolves.toBe(1)
  })

  it('renders status as table and as json', async () => {
    const view = {
      running: true,
      health: { status: 'running', pid: 1, version: '0.1.1-rc.1', startedAt: 't', uptimeSeconds: 65, runtimes: [{ command: 'claude', label: 'Claude CLI', present: true, checkedAt: 't' }] },
      logPath: '/x/daemon.log',
    }
    const running = stubOperations({ status: (() => Promise.resolve(view)) as never })
    await expect(runDaemonCommand(invocation({ command: 'status' }), running.operations)).resolves.toBe(0)
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Daemon: running (pid 1, uptime 1m 5s)'))

    await expect(runDaemonCommand(invocation({ command: 'status', output: 'json' }), running.operations)).resolves.toBe(0)
    expect(stdout).toHaveBeenCalledWith(`${JSON.stringify(view.health, null, 2)}\n`)

    const stopped = stubOperations({ status: () => Promise.resolve({ running: false, health: undefined, logPath: '/x' }) })
    await expect(runDaemonCommand(invocation({ command: 'status', output: 'json' }), stopped.operations)).resolves.toBe(0)
    expect(stdout).toHaveBeenCalledWith(`${JSON.stringify({ status: 'stopped' }, null, 2)}\n`)
  })

  it('tails logs, failing when none exists', async () => {
    const ok = stubOperations({ tail: (() => Promise.resolve({ ok: true })) as never })
    await expect(runDaemonCommand(invocation({ command: 'logs', lines: 100, follow: true }), ok.operations)).resolves.toBe(0)
    expect(ok.calls.tail[0]).toEqual([{ lines: 100, follow: true }])

    const noLog = stubOperations({ tail: (() => Promise.resolve({ ok: false, reason: 'no-log', logPath: '/x/daemon.log' })) as never })
    await expect(runDaemonCommand(invocation({ command: 'logs' }), noLog.operations)).resolves.toBe(1)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('/x/daemon.log'))
  })
})

describe('runDaemonCommand (real foreground daemon)', () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-cli-daemon-'))
    vi.stubEnv('DSH_HOME', home)
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  it('starts a real daemon, publishes state, and exits 0 on /shutdown', async () => {
    const running = runDaemonCommand(invocation({ command: 'start', foreground: true, port: 0, intervalSeconds: 60 }))
    let state: Awaited<ReturnType<typeof readDaemonState>>
    await vi.waitFor(async () => {
      state = await readDaemonState()
      expect(state).toBeDefined()
    })
    const response = await fetch(`http://127.0.0.1:${state?.port ?? 0}/shutdown`, { method: 'POST' })
    expect(response.status).toBe(200)
    await expect(running).resolves.toBe(0)
    expect(await readDaemonState()).toBeUndefined()
  }, 15_000)
})
