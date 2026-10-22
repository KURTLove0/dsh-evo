/** Work Center stale-read protection, source errors, and preview invalidation. */
import { describe, expect, it, vi } from 'vitest'
import { WorkCenterManager, type WorkCenterPort } from '../src/client/work-center/manager.ts'
import type { WorkDetail, WorkPage, WorkReference, WorkDiagnosis } from '@deepseek-ai/dsh-work-center/types'
import type { TaskPreflight } from '@deepseek-ai/dsh-workbench-agent/types'
const detail = (ref: WorkReference): WorkDetail => ({ ref, name: 'Task', sessionId: 'session' as never, workspaceId: 'workspace' as never, status: 'completed' })
const blank = (): WorkPage => ({ items: [], failures: [], observedAt: 1 })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { resolve, promise }
}
function port(): WorkCenterPort {
  return { options: vi.fn().mockResolvedValue({ pageSize: 2 }), query: vi.fn().mockResolvedValue(blank()),
    detail: vi.fn(), diagnose: vi.fn(), executors: vi.fn().mockResolvedValue([]), command: vi.fn(), preflight: vi.fn(),
    submit: vi.fn(), revisionBrief: vi.fn() }
}
describe('work center data owner', () => {
  it('discards old selections and reports one failed source without claiming an empty complete inbox', async () => {
    const transport = port()
    const stale = deferred<WorkDetail>()
    const ref = { kind: 'agent' as const, id: 'old' as never }
    const current = { ...ref, id: 'new' as never }
    vi.mocked(transport.detail).mockReturnValueOnce(stale.promise).mockResolvedValue(detail(current))
    vi.mocked(transport.query).mockResolvedValue({ ...blank(), failures: [{ source: 'workflow', message: 'offline' }] })
    const manager = new WorkCenterManager(transport, {})
    const first = manager.select(ref)
    await vi.waitFor(() => { expect(transport.detail).toHaveBeenCalledOnce() })
    const next = manager.select(current)
    expect(manager.getSnapshot().detail).toBeUndefined()
    stale.resolve(detail(ref))
    await Promise.all([first, next])
    expect(manager.getSnapshot().detail?.ref).toEqual(current)
    expect(manager.getSnapshot().failures).toEqual([{ source: 'workflow', message: 'offline' }])
  })
  it('serializes pagination and query invalidations so a previous page cannot overwrite a new filter', async () => {
    const transport = port()
    const more = deferred<WorkPage>()
    vi.mocked(transport.query).mockImplementation(async request => request.cursor === undefined ? { ...blank(), next: { query: 'initial' } } : more.promise)
    const manager = new WorkCenterManager(transport, {})
    await manager.refresh()
    const pending = manager.more()
    const next = manager.setQuery({ source: 'workflow' })
    more.resolve({ ...blank(), observedAt: 999 })
    await Promise.all([pending, next])
    expect(manager.getSnapshot().loading).toBe(false)
    expect(manager.getSnapshot().observedAt).toBe(1)
    expect(transport.query).toHaveBeenCalledWith({ limit: 2, source: 'workflow', attentionSessionIds: [] })
  })
  it('invalidates an in-flight continuation when pending sessions change and ignores equivalent sets', async () => {
    const transport = port()
    const page = deferred<WorkPage>()
    vi.mocked(transport.query).mockImplementation(async request => request.cursor === undefined ? { ...blank(), next: { query: 'initial' } } : page.promise)
    const manager = new WorkCenterManager(transport, {})
    await manager.refresh()
    const more = manager.more()
    const refresh = manager.setAttention(['question' as never, 'approval' as never, 'question' as never])
    expect(manager.getSnapshot().next).toBeUndefined()
    page.resolve({ ...blank(), observedAt: 999 })
    await Promise.all([more, refresh])
    expect(manager.getSnapshot().observedAt).toBe(1)
    expect(transport.query).toHaveBeenCalledWith({ limit: 2, attentionSessionIds: ['approval', 'question'] })
    const count = vi.mocked(transport.query).mock.calls.length
    await manager.setAttention(['approval' as never, 'question' as never])
    expect(transport.query).toHaveBeenCalledTimes(count)
    await manager.setAttention([])
    expect(transport.query).toHaveBeenCalledWith({ limit: 2, attentionSessionIds: [] })
    manager.dispose()
  })
  it('invalidates a preview while its read is pending and prepares revision feedback on the host', async () => {
    const transport = port()
    const pending = deferred<TaskPreflight>()
    const brief = { version: 1 as const, goal: 'Task', background: '', deliverables: [], acceptanceCriteria: [], constraints: '' }
    vi.mocked(transport.preflight).mockReturnValueOnce(pending.promise)
    vi.mocked(transport.revisionBrief).mockResolvedValue({ ...brief, background: 'Recorded feedback' })
    const manager = new WorkCenterManager(transport, {})
    const request = { id: 'agent' as never, workspaceId: 'workspace' as never, brief }
    const check = manager.check(request, { ref: { kind: 'agent', id: 'run' as never }, reviewRevision: 1 })
    await vi.waitFor(() => { expect(transport.preflight).toHaveBeenCalledOnce() })
    manager.invalidateCheck()
    pending.resolve({ checkedAt: 1, agentRevision: 1, issues: [], mcp: [], prompt: 'Exact prompt' })
    await check
    expect(transport.preflight).toHaveBeenCalledWith({ ...request, brief: { ...brief, background: 'Recorded feedback' } })
    expect(manager.getSnapshot().readiness).toBeUndefined()
    manager.dispose()
    const snapshot = manager.getSnapshot()
    await manager.refresh()
    expect(manager.getSnapshot()).toBe(snapshot)
  })
})

