/** Latest configuration reads and recovery of explicit probes without duplicated connection work. */
import { expect, it, vi } from 'vitest'
import { HealthManager, type HealthPort } from '../src/client/health/manager.ts'
import type { HealthAgent, HealthProbeRecord, HealthProbeRequest, HealthReport } from '@deepseek-ai/dsh-capability-health/types'
const request: HealthProbeRequest = { id: 'probe' as never, agentId: 'agent' as never, expectedRevision: 1, workspaceId: 'workspace' as never, serverName: 'crm' }
const live: HealthProbeRecord = { ...request, status: 'running', startedAt: 1 }
const complete = { ...request, status: 'connected', startedAt: 1, checkedAt: 2, cleanup: 'closed' } satisfies HealthProbeRecord
const report: HealthReport = { checkedAt: 1, items: [] }
function setup() {
  const port: HealthPort = { choices: vi.fn(async () => []), check: vi.fn(async () => report),
    startProbe: vi.fn(async () => ({ ok: true as const, value: live })), readProbe: vi.fn(async () => complete), cancelProbe: vi.fn(async (): Promise<HealthProbeRecord> => ({ ...complete, status: 'cancelled' })) }
  return { port, manager: new HealthManager(port) }
}
it('keeps stable snapshots, discards older directory reads, and suppresses late publications after disposal', async () => {
  const { port, manager } = setup()
  const pending = Promise.withResolvers<HealthAgent[]>()
  vi.mocked(port.choices).mockReturnValueOnce(pending.promise)
  const notify = vi.fn(), stop = manager.subscribe(notify)
  const old = manager.load(), newer = manager.load()
  await newer
  const state = manager.getSnapshot(); expect(manager.getSnapshot()).toBe(state)
  pending.resolve([{ id: 'old' as never, revision: 1, name: 'Old', archived: false }]); await old
  expect(manager.getSnapshot().agents).toEqual([])
  expect(manager.getSnapshot().loaded).toBe(true)
  await vi.waitFor(() => { expect(notify).toHaveBeenCalled() }); stop()
  vi.mocked(port.choices).mockRejectedValueOnce('Directory offline')
  await manager.load(); expect(manager.getSnapshot().error).toBe('Directory offline')
  const delayed = Promise.withResolvers<HealthAgent[]>()
  vi.mocked(port.choices).mockReturnValueOnce(delayed.promise)
  const loading = manager.load(); manager.dispose(); const last = manager.getSnapshot()
  delayed.resolve([]); await loading; await manager.load()
  expect(manager.getSnapshot()).toBe(last)
})
it('invalidates an in-flight check without starting another one and preserves failed last-known results', async () => {
  const { port, manager } = setup()
  await manager.check({ kind: 'global' })
  const pending = Promise.withResolvers<HealthReport>()
  vi.mocked(port.check).mockReturnValueOnce(pending.promise)
  const check = manager.check({ kind: 'global' })
  await manager.check({ kind: 'global' })
  manager.invalidate()
  pending.resolve({ checkedAt: 999, items: [] }); await check
  expect(manager.getSnapshot()).toMatchObject({ report, stale: true, checking: false })
  vi.mocked(port.check).mockRejectedValueOnce(new Error('Configuration offline'))
  await manager.check({ kind: 'global' })
  expect(manager.getSnapshot()).toMatchObject({ report, stale: true, error: 'Configuration offline' })
  manager.dispose(); await manager.check({ kind: 'global' })
})
it('distinguishes host refusal from a lost response, and recovers by read without ever resubmitting', async () => {
  const { port, manager } = setup()
  vi.mocked(port.startProbe).mockResolvedValueOnce({ ok: false, error: { message: 'Capacity reached' } })
  await manager.start(request)
  expect(manager.getSnapshot().pending).toEqual([])
  expect(manager.getSnapshot().probeErrors).toEqual([{ id: request.id, message: 'Capacity reached' }])
  vi.mocked(port.startProbe).mockRejectedValueOnce(new Error('Acknowledgment lost'))
  await manager.start(request)
  await manager.start(request)
  expect(port.startProbe).toHaveBeenCalledTimes(2)
  expect(manager.getSnapshot().pending).toEqual([request])
  vi.mocked(port.readProbe).mockResolvedValueOnce(null)
  await manager.recover()
  expect(manager.getSnapshot().unavailable).toEqual([request.id])
  await manager.recover(request.id)
  expect(manager.getSnapshot()).toMatchObject({ pending: [], probes: [complete], probeErrors: [], unavailable: [] })
  await manager.start(request)
  await manager.recover('unknown' as never)
  expect(port.startProbe).toHaveBeenCalledTimes(2)
})
it('does not replace an event-confirmed completion with an older admission response or transport error', async () => {
  const { port, manager } = setup()
  const admission = Promise.withResolvers<Awaited<ReturnType<HealthPort['startProbe']>>>()
  vi.mocked(port.startProbe).mockReturnValueOnce(admission.promise)
  const start = manager.start(request)
  await manager.recover(request.id)
  admission.resolve({ ok: true as const, value: live }); await start
  expect(manager.getSnapshot().probes).toEqual([complete])
  const lost = Promise.withResolvers<Awaited<ReturnType<HealthPort['startProbe']>>>()
  const next = { ...request, id: 'next' as never }
  vi.mocked(port.startProbe).mockReturnValueOnce(lost.promise)
  vi.mocked(port.readProbe).mockResolvedValueOnce({ ...complete, id: next.id })
  const sending = manager.start(next)
  await manager.recover(next.id)
  lost.reject(new Error('Late transport failure')); await sending
  expect(manager.getSnapshot().probeErrors).toEqual([])
})
it('keeps per-probe recovery failures independent and supports cancellation after remount or reconnect', async () => {
  const { port, manager } = setup()
  await manager.start(request)
  vi.mocked(port.readProbe).mockRejectedValueOnce(new Error('Read failed'))
  await manager.recover()
  expect(manager.getSnapshot().probes).toEqual([live])
  expect(manager.getSnapshot().probeErrors).toEqual([{ id: request.id, message: 'Read failed' }])
  vi.mocked(port.cancelProbe).mockRejectedValueOnce('Cancel response lost')
  await manager.cancel(request.id)
  expect(manager.getSnapshot().probeErrors[0]?.message).toBe('Cancel response lost')
  await manager.cancel(request.id)
  expect(manager.getSnapshot().probes[0]).toMatchObject({ status: 'cancelled', cleanup: 'closed' })
  expect(manager.getSnapshot().probeErrors).toEqual([])
  vi.mocked(port.readProbe).mockResolvedValueOnce(null)
  await manager.recover()
  expect(manager.getSnapshot().unavailable).toEqual([request.id])
  expect(port.startProbe).toHaveBeenCalledOnce()
  manager.dispose(); const last = manager.getSnapshot()
  await manager.start({ ...request, id: 'disposed' as never }); await manager.recover(); await manager.cancel(request.id)
  expect(manager.getSnapshot()).toBe(last)
})
