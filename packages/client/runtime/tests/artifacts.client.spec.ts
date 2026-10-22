/** Artifact reads remain independent of live-file observations and admitted writes. */
import { expect, it, vi } from 'vitest'
import { ArtifactManager, type ArtifactPort } from '../src/client/artifacts/manager.ts'
import type { ArtifactDetail, ArtifactOptions, ArtifactPage, ArtifactRegistration } from '@deepseek-ai/dsh-work-artifacts/types'
const id = 'artifact' as never
const request: ArtifactRegistration = { expectedVersion: 0, requestId: 'request' as never, path: 'report', source: { kind: 'current-file', ref: { kind: 'agent', id: 'run' as never } } }
function setup() {
  const port: ArtifactPort = { options: vi.fn(async () => ({ pageSize: 2, maxFileBytes: 100 })),
    query: vi.fn(async () => ({ items: [], observedAt: 1 })),
    read: vi.fn(async () => ({ entry: { id }, snapshot: { version: 1 }, versions: [] }) as unknown as ArtifactDetail),
    inspectCurrent: vi.fn(async () => ({ id, version: 1, observedAt: 2, state: 'missing' as const })), register: vi.fn(async () => ({ id, version: 1 })) }
  return { port, manager: new ArtifactManager(port, { text: '' }) }
}
it('keeps submitted filters and old rows on failure and never inspects files while refreshing', async () => {
  const { port, manager } = setup()
  await manager.refresh(); const previous = manager.getSnapshot().directory.page
  vi.mocked(port.query).mockRejectedValueOnce(new Error('Offline'))
  await manager.setQuery({ text: 'new' })
  expect(manager.getSnapshot().directory).toMatchObject({ submitted: { text: '' }, stale: true, error: 'Offline', page: previous })
  await manager.refresh(); expect(manager.getSnapshot().directory.submitted).toEqual({ text: 'new' })
  expect(port.inspectCurrent).not.toHaveBeenCalled()
  manager.dispose()
})
it('drops superseded options, pages, previews, and current-file observations', async () => {
  const { port, manager } = setup()
  const options = Promise.withResolvers<ArtifactOptions>()
  vi.mocked(port.options).mockReturnValueOnce(options.promise)
  const old = manager.refresh(); await manager.setQuery({ text: 'latest' }); options.resolve({ pageSize: 2, maxFileBytes: 100 }); await old
  expect(port.query).toHaveBeenCalledTimes(1)
  const reading = Promise.withResolvers<ArtifactDetail>()
  vi.mocked(port.read).mockReturnValueOnce(reading.promise)
  const first = manager.select('old' as never, 1); await manager.select(id, 2)
  reading.resolve({} as ArtifactDetail); await first
  expect(manager.getSnapshot().preview.target).toEqual({ id, version: 2 })
  const observation = Promise.withResolvers<Awaited<ReturnType<ArtifactPort['inspectCurrent']>>>()
  vi.mocked(port.inspectCurrent).mockReturnValueOnce(observation.promise)
  const inspect = manager.inspectCurrent(); manager.invalidate()
  observation.resolve({ id, version: 2, observedAt: 9, state: 'missing' }); await inspect
  expect(manager.getSnapshot().current).toMatchObject({ stale: true, loading: false })
  expect(manager.getSnapshot().current.observation).toBeUndefined(); manager.dispose()
})
it('preserves observations as stale and clears them on selecting another version', async () => {
  const { manager, port } = setup()
  await manager.select(id, 1); await manager.inspectCurrent(); manager.invalidate(); await manager.refresh()
  expect(manager.getSnapshot().current).toMatchObject({ stale: true, observation: { state: 'missing' } })
  expect(port.inspectCurrent).toHaveBeenCalledTimes(1)
  await manager.select(id, 2); expect(manager.getSnapshot().current.observation).toBeUndefined()
  vi.mocked(port.read).mockRejectedValueOnce('Unavailable'); await manager.select(id, 3)
  expect(manager.getSnapshot().preview).toMatchObject({ error: 'Unavailable', target: { id, version: 3 } })
  manager.dispose()
})
it('appends only an owned continuation and retains rows when its generation expires', async () => {
  const { port, manager } = setup()
  const next = { generation: 'generation', query: 'query', after: id } as never
  vi.mocked(port.query).mockResolvedValueOnce({ items: [{ id }], observedAt: 1, next } as unknown as ArtifactPage)
  await manager.refresh()
  vi.mocked(port.query).mockRejectedValueOnce(new Error('Directory changed'))
  await manager.more()
  expect(manager.getSnapshot().directory).toMatchObject({ stale: true, error: 'Directory changed', page: { items: [{ id }] } })
  await manager.more(); expect(port.query).toHaveBeenCalledTimes(2); manager.dispose()
})
it('pins and coalesces registration inputs, retaining committed receipts when refresh fails', async () => {
  const { port, manager } = setup(), owned = structuredClone(request)
  const pending = Promise.withResolvers<{ id: typeof id; version: number }>()
  vi.mocked(port.register).mockReturnValueOnce(pending.promise)
  const task = manager.register(owned)
  expect(manager.register(owned)).toBe(task)
  await expect(manager.register({ ...owned, path: 'different' })).rejects.toThrow('pending')
  owned.path = 'mutated'; await Promise.resolve()
  expect(port.register).toHaveBeenCalledWith(request)
  vi.mocked(port.options).mockRejectedValueOnce(new Error('Refresh unavailable'))
  pending.resolve({ id, version: 1 }); expect(await task).toEqual({ id, version: 1 })
  await vi.waitFor(() => { expect(manager.getSnapshot().directory.error).toBe('Refresh unavailable') })
  expect(manager.getSnapshot().mutating).toBe(false); manager.dispose()
})
it('retires queued unsent writes and ignores late reads after disposal', async () => {
  const { port, manager } = setup()
  const task = manager.register(request); manager.dispose(); const last = manager.getSnapshot()
  await expect(task).rejects.toThrow('disposed'); expect(port.register).not.toHaveBeenCalled()
  await manager.refresh(); await manager.more(); await manager.select(id, 1); await manager.inspectCurrent()
  await expect(manager.register(request)).rejects.toThrow('disposed')
  expect(manager.getSnapshot()).toBe(last)
})
