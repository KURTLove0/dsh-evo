/** Real machine HTTP and JSON journals over nondeterministic native admission owners. */
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request as httpRequest, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as Domain from '@deepseek-ai/dsh-storage-domain'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as Companion from '../src/invariant.ts'
import { remoteDomain, submissionKey, nativeRequestId, type StoredSubmission } from '../src/store.ts'
import { readReply, remoteOrigin } from '../src/transport.ts'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { afterEach, expect, it, vi } from 'vitest'
import * as Receiver from '../src/receiver.ts'
import * as Client from '../src/index.ts'
import { RemoteWorkGateway } from '../src/gateway.ts'
import { REMOTE_WORK_PATH } from '../src/protocol.ts'
import type { RemoteEnvelope, RemoteOperation, RemoteWorkResult, RemoteTarget, RemoteSubmission } from '../src/types.ts'
import type { AgentCommand } from '@deepseek-ai/dsh-workbench-agent/types'
import type { WorkflowCommand } from '@deepseek-ai/dsh-business-workflow/workbench-types'
const roots: string[] = [], contexts: Context[] = []
const hostId = '8511e804-cf4b-4c78-a213-eaf480b56f8f' as RemoteEnvelope['hostId']
const principalId = 'laptop' as RemoteEnvelope['principalId']
const bearer = '0123456789abcdef0123456789abcdef'
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  vi.restoreAllMocks()
})
const target = (): RemoteTarget => ({ kind: 'agent', id: 'agent' as never, workspaceId: 'workspace' as never, expectedRevision: 1,
  brief: { version: 1, goal: 'Review input', background: '', deliverables: [], acceptanceCriteria: [], constraints: '' } })
const workflowTarget = (): RemoteTarget => ({ kind: 'workflow', id: 'workflow' as never, workspaceId: 'workspace' as never,
  versionId: 'publication' as never, inputs: { report: { a: 1, b: 2 } } })
