/** File grants and immutable citation evidence over real filesystem and JSON persistence. */
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as Domain from '@deepseek-ai/dsh-storage-domain'
import FsLocal from '@deepseek-ai/dsh-fs-local'
import * as Knowledge from '../src/index.ts'
import { WorkKnowledgeGateway } from '../src/gateway.ts'
import { knowledgeDomain, textDigest } from '../src/schema.ts'
import type { KnowledgeSource, KnowledgeSourceId } from '../src/types.ts'
const contexts: Context[] = [], roots: string[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  vi.restoreAllMocks()
})
const workspaceId = 'project' as never, id = 'material' as KnowledgeSourceId
async function boot(root?: string, config: Partial<Knowledge.Config> = {}) {
  if (root === undefined) { root = await mkdtemp(join(tmpdir(), 'dsh-knowledge-')); roots.push(root) }
  const cwd = join(root, 'project'); await mkdir(cwd, { recursive: true })
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage); await ctx.plugin(JsonStorage, { root: join(root, 'storage') }); await ctx.plugin(Domain, { backend: 'json' })
  await ctx.plugin(FsLocal, { cwd })
  const workspace = vi.fn(() => ({ id: workspaceId, path: cwd }))
  ctx.provide('workspaceRegistry', { get: workspace } as never)
  const fiber = ctx.plugin(Knowledge, { maxSources: 64, maxVersions: 20, maxFileBytes: 131072, maxRecordBytes: 4194304,
    maxTotalBytes: 16777216, maxResponseBytes: 1048576, maxQueryBytes: 512, maxHits: 50, ...config }); await fiber
  const service = ctx.workKnowledge, gateway = ctx.get('workKnowledgeGateway') as WorkKnowledgeGateway
  return { ctx, root, cwd, workspace, fiber, service, gateway }
}
async function register(ui: Awaited<ReturnType<typeof boot>>, text = '中文材料\nconst answer = "引用";\n<script>unsafe()</script>\r\n') {
  await writeFile(join(ui.cwd, 'source.md'), text)
  return ui.gateway.register({ id, workspaceId, path: 'source.md' })
}
const index = (ui: Awaited<ReturnType<typeof boot>>, source: KnowledgeSource, requestId = 'capture') =>
  ui.gateway.index({ id: source.id, expectedRevision: source.revision, requestId: requestId as never })
