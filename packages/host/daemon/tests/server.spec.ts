/**
 * createDaemonServer: health answers with identity and report, deferred
 * shutdown, route/method handling, uptime clamping, and bind failures.
 */

import { describe, expect, it, vi } from 'vitest'
import type { DaemonReport } from '../src/report.ts'
import { createDaemonServer, type DaemonServer } from '../src/server.ts'

const REPORT: DaemonReport = {
  runtimes: [{ command: 'claude', label: 'Claude CLI', present: true, checkedAt: '2026-09-28T10:00:00.000Z' }],
}

async function serve(options: Partial<Parameters<typeof createDaemonServer>[0]> = {}): Promise<DaemonServer> {
  return createDaemonServer({
    port: 0,
    version: '0.1.1-rc.1',
    startedAt: '2026-09-28T10:00:00.000Z',
    report: () => REPORT,
    onShutdown: () => {},
    ...options,
  })
}

describe('createDaemonServer', () => {
  it('answers GET /health with identity, uptime, and the sensing report', async () => {
    const server = await serve({ pid: 4321, now: () => Date.parse('2026-09-28T10:01:35.000Z') })
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/health`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        status: 'running',
        pid: 4321,
        version: '0.1.1-rc.1',
        startedAt: '2026-09-28T10:00:00.000Z',
        uptimeSeconds: 95,
        runtimes: REPORT.runtimes,
      })
    } finally {
      await server.close()
    }
  })

  it('clamps a skewed clock so uptime never goes negative', async () => {
    const server = await serve({ now: () => Date.parse('2026-09-28T09:00:00.000Z') })
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/health`)
      expect(((await response.json()) as { uptimeSeconds: number }).uptimeSeconds).toBe(0)
    } finally {
      await server.close()
    }
  })

  it('answers POST /shutdown, then runs the shutdown callback on the next tick', async () => {
    const onShutdown = vi.fn()
    const server = await serve({ onShutdown })
    const response = await fetch(`http://127.0.0.1:${server.port}/shutdown`, { method: 'POST' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'stopping' })
    await vi.waitFor(() => { expect(onShutdown).toHaveBeenCalledOnce() })
    await server.close()
  })

  it('answers unknown routes 404 and wrong methods 405', async () => {
    const server = await serve()
    try {
      const missing = await fetch(`http://127.0.0.1:${server.port}/nope`)
      expect(missing.status).toBe(404)
      expect(await missing.json()).toEqual({ error: 'not-found' })
      const wrongMethod = await fetch(`http://127.0.0.1:${server.port}/health`, { method: 'POST' })
      expect(wrongMethod.status).toBe(405)
      expect(await wrongMethod.json()).toEqual({ error: 'method-not-allowed' })
    } finally {
      await server.close()
    }
  })

  it('fails loud when the port is already bound', async () => {
    const first = await serve({ port: 0 })
    try {
      await expect(serve({ port: first.port })).rejects.toThrow(`dsh-daemon: cannot bind 127.0.0.1:${first.port}`)
    } finally {
      await first.close()
    }
  })
})
