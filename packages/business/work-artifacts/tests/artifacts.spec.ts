/** Real JSON persistence and filesystem evidence for explicitly registered project outputs. */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as Domain from '@deepseek-ai/dsh-storage-domain'
import FsLocal from '@deepseek-ai/dsh-fs-local'
import type { DeliveryReview, WorkSource } from '@deepseek-ai/dsh-work-center/types'
import * as Artifacts from '../src/index.ts'
import { WorkArtifactGateway } from '../src/gateway.ts'
import { artifactDomain } from '../src/schema.ts'
import type { ArtifactQuery, ArtifactRegistration, ArtifactVersion } from '../src/types.ts'
import { decodeArtifact, encodeArtifact } from '../src/bytes.ts'
const contexts: Context[] = [], roots: string[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  vi.restoreAllMocks()
})
const query: ArtifactQuery = { text: '', limit: 2 }
const ref = { kind: 'agent' as const, id: 'source-run' as never }
const source: WorkSource = { ref, name: 'Report writer', workspaceId: 'workspace' as never, sessionId: 'session' as never, status: 'completed' }
const register = (patch: Partial<ArtifactRegistration> = {}): ArtifactRegistration => ({ path: 'report.html', expectedVersion: 0,
  requestId: 'capture' as never,
  source: { kind: 'current-file', ref }, ...patch })
