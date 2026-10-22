/** Explicit knowledge reads, authority-qualified selections, and uncertain command recovery. */
import { expect, it, vi } from 'vitest'
import { KnowledgeManager, type KnowledgePort, type KnowledgeWrite } from '../src/client/knowledge/manager.ts'
import type { KnowledgeExcerpt, KnowledgeOptions, KnowledgeSearchResult, KnowledgeSource } from '@deepseek-ai/dsh-work-knowledge/types'
const source: KnowledgeSource = { id: 'source' as never, workspaceId: 'workspace' as never, workspacePath: '/workspace', path: 'source.md', enabled: true, revision: 1, versions: [] }
const register: KnowledgeWrite = { kind: 'register', request: { id: source.id, workspaceId: source.workspaceId, path: source.path } }
const citation = { sourceId: source.id, version: 1, textSha256: 'digest', startLine: 1, endLine: 2 }
const excerpt: KnowledgeExcerpt = { citation, path: source.path, text: 'Original material', current: { sourceId: source.id, state: 'different', textSha256: 'current', observedAt: 1 } }
const options: KnowledgeOptions = { maxSources: 64, maxVersions: 20, maxFileBytes: 100, maxQueryBytes: 512, maxHits: 5 }
function setup() {
  const port: KnowledgePort = { options: vi.fn(async () => options), sources: vi.fn(async () => [source]),
    register: vi.fn(async () => source), index: vi.fn(async () => ({ source, attempt: { state: 'ready' as const, version: 1, completedAt: 1 } })),
    setEnabled: vi.fn(async () => ({ ...source, enabled: false, revision: 2 })),
    search: vi.fn(async () => ({ hits: [{ citation, text: 'Original material', path: source.path }], more: false, current: [excerpt.current], excluded: [], observedAt: 1 })),
    read: vi.fn(async () => excerpt) }
  return { port, manager: new KnowledgeManager(port) }
}
it('refreshes content-free metadata and clears retrieved text on refresh or connection invalidation', async () => {
  const { port, manager } = setup(), listener = vi.fn(), off = manager.subscribe(listener)
  await manager.refresh(); expect(port.sources).not.toHaveBeenCalled()
  await manager.search('material', 2); await manager.read(citation)
  expect(port.search).not.toHaveBeenCalled(); expect(port.read).not.toHaveBeenCalled()
  await manager.select(source.workspaceId); await manager.search('material', 2); await manager.read(citation)
  expect(manager.getSnapshot().excerpt?.text).toBe('Original material')
  await manager.refresh()
  expect(manager.getSnapshot().result).toBeUndefined(); expect(manager.getSnapshot().excerpt).toBeUndefined()
  expect(port.read).toHaveBeenCalledOnce(); expect(port.search).toHaveBeenCalledOnce()
  manager.invalidate(); expect(manager.getSnapshot().stale).toBe(true); expect(manager.getSnapshot().sources).toEqual([source])
  vi.mocked(port.sources).mockRejectedValueOnce(new Error('Metadata unavailable'))
  await manager.refresh(); expect(manager.getSnapshot()).toMatchObject({ stale: true, error: 'Metadata unavailable', sources: [source] })
  await manager.refresh(); expect(manager.getSnapshot().stale).toBe(false)
  await Promise.resolve(); expect(listener).toHaveBeenCalled(); off(); manager.dispose()
})
it('ignores superseded options, workspace metadata, searches, and citation replies', async () => {
  const { port, manager } = setup(), slowOptions = Promise.withResolvers<KnowledgeOptions>()
  vi.mocked(port.options).mockReturnValueOnce(slowOptions.promise)
  const first = manager.select(source.workspaceId)
  await manager.select('new' as never); slowOptions.resolve(options); await first
  expect(port.sources).toHaveBeenCalledTimes(1); expect(manager.getSnapshot().workspace).toBe('new')
  const slowSources = Promise.withResolvers<KnowledgeSource[]>()
  vi.mocked(port.sources).mockReturnValueOnce(slowSources.promise)
  const metadata = manager.refresh(); await Promise.resolve(); await manager.select(source.workspaceId)
  slowSources.resolve([]); await metadata; expect(manager.getSnapshot().sources).toEqual([source])
  const slowSearch = Promise.withResolvers<KnowledgeSearchResult>()
  vi.mocked(port.search).mockReturnValueOnce(slowSearch.promise)
  const searching = manager.search('old', 1); await manager.search('new', 2)
  slowSearch.resolve({ hits: [], current: [], excluded: [], more: false, observedAt: 0 }); await searching
  expect(manager.getSnapshot().result?.query.text).toBe('new')
  const slowRead = Promise.withResolvers<KnowledgeExcerpt>()
  vi.mocked(port.read).mockReturnValueOnce(slowRead.promise)
  const reading = manager.read(citation); manager.clearPreview(); slowRead.resolve(excerpt); await reading
  expect(manager.getSnapshot().excerpt).toBeUndefined()
  const delayed = Promise.withResolvers<KnowledgeExcerpt>(); vi.mocked(port.read).mockReturnValueOnce(delayed.promise)
  const old = manager.read(citation); await manager.select(undefined); delayed.resolve(excerpt); await old
  expect(manager.getSnapshot().excerpt).toBeUndefined(); manager.dispose()
})
it('clears old content and reports independent read failures', async () => {
  const { port, manager } = setup(); await manager.select(source.workspaceId)
  await manager.read(citation); vi.mocked(port.read).mockRejectedValueOnce('Access revoked')
  await manager.read(citation); expect(manager.getSnapshot()).toMatchObject({ excerpt: undefined, readError: 'Access revoked', reading: false })
  vi.mocked(port.search).mockRejectedValueOnce(new Error('Source unavailable'))
  await manager.search('material', 1); expect(manager.getSnapshot()).toMatchObject({ result: undefined, searchError: 'Source unavailable', searching: false })
  vi.mocked(port.options).mockRejectedValueOnce('Offline'); await manager.refresh()
  expect(manager.getSnapshot().error).toBe('Offline'); manager.dispose()
})
it('retains the exact uncertain command, coalesces equal in-flight requests, and retries only explicitly', async () => {
  const { port, manager } = setup(); await manager.select(source.workspaceId)
  const gate = Promise.withResolvers<KnowledgeSource>(); vi.mocked(port.register).mockReturnValueOnce(gate.promise)
  const first = manager.command(register), repeated = manager.command(structuredClone(register))
  expect(first).toBe(repeated); expect(port.register).toHaveBeenCalledOnce()
  manager.discard(); expect(manager.getSnapshot().pending).toEqual(register)
  await manager.command({ kind: 'index', request: { id: source.id, expectedRevision: 1, requestId: 'other' as never } })
  expect(manager.getSnapshot().writeError).toContain('settle')
  gate.reject(new Error('Acknowledgment lost')); await first
  expect(manager.getSnapshot()).toMatchObject({ writing: false, pending: register, writeError: 'Acknowledgment lost' })
  manager.invalidate(); await manager.refresh(); expect(port.register).toHaveBeenCalledOnce()
  await manager.command({ kind: 'setEnabled', request: { id: source.id, expectedRevision: 1, enabled: false } })
  expect(manager.getSnapshot().writeError).toContain('unconfirmed'); expect(port.setEnabled).not.toHaveBeenCalled()
  await manager.command(structuredClone(register)); expect(port.register).toHaveBeenCalledTimes(2)
  expect(manager.getSnapshot()).toMatchObject({ pending: undefined, acknowledged: { kind: 'register' }, writeError: null })
  expect(vi.mocked(port.register).mock.calls[1]?.[0]).toEqual(register.request); manager.dispose()
})
it('acknowledges indexing outcomes and grant changes without automatic content reads', async () => {
  const { manager, port } = setup(); await manager.select(source.workspaceId)
  const failedSource = { ...source, revision: 2, lastAttempt: { state: 'failed' as const, completedAt: 2, message: 'File missing' } }
  vi.mocked(port.index).mockResolvedValueOnce({ source: failedSource, attempt: failedSource.lastAttempt })
  vi.mocked(port.sources).mockResolvedValueOnce([failedSource])
  await manager.command({ kind: 'index', request: { id: source.id, expectedRevision: 1, requestId: 'index' as never } })
  expect(manager.getSnapshot()).toMatchObject({ acknowledged: { kind: 'index', attempt: failedSource.lastAttempt }, sources: [failedSource], pending: undefined })
  await manager.command({ kind: 'setEnabled', request: { id: source.id, expectedRevision: 2, enabled: false } })
  expect(manager.getSnapshot().acknowledged?.kind).toBe('setEnabled')
  expect(port.read).not.toHaveBeenCalled(); expect(port.search).not.toHaveBeenCalled()
  vi.mocked(port.setEnabled).mockRejectedValueOnce('Revision changed')
  await manager.command({ kind: 'setEnabled', request: { id: source.id, expectedRevision: 2, enabled: false } })
  expect(manager.getSnapshot().pending?.kind).toBe('setEnabled')
  manager.discard(); expect(manager.getSnapshot().pending).toBeUndefined(); manager.dispose()
})
it('keeps an acknowledged command separate from failed metadata and from a newly selected workspace', async () => {
  const { manager, port } = setup(); await manager.select(source.workspaceId)
  vi.mocked(port.sources).mockRejectedValueOnce(new Error('Refresh failed'))
  await manager.command(register)
  expect(manager.getSnapshot()).toMatchObject({ acknowledged: { kind: 'register' }, pending: undefined, error: 'Refresh failed' })
  const deferred = Promise.withResolvers<KnowledgeSource>(); vi.mocked(port.register).mockReturnValueOnce(deferred.promise)
  const writing = manager.command(register); await manager.select('other' as never)
  deferred.resolve(source); await writing
  expect(manager.getSnapshot().workspace).toBe('other'); expect(manager.getSnapshot().acknowledged?.kind).toBe('register'); manager.dispose()
})
it('ignores pending read/write replies after disposal and never admits further operations', async () => {
  const { manager, port } = setup(); await manager.select(source.workspaceId)
  const deferred = Promise.withResolvers<KnowledgeSource>(); vi.mocked(port.register).mockReturnValueOnce(deferred.promise)
  const writing = manager.command(register); manager.dispose(); const before = manager.getSnapshot()
  deferred.resolve(source); await writing; await manager.refresh(); await manager.command(register); await manager.search('ignored', 1); await manager.read(citation)
  expect(manager.getSnapshot()).toBe(before); expect(port.register).toHaveBeenCalledOnce()
  const delayed = setup(), optionsReply = Promise.withResolvers<KnowledgeOptions>()
  vi.mocked(delayed.port.options).mockReturnValueOnce(optionsReply.promise)
  const reading = delayed.manager.refresh(); delayed.manager.dispose(); optionsReply.resolve(options); await reading
  expect(delayed.manager.getSnapshot().options).toBeUndefined()
})
it('orders source paths independently of generated identities and preserves an older recovered indexing receipt', async () => {
  const { manager, port } = setup()
  const newer = { ...source, versions: [{ version: 1, capturedAt: 1, textSha256: 'one', bytes: 1, lines: 1 },
    { version: 2, capturedAt: 2, textSha256: 'two', bytes: 1, lines: 1 }] }
  vi.mocked(port.sources).mockResolvedValue([
    { ...source, id: 'a' as never, path: 'z.md' }, { ...source, id: 'z' as never, path: 'a.md' },
    { ...source, id: 'b' as never, path: 'a.md' },
  ])
  await manager.select(source.workspaceId)
  expect(manager.getSnapshot().sources.map(value => value.id)).toEqual(['b', 'z', 'a'])
  vi.mocked(port.index).mockResolvedValueOnce({ source: newer, attempt: { state: 'ready', version: 1, completedAt: 1 } })
  await manager.command({ kind: 'index', request: { id: source.id, expectedRevision: 1, requestId: 'original' as never } })
  expect(manager.getSnapshot().acknowledged).toEqual({ kind: 'index', sourceId: source.id, path: source.path, workspaceId: source.workspaceId,
    attempt: { state: 'ready', version: 1, completedAt: 1 } })
  manager.dispose()
})
