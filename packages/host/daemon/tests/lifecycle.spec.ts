/**
 * Daemon lifecycle helpers: start's already-running/spawn/poll outcomes,
 * stop's graceful/kill/timeout outcomes, status rendering, and the log
 * tail's initial and follow behaviors — all over injected seams.
 */

import { spawn as spawnChild } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DaemonProbe } from '../src/client.ts'
import {
  daemonStatus,
  formatUptime,
  renderStatusTable,
  startDaemon,
  stopDaemon,
  tailDaemonLog,
} from '../src/lifecycle.ts'
import { createDaemonServer, type DaemonHealth } from '../src/server.ts'
import { daemonDir, daemonLogPath } from '../src/state.ts'

const HEALTH: DaemonHealth = {
  status: 'running',
  pid: 4321,
  version: '0.1.1-rc.1',
  startedAt: '2026-09-28T10:00:00.000Z',
  uptimeSeconds: 125,
  runtimes: [
    { command: 'claude', label: 'Claude CLI', present: true, checkedAt: '2026-09-28T10:02:00.000Z' },
    { command: 'codex', label: 'Codex CLI', present: false, checkedAt: '2026-09-28T10:02:00.000Z' },
  ],
}

const runningProbe: DaemonProbe = { running: true, health: HEALTH, state: { pid: 4321, port: 3081, version: '0.1.1-rc.1', startedAt: HEALTH.startedAt } }
const stoppedProbe: DaemonProbe = { running: false }

const noSleep = (): Promise<void> => Promise.resolve()

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-daemon-lifecycle-'))
  vi.stubEnv('DSH_HOME', home)
  await mkdir(daemonDir(), { recursive: true })
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(home, { recursive: true, force: true })
})

describe('startDaemon', () => {
  it('refuses to start over a live daemon', async () => {
    const result = await startDaemon(
      { binPath: '/cli/bin.js', port: 3081, intervalMs: 15_000 },
      { probe: () => Promise.resolve(runningProbe) },
    )
    expect(result).toEqual({ ok: false, reason: 'already-running', pid: 4321 })
  })

  it('spawns the detached child with daemon env and resolves once health answers', async () => {
    const calls: unknown[] = []
    const child = { unref: vi.fn() }
    const spawn = ((...args: unknown[]) => {
      calls.push(args)
      return child
    }) as never
    let probes = 0
    const probe = (): Promise<DaemonProbe> => {
      probes += 1
      return Promise.resolve(probes === 1 ? stoppedProbe : runningProbe)
    }
    const result = await startDaemon(
      { binPath: '/cli/bin.js', port: 3081, intervalMs: 15_000 },
      { spawn, probe, sleep: noSleep },
    )
    expect(result).toEqual({ ok: true, pid: 4321, logPath: daemonLogPath() })
    expect(child.unref).toHaveBeenCalledOnce()
    const [exe, argv, spawnOptions] = calls[0] as [string, string[], { detached: boolean; env: Record<string, string> }]
    expect(exe).toBe(process.execPath)
    expect(argv.at(-3)).toBe('daemon')
    expect(argv.slice(-3)).toEqual(['daemon', 'start', '--foreground'])
    expect(argv.at(-4)).toBe('/cli/bin.js')
    expect(spawnOptions.detached).toBe(true)
    expect(spawnOptions.env.DSH_DAEMON_PORT).toBe('3081')
    expect(spawnOptions.env.DSH_DAEMON_INTERVAL_MS).toBe('15000')
  })

  it('reports a spawn failure with the log path and cleans the descriptor', async () => {
    const spawn = (() => { throw new Error('ENOEXEC') }) as never
    const result = await startDaemon(
      { binPath: '/cli/bin.js', port: 3081, intervalMs: 15_000 },
      { spawn, probe: () => Promise.resolve(stoppedProbe) },
    )
    expect(result).toEqual({ ok: false, reason: 'spawn-failed', logPath: daemonLogPath(), message: 'ENOEXEC' })

    // A non-Error throw still produces a message.
    const weirdSpawn = (() => { throw 'raw failure' }) as never
    const weird = await startDaemon(
      { binPath: '/cli/bin.js', port: 3081, intervalMs: 15_000 },
      { spawn: weirdSpawn, probe: () => Promise.resolve(stoppedProbe) },
    )
    expect(weird).toEqual({ ok: false, reason: 'spawn-failed', logPath: daemonLogPath(), message: 'raw failure' })
  })

  it('times out when the child never reports healthy', async () => {
    const child = { unref: vi.fn() }
    const spawn = (() => child) as never
    const result = await startDaemon(
      { binPath: '/cli/bin.js', port: 3081, intervalMs: 15_000 },
      { spawn, probe: () => Promise.resolve(stoppedProbe), sleep: noSleep, startupTimeoutMs: 250 },
    )
    expect(result).toEqual({ ok: false, reason: 'start-timeout', logPath: daemonLogPath() })
  })
})

