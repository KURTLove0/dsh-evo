/**
 * probeDaemonHealth / requestDaemonShutdown: every failure spelling collapses
 * to "not running" / refusal; a live daemon answers with its validated health
 * and the state it published.
 */

import { describe, expect, it } from 'vitest'
import { probeDaemonHealth, requestDaemonShutdown } from '../src/client.ts'
import { createDaemonServer, type DaemonServer } from '../src/server.ts'
import type { DaemonState } from '../src/state.ts'

const STATE: DaemonState = { pid: 4321, port: 3081, version: '0.1.1-rc.1', startedAt: '2026-09-28T10:00:00.000Z' }

const readState = (state: DaemonState | undefined) => () => Promise.resolve(state)

describe('probeDaemonHealth', () => {
  it('answers not-running when no state document exists', async () => {
    expect(await probeDaemonHealth({ readState: readState(undefined) })).toEqual({ running: false })
  })

  it('answers not-running when the endpoint refuses, errors, or answers non-ok', async () => {
    const fetchImpl = (() => Promise.reject(new Error('ECONNREFUSED'))) as never
    expect(await probeDaemonHealth({ readState: readState(STATE), fetchImpl })).toEqual({ running: false })
    const notOk = (() => Promise.resolve(new Response('no', { status: 503 }))) as never
    expect(await probeDaemonHealth({ readState: readState(STATE), fetchImpl: notOk })).toEqual({ running: false })
  })

  it('answers not-running for a non-JSON or schema-foreign answer', async () => {
    const text = (() => Promise.resolve(new Response('hello', { status: 200 }))) as never
    expect(await probeDaemonHealth({ readState: readState(STATE), fetchImpl: text })).toEqual({ running: false })
    const foreign = (() => Promise.resolve(Response.json({ status: 'ok' }))) as never
    expect(await probeDaemonHealth({ readState: readState(STATE), fetchImpl: foreign })).toEqual({ running: false })
  })

  it('answers with the validated health and published state of a live daemon', async () => {
    const server: DaemonServer = await createDaemonServer({
      port: 0,
      version: STATE.version,
      startedAt: STATE.startedAt,
      report: () => ({ runtimes: [{ command: 'codex', label: 'Codex CLI', present: true, checkedAt: STATE.startedAt }] }),
      onShutdown: () => {},
    })
    try {
      const probe = await probeDaemonHealth({ readState: readState({ ...STATE, port: server.port }) })
      if (!probe.running) throw new Error('expected a running probe')
      expect(probe.running).toBe(true)
      expect(probe.state).toEqual({ ...STATE, port: server.port })
      expect(probe.health.status).toBe('running')
      expect(probe.health.runtimes).toEqual([{ command: 'codex', label: 'Codex CLI', present: true, checkedAt: STATE.startedAt }])
    } finally {
      await server.close()
    }
  })
})

describe('requestDaemonShutdown', () => {
  it('returns whether the daemon accepted the request', async () => {
    const accepted = (() => Promise.resolve(new Response('{}', { status: 200 }))) as never
    expect(await requestDaemonShutdown(3081, { fetchImpl: accepted })).toBe(true)
    const refused = (() => Promise.resolve(new Response('no', { status: 500 }))) as never
    expect(await requestDaemonShutdown(3081, { fetchImpl: refused })).toBe(false)
    const dead = (() => Promise.reject(new Error('ECONNREFUSED'))) as never
    expect(await requestDaemonShutdown(3081, { fetchImpl: dead })).toBe(false)
  })
})