it('keeps immutable text, exact citations, attempt receipts, and independent freshness across restart', async () => {
  const ui = await boot(), source = await register(ui), first = await index(ui, source)
  expect(first.attempt).toMatchObject({ state: 'ready', version: 1 })
  expect(ui.gateway.options({})).toMatchObject({ maxSources: 64, maxVersions: 20, maxFileBytes: 131072, maxHits: 50 })
  const found = await ui.gateway.search({ workspaceId, text: '材料', limit: 2 })
  expect(found.hits).toHaveLength(1); expect(found.current[0]?.state).toBe('matching')
  const citation = found.hits[0]!.citation
  expect((await ui.gateway.read({ workspaceId, citation })).text).toBe('中文材料')
  await writeFile(join(ui.cwd, 'source.md'), 'New text')
  const stale = await ui.service.search({ workspaceId, text: '材料', limit: 2 })
  expect(stale.hits[0]?.text).toBe('中文材料'); expect(stale.current[0]?.state).toBe('different')
  const second = await index(ui, first.source, 'second')
  expect(second.attempt).toMatchObject({ state: 'ready', version: 2 })
  expect((await ui.service.read(workspaceId, citation)).text).toBe('中文材料')
  const replay = await index(ui, source)
  expect(replay.attempt).toEqual(first.attempt); expect(replay.source.versions).toHaveLength(2)
  expect(JSON.stringify(await ui.gateway.sources({ workspaceId }))).not.toContain('New text')
  expect(JSON.stringify(replay)).not.toMatch(/rootKey|targetKey|requestId|expectedRevision/)
  await ui.ctx.fiber.dispose()
  const restarted = await boot(ui.root)
  expect((await index(restarted, source)).attempt).toEqual(first.attempt)
  expect((await restarted.service.read(workspaceId, citation)).text).toBe('中文材料')
  expect((await readFile(join(ui.cwd, 'source.md'), 'utf8'))).toBe('New text')
})
it('enforces grant revocation in direct executors and keeps old citations across re-enable', async () => {
  const ui = await boot(), initial = await register(ui), ready = (await index(ui, initial)).source
  const citation = (await ui.service.search({ workspaceId, text: 'const', limit: 1 })).hits[0]!.citation
  const disabled = await ui.gateway.setEnabled({ id, expectedRevision: ready.revision, enabled: false })
  await expect(ui.service.read(workspaceId, citation)).rejects.toThrow('disabled')
  await expect(index(ui, initial)).rejects.toThrow('disabled')
  expect((await ui.service.search({ workspaceId, text: 'const', limit: 1 })).hits).toEqual([])
  expect((await ui.service.sources(workspaceId))[0]?.versions).toHaveLength(1)
  await ui.service.setEnabled({ id, expectedRevision: disabled.revision, enabled: true })
  expect((await ui.service.read(workspaceId, citation)).text).toContain('const answer')
  await expect(ui.service.read('other' as never, citation)).rejects.toThrow('another workspace')
  expect((await ui.service.search({ workspaceId: 'other' as never, text: 'const', limit: 1 })).hits).toEqual([])
  await expect(ui.service.setEnabled({ id, expectedRevision: ready.revision, enabled: true })).rejects.toThrow('revision changed')
  expect((await ui.service.register({ id, workspaceId, path: 'source.md' })).enabled).toBe(true)
  await expect(ui.service.register({ id, workspaceId, path: 'other' })).rejects.toThrow('another file')
})
it('retains successful captures after failed reads and recovers the original failed attempt without reading again', async () => {
  const ui = await boot(), initial = await register(ui), ready = (await index(ui, initial)).source
  await rm(join(ui.cwd, 'source.md'))
  const failed = await index(ui, ready, 'missing')
  expect(failed.attempt.state).toBe('failed'); expect(failed.source.versions).toHaveLength(1)
  const excluded = await ui.service.search({ workspaceId, text: '材料', limit: 1 })
  expect(excluded.hits).toEqual([]); expect(excluded.excluded[0]?.message).toContain('missing')
  await writeFile(join(ui.cwd, 'source.md'), 'Restored file')
  expect((await index(ui, ready, 'missing')).attempt).toEqual(failed.attempt)
  expect((await index(ui, failed.source, 'restored')).source.versions).toHaveLength(2)
  await expect(index(ui, { ...initial, revision: 50 })).rejects.toThrow('another revision')
})
it('rejects escaped and rebound targets and original workspace reassignment before content access', async () => {
  const ui = await boot(), initial = await register(ui), ready = (await index(ui, initial)).source
  const citation = (await ui.service.search({ workspaceId, text: '材料', limit: 1 })).hits[0]!.citation
  await writeFile(join(ui.root, 'private'), 'Private')
  await rm(join(ui.cwd, 'source.md')); await symlink(join(ui.root, 'private'), join(ui.cwd, 'source.md'))
  await expect(ui.service.read(workspaceId, citation)).rejects.toThrow('outside')
  expect((await index(ui, ready, 'escape')).attempt).toMatchObject({ state: 'failed' })
  await rm(join(ui.cwd, 'source.md')); await writeFile(join(ui.cwd, 'other.md'), 'Other')
  await symlink(join(ui.cwd, 'other.md'), join(ui.cwd, 'source.md'))
  await expect(ui.service.read(workspaceId, citation)).rejects.toThrow('target changed')
  ui.workspace.mockReturnValue({ id: workspaceId, path: ui.root })
  await expect(ui.service.read(workspaceId, citation)).rejects.toThrow('Original knowledge workspace')
  expect((await ui.service.search({ workspaceId, text: '材料', limit: 1 })).excluded).toHaveLength(1)
})
it('matches literal Chinese, short queries, quotes, operators, punctuation, and code with exact lines', async () => {
  const ui = await boot(), source = await register(ui, '材料与版本\n材料与版本\nfoo OR bar\nhello "world"\nA_%[B]\nconst answer = 42;\n🛰️中文检索\n'), ready = await index(ui, source)
  for (const text of ['材料', '材料与版本', 'OR', 'foo OR bar', '"world"', 'a_%[b]', 'CONST answer', '中文检索', '🛰️']) {
    const found = await ui.service.search({ workspaceId, text, limit: 20 })
    expect(found.hits.length, text).toBeGreaterThan(0)
    for (const hit of found.hits) expect((await ui.service.read(workspaceId, hit.citation)).text).toBe(hit.text)
  }
  const page = await ui.service.search({ workspaceId, text: '材料', limit: 1 })
  expect(page.more).toBe(true); expect(page.hits[0]?.citation.startLine).toBe(1)
  expect((await ui.service.search({ workspaceId, text: 'absent', limit: 1 })).more).toBe(false)
  const citation = page.hits[0]!.citation
  for (const patch of [{ version: 99 }, { textSha256: '0'.repeat(64) }, { startLine: 0 }, { endLine: 999 }, { startLine: 2, endLine: 1 }, { startLine: 1.5 }])
    await expect(ui.service.read(workspaceId, { ...citation, ...patch })).rejects.toThrow('citation')
  const multiline = await ui.service.read(workspaceId, { ...citation, endLine: ready.source.versions[0]!.lines })
  expect(multiline.text).toContain('🛰️中文检索\n')
})
it('refuses binary, invalid UTF-8, oversized, changing, and unavailable current files without losing captures', async () => {
  const ui = await boot(undefined, { maxFileBytes: 100 }), source = await register(ui), ready = await index(ui, source)
  let selected = ready.source
  for (const data of [Buffer.from([0, 0]), Buffer.from([255]), Buffer.alloc(101, 65)]) {
    await writeFile(join(ui.cwd, 'source.md'), data)
    const result = await index(ui, selected, `attempt-${selected.revision}`)
    expect(result.attempt.state).toBe('failed'); expect(result.source.versions).toHaveLength(1); selected = result.source
  }
  await writeFile(join(ui.cwd, 'source.md'), 'Again')
  const stat = ui.ctx.fs.stat.bind(ui.ctx.fs)
  let reads = 0
  vi.spyOn(ui.ctx.fs, 'stat').mockImplementation(async (target) => {
    const result = await stat(target); reads++
    return reads % 2 === 0 && result !== undefined ? { ...result, version: 'changed' as never } : result
  })
  const raced = (await index(ui, selected, 'race')).attempt
  expect(raced.state).toBe('failed')
  if (raced.state === 'failed') expect(raced.message).toContain('changed during')
})
it('serializes duplicate and competing indexing commands and refuses stale revisions', async () => {
  const ui = await boot(), source = await register(ui)
  const [a, b] = await Promise.all([index(ui, source), index(ui, source)])
  expect(a).toEqual(b); expect(a.source.versions).toHaveLength(1)
  await expect(index(ui, source, 'conflict')).rejects.toThrow('revision changed')
  const results = await Promise.allSettled([index(ui, a.source, 'next'), index(ui, a.source, 'competing')])
  expect(results.map(value => value.status)).toEqual(['fulfilled', 'rejected'])
})
it('validates registration, unindexed sources, query bounds, and complete record/corpus/response capacities', async () => {
  const ui = await boot(undefined, { maxSources: 1, maxVersions: 1, maxQueryBytes: 6, maxHits: 2 })
  for (const path of ['', '/', 'C:source.md', '../private', '.'])
    await expect(ui.service.register({ id, workspaceId, path })).rejects.toThrow()
  const source = await register(ui, '材料')
  expect((await ui.service.search({ workspaceId, text: '材料', limit: 1 })).excluded[0]?.message).toContain('no successful capture')
  await expect(ui.service.register({ id: 'other' as never, workspaceId, path: 'source.md' })).rejects.toThrow('capacity')
  const ready = await index(ui, source)
  await expect(index(ui, ready.source, 'second')).rejects.toThrow('version capacity')
  for (const text of ['', '       ', '材料甲', '\0']) await expect(ui.service.search({ workspaceId, text, limit: 1 })).rejects.toThrow('query')
  for (const limit of [0, 3, 1.5]) await expect(ui.service.search({ workspaceId, text: '材料', limit })).rejects.toThrow('limit')
  expect((await ui.service.search({ workspaceId, text: '材料', limit: 1 })).hits).toHaveLength(1)
  for (const config of [{ maxRecordBytes: 1 }, { maxTotalBytes: 1 }, { maxResponseBytes: 1 }]) {
    const tiny = await boot(undefined, config)
    await expect(register(tiny)).rejects.toThrow(/exceeds/)
  }
  await expect(ui.service.sources(workspaceId)).resolves.toHaveLength(1)
  await expect(ui.service.read(workspaceId, { sourceId: 'absent' as never, version: 1, textSha256: '', startLine: 1, endLine: 1 })).rejects.toThrow('Unknown knowledge source')
})
it('fails durable decoding for corrupt text, revision, attempts, and duplicate request identities', () => {
  const base = { id, workspaceId, workspacePath: '/project', path: 'a', rootKey: '/project', targetKey: '/project/a', enabled: true, revision: 2,
    versions: [{ version: 1, capturedAt: 1, textSha256: textDigest('材料'), bytes: 6, lines: 1, text: '材料', requestId: 'one', expectedRevision: 1 }] }
  const schema = knowledgeDomain.tables.sources.valueSchema
  expect(schema.parse(base)).toEqual(base)
  for (const patch of [{ version: 2 }, { text: 'other' }, { bytes: 1 }, { lines: 2 }, { expectedRevision: 2 }])
    expect(() => schema.parse({ ...base, versions: [{ ...base.versions[0], ...patch }] })).toThrow('inconsistent')
  expect(() => schema.parse({ ...base, revision: 3, versions: [...base.versions, { ...base.versions[0], version: 2 }] })).toThrow('repeat')
  expect(() => schema.parse({ ...base, lastAttempt: { state: 'ready', version: 2, completedAt: 1, requestId: 'one', expectedRevision: 1 } })).toThrow('attempt')
  for (const lastAttempt of [
    { state: 'ready', version: 1, completedAt: 1, requestId: 'other', expectedRevision: 1 },
    { state: 'ready', version: 1, completedAt: 1, requestId: 'one', expectedRevision: 2 },
    { state: 'ready', version: 1, completedAt: 2, requestId: 'one', expectedRevision: 1 },
    { state: 'failed', completedAt: 1, message: 'Failure', requestId: 'one', expectedRevision: 1 },
  ]) expect(() => schema.parse({ ...base, revision: 3, lastAttempt })).toThrow('attempt')
  expect(() => schema.parse({ ...base, revision: 4, versions: [...base.versions, { ...base.versions[0], version: 2, requestId: 'two' }] })).toThrow('inconsistent')

})
it('rejects duplicate canonical targets, missing workspaces, and unavailable reads without granting new access', async () => {
  const ui = await boot(), source = await register(ui)
  await symlink(join(ui.cwd, 'source.md'), join(ui.cwd, 'alias.md'))
  await expect(ui.service.register({ id: 'alias' as never, workspaceId, path: 'alias.md' })).rejects.toThrow('already registered')
  ui.workspace.mockReturnValueOnce(undefined as never)
  await expect(ui.service.register({ id: 'other' as never, workspaceId, path: 'other' })).rejects.toThrow('workspace is unavailable')
  expect(await ui.service.setEnabled({ id, expectedRevision: 1, enabled: true })).toEqual(source)
  await writeFile(join(ui.cwd, 'other.md'), 'Second')
  await ui.service.register({ id: 'second' as never, workspaceId, path: 'other.md' })
  expect((await ui.service.sources(workspaceId)).map(item => item.id)).toEqual([id, 'second'])
  await expect(index(ui, source, 'once')).resolves.toMatchObject({ attempt: { state: 'ready' } })
  vi.spyOn(ui.ctx.fs, 'streamText').mockRejectedValueOnce(new Error('Read denied by filesystem'))
  const failed = await index(ui, { ...source, revision: 2 }, 'denied')
  expect(failed.attempt).toMatchObject({ state: 'failed', message: 'Read denied by filesystem' })
  await expect(index(ui, { ...source, revision: 40 }, 'denied')).rejects.toThrow('another revision')
  vi.spyOn(ui.ctx.fs, 'streamText').mockRejectedValueOnce('Filesystem transport rejected')
  expect((await index(ui, failed.source, 'untyped-transport')).attempt).toMatchObject({ state: 'failed', message: 'Filesystem transport rejected' })
})
it('bounds size-less streaming, preserves BOM decoding and CR text, and rejects a complete oversized result', async () => {
  const ui = await boot(undefined, { maxFileBytes: 5 }), source = await register(ui, '\uFEFF界')
  // The local provider reports raw bytes, so use its size-less metadata path to bound decoded text independently.
  const stat = ui.ctx.fs.stat.bind(ui.ctx.fs)
  vi.spyOn(ui.ctx.fs, 'stat').mockImplementation(async (target) => {
    const info = await stat(target)
    if (info === undefined) return info
    const { size: _size, ...value } = info
    return value
  })
  const ready = await index(ui, source)
  expect(ready.source.versions[0]?.bytes).toBe(3)
  await writeFile(join(ui.cwd, 'source.md'), '界界')
  const oversized = (await index(ui, ready.source, 'large-stream')).attempt
  expect(oversized.state).toBe('failed')
  if (oversized.state === 'failed') expect(oversized.message).toContain('text exceeds')
  const another = await boot(), registered = await register(another, 'a\r\nb\n')
  const captured = await index(another, registered)
  const hit = (await another.service.search({ workspaceId, text: 'a', limit: 1 })).hits[0]!
  expect(hit.text).toBe('a\r')
  expect((await another.service.read(workspaceId, { ...hit.citation, endLine: 3 })).text).toBe('a\r\nb\n')
  const record = another.ctx.storageDomain.get('work_knowledge')!.table('sources').get(id) as import('../src/schema.ts').StoredKnowledgeSource
  const exactBytes = Buffer.byteLength(JSON.stringify(record))
  const bounded = await boot(another.root, { maxRecordBytes: exactBytes, maxTotalBytes: exactBytes })
  expect(await bounded.service.setEnabled({ id, expectedRevision: captured.source.revision, enabled: true })).toEqual(captured.source)
  await expect(bounded.service.register({ id: 'new' as never, workspaceId, path: 'source.md' })).rejects.toThrow('already registered')
  const limited = await boot(another.root, { maxResponseBytes: 400 })
  await expect(limited.service.read(workspaceId, { ...hit.citation, endLine: 3 })).resolves.toMatchObject({ text: 'a\r\nb\n' })
  await expect(limited.service.search({ workspaceId, text: 'a', limit: 1 })).rejects.toThrow('maxResponseBytes')
})
it('drains admitted reads before closing storage and refuses commands during teardown', async () => {
  const ui = await boot(), source = await register(ui)
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const original = ui.ctx.fs.streamText.bind(ui.ctx.fs)
  const read = vi.spyOn(ui.ctx.fs, 'streamText').mockImplementationOnce(async (target) => { await gate; return original(target) })
  const operation = index(ui, source)
  await vi.waitFor(() => { expect(read).toHaveBeenCalledOnce() })
  let disposed = false
  const closing = ui.fiber.dispose().then(() => { disposed = true })
  try {
    await Promise.resolve()
    expect(disposed).toBe(false)
  } finally { release() }
  expect((await operation).attempt.state).toBe('ready'); await closing
  await expect(ui.service.sources(workspaceId)).rejects.toThrow('unloading')
  const restarted = await boot(ui.root)
  expect((await restarted.service.sources(workspaceId))[0]?.versions).toHaveLength(1)
})
it('checks authoritative committed source keys, version order, revision links, and ready receipts', async () => {
  const { default: Registry } = await import('@deepseek-ai/dsh-invariants'), companion = await import('../src/invariant.ts')
  const ctx = new Context(); contexts.push(ctx); await ctx.plugin(Registry); const fiber = await ctx.plugin(companion)
  const capture = { version: 1, requestId: 'one', expectedRevision: 1 }
  const record = { id: 'file', revision: 2, versions: [capture] }
  const emit = (value: object, patch: object = {}) => { ctx.emit('domain/changed', { domain: 'work_knowledge', table: 'sources', operation: 'put', key: 'file', value, ...patch } as never) }
  expect(() => { emit(record) }).not.toThrow()
  for (const patch of [{ domain: 'other' }, { table: 'other' }, { operation: 'delete' }]) expect(() => { emit({}, patch) }).not.toThrow()
  expect(() => { emit({ ...record, id: 'other' }) }).toThrow('key differs')
  expect(() => { emit({ ...record, versions: [{ ...capture, version: 2 }] }) }).toThrow('capture order')
  expect(() => { emit({ ...record, revision: 1 }) }).toThrow('capture order')
  expect(() => { emit({ ...record, lastAttempt: { state: 'ready', version: 2, requestId: 'one' } }) }).toThrow('does not identify')
  await fiber.dispose()
})
