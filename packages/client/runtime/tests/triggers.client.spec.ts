/** Trigger read generations and exact command ownership remain independent of rendering. */
import { expect, it, vi } from 'vitest'
import { TriggerManager, type TriggerPort } from '../src/client/triggers/manager.ts'
import type { TriggerDirectory, TriggerOptions, WorkTrigger } from '@deepseek-ai/dsh-work-triggers/types'
const id = 'trigger' as never
function setup() {
  const record: WorkTrigger = { id, revision: 1, enabled: true, createdAt: 1, updatedAt: 1, occurrences: [],
    definition: { name: 'Rule', rule: { kind: 'at', at: 10 }, target: { kind: 'workflow', id: 'workflow' as never, versionId: 'version' as never, workspaceId: 'workspace' as never, inputs: {} } } }
  const port: TriggerPort = { options: vi.fn(async () => ({ minIntervalMs: 100, pollIntervalMs: 10, maxOccurrences: 5 })),
    query: vi.fn(async () => ({ items: [], failures: [], observedAt: 1 })), read: vi.fn(async () => record),
    prepare: vi.fn(async () => ({ name: 'Prepared', target: { kind: 'agent', id: 'agent', workspaceId: 'workspace', expectedRevision: 1 } }) as never),
    command: vi.fn(async () => ({ id, revision: 1 })) }
  return { port, manager: new TriggerManager(port), record }
}
it('retains submitted scope and selected detail after failed reads and never issues commands on sync', async () => {
  const { port, manager, record } = setup(), listener = vi.fn(), stop = manager.subscribe(listener)
  await manager.sync(); await manager.select(id)
  vi.mocked(port.query).mockRejectedValueOnce(new Error('Offline')); vi.mocked(port.read).mockRejectedValueOnce('Read failed')
  await manager.refresh({ text: 'new' }); await manager.select(id)
  expect(manager.getSnapshot().directory).toMatchObject({ submitted: { text: '' }, stale: true, error: 'Offline' })
  expect(manager.getSnapshot().detail).toMatchObject({ value: record, stale: true, error: 'Read failed' })
  manager.invalidate(); await manager.sync()
  expect(manager.getSnapshot().directory.submitted).toEqual({ text: 'new' }); expect(port.command).not.toHaveBeenCalled()
  await vi.waitFor(() => { expect(listener).toHaveBeenCalled() }); stop(); manager.dispose()
})
it('discards superseded options, directory, detail, and prepared-source responses', async () => {
  const { port, manager, record } = setup()
  const options = Promise.withResolvers<TriggerOptions>(); vi.mocked(port.options).mockReturnValueOnce(options.promise)
  const old = manager.refresh(); await manager.refresh({ text: 'latest' }); options.resolve({ minIntervalMs: 1, pollIntervalMs: 1, maxOccurrences: 1 }); await old
  expect(port.query).toHaveBeenCalledTimes(1)
  const directory = Promise.withResolvers<TriggerDirectory>(); vi.mocked(port.query).mockReturnValueOnce(directory.promise)
  const query = manager.refresh(); await Promise.resolve(); manager.invalidate()
  directory.resolve({ items: [], failures: [], observedAt: 99 }); await query
  expect(manager.getSnapshot().directory.value?.observedAt).toBe(1)
  const detail = Promise.withResolvers<WorkTrigger>(); vi.mocked(port.read).mockReturnValueOnce(detail.promise)
  const reading = manager.select(id); await manager.select('other' as never); detail.resolve(record); await reading
  expect(manager.getSnapshot().detail.id).toBe('other')
  const prepared = Promise.withResolvers<Awaited<ReturnType<TriggerPort['prepare']>>>()
  vi.mocked(port.prepare).mockReturnValueOnce(prepared.promise)
  const preparation = manager.prepare({ kind: 'agent', id: 'old' as never }); manager.invalidate(); prepared.resolve({ name: 'Old' } as never); await preparation
  expect(manager.getSnapshot().preparation.value).toBeUndefined()
  await manager.prepare({ kind: 'workflow', id: 'new' as never }); expect(manager.getSnapshot().preparation.value?.name).toBe('Prepared')
  vi.mocked(port.prepare).mockRejectedValueOnce('Unavailable'); await manager.prepare({ kind: 'agent', id: 'missing' as never })
  expect(manager.getSnapshot().preparation.error).toBe('Unavailable'); manager.dispose()
})
it('pins and coalesces commands, reads authoritative state after uncertainty, and never retries on reconnect', async () => {
  const { port, manager } = setup(), request = { kind: 'set-enabled' as const, id, expectedRevision: 1, enabled: false }
  const result = Promise.withResolvers<{ id: typeof id; revision: number }>(); vi.mocked(port.command).mockReturnValueOnce(result.promise)
  const pending = manager.command(request); expect(manager.command(request)).toBe(pending)
  await expect(manager.command({ ...request, enabled: true })).rejects.toThrow('pending')
  request.enabled = true; await Promise.resolve(); expect(port.command).toHaveBeenCalledWith({ ...request, enabled: false })
  result.reject(new Error('Lost acknowledgment')); await expect(pending).rejects.toThrow('Lost acknowledgment')
  await manager.sync(); manager.invalidate(); await manager.sync(); expect(port.command).toHaveBeenCalledTimes(1)
  vi.mocked(port.query).mockRejectedValueOnce('Refresh unavailable')
  expect(await manager.command({ ...request, expectedRevision: 2 })).toEqual({ id, revision: 1 })
  await vi.waitFor(() => { expect(manager.getSnapshot().directory.error).toBe('Refresh unavailable') })
  manager.dispose(); await expect(manager.command(request)).rejects.toThrow('disposed')
})
it('retires queued commands and ignores late read and command publications after disposal', async () => {
  const { port, manager } = setup()
  const pending = manager.command({ kind: 'acknowledge', id, noticeId: 'notice' as never }); manager.dispose()
  await expect(pending).rejects.toThrow('disposed'); expect(port.command).not.toHaveBeenCalled()
  const value = manager.getSnapshot(); await manager.refresh(); await manager.select(id); await manager.prepare({ kind: 'agent', id: 'run' as never })
  expect(manager.getSnapshot()).toBe(value)
})
