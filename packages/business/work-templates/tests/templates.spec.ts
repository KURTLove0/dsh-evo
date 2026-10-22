/** Durable template versions and request replay over real JSON domain storage. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as Domain from '@deepseek-ai/dsh-storage-domain'
import type { WorkflowDocument } from '@deepseek-ai/dsh-business-workflow/workbench-types'
import * as Templates from '../src/index.ts'
import type { TemplateMutation } from '../src/types.ts'
import { WorkTemplateGateway } from '../src/gateway.ts'

const roots: string[] = [], contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
const definition = { requirement: { summary: 'Review', objectives: [], inputs: [], outputs: [], constraints: [], acceptanceCases: [] }, nodes: [], finalOutputs: [], positions: {} }
const workflow: WorkflowDocument = { id: 'workflow' as never, workspaceId: 'workspace' as never, name: 'Workflow', revision: 2, createdAt: 1, updatedAt: 1,
  archived: false, draft: definition, versions: [{ id: 'publication' as never, number: 1, revision: 1, createdAt: 1, definition }] }
async function boot(root?: string, config: Partial<Templates.Config> = {}) {
  if (root === undefined) { root = await mkdtemp(join(tmpdir(), 'dsh-templates-')); roots.push(root) }
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage); await ctx.plugin(JsonStorage, { root }); await ctx.plugin(Domain, { backend: 'json' })
  const command = vi.fn(async () => ({ workflowId: 'copy' as never, revision: 1 }))
  const snapshot = vi.fn(async () => ({ workflows: [workflow, { ...workflow, id: 'draft', versions: [] }] }))
  ctx.provide('workflowWorkbench', { snapshot, command } as never)
  await ctx.plugin(Templates, { maxTemplates: 3, maxVersions: 3, maxRecordBytes: 10000, ...config })
  return { ctx, root, command, snapshot, service: ctx.workTemplates, gateway: ctx.get('workTemplateGateway') as WorkTemplateGateway }
}
const save = (goal = 'Review changes'): Extract<TemplateMutation, { kind: 'save-task' }> => ({ kind: 'save-task', expectedRevision: 0,
  requestId: 'first' as never, name: 'Review', brief: { version: 1, goal, background: 'Source paths', deliverables: [], acceptanceCriteria: ['Cite evidence'], constraints: 'Read only' } })
it('retains exact prior versions and original receipts after edits, archive, restore, and restart', async () => {
  const ui = await boot()
  const changed = vi.fn(); ui.ctx.on('work-template/changed', changed)
  const first = await ui.gateway.command(save())
  expect(changed).toHaveBeenCalledWith(first.id)
  const edit = { ...save('Review documentation'), id: first.id, expectedRevision: 1, requestId: 'edit' as never }
  expect(await ui.gateway.command(edit)).toMatchObject({ revision: 2, version: 2 })
  expect(await ui.gateway.command(save())).toEqual(first)
  expect((await ui.gateway.read({ id: first.id })).versions.map(value => value.content)).toMatchObject([
    { brief: { goal: 'Review changes' } }, { brief: { goal: 'Review documentation' } },
  ])
  await expect(ui.service.command({ ...edit, requestId: 'stale' as never })).rejects.toThrow('changed')
  await expect(ui.service.command({ ...save('Other') })).rejects.toThrow('another template edit')
  await expect(ui.service.command({ ...save(), requestId: '' as never })).rejects.toThrow('nonempty')
  await expect(ui.service.command({ ...save(), requestId: 'blank' as never, name: '' })).rejects.toThrow('name')
  await expect(ui.service.command({ ...save(), requestId: 'goal' as never, brief: { ...save().brief, goal: '' } })).rejects.toThrow()
  for (const template of [{ id: '' as never, version: 1 }, { id: 'source' as never, version: 0 }])
    await expect(ui.service.command({ ...save(), requestId: 'invalid-source' as never, brief: { ...save().brief, template } })).rejects.toThrow()
  const archive = { kind: 'archive' as const, id: first.id, expectedRevision: 2, requestId: 'archive' as never, archived: true }
  await ui.service.command(archive)
  await expect(ui.service.command({ ...edit, expectedRevision: 3, requestId: 'blocked' as never })).rejects.toThrow('Restore')
  await ui.service.command({ ...archive, expectedRevision: 3, requestId: 'restore' as never, archived: false })
  const detached = await ui.service.read(first.id); detached.versions[0]!.name = 'Changed outside'
  expect((await ui.service.list())[0]).toMatchObject({ name: 'Review', revision: 4, version: 2, archived: false })
  expect(JSON.stringify(await ui.service.read(first.id))).not.toContain('requests')
  await expect(ui.service.read('missing' as never)).rejects.toThrow('Unknown')
  contexts.splice(contexts.indexOf(ui.ctx), 1); await ui.ctx.fiber.dispose()
  await expect(ui.service.list()).rejects.toThrow('unloading')
  const restarted = await boot(ui.root)
  expect(await restarted.service.command(save())).toEqual(first)
  expect(await restarted.service.command(archive)).toMatchObject({ revision: 3, version: 2 })
})
it('captures only a published definition and forwards an explicit pinned copy without executing', async () => {
  const ui = await boot()
  expect(await ui.gateway.sources({})).toEqual([{ id: 'workflow', name: 'Workflow', versions: [{ id: 'publication', number: 1 }] }])
  expect(ui.gateway.examples({})).toHaveLength(3)
  expect(await ui.gateway.list({})).toEqual([])
  const saveFlow = { kind: 'save-workflow' as const, expectedRevision: 0, requestId: 'workflow' as never, name: 'Workflow template', workflowId: workflow.id, versionId: workflow.versions[0]!.id }
  const first = await ui.service.command(saveFlow)
  expect(ui.command).not.toHaveBeenCalled()
  const copy = { id: first.id, version: 1, requestId: 'copy' as never, workspaceId: 'destination' as never, name: 'Independent copy' }
  expect(await ui.gateway.copyWorkflow(copy)).toEqual({ workflowId: 'copy', revision: 1 })
  expect(ui.command).toHaveBeenLastCalledWith({ kind: 'copy', id: workflow.id, versionId: 'publication', workspaceId: 'destination', name: 'Independent copy', requestId: 'copy', template: { id: first.id, version: 1 } })
  await expect(ui.service.command({ ...saveFlow, requestId: 'unknown' as never, versionId: 'missing' as never })).rejects.toThrow('Unknown workflow publication')
  await expect(ui.service.command({ ...save(), id: first.id, expectedRevision: 1, requestId: 'kind' as never })).rejects.toThrow('kind cannot change')
  await expect(ui.service.copyWorkflow({ ...copy, version: 99 })).rejects.toThrow('saved workflow')
  await ui.service.command({ kind: 'archive', id: first.id, expectedRevision: 1, requestId: 'archive' as never, archived: true })
  await expect(ui.service.copyWorkflow(copy)).rejects.toThrow('Restore')
})
it('rejects history, directory, and complete-record capacity without deleting evidence', async () => {
  const ui = await boot(undefined, { maxTemplates: 1, maxVersions: 1 })
  const first = await ui.service.command(save())
  await expect(ui.service.command({ ...save(), requestId: 'second' as never })).rejects.toThrow('Template capacity')
  await expect(ui.service.command({ ...save(), id: first.id, expectedRevision: 1, requestId: 'version' as never })).rejects.toThrow('version capacity')
  const small = await boot(undefined, { maxRecordBytes: 1024 })
  await expect(small.service.command({ ...save('界'.repeat(400)) })).rejects.toThrow('maxRecordBytes')
  expect(await small.service.list()).toEqual([])
})
it('contains throwing observers after a committed write', async () => {
  const ui = await boot()
  ui.ctx.on('work-template/changed', () => { throw new Error('Observer failure') })
  // oxlint-disable-next-line typescript/no-misused-promises -- Exercise rejecting untyped observers of the void event.
  ui.ctx.on('work-template/changed', () => Promise.reject(new Error('Observer rejection')))
  const first = await ui.service.command(save())
  expect((await ui.service.read(first.id)).revision).toBe(1)
})
it('checks committed template key, contiguous history, and receipt ownership through its companion', async () => {
  const { default: Registry } = await import('@deepseek-ai/dsh-invariants')
  const companion = await import('../src/invariant.ts')
  const ctx = new Context(); contexts.push(ctx); await ctx.plugin(Registry)
  const fiber = ctx.plugin(companion); await fiber.await()
  const version = { version: 1, name: 'Template', createdAt: 1, content: { kind: 'task', brief: save().brief } }
  const request = { id: 'request', hash: 'hash', revision: 1, version: 1 }
  const record = { id: 'template', revision: 1, archived: false, versions: [version], requests: [request] }
  const emit = (value: object, patch: object = {}) => {
    ctx.emit('domain/changed', { domain: 'work_templates', table: 'templates', operation: 'put', key: 'template', value, ...patch } as never)
  }
  expect(() => { emit(record) }).not.toThrow()
  for (const patch of [{ domain: 'other' }, { table: 'other' }, { operation: 'deleted' }]) expect(() => { emit({}, patch) }).not.toThrow()
  expect(() => { emit({ ...record, id: 'other' }) }).toThrow('key differs')
  expect(() => { emit({ ...record, versions: [{ ...version, version: 2 }] }) }).toThrow('not contiguous')
  expect(() => { emit({ ...record, versions: [version, { ...version, version: 2, content: { kind: 'workflow' } }] }) }).toThrow('changes content kind')
  expect(() => { emit({ ...record, revision: 2 }) }).toThrow('mutation count')
  expect(() => { emit({ ...record, revision: 2, requests: [request, request] }) }).toThrow('IDs repeat')
  expect(() => { emit({ ...record, requests: [{ ...request, version: 2 }] }) }).toThrow('uncommitted version')
  expect(() => { emit({ ...record, requests: [{ ...request, revision: 2 }] }) }).toThrow('uncommitted version')
  await fiber.dispose()
})
it('counts complete UTF-8 records at the exact configured byte limit', async () => {
  const request = { ...save(), brief: { ...save().brief, background: '界'.repeat(250) } }
  const ui = await boot()
  const first = await ui.service.command(request)
  const stored = ui.ctx.storageDomain.get('work_templates')!.table('templates').get(first.id)
  const bytes = Buffer.byteLength(JSON.stringify(stored))
  expect(bytes).toBeGreaterThan(1024)
  const exact = await boot(undefined, { maxRecordBytes: bytes })
  expect(await exact.service.command(request)).toMatchObject({ version: 1 })
  const narrow = await boot(undefined, { maxRecordBytes: bytes - 1 })
  await expect(narrow.service.command(request)).rejects.toThrow('maxRecordBytes')
  expect(await narrow.service.list()).toEqual([])
})
