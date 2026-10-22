/** Template manager coalescing, selection ownership, and receipt preservation. */
import { expect, it, vi } from 'vitest'
import { TemplateManager, type TemplatePort } from '../src/client/templates/manager.ts'
import type { TemplateRecord } from '@deepseek-ai/dsh-work-templates/types'
const record: TemplateRecord = { id: 'template' as never, revision: 1, archived: false, versions: [{ version: 1, createdAt: 1, name: 'Task', content: { kind: 'task', brief: { version: 1, goal: 'Review', background: '', deliverables: [], acceptanceCriteria: [], constraints: '' } } }] }
function setup() {
  const port: TemplatePort = {
    list: vi.fn(async () => []), sources: vi.fn(async () => []), examples: vi.fn(async () => []),
    read: vi.fn(async () => structuredClone(record)), command: vi.fn(async () => ({ id: record.id, revision: 1, version: 1 })),
    copyWorkflow: vi.fn(async () => ({ workflowId: 'copy' as never })),
  }
  const manager = new TemplateManager(port)
  return { manager, port }
}
it('coalesces invalidations, keeps stable snapshots, and drops superseded selection reads', async () => {
  const { manager, port } = setup()
  const old = manager.getSnapshot()
  const notify = vi.fn(), stop = manager.subscribe(notify)
  const pending = Promise.withResolvers<TemplateRecord>()
  vi.mocked(port.read).mockReturnValueOnce(pending.promise)
  const first = manager.select('first' as never)
  await vi.waitFor(() => { expect(port.read).toHaveBeenCalledWith('first') })
  const second = manager.select(record.id)
  pending.resolve({ ...record, id: 'first' as never })
  await Promise.all([first, second])
  expect(manager.getSnapshot().record?.id).toBe(record.id)
  expect(manager.getSnapshot()).not.toBe(old)
  const latest = manager.getSnapshot(); expect(manager.getSnapshot()).toBe(latest)
  await vi.waitFor(() => { expect(notify).toHaveBeenCalled() })
  stop(); manager.dispose(); await manager.refresh()
  expect(manager.getSnapshot()).toBe(latest)
})
it('preserves a committed receipt if refreshing fails and ignores in-flight publications after disposal', async () => {
  const { manager, port } = setup()
  const brief = { version: 1 as const, goal: 'Review', background: '', deliverables: [], acceptanceCriteria: [], constraints: '' }
  const mutation = { kind: 'save-task' as const, expectedRevision: 0, name: 'Task', requestId: 'request' as never, brief }
  vi.mocked(port.list).mockRejectedValueOnce(new Error('Directory offline'))
  expect(await manager.command(mutation)).toMatchObject({ id: record.id })
  expect(manager.getSnapshot().error).toBe('Directory offline')
  await manager.select('other' as never)
  await manager.command(mutation)
  expect(manager.getSnapshot().selected).toBe('other')
  const request = { id: record.id, version: 1, workspaceId: 'workspace' as never, name: 'Copy', requestId: 'copy' as never }
  expect(await manager.copyWorkflow(request)).toEqual({ workflowId: 'copy' })
  const pending = Promise.withResolvers<TemplateRecord[]>()
  vi.mocked(port.list).mockReturnValueOnce(pending.promise as never)
  const refresh = manager.refresh(); manager.dispose(); const last = manager.getSnapshot()
  pending.resolve([]); await refresh
  expect(manager.getSnapshot()).toBe(last)
})

it('keeps successfully read task templates available when workflow choices or examples fail', async () => {
  const { manager, port } = setup()
  vi.mocked(port.list).mockResolvedValueOnce([{ id: record.id, revision: 1, archived: false, name: 'Task', kind: 'task', version: 1 }])
  vi.mocked(port.sources).mockRejectedValueOnce(new Error('Workflow choices unavailable'))
  vi.mocked(port.examples).mockImplementationOnce(() => { throw new Error('Examples unavailable') })
  await manager.refresh()
  expect(manager.getSnapshot().items).toHaveLength(1)
  expect(manager.getSnapshot().error).toBe('Workflow choices unavailable · Examples unavailable')
  vi.mocked(port.read).mockRejectedValueOnce('Selected history unavailable')
  await manager.select(record.id)
  expect(manager.getSnapshot().record).toBeUndefined()
  expect(manager.getSnapshot().error).toBe('Selected history unavailable')
  manager.dispose()
})