async function boot(root?: string, config: Partial<Artifacts.Config> = {}) {
  if (root === undefined) { root = await mkdtemp(join(tmpdir(), 'dsh-artifacts-')); roots.push(root) }
  const cwd = join(root, 'project'); await mkdir(cwd, { recursive: true })
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage); await ctx.plugin(JsonStorage, { root: join(root, 'storage') }); await ctx.plugin(Domain, { backend: 'json' })
  await ctx.plugin(FsLocal, { cwd })
  const sourceRead = vi.fn(async () => structuredClone(source))
  const original = encodeArtifact(Buffer.from('\uFEFF<html>Retained accepted report</html>'))
  const reviewValue: DeliveryReview = { ref, version: 'delivery' as never, revision: 1, decisionId: 'decision' as never, decision: 'accepted',
    reason: 'Reviewed the retained bytes', reviewedAt: 1, actor: 'local-operator', delivery: { version: 'delivery' as never,
      outputs: [], criteria: [], evidence: 'recorded-response', artifacts: [{ path: 'report.html', state: 'captured', ...original }] } }
  const review = vi.fn(async () => structuredClone(reviewValue)), workspace = vi.fn(() => ({ path: cwd }))
  ctx.provide('workCenter', { source: sourceRead, review } as never); ctx.provide('workspaceRegistry', { get: workspace } as never)
  const fiber = ctx.plugin(Artifacts, { pageSize: 2, maxPageSize: 3,
    maxArtifacts: 1000, maxVersions: 20, maxFileBytes: 131072,
    maxRecordBytes: 4194304, maxResponseBytes: 1048576, ...config }); await fiber
  await writeFile(join(cwd, 'report.html'), '<script>globalThis.executed = true</script>\nOriginal report')
  return { ctx, cwd, root, fiber, sourceRead, review, reviewValue, workspace, service: ctx.workArtifacts,
    gateway: ctx.get('workArtifactGateway') as WorkArtifactGateway }
}
it('retains exact UTF-8, BOM, empty, NUL, and invalid-UTF-8 bytes and rejects inconsistent durable evidence', () => {
  for (const data of [Buffer.from(''), Buffer.from('\uFEFF报告'), Buffer.from([0, 1]), Buffer.from([255]), Buffer.from('<script>inert</script>')]) {
    const encoded = encodeArtifact(data)
    expect(Buffer.from(decodeArtifact(encoded))).toEqual(data)
    for (const patch of [{ sha256: '0'.repeat(64) }, { bytes: data.byteLength + 1 }, { content: 'different' }])
      expect(() => decodeArtifact({ ...encoded, ...patch })).toThrow('inconsistent')
  }
})
it('stores immutable file versions, original receipts, and metadata-only pages across edits and restart', async () => {
  const ui = await boot(), changed = vi.fn(); ui.ctx.on('work-artifact/changed', changed)
  const first = await ui.gateway.register(register())
  expect(changed).toHaveBeenCalledWith(first.id)
  expect(ui.gateway.options({})).toEqual({ pageSize: 2, maxFileBytes: 131072 })
  const before = await ui.gateway.read(first)
  expect(before.snapshot.content).toContain('<script>')
  expect(JSON.stringify(before)).not.toContain('intentHash')
  expect(JSON.stringify(before)).not.toContain('requestId')
  await writeFile(join(ui.cwd, 'report.html'), 'New report')
  const second = await ui.service.register(register({ id: first.id, expectedVersion: 1, requestId: 'second' as never }))
  expect(second.version).toBe(2)
  expect((await ui.service.read(first.id, 1)).snapshot).toEqual(before.snapshot)
  expect((await ui.service.read(first.id, 2)).snapshot.content).toBe('New report')
  const reads = vi.spyOn(ui.ctx.fs, 'readBytes')
  expect(await ui.service.register(register())).toEqual(first)
  const page = await ui.gateway.query(query)
  expect(page.items[0]?.latest.version).toBe(2)
  expect(JSON.stringify(page)).not.toContain('New report')
  expect(reads).not.toHaveBeenCalled()
  await ui.fiber.dispose()
  const restarted = await boot(ui.root)
  expect(await restarted.service.register(register())).toEqual(first)
  expect((await restarted.service.read(first.id, 1)).snapshot).toEqual(before.snapshot)
  await expect(ui.service.query(query)).rejects.toThrow('unloading')
})
it('promotes exact accepted-review bytes without touching the current file and preserves historical acceptance provenance', async () => {
  const ui = await boot(); await rm(join(ui.cwd, 'report.html'))
  const reads = vi.spyOn(ui.ctx.fs, 'readBytes'), resolves = vi.spyOn(ui.ctx.fs, 'resolve')
  const receipt = await ui.gateway.register(register({ source: { kind: 'accepted-review', ref, reviewRevision: 1 } }))
  const stored = await ui.gateway.read(receipt)
  expect(stored.snapshot.content).toBe('\uFEFF<html>Retained accepted report</html>')
  expect(stored.snapshot.origin).toMatchObject({ kind: 'accepted-review', reviewRevision: 1, deliveryVersion: 'delivery', reviewedAt: 1 })
  expect(ui.review).toHaveBeenCalledWith(ref, 1)
  expect(reads).not.toHaveBeenCalled(); expect(resolves).not.toHaveBeenCalled()
  expect((await ui.service.inspectCurrent(receipt.id, 1)).state).toBe('missing')
  expect((await ui.service.read(receipt.id, 1)).snapshot.content).toBe(stored.snapshot.content)
})
it('observes matching, changed, missing, outside-workspace, and unavailable current files without rewriting history', async () => {
  const ui = await boot(), first = await ui.service.register(register())
  expect((await ui.gateway.inspectCurrent(first)).state).toBe('matching')
  await writeFile(join(ui.cwd, 'report.html'), 'Different')
  expect((await ui.service.inspectCurrent(first.id, 1)).state).toBe('different')
  await rm(join(ui.cwd, 'report.html'))
  expect((await ui.service.inspectCurrent(first.id, 1)).state).toBe('missing')
  await writeFile(join(ui.root, 'outside.html'), 'Outside')
  await symlink(join(ui.root, 'outside.html'), join(ui.cwd, 'report.html'))
  const external = await ui.service.inspectCurrent(first.id, 1)
  expect(external.state).toBe('unavailable')
  if (external.state === 'unavailable') expect(external.message).toContain('outside')
  ui.workspace.mockReturnValueOnce(undefined as never)
  expect((await ui.service.inspectCurrent(first.id, 1)).state).toBe('unavailable')
  vi.spyOn(ui.ctx.fs, 'resolve').mockRejectedValueOnce('Disconnected provider')
  expect(await ui.service.inspectCurrent(first.id, 1)).toMatchObject({ state: 'unavailable', message: 'Disconnected provider' })
  expect((await ui.service.read(first.id, 1)).entry.latest.version).toBe(1)
  await expect(ui.service.read(first.id, 9)).rejects.toThrow('capture version')
  await expect(ui.service.inspectCurrent('missing' as never, 1)).rejects.toThrow('Unknown project artifact')
})
it('rejects stale versions, conflicting request identities, duplicate paths, moved workspaces, and unsettled executions', async () => {
  const ui = await boot(), first = await ui.service.register(register())
  await expect(ui.service.register(register({ path: 'another', requestId: 'capture' as never }))).rejects.toThrow('another registration')
  await expect(ui.service.register(register({ id: first.id, expectedVersion: 0, requestId: 'stale' as never }))).rejects.toThrow('version changed')
  await expect(ui.service.register(register({ requestId: 'duplicate' as never }))).rejects.toThrow('already registered')
  await expect(ui.service.register(register({ id: first.id, expectedVersion: 1, path: 'changed', requestId: 'path' as never }))).rejects.toThrow('cannot change')
  ui.workspace.mockReturnValueOnce({ path: ui.root })
  await expect(ui.service.register(register({ id: first.id, expectedVersion: 1, requestId: 'root' as never }))).rejects.toThrow('cannot change')
  ui.sourceRead.mockResolvedValueOnce({ ...source, status: 'running' })
  await expect(ui.service.register(register({ path: 'new', requestId: 'active' as never }))).rejects.toThrow('settle')
  ui.workspace.mockReturnValueOnce(undefined as never)
  await expect(ui.service.register(register({ path: 'new', requestId: 'missing-workspace' as never }))).rejects.toThrow('workspace is unavailable')
  await expect(ui.service.register(register({ requestId: '' as never }))).rejects.toThrow('nonempty')
  await expect(ui.service.register(register({ path: '   ' }))).rejects.toThrow('nonempty')
  await expect(ui.service.register(register({ id: 'unknown' as never, requestId: 'unknown' as never }))).rejects.toThrow('Unknown project artifact')
  await expect(ui.service.register(register({ path: 'missing', requestId: 'missing-file' as never }))).rejects.toThrow()
  await writeFile(join(ui.root, 'outside'), 'Private')
  await expect(ui.service.register(register({ path: '../outside', requestId: 'outside' as never }))).rejects.toThrow('outside')
})
it('rejects unaccepted, missing-path, and inconsistent reviewed captures instead of reading a replacement from disk', async () => {
  const ui = await boot(), request = register({ source: { kind: 'accepted-review', ref, reviewRevision: 1 } })
  ui.review.mockResolvedValueOnce({ ...ui.reviewValue, decision: 'changes-requested' })
  await expect(ui.service.register(request)).rejects.toThrow('accepted review')
  await expect(ui.service.register({ ...request, path: 'other' })).rejects.toThrow('no retained capture')
  ui.review.mockResolvedValueOnce({ ...ui.reviewValue, delivery: { ...ui.reviewValue.delivery, artifacts: [{ path: 'report.html', state: 'unavailable', error: 'Missing' }] } })
  await expect(ui.service.register(request)).rejects.toThrow('no retained capture')
  const original = ui.reviewValue.delivery.artifacts[0]!
  if (original.state !== 'captured') throw new Error('Expected fixture capture')
  ui.review.mockResolvedValueOnce({ ...ui.reviewValue, delivery: { ...ui.reviewValue.delivery, artifacts: [{ ...original, sha256: '0'.repeat(64) }] } })
  await expect(ui.service.register(request)).rejects.toThrow('inconsistent')
})
it('bounds files, versions, registrations, and complete UTF-8 records without partial commits', async () => {
  const tiny = await boot(undefined, { maxFileBytes: 1 })
  await expect(tiny.service.register(register())).rejects.toThrow()
  await expect(tiny.service.register(register({ source: { kind: 'accepted-review', ref, reviewRevision: 1 } }))).rejects.toThrow('maxFileBytes')
  expect((await tiny.service.query(query)).items).toEqual([])
  const bounded = await boot(undefined, { maxArtifacts: 1, maxVersions: 1 }), first = await bounded.service.register(register())
  await expect(bounded.service.register(register({ path: 'other', requestId: 'full' as never }))).rejects.toThrow('capacity')
  await expect(bounded.service.register(register({ id: first.id, expectedVersion: 1, requestId: 'version' as never }))).rejects.toThrow('version capacity')
  const small = await boot(undefined, { maxRecordBytes: 1 })
  await expect(small.service.register(register())).rejects.toThrow('maxRecordBytes')
  expect((await small.service.query(query)).items).toEqual([])
  await expect(boot(undefined, { pageSize: 4, maxPageSize: 3 })).rejects.toThrow('pageSize')
})
it('binds pagination to filtered latest metadata, committed generations, and provider restarts', async () => {
  const ui = await boot()
  for (let i = 0; i < 3; i++) {
    await writeFile(join(ui.cwd, `report-${i}`), String(i))
    if (i === 1) ui.sourceRead.mockResolvedValueOnce({ ...source, ref: { kind: 'workflow', id: 'workflow-run' as never }, status: 'succeeded' })
    await ui.service.register(register({ path: `report-${i}`, requestId: `item-${i}` as never,
      ...(i === 1 ? { source: { kind: 'current-file', ref: { kind: 'workflow', id: 'workflow-run' as never } } } : {}) }))
  }
  const first = await ui.service.query(query)
  expect(first.items).toHaveLength(2); expect(first.next).toBeDefined()
  const next = await ui.service.query({ ...query, cursor: first.next! })
  expect(next.items).toHaveLength(1); expect(next.next).toBeUndefined()
  expect(new Set([...first.items, ...next.items].map(value => value.id)).size).toBe(3)
  expect((await ui.service.query({ ...query, source: 'workflow' })).items).toHaveLength(1)
  expect((await ui.service.query({ ...query, text: 'REPORT-1', workspaceId: 'workspace' as never, origin: 'current-file' })).items).toHaveLength(1)
  expect((await ui.service.query({ ...query, workspaceId: 'other' as never })).items).toEqual([])
  expect((await ui.service.query({ ...query, origin: 'accepted-review' })).items).toEqual([])
  await expect(ui.service.query({ ...query, cursor: { ...first.next!, after: 'missing' as never } })).rejects.toThrow('continuation')
  await expect(ui.service.query({ ...query, text: 'different', cursor: first.next! })).rejects.toThrow('selection changed')
  for (const limit of [0, 4, 1.5]) await expect(ui.service.query({ ...query, limit })).rejects.toThrow('maxPageSize')
  const selected = first.items[0]!
  await ui.service.register(register({ id: selected.id, path: selected.path, expectedVersion: 1, requestId: 'append' as never }))
  await expect(ui.service.query({ ...query, cursor: first.next! })).rejects.toThrow('directory or selection')
  const again = await ui.service.query(query)
  await ui.fiber.dispose(); const restarted = await boot(ui.root)
  await expect(restarted.service.query({ ...query, cursor: again.next! })).rejects.toThrow('directory or selection')
})
it('checks complete response capacity before writes and rejects oversized previews without truncation', async () => {
  const small = await boot(undefined, { maxResponseBytes: 1 })
  expect(() => small.service.options()).toThrow('maxResponseBytes')
  await expect(small.service.register(register())).rejects.toThrow('maxResponseBytes')
  expect(small.ctx.storageDomain.get('work_artifacts')!.table('artifacts').size).toBe(0)
  await expect(small.service.query(query)).rejects.toThrow('maxResponseBytes')
  const full = await boot(), first = await full.service.register(register())
  await full.fiber.dispose()
  const constrained = await boot(full.root, { maxResponseBytes: 100 })
  await expect(constrained.service.read(first.id, 1)).rejects.toThrow('maxResponseBytes')
  await expect(constrained.service.inspectCurrent(first.id, 1)).rejects.toThrow('maxResponseBytes')
  await constrained.fiber.dispose()
  const recovery = await boot(full.root, { maxResponseBytes: 1 })
  await expect(recovery.service.register(register())).rejects.toThrow('maxResponseBytes')
  expect(recovery.sourceRead).not.toHaveBeenCalled()
})
it('rejects corrupted durable version relationships and payloads at the declared parser', async () => {
  const ui = await boot(), first = await ui.service.register(register())
  const record = ui.ctx.storageDomain.get('work_artifacts')!.table('artifacts').get(first.id) as import('../src/schema.ts').StoredArtifact
  expect(artifactDomain.tables.artifacts.valueSchema.parse(record)).toEqual(record)
  const version = record.versions[0]!
  for (const value of [{ ...record, versions: [{ ...version, version: 2 }] },
    { ...record, versions: [{ ...version, origin: { ...version.origin, source: { ...source, workspaceId: 'other' } } }] },
    { ...record, versions: [{ ...version, bytes: 999 }] },
    { ...record, versions: [version, { ...version, version: 2 }] }])
    expect(() => artifactDomain.tables.artifacts.valueSchema.parse(value)).toThrow()
})
it('contains throwing observers after commit and drains an admitted filesystem read before closing storage', async () => {
  const ui = await boot()
  ui.ctx.on('work-artifact/changed', () => { throw new Error('Observer threw') })
  // oxlint-disable-next-line typescript/no-misused-promises -- A rejected untyped void observer must not reject an admitted capture.
  ui.ctx.on('work-artifact/changed', () => Promise.reject(new Error('Observer rejected')))
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const read = vi.spyOn(ui.ctx.fs, 'readBytes').mockImplementationOnce(async () => { await gate; return Buffer.from('Owned capture') })
  const registration = ui.service.register(register())
  await vi.waitFor(() => { expect(read).toHaveBeenCalledOnce() })
  let closed = false
  const disposing = ui.fiber.dispose().then(() => { closed = true })
  try { await Promise.resolve(); expect(closed).toBe(false) } finally { release() }
  const receipt = await registration; await disposing
  const restarted = await boot(ui.root)
  expect((await restarted.service.read(receipt.id, 1)).snapshot.content).toBe('Owned capture')
})
it('checks committed registration identity, version order, workspace links, and request ownership through its companion', async () => {
  const { default: Registry } = await import('@deepseek-ai/dsh-invariants'), companion = await import('../src/invariant.ts')
  const ctx = new Context(); contexts.push(ctx); await ctx.plugin(Registry); const fiber = await ctx.plugin(companion)
  const version: ArtifactVersion = { ...encodeArtifact(Buffer.from('content')), version: 1, capturedAt: 1, origin: { kind: 'current-file', source } }
  const record = { id: 'file', workspaceId: 'workspace', path: 'report', workspacePath: '/workspace', versions: [{ ...version, content: 'content', requestId: 'request', intentHash: 'hash' }] }
  const emit = (value: object, patch: object = {}) => { ctx.emit('domain/changed', { domain: 'work_artifacts', table: 'artifacts', operation: 'put', key: 'file', value, ...patch } as never) }
  expect(() => { emit(record) }).not.toThrow()
  for (const patch of [{ domain: 'other' }, { table: 'other' }, { operation: 'delete' }]) expect(() => { emit({}, patch) }).not.toThrow()
  expect(() => { emit({ ...record, id: 'other' }) }).toThrow('key differs')
  expect(() => { emit({ ...record, versions: [{ ...record.versions[0], version: 2 }] }) }).toThrow('not contiguous')
  expect(() => { emit({ ...record, workspaceId: 'other' }) }).toThrow('another workspace')
  expect(() => { emit({ ...record, versions: [record.versions[0], { ...record.versions[0], version: 2 }] }) }).toThrow('identities repeat')
  await fiber.dispose()
})


