/**
 * Process-bound lifecycle: startDaemon really spawns the fixture daemon,
 * health answers through the real endpoint, a second start refuses, and
 * stopDaemon shuts the child down and sweeps the state.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { probeDaemonHealth } from '../src/client.ts'
import { daemonStatus, startDaemon, stopDaemon } from '../src/lifecycle.ts'

const FIXTURE = fileURLToPath(new URL('./fixtures/fake-daemon.mjs', import.meta.url))

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-daemon-e2e-'))
  vi.stubEnv('DSH_HOME', home)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(home, { recursive: true, force: true })
})

describe('daemon lifecycle against a real child', () => {
  it('starts, reports status, refuses a second start, and stops the spawned daemon', async () => {
    const started = await startDaemon({ binPath: FIXTURE, port: 0, intervalMs: 1000 })
    if (!started.ok) throw new Error(`expected a start, got ${JSON.stringify(started)}`)
    expect(started.pid).not.toBe(process.pid)

    const probe = await probeDaemonHealth()
    if (!probe.running) throw new Error('expected a running daemon')
    expect(probe.health.version).toBe('fixture')
    expect(probe.health.runtimes[0]).toMatchObject({ command: 'claude', present: true })

    const status = await daemonStatus()
    expect(status.running).toBe(true)

    const again = await startDaemon({ binPath: FIXTURE, port: 0, intervalMs: 1000 })
    expect(again).toEqual({ ok: false, reason: 'already-running', pid: started.pid })

    await expect(stopDaemon()).resolves.toEqual({ ok: true })
    expect((await probeDaemonHealth()).running).toBe(false)
    expect((await daemonStatus()).running).toBe(false)
  }, 20_000)
})
