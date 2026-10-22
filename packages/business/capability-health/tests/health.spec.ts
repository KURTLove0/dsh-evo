/** Source-local observations, admission identity, and temporary probe ownership. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { McpProbeOutcome } from '@deepseek-ai/dsh-mcp-client'
import type { WorkbenchAgent } from '@deepseek-ai/dsh-workbench-agent/types'
import type { HealthProbeRequest } from '../src/types.ts'
import * as Health from '../src/index.ts'
import { InvariantError } from '@deepseek-ai/dsh-invariants'
import { CapabilityHealthGateway } from '../src/gateway.ts'

const probe = vi.hoisted(() => vi.fn())
const present = vi.hoisted(() => vi.fn(() => true))
vi.mock('@deepseek-ai/dsh-daemon', () => ({ commandPresent: present }))
vi.mock('@deepseek-ai/dsh-mcp-client', () => ({ probeMcp: probe }))
const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())); vi.restoreAllMocks() })
beforeEach(() => { present.mockReset().mockReturnValue(true); probe.mockReset(); probe.mockResolvedValue({ startedAt: 10, checkedAt: 20, status: 'connected', cleanup: 'closed' }) })
const request: HealthProbeRequest = { id: 'probe' as never, agentId: 'agent' as never, expectedRevision: 1, workspaceId: 'workspace' as never, serverName: 'crm' }
async function boot(config: Partial<Health.Config> = {}) {
  const ctx = new Context(); contexts.push(ctx)
  const agent: WorkbenchAgent = { id: request.agentId, revision: 1, name: 'Reviewer', archived: false, createdAt: 1, updatedAt: 1,
    instructions: '', avatar: '', description: '', runtime: 'local', model: { provider: 'local', model: 'mock' }, skills: ['review'], starters: [], concurrency: 1,
    mcpServers: [{ name: 'crm', transport: 'stdio', command: 'node', args: ['server'], env: [{ name: 'TOKEN', value: 'secret-value' }] }] }
  const snapshot = vi.fn(async () => ({ agents: [agent] }))
  const preflight = vi.fn(async () => ({ checkedAt: 1, agentRevision: 1, issues: [], mcp: [] }))
  const workspace = vi.fn(() => ({ path: '/workspace', status: async () => 'ok' }))
  const providers = vi.fn(() => [
    { provider: 'local', displayName: '本地 Local', settingsNs: '', settingsPath: [], localCommand: 'local' },
    { provider: 'api', displayName: 'API', settingsNs: 'models', settingsPath: ['providers', 'api'] },
    { provider: 'missing', displayName: 'Missing', settingsNs: 'models', settingsPath: ['providers', 'missing'] },
  ])
  const models = vi.fn(async () => [{ id: 'mock' }])
  const settings = vi.fn(() => [{ ns: 'models', value: { providers: { api: { apiKeyEnv: 'API_KEY', secret: 'secret-value' } } } }])
  const describe = vi.fn(async () => ({ configured: true, source: 'file', writable: true }))
  const listRecords = vi.fn(async () => [{ key: 'owner/orphan', kind: 'grant' }])
  const describeRecord = vi.fn(async () => ({ configured: true, kind: 'grant', writable: true }))
  const authorization = vi.fn(() => [{ key: 'owner/api', label: 'API authorization', methods: [], inFlight: false }])
  ctx.provide('workbenchAgents', { snapshot, preflight } as never)
  ctx.provide('workspaceRegistry', { get: workspace } as never)
  ctx.provide('llm', { listConfigurableProviders: providers, listProviders: () => [{ id: 'local' }, { id: 'api' }], listModels: models } as never)
  ctx.provide('credentials', { describe, listRecords, describeRecord } as never)
  ctx.provide('settings', { describe: settings } as never)
  ctx.provide('authorization', { list: authorization } as never)
  await ctx.plugin(Health, { maxItems: 100, maxReportBytes: 262144, maxActiveProbes: 1, maxProbeRecords: 3,
    probeTimeoutMs: 100, probeCloseTimeoutMs: 100, ...config }).await()
  const gateway = ctx.get('capabilityHealthGateway') as CapabilityHealthGateway
  return { ctx, service: ctx.capabilityHealth, gateway, agent, snapshot, preflight, workspace, providers, models, settings,
    describe, listRecords, describeRecord, authorization }
}
it('joins configuration facts without returning credentials or claiming authentication and execution', async () => {
  const ui = await boot()
  expect(await ui.gateway.choices({})).toEqual([{ id: 'agent', name: 'Reviewer', revision: 1, archived: false }])
  const report = await ui.gateway.check({ kind: 'agent', id: request.agentId, expectedRevision: 1, workspaceId: request.workspaceId })
  expect(report.selection).toEqual({ id: 'agent', revision: 1, workspaceId: 'workspace' })
  expect(report.items.find(row => row.kind === 'mcp')).toMatchObject({ state: 'not-checked', code: 'mcp-not-checked' })
  expect(report.items.find(row => row.key === 'credential:api')).toMatchObject({ label: 'API_KEY', code: 'credential-configured', source: 'file' })
  expect(report.items.find(row => row.key === 'credential:local')).toMatchObject({ state: 'unknown', code: 'credential-undeclared' })
  expect(report.items.find(row => row.key === 'provider:missing')?.state).toBe('missing')
  expect(report.items.find(row => row.key === 'record:owner/orphan')?.code).toBe('credential-owner-missing')
  expect(JSON.stringify(report)).not.toContain('secret-value')
  expect(probe).not.toHaveBeenCalled()
  ui.agent.model = undefined
  const withoutModel = await ui.service.check({ kind: 'agent', id: request.agentId, expectedRevision: 1, workspaceId: request.workspaceId })
  expect(withoutModel.items.find(row => row.kind === 'model')?.label).toBe('local')
})
it('preserves successful sources when catalogs, credential descriptions, or configuration discovery fail', async () => {
  const ui = await boot()
  ui.models.mockRejectedValueOnce(new Error('secret-value'))
  ui.describe.mockResolvedValueOnce({ configured: false, source: undefined, writable: true } as never)
  ui.describeRecord.mockRejectedValueOnce(new Error('secret-value'))
  let report = await ui.service.check({ kind: 'global' })
  expect(report.items.find(row => row.key === 'catalog:local')?.code).toBe('catalog-failed')
  expect(report.items.find(row => row.key === 'credential:api')?.code).toBe('credential-missing')
  expect(report.items.find(row => row.key === 'record:owner/api')?.code).toBe('credential-read-failed')
  expect(JSON.stringify(report)).not.toContain('secret-value')
  ui.describe.mockRejectedValueOnce('secret-value')
  expect((await ui.service.check({ kind: 'global' })).items.find(row => row.key === 'credential:api')?.code).toBe('credential-read-failed')
  ui.settings.mockImplementationOnce(() => { throw new Error('secret-value') })
  report = await ui.service.check({ kind: 'global' })
  expect(report.items.find(row => row.key === 'catalog:api')?.code).toBe('catalog-readable')
  expect(report.items.find(row => row.key === 'credential:api')?.code).toBe('credential-read-failed')
  ui.providers.mockImplementationOnce(() => { throw new Error('secret-value') })
  ui.authorization.mockImplementationOnce(() => { throw new Error('secret-value') })
  report = await ui.service.check({ kind: 'global' })
  expect(report.items.filter(row => row.code === 'source-unavailable')).toHaveLength(2)
  ui.describeRecord.mockResolvedValueOnce({ configured: false, writable: true } as never)
  expect((await ui.service.check({ kind: 'global' })).items.find(row => row.key === 'record:owner/api')?.code).toBe('credential-missing')
  present.mockReturnValueOnce(false)
  expect((await ui.service.check({ kind: 'global' })).items.find(row => row.key === 'catalog:local')?.code).toBe('catalog-not-checked')
  ui.settings.mockReturnValueOnce([{ ns: 'models', value: { providers: { api: null } } }] as never)
  expect((await ui.service.check({ kind: 'global' })).items.find(row => row.key === 'credential:api')?.code).toBe('credential-undeclared')
  ui.settings.mockReturnValueOnce([{ ns: 'models', value: undefined }] as never)
  expect((await ui.service.check({ kind: 'global' })).items.find(row => row.key === 'credential:api')?.code).toBe('credential-undeclared')
})
it('reports skipped dependency checks as unknown and keeps MCP untested when preflight fails', async () => {
  const ui = await boot()
  ui.preflight.mockResolvedValueOnce({ checkedAt: 1, agentRevision: 1, issues: ['archived', 'workspace', 'runtime', 'model', 'skills'].map(code => ({ code, message: 'secret-value' })), mcp: [] } as never)
  const request = { kind: 'agent' as const, id: ui.agent.id, expectedRevision: 1, workspaceId: 'workspace' as never }
  let report = await ui.service.check(request)
  expect(report.items.find(row => row.kind === 'executor')?.code).toBe('agent-archived')
  expect(report.items.find(row => row.kind === 'workspace')?.code).toBe('workspace-unavailable')
  expect(report.items.find(row => row.kind === 'skills')?.code).toBe('skills-unchecked')
  expect(report.items.find(row => row.kind === 'model')?.code).toBe('model-route-unchecked')
  ui.preflight.mockResolvedValueOnce({ checkedAt: 1, agentRevision: 1, issues: [{ code: 'skills', message: '' }, { code: 'model', message: '' }], mcp: [] } as never)
  report = await ui.service.check(request)
  expect(report.items.find(row => row.kind === 'skills')?.code).toBe('skills-unavailable')
  ui.preflight.mockResolvedValueOnce({ checkedAt: 1, agentRevision: 2, issues: [], mcp: [] })
  expect((await ui.service.check(request)).items[0]?.code).toBe('source-unavailable')
  ui.preflight.mockRejectedValueOnce(new Error('secret-value'))
  expect((await ui.service.check(request)).items.find(row => row.kind === 'mcp')?.state).toBe('not-checked')
  await expect(ui.service.check({ ...request, id: 'missing' as never })).rejects.toThrow('unavailable')
  await expect(ui.service.check({ ...request, expectedRevision: 2 })).rejects.toThrow('changed')
})
it('admits probes once, recovers retained records, rejects conflicting identities, and awaits cancellation', async () => {
  const ui = await boot()
  const result = Promise.withResolvers<McpProbeOutcome>()
  probe.mockReturnValueOnce(result.promise)
  expect(await ui.gateway.startProbe(request)).toMatchObject({ status: 'running' })
  await ui.gateway.startProbe(request)
  expect(probe).toHaveBeenCalledOnce()
  expect(probe.mock.calls[0]?.[0]).toMatchObject({ cwd: '/workspace', env: { TOKEN: 'secret-value' } })
  await expect(ui.service.startProbe({ ...request, serverName: 'other' })).rejects.toThrow('another request')
  await expect(ui.service.startProbe({ ...request, id: 'next' as never })).rejects.toThrow('capacity')
  const read = ui.gateway.readProbe({ id: request.id })!
  read.serverName = 'edited'
  expect(ui.service.readProbe(request.id)?.serverName).toBe('crm')
  const cancelled = ui.gateway.cancelProbe({ id: request.id })
  const probeOptions = probe.mock.calls[0]?.[1] as { signal: AbortSignal }
  const signal = probeOptions.signal
  expect(signal.aborted).toBe(true)
  result.resolve({ startedAt: 10, checkedAt: 20, status: 'cancelled', cleanup: 'closed' })
  expect(await cancelled).toMatchObject({ status: 'cancelled', cleanup: 'closed' })
  expect(await ui.service.startProbe(request)).toMatchObject({ status: 'cancelled' })
  expect(await ui.service.cancelProbe(request.id)).toMatchObject({ status: 'cancelled' })
  expect(ui.gateway.readProbe({ id: 'unknown' as never })).toBeNull()
  await expect(ui.service.cancelProbe('unknown' as never)).rejects.toThrow('no retained probe')
})
it('validates the saved selection and refuses new probes after failed cleanup or record capacity', async () => {
  const ui = await boot()
  await expect(ui.service.startProbe({ ...request, id: '' as never })).rejects.toThrow('nonempty')
  await expect(ui.service.startProbe({ ...request, expectedRevision: 2 })).rejects.toThrow('changed')
  ui.agent.archived = true
  await expect(ui.service.startProbe(request)).rejects.toThrow('Restore')
  ui.agent.archived = false
  ui.workspace.mockReturnValueOnce(undefined as never)
  await expect(ui.service.startProbe(request)).rejects.toThrow('workspace')
  ui.workspace.mockReturnValueOnce({ path: '/workspace', status: async () => 'missing' })
  await expect(ui.service.startProbe(request)).rejects.toThrow('workspace')
  await expect(ui.service.startProbe({ ...request, serverName: 'missing' })).rejects.toThrow('server is unavailable')
  probe.mockResolvedValueOnce({ startedAt: 10, checkedAt: 20, status: 'connected', cleanup: 'failed' })
  await ui.service.startProbe(request)
  await expect.poll(() => ui.service.readProbe(request.id)?.cleanup).toBe('failed')
  await expect(ui.service.startProbe({ ...request, id: 'another' as never })).rejects.toThrow('cleanup failed')
  const limited = await boot({ maxProbeRecords: 1 })
  await limited.service.startProbe(request)
  await expect.poll(() => limited.service.readProbe(request.id)?.status).toBe('connected')
  await expect(limited.service.startProbe({ ...request, id: 'another' as never })).rejects.toThrow('record capacity')
})
it('contains setup and observer failures after admission and drains probes when unloaded', async () => {
  const ui = await boot()
  ui.ctx.on('capability-health/probe-changed', () => { throw new Error('observer failed') })
  const reject = async () => { throw new Error('observer failed') }
  // oxlint-disable-next-line typescript/no-misused-promises -- Model a rejecting untyped void listener.
  ui.ctx.on('capability-health/probe-changed', reject)
  ui.ctx.on('capability-health/probe-changed', () => { throw 'untyped observer failure' })
  ui.ctx.on('capability-health/probe-changed', () => { throw Object.assign(new Error('Observer'), { code: 'OTHER' }) })
  probe.mockRejectedValueOnce(new Error('secret-value'))
  await ui.service.startProbe(request)
  await expect.poll(() => ui.service.readProbe(request.id)?.status).toBe('failed')
  const unloading = await boot()
  unloading.agent.mcpServers = [{ name: 'crm', transport: 'streamable-http', url: 'https://example.invalid', headers: [{ name: 'Authorization', value: 'secret-value' }] }]
  probe.mockImplementationOnce((_config, options: { signal: AbortSignal }) => new Promise((resolve) => {
    options.signal.addEventListener('abort', () => { resolve({ status: 'cancelled', cleanup: 'closed', startedAt: 1, checkedAt: 2 }) }, { once: true })
  }))
  await unloading.service.startProbe(request)
  const events = vi.fn(); unloading.ctx.on('capability-health/probe-changed', events)
  const owner = unloading.service
  await unloading.ctx.fiber.dispose()
  expect(owner.readProbe(request.id)).toMatchObject({ status: 'cancelled', cleanup: 'closed' })
  expect(events).not.toHaveBeenCalled()
  await expect(owner.choices()).rejects.toThrow('unloading')
  await expect(owner.startProbe({ ...request, id: 'new' as never })).rejects.toThrow('unloading')
})
it('reports synchronous invariant failures after dispatch without losing ownership of admitted work', async () => {
  const ui = await boot()
  const gate = Promise.withResolvers<McpProbeOutcome>()
  probe.mockReturnValueOnce(gate.promise)
  const remove = ui.ctx.on('capability-health/probe-changed', () => { throw new InvariantError('@deepseek-ai/dsh-capability-health', 'probe relation') })
  const other = vi.fn(); ui.ctx.on('capability-health/probe-changed', other)
  await expect(ui.service.startProbe(request)).rejects.toThrow('probe relation')
  expect(other).toHaveBeenCalledOnce()
  expect(ui.service.readProbe(request.id)?.status).toBe('running')
  remove()
  const cancelled = ui.service.cancelProbe(request.id)
  gate.resolve({ startedAt: 10, checkedAt: 20, status: 'cancelled', cleanup: 'closed' })
  expect(await cancelled).toMatchObject({ status: 'cancelled', cleanup: 'closed' })
})
it('enforces complete report bytes and item bounds without truncating observations', async () => {
  const ui = await boot()
  vi.spyOn(Date, 'now').mockReturnValue(100)
  ui.agent.name = '检查执行者'
  const report = await ui.service.check({ kind: 'global' })
  const bytes = Buffer.byteLength(JSON.stringify(report))
  expect(bytes).toBeGreaterThan(JSON.stringify(report).length)
  const exact = await boot({ maxReportBytes: bytes })
  expect(await exact.service.check({ kind: 'global' })).toEqual(report)
  const narrow = await boot({ maxReportBytes: bytes - 1 })
  await expect(narrow.service.check({ kind: 'global' })).rejects.toThrow('capacity')
  const items = await boot({ maxItems: 1 })
  await expect(items.service.check({ kind: 'global' })).rejects.toThrow('capacity')
  items.snapshot.mockResolvedValueOnce({ agents: [items.agent, { ...items.agent, id: 'other' }] } as never)
  await expect(items.service.choices()).rejects.toThrow('capacity')
  await expect(boot({ maxActiveProbes: 2, maxProbeRecords: 1 })).rejects.toThrow('must not exceed')
})
