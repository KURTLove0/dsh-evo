/**
 * runDaemon: publish-serve-shutdown lifecycle, signal/endpoint convergence on
 * one teardown path, bind failure as exit 1, and the default signal
 * installer's register/invoke/remove behavior.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readDaemonState } from '../src/state.ts'
import { createDaemonServer } from '../src/server.ts'
import { installShutdownSignals, runDaemon } from '../src/run.ts'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-daemon-run-'))
  vi.stubEnv('DSH_HOME', home)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(home, { recursive: true, force: true })
})

describe('runDaemon', () => {
  it('publishes state, serves health, and exits 0 after a /shutdown with the state swept', async () => {
    const lines: string[] = []
    let port = 0
    const beforeTerm = process.listenerCount('SIGTERM')
    const beforeInt = process.listenerCount('SIGINT')
    // No installSignals seam: the default SIGTERM/SIGINT installer is on duty.
    const running = runDaemon({
      port: 0,
      intervalMs: 60_000,
      version: '0.1.1-rc.1',
      log: (line) => { lines.push(line) },
      onReady: (server) => { port = server.port },
    })
    await vi.waitFor(() => { expect(port).not.toBe(0) })
    const state = await readDaemonState()
    expect(state).toMatchObject({ pid: process.pid, port, version: '0.1.1-rc.1' })
    expect(lines[0]).toContain(`http://127.0.0.1:${port}/health`)

    const health = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as { status: string }
    expect(health.status).toBe('running')
    const shutdown = await fetch(`http://127.0.0.1:${port}/shutdown`, { method: 'POST' })
    expect(shutdown.status).toBe(200)
    await expect(running).resolves.toBe(0)
    expect(await readDaemonState()).toBeUndefined()
    expect(process.listenerCount('SIGTERM')).toBe(beforeTerm)
    expect(process.listenerCount('SIGINT')).toBe(beforeInt)
  })

  it('exits through the signal path with the same teardown, ignoring a second stop request', async () => {
    let shutdown: (() => void) | undefined
    const running = runDaemon({
      port: 0,
      intervalMs: 60_000,
      version: '0.1.1-rc.1',
      log: () => {},
      installSignals: (handler) => {
        shutdown = handler
        return () => {}
      },
      onReady: () => {
        shutdown?.()
        // A duplicate stop (signal racing /shutdown) is a no-op: teardown
        // belongs to the first requester.
        shutdown?.()
      },
    })
    await expect(running).resolves.toBe(0)
    expect(await readDaemonState()).toBeUndefined()
  })

  it('exits 1 when the port cannot bind, before any state is published', async () => {
    const blocker = await createDaemonServer({
      port: 0,
      version: 'x',
      startedAt: new Date().toISOString(),
      report: () => ({ runtimes: [] }),
      onShutdown: () => {},
    })
    try {
      const lines: string[] = []
      const code = await runDaemon({ port: blocker.port, intervalMs: 1000, version: '0.1.1-rc.1', log: (line) => { lines.push(line) } })
      expect(code).toBe(1)
      expect(lines[0]).toContain('cannot bind')
      expect(await readDaemonState()).toBeUndefined()
    } finally {
      await blocker.close()
    }
  })

  it('logs through console.log by default', async () => {
    const printed = vi.spyOn(console, 'log').mockImplementation(() => {})
    let shutdown: (() => void) | undefined
    const running = runDaemon({
      port: 0,
      intervalMs: 60_000,
      version: '0.1.1-rc.1',
      installSignals: (handler) => {
        shutdown = handler
        return () => {}
      },
      onReady: () => { shutdown?.() },
    })
    await expect(running).resolves.toBe(0)
    expect(printed.mock.calls.some(call => String(call[0]).includes('dsh daemon: pid'))).toBe(true)
    printed.mockRestore()
  })
})

describe('installShutdownSignals', () => {
  it('registers both signals once and restores the listener sets', () => {
    const beforeTerm = process.listenerCount('SIGTERM')
    const beforeInt = process.listenerCount('SIGINT')
    const shutdown = vi.fn()
    const uninstall = installShutdownSignals(shutdown)
    expect(process.listenerCount('SIGTERM')).toBe(beforeTerm + 1)
    expect(process.listenerCount('SIGINT')).toBe(beforeInt + 1)
    uninstall()
    expect(process.listenerCount('SIGTERM')).toBe(beforeTerm)
    expect(process.listenerCount('SIGINT')).toBe(beforeInt)
    expect(shutdown).not.toHaveBeenCalled()
  })

  it('invokes shutdown when either signal fires', () => {
    const shutdown = vi.fn()
    const uninstall = installShutdownSignals(shutdown)
    const onTerm = process.listeners('SIGTERM').at(-1) as () => void
    const onInt = process.listeners('SIGINT').at(-1) as () => void
    onTerm()
    onInt()
    expect(shutdown).toHaveBeenCalledTimes(2)
    uninstall()
  })
})
