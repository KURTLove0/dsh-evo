/** Snapshot refreshes must not publish stale selection or miss an in-flight change notification. */
import { describe, expect, it, vi } from 'vitest'
import { WorkflowManager, type WorkflowPort } from '../../src/client/workflows/manager.ts'
import type { WorkflowWorkbenchSnapshot, WorkflowId } from '@deepseek-ai/dsh-business-workflow/workbench-types'
const blank = (): WorkflowWorkbenchSnapshot => ({ workflows: [], runs: [], operations: [], latestRuns: [], presets: [] })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
describe('workflow data owner', () => {
  it('reports a committed command whose result could not be refreshed so editor drafts are retained', async () => {
    const receipt = { workflowId: 'workflow' as WorkflowId, revision: 4 }
    const command = vi.fn().mockResolvedValue(receipt)
    const port: WorkflowPort = {
      snapshot: vi.fn().mockRejectedValue(new Error('offline')),
      command,
      validate: vi.fn(),
    }
    const manager = new WorkflowManager(port)
    await expect(manager.command({ kind: 'publish', id: receipt.workflowId, expectedRevision: 3 }))
      .rejects.toThrow('Operation was committed')
    expect(command).toHaveBeenCalledOnce()
    expect(manager.getSnapshot().error).toContain('offline')
  })
  it('coalesces an in-flight notification but reads a fresh snapshot before settling', async () => {
    const pending = deferred<WorkflowWorkbenchSnapshot>()
    const snapshot = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({ ...blank(), presets: ['new'] })
    const port: WorkflowPort = {
      snapshot,
      command: vi.fn(),
      validate: vi.fn(),
    }
    const manager = new WorkflowManager(port)
    const first = manager.refresh()
    const second = manager.refresh()
    pending.resolve({ ...blank(), presets: ['old'] })
    await Promise.all([first, second])
    expect(snapshot).toHaveBeenCalledTimes(2)
    expect(manager.getSnapshot().presets).toEqual(['new'])
  })

  it('refreshes a notification received while publishing the settled snapshot', async () => {
    const port: WorkflowPort = {
      snapshot: vi.fn().mockResolvedValueOnce(blank()).mockResolvedValue({ ...blank(), presets: ['updated'] }),
      command: vi.fn(),
      validate: vi.fn(),
    }
    const manager = new WorkflowManager(port)
    let notified = false
    manager.subscribe(() => {
      if (!manager.getSnapshot().loading && !notified) {
        notified = true
        void manager.refresh()
      }
    })
    await manager.refresh()
    expect(manager.getSnapshot().presets).toEqual(['updated'])
  })

  it('discards another workflow history when selection changes during a read', async () => {
    const pending = deferred<WorkflowWorkbenchSnapshot>()
    const port: WorkflowPort = {
      snapshot: vi
        .fn()
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValue({ ...blank(), presets: ['selected'] }),
      command: vi.fn(),
      validate: vi.fn(),
    }
    const manager = new WorkflowManager(port)
    const first = manager.select('first' as WorkflowId)
    const second = manager.select('second' as WorkflowId)
    pending.resolve({ ...blank(), presets: ['stale'] })
    await Promise.all([first, second])
    expect(manager.getSnapshot()).toMatchObject({ selectedId: 'second', presets: ['selected'], loading: false })
  })

  it('retains data and exposes failed commands, then stops publishing after disposal', async () => {
    const port: WorkflowPort = {
      snapshot: vi.fn().mockResolvedValue({ ...blank(), presets: ['standard'] }),
      command: vi.fn().mockRejectedValue(new Error('revision conflict')),
      validate: vi.fn(),
    }
    const manager = new WorkflowManager(port)
    await manager.refresh()
    await expect(manager.command({ kind: 'cancel', runId: 'run' as never })).rejects.toThrow('revision conflict')
    expect(manager.getSnapshot()).toMatchObject({ presets: ['standard'], error: 'Error: revision conflict' })
    const snapshot = manager.getSnapshot()
    manager.dispose()
    await manager.refresh()
    expect(manager.getSnapshot()).toBe(snapshot)
  })
})