describe('stopDaemon', () => {
  it('answers not-running without touching anything', async () => {
    const result = await stopDaemon({ probe: () => Promise.resolve(stoppedProbe) })
    expect(result).toEqual({ ok: false, reason: 'not-running' })
  })

  it('stops gracefully through the real endpoint and sweeps the state document', async () => {
    // No shutdown seam: the default requestDaemonShutdown POSTs to the live
    // server, whose onShutdown flips the next probe to stopped.
    let alive = true
    const server = await createDaemonServer({
      port: 0,
      version: '0.1.1-rc.1',
      startedAt: HEALTH.startedAt,
      report: () => ({ runtimes: [] }),
      onShutdown: () => { alive = false },
    })
    const probe = (): Promise<DaemonProbe> => Promise.resolve(alive
      ? { running: true, health: HEALTH, state: { pid: 4321, port: server.port, version: '0.1.1-rc.1', startedAt: HEALTH.startedAt } }
      : stoppedProbe)
    const clearState = vi.fn(() => Promise.resolve())
    await expect(stopDaemon({ probe, clearState, sleep: noSleep })).resolves.toEqual({ ok: true })
    expect(clearState).toHaveBeenCalledOnce()
    await server.close()
  })

  it('falls back to the default kill on a real child when the endpoint refuses', async () => {
    // No kill seam: the default process.kill SIGTERMs the wedged child.
    const child = spawnChild(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    const gone = new Promise<number | null>((resolve) => { child.once('exit', (code) => { resolve(code) }) })
    try {
      let probes = 0
      const probe = (): Promise<DaemonProbe> => {
        probes += 1
        return Promise.resolve(probes === 1
          ? { running: true, health: { ...HEALTH, pid: child.pid ?? 0 }, state: { pid: child.pid ?? 0, port: 3081, version: '0.1.1-rc.1', startedAt: HEALTH.startedAt } }
          : stoppedProbe)
      }
      await expect(stopDaemon({ probe, shutdown: () => Promise.resolve(false), sleep: noSleep, clearState: () => Promise.resolve() }))
        .resolves.toEqual({ ok: true })
      await gone
    } finally {
      child.kill('SIGKILL')
    }
  })

  it('falls back to a signal when the endpoint refuses the shutdown', async () => {
    const kill = vi.fn()
    let probes = 0
    const probe = (): Promise<DaemonProbe> => {
      probes += 1
      return Promise.resolve(probes === 1 ? runningProbe : stoppedProbe)
    }
    await expect(stopDaemon({ probe, shutdown: () => Promise.resolve(false), kill, sleep: noSleep, clearState: () => Promise.resolve() }))
      .resolves.toEqual({ ok: true })
    expect(kill).toHaveBeenCalledWith(4321)
  })

  it('times out when the daemon stays alive', async () => {
    const result = await stopDaemon({
      probe: () => Promise.resolve(runningProbe),
      shutdown: () => Promise.resolve(true),
      sleep: noSleep,
      stopTimeoutMs: 300,
    })
    expect(result).toEqual({ ok: false, reason: 'stop-timeout' })
  })
})

describe('daemonStatus + renderStatusTable + formatUptime', () => {
  it('renders the running table with the sensing report', async () => {
    const view = await daemonStatus({ probe: () => Promise.resolve(runningProbe) })
    expect(view).toEqual({ running: true, health: HEALTH, logPath: daemonLogPath() })
    expect(renderStatusTable(view)).toBe([
      'Daemon: running (pid 4321, uptime 2m 5s)',
      'Version: 0.1.1-rc.1',
      'Runtimes: claude (present), codex (missing)',
      `Log: ${daemonLogPath()}`,
    ].join('\n'))
  })

  it('renders the stopped posture with the start hint', async () => {
    const view = await daemonStatus({ probe: () => Promise.resolve(stoppedProbe) })
    expect(view).toEqual({ running: false, health: undefined, logPath: daemonLogPath() })
    expect(renderStatusTable(view)).toBe(['Daemon: stopped', 'Start it with: dsh daemon start'].join('\n'))
    expect(renderStatusTable({ running: true, health: undefined, logPath: '/x' })).toContain('Daemon: stopped')
  })

  it('formats uptimes as the largest two readable units', () => {
    expect(formatUptime(9)).toBe('9s')
    expect(formatUptime(59.9)).toBe('59s')
    expect(formatUptime(60)).toBe('1m 0s')
    expect(formatUptime(200)).toBe('3m 20s')
    expect(formatUptime(3600)).toBe('1h 0m')
    expect(formatUptime(7_500)).toBe('2h 5m')
    expect(formatUptime(86_400)).toBe('1d 0h')
    expect(formatUptime(93_600)).toBe('1d 2h')
  })
})

describe('tailDaemonLog', () => {
  it('answers no-log when no log file exists', async () => {
    const result = await tailDaemonLog({}, { write: () => {} })
    expect(result).toEqual({ ok: false, reason: 'no-log', logPath: daemonLogPath() })
  })

  it('prints the trailing lines, defaulting to fifty and skipping empties', async () => {
    const lines = Array.from({ length: 60 }, (_, index) => `line-${index + 1}`)
    await writeFile(daemonLogPath(), `${lines.join('\n')}\n`)
    const out: string[] = []
    await expect(tailDaemonLog({}, { write: (text) => { out.push(text) } })).resolves.toEqual({ ok: true })
    expect(out).toEqual([`${lines.slice(-50).join('\n')}\n`])

    out.length = 0
    await expect(tailDaemonLog({ lines: 2 }, { write: (text) => { out.push(text) } })).resolves.toEqual({ ok: true })
    expect(out).toEqual(['line-59\nline-60\n'])

    await writeFile(daemonLogPath(), '')
    out.length = 0
    await expect(tailDaemonLog({}, { write: (text) => { out.push(text) } })).resolves.toEqual({ ok: true })
    expect(out).toEqual([])
  })

  it('writes to stdout by default', async () => {
    await writeFile(daemonLogPath(), 'hello\n')
    const printed = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await expect(tailDaemonLog({})).resolves.toEqual({ ok: true })
    expect(printed).toHaveBeenCalledWith('hello\n')
    printed.mockRestore()
  })

  it('follows appended content, restarts a truncated log, and skips vanished files', async () => {
    await writeFile(daemonLogPath(), 'first\n')
    const out: string[] = []
    let polls = 0
    const shouldContinue = (): boolean => {
      polls += 1
      return polls <= 4
    }
    let tick = 0
    const sleep = (): Promise<void> => {
      tick += 1
      return (async () => {
        if (tick === 1) await rm(daemonLogPath(), { force: true })
        if (tick === 2) await writeFile(daemonLogPath(), 'first\nsecond\n')
        if (tick === 3) await writeFile(daemonLogPath(), 'x\n')
        if (tick === 4) await writeFile(daemonLogPath(), 'x\ny\n')
      })()
    }
    await expect(tailDaemonLog(
      { follow: true },
      { write: (text) => { out.push(text) }, sleep, shouldContinue, followIntervalMs: 1 },
    )).resolves.toEqual({ ok: true })
    expect(out).toEqual(['first\n', 'second\n', 'x\n', 'y\n'])
  })

  it('follows with the default clock, skipping polls without growth', async () => {
    await writeFile(daemonLogPath(), 'a\n')
    const out: string[] = []
    let polls = 0
    // No sleep seam: the default clock runs on the 1ms follow interval. The
    // continuation check mutates the log before the poll that reads it.
    const shouldContinue = (): boolean => {
      polls += 1
      if (polls === 1) appendFileSync(daemonLogPath(), 'b\n')
      return polls < 3
    }
    await expect(tailDaemonLog(
      { follow: true },
      { write: (text) => { out.push(text) }, shouldContinue, followIntervalMs: 1 },
    )).resolves.toEqual({ ok: true })
    expect(out).toEqual(['a\n', 'b\n'])
  })

  it('lets a clock failure escape the follow loop', async () => {
    await writeFile(daemonLogPath(), 'first\n')
    const sleep = (): Promise<void> => Promise.reject(new Error('clock exploded'))
    await expect(tailDaemonLog({ follow: true }, { write: () => {}, sleep })).rejects.toThrow('clock exploded')
  })
})
