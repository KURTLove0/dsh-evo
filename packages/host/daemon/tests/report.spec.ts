/**
 * probeRuntimes / startProbeLoop: catalog-order rows with one shared probe
 * timestamp, immediate-first sensing, interval refresh, unref'd timer, and
 * stop semantics.
 */

import { describe, expect, it, vi } from 'vitest'
import { DAEMON_PROBE_CATALOG } from '../src/catalog.ts'
import { probeRuntimes, startProbeLoop, type ProbeLoopTimers } from '../src/report.ts'

describe('probeRuntimes', () => {
  it('probes every catalog entry in order with one shared timestamp', () => {
    const seen: string[] = []
    const spawn = ((command: string, args: readonly string[]) => {
      seen.push(args[0] ?? '')
      return { status: command === 'which' && args[0] === 'claude' ? 0 : 1 }
    }) as never
    const rows = probeRuntimes({ spawn }, new Date('2026-09-28T10:00:00.000Z'))
    expect(rows).toEqual(DAEMON_PROBE_CATALOG.map(entry => ({
      command: entry.command,
      label: entry.label,
      present: entry.command === 'claude',
      checkedAt: '2026-09-28T10:00:00.000Z',
    })))
    expect(seen).toEqual(DAEMON_PROBE_CATALOG.map(entry => entry.command))
  })
})

describe('startProbeLoop', () => {
  it('probes immediately, refreshes on the interval, unrefs the timer, and stops', () => {
    let probes = 0
    const spawn = (() => {
      probes += 1
      return { status: probes <= DAEMON_PROBE_CATALOG.length ? 1 : 0 }
    }) as never
    let tick: (() => void) | undefined
    const timer = { unref: vi.fn() }
    const clearInterval = vi.fn()
    const timers: ProbeLoopTimers = {
      setInterval: ((callback: () => void) => {
        tick = callback
        return timer
      }) as never,
      clearInterval: clearInterval as never,
    }
    const loop = startProbeLoop({ intervalMs: 1000, internals: { spawn }, timers })
    expect(timer.unref).toHaveBeenCalledOnce()
    expect(loop.report().runtimes.every(row => !row.present)).toBe(true)

    tick?.()
    expect(loop.report().runtimes.every(row => row.present)).toBe(true)

    loop.stop()
    expect(clearInterval).toHaveBeenCalledWith(timer)
  })

  it('schedules on the platform timers by default', () => {
    const spawn = (() => ({ status: 0 })) as never
    const loop = startProbeLoop({ intervalMs: 60_000, internals: { spawn } })
    expect(loop.report().runtimes.every(row => row.present)).toBe(true)
    loop.stop()
  })
})
