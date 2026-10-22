/** Read epochs preserve evidence without repeating original-log reads on invalidation or remount. */
import { expect, it, vi } from 'vitest'
import { WorkStatisticsManager } from '../src/client/statistics/manager.ts'
import type { WorkStatisticsQuery, WorkStatisticsReport, WorkStatisticsChoices } from '@deepseek-ai/dsh-work-center/types'
const query: WorkStatisticsQuery = { from: 0, to: 1, timeZone: 'UTC', usage: 'skip' }
const report = { observedAt: 1, query } as WorkStatisticsReport
const choices: WorkStatisticsChoices = { executors: [], failures: [] }
const deferred = <T>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void
  return { promise: new Promise<T>((yes, no) => { resolve = yes; reject = no }), resolve, reject } }

it('loads choices independently, retains last-known reports, and never reads on invalidation', async () => {
  const port = { choices: vi.fn(async () => choices), read: vi.fn(async (_request: WorkStatisticsQuery) => report) }
  const manager = new WorkStatisticsManager(port)
  const notify = vi.fn(), stop = manager.subscribe(notify)
  await manager.loadChoices(); await manager.read(query)
  expect(manager.getSnapshot()).toMatchObject({ choices, report, loading: false, stale: false })
  manager.invalidate()
  expect(manager.getSnapshot().stale).toBe(true)
  expect(port.read).toHaveBeenCalledTimes(1)
  port.read.mockRejectedValueOnce('Report unavailable'); port.choices.mockRejectedValueOnce(new Error('Directory unavailable'))
  await manager.read(query); await manager.loadChoices()
  expect(manager.getSnapshot()).toMatchObject({ report, choices, error: 'Report unavailable', choicesError: 'Directory unavailable' })
  stop()
})
it('discards superseded, invalidated, and disposed responses without publishing stale completion flags', async () => {
  const first = deferred<WorkStatisticsReport>(), olderChoices = deferred<WorkStatisticsChoices>()
  const port = { choices: vi.fn().mockReturnValueOnce(olderChoices.promise).mockResolvedValue(choices),
    read: vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(report) }
  const manager = new WorkStatisticsManager(port)
  const beforeChoices = manager.loadChoices(); await manager.loadChoices(); olderChoices.resolve({ executors: [], failures: [{ source: 'agent', message: 'old' }] }); await beforeChoices
  expect(manager.getSnapshot().choices).toEqual(choices)
  const before = manager.read(query); await manager.read({ ...query, usage: 'recorded' }); first.resolve({ ...report, observedAt: 0 }); await before
  expect(manager.getSnapshot().report).toEqual(report)
  const pending = deferred<WorkStatisticsReport>(); port.read.mockReturnValueOnce(pending.promise)
  const invalidated = manager.read(query); manager.invalidate(); pending.reject('old failure'); await invalidated
  expect(manager.getSnapshot().error).toBeNull()
  const directory = deferred<WorkStatisticsChoices>(); port.choices.mockReturnValueOnce(directory.promise)
  const gone = manager.loadChoices(); manager.dispose(); directory.reject('disposed failure'); await gone
  const snapshot = manager.getSnapshot(); await manager.loadChoices(); await manager.read(query); manager.invalidate()
  expect(manager.getSnapshot()).toBe(snapshot)
})
