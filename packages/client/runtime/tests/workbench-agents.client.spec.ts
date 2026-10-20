/** Coalesced directory refresh and committed command receipts across disconnects. */
import { describe, expect, it, vi } from 'vitest'
import type { AgentDirectory, WorkbenchAgentId } from '@deepseek-ai/dsh-workbench-agent/types'
import { AgentDirectoryManager } from '../src/client/workbench-agents/manager.ts'
const blank = (): AgentDirectory => ({ agents: [], runs: [], workloads: [], runtime: { id: 'harness', available: true }, defaultConcurrency: 6, maxConcurrency: 8 })
describe('independent agent directory owner', () => {
  it('coalesces notifications and never publishes another selection’s history', async () => {
    let resolve!: (value: AgentDirectory) => void
    const first = new Promise<AgentDirectory>((done) => { resolve = done })
    const snapshot = vi.fn().mockReturnValueOnce(first).mockResolvedValue({ ...blank(), maxConcurrency: 4 })
    const manager = new AgentDirectoryManager({ snapshot, command: vi.fn() })
    const loading = manager.refresh()
    const selected = manager.select('agent' as WorkbenchAgentId)
    resolve({ ...blank(), maxConcurrency: 100 })
    await Promise.all([loading, selected])
    expect(snapshot).toHaveBeenCalledTimes(2)
    expect(manager.getSnapshot().maxConcurrency).toBe(4)
    expect(manager.getSnapshot().selectedId).toBe('agent')
  })
  it('keeps a committed receipt when refresh fails and surfaces the read failure', async () => {
    const receipt = { agentId: 'agent' as WorkbenchAgentId }
    const manager = new AgentDirectoryManager({ snapshot: vi.fn().mockRejectedValue(new Error('Offline')), command: vi.fn().mockResolvedValue(receipt) })
    await expect(manager.command({ kind: 'copy', id: receipt.agentId, name: 'Copy' })).resolves.toEqual(receipt)
    expect(manager.getSnapshot().error).toBe('Offline')
  })
  it('retains data on write failure and stops publishing after unload', async () => {
    const manager = new AgentDirectoryManager({ snapshot: vi.fn().mockResolvedValue(blank()), command: vi.fn().mockRejectedValue('Rejected') })
    const listener = vi.fn()
    const stop = manager.subscribe(listener)
    await manager.refresh()
    await expect(manager.command({ kind: 'stop', runId: 'run' as never })).rejects.toBe('Rejected')
    expect(manager.getSnapshot().error).toBe('Rejected')
    stop()
    const before = manager.getSnapshot()
    manager.dispose()
    await manager.refresh()
    expect(manager.getSnapshot()).toBe(before)
  })
})