function nativeState() { return { runs: new Map<string, { kind: 'agent' | 'workflow'; id: string }>() } }
async function boot(options: { root?: string; config?: Partial<Receiver.Config>; state?: ReturnType<typeof nativeState>; listenHost?: '127.0.0.1' | '0.0.0.0'; observeResponse?: (response: ServerResponse) => void } = {}) {
  const root = options.root ?? await mkdtemp(join(tmpdir(), 'dsh-remote-')); if (options.root === undefined) roots.push(root)
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage); await ctx.plugin(JsonStorage, { root: join(root, 'storage') }); await ctx.plugin(Domain, { backend: 'json' })
  await ctx.plugin(WebServer, { host: options.listenHost ?? '127.0.0.1', port: 0 })
  if (options.observeResponse !== undefined) {
    const register = ctx.webServer.register.bind(ctx.webServer)
    vi.spyOn(ctx.webServer, 'register').mockImplementation(route => register({ ...route, handler: (request, response) => {
      options.observeResponse?.(response); return route.handler(request, response)
    } }))
  }
  const secrets = new Map([['REMOTE_TOKEN', bearer], ['OTHER_TOKEN', 'fedcba9876543210fedcba9876543210']])
  const resolve = vi.fn(async (reference: string) => { const value = secrets.get(reference); return value === undefined ? undefined : { value, source: 'test' } })
  ctx.provide('credentials', { resolve, describe: async (reference: string) => ({ configured: secrets.has(reference), writable: false }) } as never)
  const state = options.state ?? nativeState()
  const admit = (id: string, kind: 'agent' | 'workflow') => {
    let ref = state.runs.get(id)
    if (ref === undefined) { ref = { kind, id: randomUUID() }; state.runs.set(id, ref) }
    return ref
  }
  const agent = vi.fn(async (command: AgentCommand) => {
    if (command.kind === 'stop') return { agentId: 'agent' }
    if (command.kind !== 'submit-task') throw new Error('Unexpected native agent command')
    return { agentId: command.id, runId: admit(command.requestId, 'agent').id }
  })
  const workflow = vi.fn(async (command: WorkflowCommand): Promise<{ workflowId: string; runIds?: string[] }> => {
    if (command.kind === 'cancel' || command.kind === 'decide') return { workflowId: 'workflow' }
    if (command.kind !== 'start' || command.requestId === undefined) throw new Error('Unexpected native workflow command')
    return { workflowId: command.id, runIds: [admit(command.requestId, 'workflow').id] }
  })
  const agentSnapshot = vi.fn(async () => ({ agents: [{ id: 'agent', name: 'Reporter', revision: 1, runtime: 'mock', skills: ['review'], mcpServers: [{ name: 'configured-server' }], archived: false }] }))
  const workflowSnapshot = vi.fn(async () => ({ workflows: [{ id: 'workflow', name: 'Approval', workspaceId: 'workspace', archived: false,
    versions: [{ id: 'publication', number: 1, definition: { requirement: { inputs: [{ name: 'report', description: 'Original input' }] } } }] }] }))
  const preflight = vi.fn(async () => ({ agentRevision: 1, issues: [] }))
  const workspace = vi.fn(() => ({ id: 'workspace', title: 'Remote project', path: root }))
  const source = vi.fn(async (ref: { kind: string; id: string }) => ({ ref, name: 'Remote execution', workspaceId: 'workspace', sessionId: 'remote-session', status: 'completed' }))
  const detail = vi.fn(async (ref: { kind: string; id: string }) => ({ ref, workspaceId: 'workspace', delivery: { outputs: [{ name: 'report', text: 'Recorded remote output' }], evidence: 'recorded-response' } }))
  ctx.provide('workbenchAgents', { snapshot: agentSnapshot, preflight, command: agent } as never)
  const inspectRun = vi.fn(async (id: string) => ({ id, workspaceId: 'workspace',
    version: { definition: { nodes: [{ id: 'approval', kind: 'approval', title: 'Review report', instruction: 'Review actual input' }] } },
    attempts: [{ id: 'waiting-attempt', nodeId: 'approval', status: 'waiting', inputs: { report: 'Original input' } }] }))
  ctx.provide('workflowWorkbench', { snapshot: workflowSnapshot, command: workflow, inspectRun } as never)
  ctx.provide('workspaceRegistry', { get: workspace } as never); ctx.provide('workCenter', { source, detail } as never)
  const config: Receiver.Config = { hostId, principals: [{ id: principalId, credentialRef: 'REMOTE_TOKEN', allowStop: true, allowWorkflowDecisions: true,
    grants: [{ workspaceId: 'workspace', agents: ['agent'], workflows: ['workflow'] }] }],
  maxRequestBytes: 262144, maxResponseBytes: 1048576, maxRecordBytes: 262144, maxSubmissions: 100,
  maxInFlight: 16, bodyTimeoutMs: 1000, ...options.config }
  const fiber = ctx.plugin(Receiver, config); await fiber
  const origin = `http://127.0.0.1:${ctx.webServer.port}`
  const raw = async (operation: RemoteOperation, headers: Record<string, string> = {}) => fetch(`${origin}${REMOTE_WORK_PATH}`, {
    method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ version: 1, hostId, principalId, operation }),
  })
  const invoke = async (operation: RemoteOperation): Promise<RemoteWorkResult> => {
    const response = await raw(operation), body = await response.json() as { result: RemoteWorkResult; error?: { code: string } }
    if (!response.ok) throw new Error(body.error?.code)
    return body.result
  }
  return { ctx, root, origin, raw, invoke, fiber, config, state, secrets, resolve, agent, workflow,
    agentSnapshot, workflowSnapshot, preflight, workspace, source, detail, inspectRun }
}
async function client(ui: Awaited<ReturnType<typeof boot>>, config: Partial<Client.Config> = {}) {
  const ctx = new Context(); contexts.push(ctx)
  const describe = vi.fn(async () => ({ configured: true, writable: false }))
  ctx.provide('credentials', { resolve: ui.resolve, describe } as never)
  const configuration: Client.Config = { peers: [{ id: 'peer', name: 'Remote machine', origin: ui.origin, hostId, principalId, credentialRef: 'REMOTE_TOKEN' }],
    timeoutMs: 1000, maxRequestBytes: 262144, maxResponseBytes: 1048576, maxInFlight: 16, ...config }
  const fiber = ctx.plugin(Client, configuration); await fiber
  const gateway = ctx.get('remoteWorkGateway') as RemoteWorkGateway
  return { ctx, fiber, configuration, gateway, describe, service: ctx.remoteWork, call: (operation: RemoteOperation) => gateway.call({ peer: 'peer' as never, expected: { hostId, principalId }, operation }) }
}
function submission(result: RemoteWorkResult): Extract<RemoteWorkResult, { kind: 'submission' }>['submission'] {
  if (result.kind !== 'submission') throw new Error('Missing submission result')
  return result.submission
}
it('authenticates catalog and native execution without returning bearer values or file bytes', async () => {
  const ui = await boot(), local = await client(ui)
  expect(await local.gateway.peers({})).toMatchObject([{ name: 'Remote machine', authorization: { configured: true, reference: 'REMOTE_TOKEN' } }])
  expect(await local.call({ kind: 'catalog' })).toMatchObject({ kind: 'catalog', catalog: { credentialOwner: 'remote-host', workspaces: [{ path: ui.root }] } })
  const id = randomUUID() as RemoteSubmission['id']
  const admitted = submission(await local.call({ kind: 'submit', id, target: target() }))
  expect(admitted.admission.state).toBe('admitted'); expect(ui.state.runs.size).toBe(1)
  expect(await local.call({ kind: 'inspect', id })).toMatchObject({ kind: 'inspection', source: { sessionId: 'remote-session' },
    delivery: { outputs: [{ text: 'Recorded remote output' }] } })
  const listed = await local.call({ kind: 'list' }); expect(JSON.stringify(listed)).not.toContain('Review input')
  expect(JSON.stringify(listed)).not.toContain(bearer)
  expect(await local.call({ kind: 'list', workspaceId: 'other' as never })).toMatchObject({ items: [] })
  expect(await local.call({ kind: 'stop', id })).toEqual({ kind: 'controlled', id })
  expect(ui.agent).toHaveBeenLastCalledWith({ kind: 'stop', runId: [...ui.state.runs.values()][0]!.id })
  await local.fiber.dispose(); await expect(local.service.call({ peer: 'peer' as never, expected: { hostId, principalId }, operation: { kind: 'list' } })).rejects.toThrow('unavailable')
})
it('retains uncertain admissions across duplicate calls, concurrent recovery, and receiver restart', async () => {
  const ui = await boot(), local = await client(ui), id = randomUUID() as RemoteSubmission['id'], native = ui.agent.getMockImplementation()!
  ui.agent.mockImplementationOnce(async (command) => { await native(command); throw new Error('Lost native acknowledgment with private diagnostics') })
  expect(submission(await local.call({ kind: 'submit', id, target: target() })).admission.state).toBe('unconfirmed')
  expect(submission(await local.call({ kind: 'submit', id, target: target() })).attempts).toBe(1); expect(ui.agent).toHaveBeenCalledOnce()
  const held = await local.call({ kind: 'inspect', id }); expect(held).toMatchObject({ submission: { admission: { state: 'unconfirmed' } } })
  await local.fiber.dispose(); await ui.fiber.dispose()
  const restarted = await boot({ root: ui.root, state: ui.state }), caller = await client(restarted)
  const restored = await Promise.all([caller.call({ kind: 'recover', id, expectedAttempt: 1 }), caller.call({ kind: 'recover', id, expectedAttempt: 1 })])
  expect(restored.map(value => submission(value).admission.state)).toEqual(['admitted', 'admitted'])
  expect(restarted.agent).toHaveBeenCalledOnce(); expect(restarted.state.runs.size).toBe(1)
  expect(submission(await caller.call({ kind: 'submit', id, target: target() })).attempts).toBe(2)
  await expect(caller.call({ kind: 'submit', id, target: { ...target(), brief: { ...(target() as Extract<RemoteTarget, { kind: 'agent' }>).brief, goal: 'Different' } } as RemoteTarget })).rejects.toThrow('conflict')
})
it('preserves publication inputs and gates native stop and workflow decisions', async () => {
  const ui = await boot(), local = await client(ui), id = randomUUID() as RemoteSubmission['id']
  await local.call({ kind: 'submit', id, target: workflowTarget() })
  const reordered = { ...workflowTarget(), inputs: { report: { b: 2, a: 1 } } } as RemoteTarget
  await local.call({ kind: 'submit', id, target: reordered }); expect(ui.workflow).toHaveBeenCalledOnce()
  await local.call({ kind: 'decide', id, attemptId: 'waiting-attempt' as never, approve: true })
  expect(ui.workflow).toHaveBeenLastCalledWith({ kind: 'decide', runId: [...ui.state.runs.values()][0]!.id, attemptId: 'waiting-attempt', approve: true })
  await local.call({ kind: 'stop', id }); expect(ui.workflow).toHaveBeenLastCalledWith({ kind: 'cancel', runId: [...ui.state.runs.values()][0]!.id })
  await ui.fiber.dispose()
  const restricted = await boot({ root: ui.root, state: ui.state,
    config: { principals: [{ ...ui.config.principals[0]!, allowStop: false, allowWorkflowDecisions: false }] } })
  expect((await restricted.raw({ kind: 'stop', id })).status).toBe(403)
  expect((await restricted.raw({ kind: 'decide', id, attemptId: 'waiting-attempt' as never, approve: false })).status).toBe(403)
  expect(restricted.workflow).not.toHaveBeenCalled()
})
it('rejects wrong authorization, intended Host/principal, cross-principal records, and unauthorized targets before execution', async () => {
  const ui = await boot()
  for (const headers of [{ authorization: '' }, { authorization: `Bearer ${'z'.repeat(32)}` }, { origin: 'https://foreign.example' }, { 'content-type': 'text/plain' }])
    expect((await ui.raw({ kind: 'list' }, headers)).status).toBe(403)
  for (const patch of [{ hostId: randomUUID() }, { principalId: 'other' }, { version: 2 }]) {
    const response = await fetch(`${ui.origin}${REMOTE_WORK_PATH}`, { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, hostId, principalId, operation: { kind: 'submit', id: randomUUID(), target: target() }, ...patch }) })
    expect(response.ok).toBe(false)
  }
  const id = randomUUID() as RemoteSubmission['id']
  expect((await ui.raw({ kind: 'submit', id, target: { ...target(), workspaceId: 'unauthorized' as never } })).status).toBe(403)
  expect((await ui.raw({ kind: 'inspect', id })).status).toBe(404)
  expect((await ui.raw({ kind: 'submit', id, target: target() })).ok).toBe(true)
  expect((await ui.raw({ kind: 'decide', id, attemptId: 'attempt' as never, approve: true })).status).toBe(403)
  expect(ui.state.runs.size).toBe(1)
})
it('observes rotated credentials and refuses ambiguous or absent configured bearers without leaking them', async () => {
  const ui = await boot(), local = await client(ui)
  ui.secrets.set('REMOTE_TOKEN', 'a'.repeat(32))
  expect((await ui.raw({ kind: 'list' })).status).toBe(403)
  expect(await local.call({ kind: 'list' })).toMatchObject({ kind: 'list', items: [] })
  ui.secrets.delete('REMOTE_TOKEN'); await expect(local.call({ kind: 'list' })).rejects.toThrow('unavailable')
  ui.secrets.set('REMOTE_TOKEN', 'bad\nvalue'); await expect(local.call({ kind: 'list' })).rejects.toThrow('unavailable')
  ui.secrets.set('REMOTE_TOKEN', bearer)
  await ui.fiber.dispose()
  const config = { principals: [...ui.config.principals, { id: 'other', credentialRef: 'OTHER_TOKEN', allowStop: false,
    allowWorkflowDecisions: false, grants: [] }] }
  const next = await boot({ config })
  next.secrets.set('OTHER_TOKEN', bearer)
  const response = await next.raw({ kind: 'list' })
  expect(response.status).toBe(503); expect(await response.text()).not.toContain(bearer)
})
it('retains unavailable native observations without inventing a terminal outcome or exposing file captures', async () => {
  const ui = await boot(), id = randomUUID() as RemoteSubmission['id']; await ui.invoke({ kind: 'submit', id, target: target() })
  ui.source.mockRejectedValueOnce(new Error('Source unavailable'))
  expect(await ui.invoke({ kind: 'inspect', id })).toMatchObject({ unavailable: true, submission: { admission: { state: 'admitted' } } })
  ui.detail.mockRejectedValueOnce(new Error('Output unavailable'))
  expect(await ui.invoke({ kind: 'inspect', id })).toMatchObject({ source: { status: 'completed' }, unavailable: true })
  ui.source.mockResolvedValueOnce({ ...(await ui.source({ kind: 'agent', id: 'different' })), workspaceId: 'foreign' })
  const mismatched = await ui.invoke({ kind: 'inspect', id }); expect(mismatched).toHaveProperty('unavailable', true); expect(mismatched).not.toHaveProperty('source')
  ui.detail.mockResolvedValueOnce({ ref: { kind: 'agent', id: 'foreign' }, workspaceId: 'workspace', delivery: { outputs: [], evidence: 'recorded-response' } })
  expect(await ui.invoke({ kind: 'inspect', id })).not.toHaveProperty('delivery')
})
it('bounds complete requests, records, and histories before another native admission', async () => {
  const ui = await boot({ config: { maxSubmissions: 1 } }), local = await client(ui)
  const id = randomUUID() as RemoteSubmission['id']; await local.call({ kind: 'submit', id, target: target() })
  expect((await ui.raw({ kind: 'submit', id: randomUUID() as never, target: target() })).status).toBe(413)
  expect(ui.state.runs.size).toBe(1)
  const tiny = await client(ui, { maxRequestBytes: 1 })
  await expect(tiny.call({ kind: 'list' })).rejects.toThrow('limit')
  const responseCap = await client(ui, { maxResponseBytes: 1 })
  await expect(responseCap.call({ kind: 'list' })).rejects.toThrow('limit')
  const bounded = await boot({ config: { maxRecordBytes: 1 } })
  expect((await bounded.raw({ kind: 'submit', id: randomUUID() as never, target: target() })).status).toBe(413)
  expect(bounded.agent).not.toHaveBeenCalled()
  const smallBody = await boot({ config: { maxRequestBytes: 1 } })
  expect((await smallBody.raw({ kind: 'submit', id: randomUUID() as never, target: target() })).status).toBe(413)
})
it('retains a recoverable request when native receipts or their durable acknowledgment are unavailable', async () => {
  const ui = await boot(), id = randomUUID() as RemoteSubmission['id']
  ui.agent.mockResolvedValueOnce({ agentId: 'agent' })
  const first = submission(await ui.invoke({ kind: 'submit', id, target: target() })); expect(first.admission.state).toBe('unconfirmed')
  ui.agent.mockRejectedValueOnce(new Error('Still unavailable'))
  expect(submission(await ui.invoke({ kind: 'recover', id, expectedAttempt: 1 })).attempts).toBe(2)
  expect((await ui.raw({ kind: 'recover', id, expectedAttempt: 1 })).status).toBe(409)
  expect((await ui.raw({ kind: 'stop', id })).status).toBe(409)
  const workflowId = randomUUID() as RemoteSubmission['id']
  ui.workflow.mockResolvedValueOnce({ workflowId: 'workflow', runIds: [] })
  expect(submission(await ui.invoke({ kind: 'submit', id: workflowId, target: workflowTarget() })).admission.state).toBe('unconfirmed')
  ui.preflight.mockResolvedValueOnce({ agentRevision: 2, issues: [] })
  expect((await ui.raw({ kind: 'submit', id: randomUUID() as never, target: target() })).status).toBe(409)
  ui.preflight.mockResolvedValueOnce({ agentRevision: 1, issues: [{ code: 'runtime', message: 'Unavailable' }] } as never)
  expect((await ui.raw({ kind: 'submit', id: randomUUID() as never, target: target() })).status).toBe(409)
})
it('denies revoked workspace/executor grants while preserving original retained records', async () => {
  const ui = await boot(), id = randomUUID() as RemoteSubmission['id']
  await ui.invoke({ kind: 'submit', id, target: target() }); await ui.fiber.dispose()
  const next = await boot({ root: ui.root, state: ui.state, config: { principals: [{ ...ui.config.principals[0]!, grants: [] }] } })
  expect((await next.raw({ kind: 'inspect', id })).status).toBe(403)
  expect(await next.invoke({ kind: 'list' })).toMatchObject({ items: [] })
  await next.fiber.dispose()
  const restored = await boot({ root: ui.root, state: ui.state })
  expect(await restored.invoke({ kind: 'inspect', id })).toMatchObject({ submission: { id } })
})
it('rejects unsupported origin and body formats and invalid peer configuration before sending credentials', async () => {
  const ui = await boot()
  expect((await fetch(`${ui.origin}${REMOTE_WORK_PATH}`)).status).toBe(403)
  expect((await fetch(`${ui.origin}${REMOTE_WORK_PATH}?token=ignored`, { method: 'POST' })).status).toBe(403)
  for (const body of ['{', JSON.stringify({ version: 1, hostId, principalId, operation: { kind: 'unknown' } })]) {
    const response = await fetch(`${ui.origin}${REMOTE_WORK_PATH}`, { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body })
    expect(response.status).toBe(400)
  }
  for (const origin of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?q=x', 'https://example.com#x']) {
    await expect(client(ui, { peers: [{ id: 'peer', name: 'Peer', origin, hostId, principalId, credentialRef: 'REMOTE_TOKEN' }] })).rejects.toThrow('invalid-request')
  }
})
it('keeps a post-admission failed journal write unconfirmed until explicit native-identity recovery', async () => {
  const ui = await boot(), id = randomUUID() as RemoteSubmission['id'], native = ui.agent.getMockImplementation()!
  const table = ui.ctx.storageDomain.get('remote_work')!.table('submissions')
  ui.agent.mockImplementationOnce(async (command) => {
    const receipt = await native(command)
    vi.spyOn(table, 'put').mockRejectedValueOnce(new Error('Storage unavailable'))
    return receipt
  })
  expect((await ui.raw({ kind: 'submit', id, target: target() })).status).toBe(503)
  const held = table.get(submissionKey({ principalId, id })) as StoredSubmission
  expect(held.admission.state).toBe('unconfirmed'); expect(ui.state.runs.size).toBe(1)
  expect(submission(await ui.invoke({ kind: 'recover', id, expectedAttempt: 1 })).admission.state).toBe('admitted')
  expect(ui.state.runs.size).toBe(1)
})
it('enforces principal-qualified ownership even when caller UUIDs coincide', async () => {
  const ui = await boot({ config: { principals: [
    { id: principalId, credentialRef: 'REMOTE_TOKEN', allowStop: true, allowWorkflowDecisions: true, grants: [{ workspaceId: 'workspace', agents: ['agent'], workflows: [] }] },
    { id: 'other', credentialRef: 'OTHER_TOKEN', allowStop: false, allowWorkflowDecisions: false, grants: [{ workspaceId: 'workspace', agents: ['agent'], workflows: [] }] },
  ] } })
  const id = randomUUID() as RemoteSubmission['id']; await ui.invoke({ kind: 'submit', id, target: target() })
  const other = async (operation: RemoteOperation) => fetch(`${ui.origin}${REMOTE_WORK_PATH}`, { method: 'POST', headers: {
    authorization: `Bearer ${ui.secrets.get('OTHER_TOKEN')}`, 'content-type': 'application/json' },
  body: JSON.stringify({ version: 1, hostId, principalId: 'other', operation }) })
  expect((await other({ kind: 'inspect', id })).status).toBe(404)
  expect((await other({ kind: 'submit', id, target: target() })).status).toBe(200)
  expect(ui.state.runs.size).toBe(2)
  const otherList = await (await other({ kind: 'list' })).json() as { result: { items: { principalId: string }[] } }
  expect(otherList.result.items.map(value => value.principalId)).toEqual(['other'])
})
it('rejects malformed durable ownership, changed receiver identity, and inconsistent granted referents at startup', async () => {
  const ui = await boot(), id = randomUUID() as RemoteSubmission['id']; await ui.invoke({ kind: 'submit', id, target: target() }); await ui.fiber.dispose()
  await expect(boot({ root: ui.root, config: { hostId: randomUUID() } })).rejects.toThrow('conflict')
  const path = join(ui.root, 'storage', 'remote_work.json')
  const disk = JSON.parse(await readFile(path, 'utf8')) as { tables: { submissions: Record<string, StoredSubmission> } }
  const record = disk.tables.submissions[`${principalId}/${id}`]!
  for (const patch of [{ inputHash: '0'.repeat(64) }, { requestId: 'different-native-id' }, { admission: { state: 'admitted', ref: { kind: 'workflow', id: 'wrong' } } }])
    expect(() => remoteDomain.tables.submissions.valueSchema.parse({ ...record, ...patch })).toThrow()
  disk.tables.submissions = { wrong: record }; await writeFile(path, JSON.stringify(disk))
  await expect(boot({ root: ui.root })).rejects.toThrow('conflict')
  const foreign = { ...record, hostId: randomUUID() as RemoteSubmission['hostId'] }
  foreign.requestId = nativeRequestId(foreign)
  disk.tables.submissions = { [`${principalId}/${id}`]: foreign }
  await writeFile(path, JSON.stringify(disk)); await expect(boot({ root: ui.root })).rejects.toThrow()
  await expect(boot({ listenHost: '0.0.0.0' })).rejects.toThrow('loopback')
  await expect(boot({ config: { principals: [ui.config.principals[0]!, ui.config.principals[0]!] } })).rejects.toThrow('conflict')
  await expect(boot({ config: { principals: [{ ...ui.config.principals[0]!, grants: [ui.config.principals[0]!.grants[0]!, ui.config.principals[0]!.grants[0]!] }] } })).rejects.toThrow('conflict')
  await expect(boot({ config: { maxResponseBytes: 1 } })).rejects.toThrow('limit')
})
it('rejects missing workspace, executor, workflow, and publication references without dispatching', async () => {
  const ui = await boot(), operation = (): RemoteOperation => ({ kind: 'submit', id: randomUUID() as never, target: target() })
  ui.workspace.mockReturnValueOnce(undefined as never)
  expect((await ui.raw({ kind: 'catalog' })).status).toBe(503)
  ui.agentSnapshot.mockResolvedValueOnce({ agents: [] }); expect((await ui.raw({ kind: 'catalog' })).status).toBe(503)
  ui.workflowSnapshot.mockResolvedValueOnce({ workflows: [] }); expect((await ui.raw({ kind: 'catalog' })).status).toBe(503)
  ui.workspace.mockReturnValueOnce(undefined as never); expect((await ui.raw(operation())).status).toBe(503)
  for (const workflows of [[], [{ ...(await ui.workflowSnapshot()).workflows[0]!, archived: true }],
    [{ ...(await ui.workflowSnapshot()).workflows[0]!, workspaceId: 'other' }], [{ ...(await ui.workflowSnapshot()).workflows[0]!, versions: [] }]]) {
    ui.workflowSnapshot.mockResolvedValueOnce({ workflows })
    expect((await ui.raw({ kind: 'submit', id: randomUUID() as never, target: workflowTarget() })).status).toBe(409)
  }
  expect(ui.agent).not.toHaveBeenCalled(); expect(ui.workflow).not.toHaveBeenCalled()
})
it('rejects forged receiver, principal, request, target, and native source fields at the response boundary', async () => {
  const ui = await boot(), local = await client(ui), id = randomUUID() as RemoteSubmission['id']
  const receipt = submission(await ui.invoke({ kind: 'submit', id, target: target() }))
  const reply = (result: unknown, patch: object = {}) => new Response(JSON.stringify({ version: 1, hostId, principalId, result, ...patch }), { headers: { 'content-type': 'application/json' } })
  const fetcher = vi.spyOn(globalThis, 'fetch')
  for (const patch of [{ hostId: randomUUID() }, { principalId: 'foreign' }, { version: 2 }]) {
    fetcher.mockResolvedValueOnce(reply({ kind: 'list', items: [], observedAt: 1 }, patch))
    await expect(local.call({ kind: 'list' })).rejects.toThrow('unavailable')
  }
  for (const patch of [{ principalId: 'foreign' }, { hostId: randomUUID() }, { admission: { state: 'admitted', ref: { kind: 'workflow', id: 'foreign' } } }]) {
    fetcher.mockResolvedValueOnce(reply({ kind: 'list', items: [{ ...receipt, ...patch }], observedAt: 1 }))
    await expect(local.call({ kind: 'list' })).rejects.toThrow('unavailable')
  }
  fetcher.mockResolvedValueOnce(reply({ kind: 'controlled', id: randomUUID() }))
  await expect(local.call({ kind: 'stop', id })).rejects.toThrow('unavailable')
  fetcher.mockResolvedValueOnce(reply({ kind: 'submission', submission: { ...receipt, id: randomUUID() } }))
  await expect(local.call({ kind: 'submit', id, target: target() })).rejects.toThrow('unavailable')
  for (const targetPatch of [{ kind: 'workflow' }, { id: 'foreign' }, { workspaceId: 'foreign' }]) {
    fetcher.mockResolvedValueOnce(reply({ kind: 'submission', submission: { ...receipt, target: { ...receipt.target, ...targetPatch }, admission: { state: 'unconfirmed' } } }))
    await expect(local.call({ kind: 'submit', id, target: target() })).rejects.toThrow('unavailable')
  }
  const inspected = await ui.invoke({ kind: 'inspect', id })
  if (inspected.kind !== 'inspection' || inspected.source === undefined) throw new Error('Missing source')
  for (const patch of [{ ref: { kind: 'workflow', id: 'foreign' } }, { ref: { ...inspected.source.ref, id: 'foreign' } }, { workspaceId: 'foreign' }]) {
    fetcher.mockResolvedValueOnce(reply({ ...inspected, source: { ...inspected.source, ...patch } }))
    await expect(local.call({ kind: 'inspect', id })).rejects.toThrow('unavailable')
  }
  fetcher.mockResolvedValueOnce(reply({ ...inspected, submission: { ...inspected.submission, admission: { state: 'unconfirmed' } } }))
  await expect(local.call({ kind: 'inspect', id })).rejects.toThrow('unavailable')
  fetcher.mockResolvedValueOnce(reply({ kind: 'controlled', id }))
  await expect(local.call({ kind: 'catalog' })).rejects.toThrow('unavailable')
})
it('does not follow redirects or retry missing, malformed, or failed remote responses', async () => {
  const ui = await boot(), local = await client(ui), fetcher = vi.spyOn(globalThis, 'fetch')
  for (const response of [new Response(null), new Response(null, { status: 503 }), new Response('{'), new Response(Uint8Array.from([255]))]) {
    fetcher.mockResolvedValueOnce(response)
    await expect(local.call({ kind: 'list' })).rejects.toThrow('unavailable')
  }
  fetcher.mockRejectedValueOnce(new Error(`Never expose ${bearer}`))
  await expect(local.call({ kind: 'list' })).rejects.toThrow('unavailable')
  expect(fetcher.mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true)
  await expect(local.service.call({ peer: 'unknown' as never, expected: { hostId, principalId }, operation: { kind: 'list' } })).rejects.toThrow('denied')
  local.describe.mockRejectedValueOnce(new Error(`Never expose ${bearer}`)); await expect(local.gateway.peers({})).rejects.toThrow('unavailable')
  expect(remoteOrigin('http://[::1]:3080')).toBe('http://[::1]:3080')
  await expect(readReply(new Response(null), 100)).rejects.toThrow('unavailable')
})
it('bounds concurrent requests and waits for aborted HTTP work during transport disposal', async () => {
  const ui = await boot(), local = await client(ui, { maxInFlight: 1 })
  const started = Promise.withResolvers<undefined>()
  vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, init) => {
    started.resolve(undefined)
    return await new Promise<Response>((_resolve, reject) => { init!.signal!.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true }) })
  })
  const pending = local.call({ kind: 'list' }); await started.promise
  await expect(local.call({ kind: 'list' })).rejects.toThrow('unavailable')
  const rejected = expect(pending).rejects.toThrow('unavailable'); await local.fiber.dispose(); await rejected
})
it('relates committed durable keys and request identities and withdraws the machine route on disposal', async () => {
  const ctx = new Context(); contexts.push(ctx); await ctx.plugin(InvariantRegistry)
  const companion = ctx.plugin(Companion); await companion
  const ui = await boot(), id = randomUUID() as RemoteSubmission['id']; await ui.invoke({ kind: 'submit', id, target: target() })
  const record = ui.ctx.storageDomain.get('remote_work')!.table('submissions').get(`${principalId}/${id}`) as StoredSubmission
  const emit = (value: object, patch: object = {}) => { ctx.emit('domain/changed', { domain: 'remote_work', table: 'submissions', operation: 'put', key: submissionKey(record), value, ...patch } as never) }
  expect(() => { emit(record) }).not.toThrow()
  for (const patch of [{ domain: 'other' }, { table: 'other' }, { operation: 'delete' }]) expect(() => { emit({}, patch) }).not.toThrow()
  expect(() => { emit(record, { key: 'wrong' }) }).toThrow('key differs')
  expect(() => { emit({ ...record, inputHash: 'wrong' }) }).toThrow('content')
  expect(() => { emit({ ...record, requestId: 'wrong' }) }).toThrow('identity')
  expect(() => { emit({ ...record, admission: { state: 'admitted', ref: { kind: 'workflow' } } }) }).toThrow('kind differs')
  await ui.fiber.dispose(); expect((await ui.raw({ kind: 'list' })).status).toBe(404)
  await companion.dispose()
})
it('rejects duplicate peer identities and accepts the case-insensitive bearer authentication scheme', async () => {
  const ui = await boot(), local = await client(ui)
  await expect(client(ui, { peers: [local.configuration.peers[0]!, local.configuration.peers[0]!] })).rejects.toThrow('conflict')
  expect((await ui.raw({ kind: 'list' }, { authorization: `bearer ${bearer}` })).status).toBe(200)
})
it('bounds concurrent inbound bodies and destroys retained requests during receiver disposal', async () => {
  const ui = await boot({ config: { maxInFlight: 1 } }), received = ui.resolve.mock.calls.length
  const closed = Promise.withResolvers<undefined>()
  const request = httpRequest(`${ui.origin}${REMOTE_WORK_PATH}`, { method: 'POST', headers: {
    authorization: `Bearer ${bearer}`, 'content-type': 'application/json', 'transfer-encoding': 'chunked' } })
  request.on('error', () => { closed.resolve(undefined) }); request.write('{')
  await vi.waitFor(() => { expect(ui.resolve).toHaveBeenCalledTimes(received + 1) })
  expect((await ui.raw({ kind: 'list' })).status).toBe(503)
  await ui.fiber.dispose(); await closed.promise
  expect(ui.state.runs.size).toBe(0)
})
it('times out an incomplete authenticated body without creating native work', async () => {
  const ui = await boot({ config: { bodyTimeoutMs: 20 } }), closed = Promise.withResolvers<undefined>()
  const request = httpRequest(`${ui.origin}${REMOTE_WORK_PATH}`, { method: 'POST', headers: {
    authorization: `Bearer ${bearer}`, 'content-type': 'application/json', 'transfer-encoding': 'chunked' } })
  request.on('error', () => { closed.resolve(undefined) }); request.write('{'); await closed.promise
  expect(await ui.invoke({ kind: 'list' })).toMatchObject({ items: [] }); expect(ui.agent).not.toHaveBeenCalled()
})
it.each([false, true])('retains native work after caller disconnect, with failed receipt write: %s', async (failWrite) => {
  const disconnected = Promise.withResolvers<undefined>()
  const ui = await boot({ observeResponse: (response) => { response.once('close', () => { disconnected.resolve(undefined) }) } })
  const started = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const native = ui.agent.getMockImplementation()!
  ui.agent.mockImplementationOnce(async (command) => {
    started.resolve(undefined); await release.promise; const receipt = await native(command)
    if (failWrite) vi.spyOn(ui.ctx.storageDomain.get('remote_work')!.table('submissions'), 'put').mockRejectedValueOnce(new Error('Receipt write failed'))
    return receipt
  })
  const id = randomUUID() as RemoteSubmission['id'], controller = new AbortController()
  const pending = fetch(`${ui.origin}${REMOTE_WORK_PATH}`, { method: 'POST', signal: controller.signal, headers: {
    authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify({ version: 1, hostId, principalId, operation: { kind: 'submit', id, target: target() } }) })
  await started.promise; controller.abort(); await expect(pending).rejects.toThrow(); await disconnected.promise; release.resolve(undefined)
  expect(await ui.invoke({ kind: 'inspect', id })).toMatchObject({ submission: { admission: { state: failWrite ? 'unconfirmed' : 'admitted' } } })
  if (failWrite) expect(submission(await ui.invoke({ kind: 'recover', id, expectedAttempt: 1 })).admission.state).toBe('admitted')
  expect(ui.state.runs.size).toBe(1)
})
it('preserves uncertainty when a native workflow provider omits or multiplies its formal admission receipt', async () => {
  const ui = await boot()
  for (const runIds of [undefined, ['one', 'two']]) {
    ui.workflow.mockResolvedValueOnce({ workflowId: 'workflow', ...(runIds === undefined ? {} : { runIds }) })
    expect(submission(await ui.invoke({ kind: 'submit', id: randomUUID() as never, target: workflowTarget() })).admission.state).toBe('unconfirmed')
  }
})

it('retains fixed remote failure classifications without trusting arbitrary diagnostics', async () => {
  const ui = await boot(), local = await client(ui), fetcher = vi.spyOn(globalThis, 'fetch')
  for (const code of ['denied', 'invalid-request', 'conflict', 'limit', 'unavailable', 'unknown-submission']) {
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ version: 1, error: { code } }), { status: 403 }))
    await expect(local.call({ kind: 'list' })).rejects.toThrow(code)
  }
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ version: 1, error: { code: 'foreign', message: bearer } }), { status: 503 }))
  await expect(local.call({ kind: 'list' })).rejects.toThrow('unavailable')
})

