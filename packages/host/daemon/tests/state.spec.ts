/**
 * Daemon state files: path resolution under the harness home, the atomic
 * publish/read roundtrip, and every "no daemon" spelling collapsing to
 * undefined.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearDaemonState,
  daemonDir,
  daemonLogPath,
  daemonStatePath,
  readDaemonState,
  writeDaemonState,
  type DaemonState,
} from '../src/state.ts'

const STATE: DaemonState = { pid: 4321, port: 3081, version: '0.1.1-rc.1', startedAt: '2026-09-28T10:00:00.000Z' }

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-daemon-state-'))
  vi.stubEnv('DSH_HOME', home)
  await mkdir(daemonDir(), { recursive: true })
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(home, { recursive: true, force: true })
})

describe('daemon state paths', () => {
  it('resolve under the harness home', () => {
    expect(daemonDir()).toBe(join(home, 'daemon'))
    expect(daemonStatePath()).toBe(join(home, 'daemon', 'daemon.json'))
    expect(daemonLogPath()).toBe(join(home, 'daemon', 'daemon.log'))
  })
})

describe('readDaemonState / writeDaemonState / clearDaemonState', () => {
  it('round-trips the published state', async () => {
    await writeDaemonState(STATE)
    expect(await readDaemonState()).toEqual(STATE)
    expect(JSON.parse(await readFile(daemonStatePath(), 'utf8'))).toEqual({ ...STATE })
  })

  it('answers undefined when no state document exists', async () => {
    expect(await readDaemonState()).toBeUndefined()
  })

  it('answers undefined for malformed JSON and for schema mismatches', async () => {
    await writeFile(daemonStatePath(), '{not json', { mode: 0o600 })
    expect(await readDaemonState()).toBeUndefined()
    await writeFile(daemonStatePath(), JSON.stringify({ pid: 'not-a-pid' }))
    expect(await readDaemonState()).toBeUndefined()
  })

  it('clears idempotently', async () => {
    await writeDaemonState(STATE)
    await clearDaemonState()
    expect(await readDaemonState()).toBeUndefined()
    await clearDaemonState()
  })
})