describe('explicit diagnostic reads', () => {
  it('reads only on request, invalidates stale results, and never starts recovery work on refresh', async () => {
    const transport = port(), manager = new WorkCenterManager(transport, {})
    const ref: WorkReference = { kind: 'agent', id: 'run' as never }
    const diagnosis = { ref, observedAt: 1, status: 'failed' as const, sources: [], findings: [],
      retry: { kind: 'agent' as const, agentId: 'agent' as never, task: 'Original task' } }
    vi.mocked(transport.detail).mockImplementation(async value => detail(value))
    vi.mocked(transport.diagnose).mockResolvedValue(diagnosis)
    await manager.diagnose(); expect(transport.diagnose).not.toHaveBeenCalled()
    await manager.select(ref); expect(transport.diagnose).not.toHaveBeenCalled()
    const first = deferred<typeof diagnosis>()
    vi.mocked(transport.diagnose).mockReturnValueOnce(first.promise)
    const reading = manager.diagnose(); await manager.diagnose()
    expect(transport.diagnose).toHaveBeenCalledOnce()
    await manager.refresh(); first.resolve(diagnosis); await reading
    expect(manager.getSnapshot().diagnosis).toBeUndefined()
    await manager.diagnose()
    expect(manager.getSnapshot().diagnosis).toEqual(diagnosis)
    expect(manager.getSnapshot().diagnosisStale).toBe(false)
    await manager.refresh(); expect(manager.getSnapshot().diagnosisStale).toBe(true)
    vi.mocked(transport.diagnose).mockRejectedValueOnce('Log source offline')
    await manager.diagnose()
    expect(manager.getSnapshot()).toMatchObject({ diagnosis, diagnosisStale: true, diagnosisError: 'Log source offline', diagnosing: false })
    expect(transport.command).not.toHaveBeenCalled(); expect(transport.submit).not.toHaveBeenCalled()
    await manager.select({ ...ref, id: 'other' as never })
    expect(manager.getSnapshot().diagnosis).toBeUndefined()
    expect(manager.getSnapshot().diagnosisError).toBeNull()
  })
  it('suppresses late diagnostics after a selection change or disposal', async () => {
    const transport = port(), manager = new WorkCenterManager(transport, {})
    const ref: WorkReference = { kind: 'agent', id: 'run' as never }
    vi.mocked(transport.detail).mockImplementation(async value => detail(value))
    await manager.select(ref)
    const pending = deferred<WorkDiagnosis>()
    vi.mocked(transport.diagnose).mockReturnValueOnce(pending.promise)
    const reading = manager.diagnose(); manager.dispose()
    const snapshot = manager.getSnapshot()
    await manager.diagnose()
    pending.resolve({ ref, observedAt: 2, status: 'failed', sources: [], findings: [], retry: { kind: 'agent', agentId: 'agent' as never, task: 'Original' } }); await reading
    expect(manager.getSnapshot()).toBe(snapshot)
  })
})