it('reads original native waiting inputs and keeps decision failures independent of delivery evidence', async () => {
  const ui = await boot(), local = await client(ui), id = randomUUID() as RemoteSubmission['id']
  await local.call({ kind: 'submit', id, target: workflowTarget() })
  expect(await local.call({ kind: 'inspect', id })).toMatchObject({ decisions: [{ attemptId: 'waiting-attempt',
    title: 'Review report', instruction: 'Review actual input', inputs: { report: 'Original input' } }] })
  const native = ui.inspectRun.getMockImplementation()!
  ui.inspectRun.mockImplementationOnce(async id => ({ ...await native(id), id: 'other' }))
  expect(await local.call({ kind: 'inspect', id })).toMatchObject({ decisionsUnavailable: true, delivery: { evidence: 'recorded-response' } })
  ui.inspectRun.mockImplementationOnce(async id => ({ ...await native(id), workspaceId: 'other' }))
  expect(await local.call({ kind: 'inspect', id })).toHaveProperty('decisionsUnavailable', true)
  ui.inspectRun.mockImplementationOnce(async id => ({ ...await native(id), attempts: [] }))
  expect(await local.call({ kind: 'inspect', id })).toHaveProperty('decisions', [])
  ui.inspectRun.mockImplementationOnce(async id => ({ ...await native(id), version: { definition: { nodes: [] } } }))
  expect(await local.call({ kind: 'inspect', id })).toHaveProperty('decisionsUnavailable', true)
  ui.inspectRun.mockImplementationOnce(async id => ({ ...await native(id), version: { definition: { nodes: [{ id: 'approval', kind: 'agent', title: 'Agent', instruction: '' }] } } }))
  expect(await local.call({ kind: 'inspect', id })).toHaveProperty('decisionsUnavailable', true)
  ui.inspectRun.mockRejectedValueOnce(new Error(bearer))
  expect(JSON.stringify(await local.call({ kind: 'inspect', id }))).not.toContain(bearer)
})
it('refuses reassigned calling peer authority before forwarding any request', async () => {
  const ui = await boot(), local = await client(ui), fetcher = vi.spyOn(globalThis, 'fetch')
  for (const expected of [{ hostId: randomUUID(), principalId }, { hostId, principalId: 'other' }]) {
    await expect(local.gateway.call({ peer: 'peer' as never, expected: expected as never, operation: { kind: 'list' } })).rejects.toThrow('denied')
  }
  expect(fetcher).not.toHaveBeenCalled()
})