it('keeps equal-time directory ordering deterministic and enforces exact UTF-8 record and response limits', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(100)
  const ui = await boot()
  await writeFile(join(ui.cwd, 'report.html'), '界')
  const first = await ui.service.register(register())
  const record = ui.ctx.storageDomain.get('work_artifacts')!.table('artifacts').get(first.id) as import('../src/schema.ts').StoredArtifact
  const recordBytes = Buffer.byteLength(JSON.stringify(record))
  const detailBytes = Buffer.byteLength(JSON.stringify(await ui.service.read(first.id, 1)))
  const exact = await boot(undefined, { maxFileBytes: 3, maxRecordBytes: recordBytes, maxResponseBytes: detailBytes })
  await writeFile(join(exact.cwd, 'report.html'), '界')
  const receipt = await exact.service.register(register())
  expect((await exact.service.read(receipt.id, 1)).snapshot.bytes).toBe(3)
  const belowRecord = await boot(undefined, { maxRecordBytes: recordBytes - 1 })
  await writeFile(join(belowRecord.cwd, 'report.html'), '界')
  await expect(belowRecord.service.register(register())).rejects.toThrow('maxRecordBytes')
  const belowResponse = await boot(undefined, { maxResponseBytes: detailBytes - 1 })
  await writeFile(join(belowResponse.cwd, 'report.html'), '界')
  const preview = await belowResponse.service.register(register())
  await expect(belowResponse.service.read(preview.id, 1)).rejects.toThrow('maxResponseBytes')
  for (const path of ['second', 'third']) {
    await writeFile(join(ui.cwd, path), 'data')
    await ui.service.register(register({ path, requestId: path as never }))
  }
  const all = await ui.service.query({ ...query, limit: 3 })
  expect(all.items.map(item => item.id)).toEqual(all.items.map(item => item.id).sort((a, b) => a.localeCompare(b)))
})
