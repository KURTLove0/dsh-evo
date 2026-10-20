/** Native JSON-RPC subprocess lifecycle without model credentials or inference. */
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUserMessage, createAssistantMessage, createToolResultMessage, CallId } from '@deepseek-ai/dsh-llm'
import Llm from '@deepseek-ai/dsh-llm'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { pathToFileURL } from 'node:url'
import * as Plugin from '../src/index.ts'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as Invariant from '../src/invariant.ts'

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function fixture(mode = 'complete') {
  const root = await mkdtemp(join(tmpdir(), 'dsh-codex-runtime-')); roots.push(root)
  const file = join(root, 'server.mjs'), record = join(root, 'requests.jsonl'), closed = join(root, 'closed')
  await writeFile(file, `import {createInterface} from 'node:readline';
import {appendFileSync,writeFileSync} from 'node:fs';
const mode=${JSON.stringify(mode)};
const send=(value)=>process.stdout.write(JSON.stringify(value)+'\\n');
process.on('SIGTERM',()=>{writeFileSync(${JSON.stringify(closed)},'closed');process.exit(0)});
createInterface({input:process.stdin}).on('line',line=>{
const request=JSON.parse(line);
if(request.id==='server-check' && !request.method){appendFileSync(${JSON.stringify(record)},JSON.stringify(request)+'\\n');send({method:'turn/completed',params:{turn:{status:'completed'}}});return;}
if(!request.id || !request.method)return;
appendFileSync(${JSON.stringify(record)},JSON.stringify(request)+'\\n');
if(mode==='quiet-exit'){process.exit(2)}
if(mode==='exit'){process.stderr.write('native startup failed');process.exit(2)}
let result={};
if(mode==='catalog-hang' && request.method==='model/list')return;
if(request.method==='model/list')result=mode==='bad-catalog'?{data:[{}]}:{data:[{model:'native-one',displayName:'Native One',supportedReasoningEfforts:[{reasoningEffort:'high',description:'High'}],defaultReasoningEffort:'high',description:'Native model'},{model:'plain',displayName:'Plain'},{model:'no-default-effort',displayName:'No effort default',supportedReasoningEfforts:[]}],nextCursor:mode==='pages' && !request.params.cursor?'next':null};
if(request.method==='thread/start')result=mode==='bad-thread'?{}:{thread:{id:'thread'}};
if(request.method==='turn/start')result={turn:{id:'turn',status:'inProgress'}};
send({id:request.id,result});
if(request.method==='turn/start'){
if(mode!=='no-delta' && mode!=='empty') {send({method:'item/agentMessage/delta',params:{delta:'native '}});send({method:'item/agentMessage/delta',params:{delta:'answer'}})}
if(mode==='bad-event')send({method:'item/agentMessage/delta',params:{delta:1}});
if(mode!=='empty')send({method:'item/completed',params:{item:{id:'answer',type:'agentMessage',text:'native answer'}}});
send({method:'item/completed',params:{item:{id:'thought',type:'reasoning'}}});
send({method:'unknown/notification',params:{}});
if(mode==='hang')return;
if(mode==='host-request'){send({id:'server-check',method:'unsupported/approval',params:{}});return;}
send({method:'item/started',params:{item:{id:'command',type:'commandExecution',command:'pwd'}}});
send({method:'item/completed',params:{item:{id:'files',type:'fileChange'}}});
send({method:'item/completed',params:{item:{id:'mcp',type:'mcpToolCall'}}});
send({method:'item/completed',params:{item:{id:'command',type:'commandExecution',command:'pwd'}}});
if(mode!=='empty') {for (const outputTokens of [1,3]) send({method:'thread/tokenUsage/updated',params:{tokenUsage:{last:{inputTokens:10,cachedInputTokens:4,outputTokens}}}});}
send({method:'turn/completed',params:{turn:{status:mode==='fail' || mode==='fail-empty'?'failed':'completed',error:mode==='fail'?{message:'native failure'}:null}}});
}});
`)
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Llm); await ctx.plugin(LocalSubprocess)
  const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
  vi.spyOn(ctx.subprocess, 'spawn').mockImplementation(spec => spawn({ ...spec, argv: [process.execPath, file, ...spec.argv.slice(1)] }))
  const config = { command: process.execPath, provider: 'codex-cli', timeoutMs: 1000, catalogTimeoutMs: 1000, catalogCacheMs: 60000, graceMs: 100, diagnosticMaxBytes: 65536 } satisfies Plugin.Config
  const adapter = new Plugin.CodexCliAdapter(ctx.subprocess, config)
  return { ctx, adapter, config, root, record, closed }
}
const chunks = async (adapter: Plugin.CodexCliAdapter, model = 'default', options: Partial<GenerateOptions> = {}) => {
  const output: StreamChunk[] = []
  for await (const chunk of adapter.stream({ provider: 'codex-cli', model, messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Business task' }] })], ...options })) output.push(chunk)
  return output
}

describe('installed Codex runtime', () => {
  it('registers and disposes the local route with an explicit native default', async () => {
    const { ctx, config } = await fixture()
    const fiber = ctx.plugin(Plugin, config); await fiber.await()
    expect(ctx.llm.listConfigurableProviders()[0]).toMatchObject({ provider: 'codex-cli', defaultModel: 'default', localCommand: process.execPath })
    expect(ctx.llm.listProviders()).toEqual([{ id: 'codex-cli', name: 'Codex CLI' }])
    await fiber.dispose()
    expect(ctx.llm.listProviders()).toEqual([])
  })
  it('discovers native models once and resolves exact reasoning metadata', async () => {
    const { adapter, record } = await fixture()
    expect((await adapter.listModels('codex-cli'))[0]?.id).toBe('native-one')
    expect((await adapter.resolveModel('codex-cli', 'native-one')).reasoning?.defaultEffort).toBe('high')
    expect((await adapter.resolveModel('codex-cli', 'default')).name).toBe('Codex default')
    expect((await readFile(record, 'utf8')).match(/model\/list/g)).toHaveLength(1)
  })
  it('runs an ephemeral native thread with inherited defaults, usage, and recorded native activity', async () => {
    const { adapter, record, closed } = await fixture()
    const output = await chunks(adapter)
    expect(output).toContainEqual({ type: 'block-end', index: 0, block: { type: 'text', text: 'native answer' } })
    expect(output.filter(chunk => chunk.type === 'usage')).toHaveLength(1)
    expect(output).toContainEqual({ type: 'usage', usage: { inputTokens: 6, cacheReadTokens: 4, outputTokens: 3 } })
    const finish = output.find(chunk => chunk.type === 'finish')
    expect(finish?.type === 'finish' ? finish.interactions?.map(item => item.kind) : []).toEqual(['command', 'file-change', 'tool'])
    expect(await readFile(closed, 'utf8')).toBe('closed')
    const requests = (await readFile(record, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { method: string; params: Record<string, unknown> })
    expect(requests.find(request => request.method === 'thread/start')?.params).toMatchObject({ model: null, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only' })
    expect(requests.find(request => request.method === 'turn/start')?.params.input).toEqual([{ type: 'text', text: '[user]\nBusiness task' }])
  })
  it('passes an explicit model override and closes a native run when the consumer stops', async () => {
    const { adapter, record, closed } = await fixture('hang')
    for await (const chunk of adapter.stream({ provider: 'codex-cli', model: 'native-one', messages: [] })) {
      if (chunk.type === 'text-delta') break
    }
    expect(await readFile(closed, 'utf8')).toBe('closed')
    expect(await readFile(record, 'utf8')).toContain('"model":"native-one"')
  })
  it.each(['fail', 'exit', 'bad-catalog'])('surfaces native %s failures and drains its process', async (mode) => {
    const { adapter } = await fixture(mode)
    if (mode === 'bad-catalog') await expect(adapter.listModels('codex-cli')).rejects.toThrow()
    else await expect(chunks(adapter)).rejects.toThrow(/native/)
  })
})


it('pages catalogs, merges concurrent reads, and re-probes when caching is disabled', async () => {
  const { ctx, config, record } = await fixture('pages')
  const adapter = new Plugin.CodexCliAdapter(ctx.subprocess, { ...config, catalogCacheMs: 0 })
  const [first, second] = await Promise.all([adapter.listModels('codex-cli'), adapter.listModels('codex-cli')])
  expect(first).toHaveLength(6); expect(second).toEqual(first)
  await adapter.listModels('codex-cli')
  expect((await readFile(record, 'utf8')).match(/model\/list/g)).toHaveLength(4)
  expect((await adapter.resolveModel('codex-cli', 'not-listed')).name).toBe('not-listed')
})

it.each(['bad-event', 'bad-thread', 'quiet-exit', 'fail-empty'])('rejects malformed or failed native operations: %s', async (mode) => {
  const { adapter } = await fixture(mode)
  await expect(chunks(adapter)).rejects.toThrow()
})

it('uses completed assistant text when the native service sends no deltas', async () => {
  const { adapter, record, root } = await fixture('no-delta')
  const result = await chunks(adapter, 'native-one', { cwd: root, purpose: 'session-title', sandboxMode: 'danger-full-access', reasoningEffort: 'high' as never, system: 'System context' })
  expect(result).toContainEqual({ type: 'text-delta', index: 0, text: 'native answer' })
  expect(await readFile(record, 'utf8')).toContain('"sandbox":"read-only"')
})

it('bounds a stalled native turn and catalog request', async () => {
  const turn = await fixture('hang')
  await expect(chunks(turn.adapter)).rejects.toThrow('cancelled or timed out')
  const catalog = await fixture('catalog-hang')
  await expect(catalog.adapter.listModels('codex-cli')).rejects.toThrow('cancelled or timed out')
})

it('leaves missing commands dormant and rejects unrelated executable-resolution failures', async () => {
  const { ctx, config } = await fixture()
  const resolve = vi.spyOn(ctx.subprocess, 'resolveExecutable')
  let index = 0
  for (const message of ['command was not found on PATH', 'command is not an executable file']) {
    resolve.mockRejectedValueOnce(new Error(message))
    await Plugin.apply(ctx, { ...config, provider: `missing-${index++}` })
  }
  for (const failure of [new Error('EPERM'), 'EPERM']) {
    resolve.mockRejectedValueOnce(failure)
    await expect(Plugin.apply(ctx, { ...config, provider: `failed-${index++}` })).rejects.toBe(failure)
  }
})

it.each([{ command: '' }, { provider: '' }])('rejects empty native connection settings: %s', async (invalid) => {
  const { ctx, config } = await fixture()
  await expect(Plugin.apply(ctx, { ...config, ...invalid })).rejects.toThrow('must be non-empty')
})

it('rejects native host requests without approving them', async () => {
  const { adapter, record } = await fixture('host-request')
  await chunks(adapter)
  expect(await readFile(record, 'utf8')).toContain('unsupported host interaction')
})

it('reports a process that cannot start and drains its failed handle', async () => {
  const { ctx, config } = await fixture()
  vi.restoreAllMocks()
  const adapter = new Plugin.CodexCliAdapter(ctx.subprocess, { ...config, command: '/nonexistent/dsh-codex-runtime' })
  await expect(chunks(adapter)).rejects.toThrow()
})

it('replays reasoning and tool results as durable role-delimited input and rejects images', async () => {
  const { adapter, record } = await fixture()
  await chunks(adapter, 'native-one', { system: 'System context', sandboxMode: 'workspace-write', messages: [
    createAssistantMessage({ source: { provider: 'codex-cli', model: 'native-one' }, content: [
      { type: 'reasoning', text: 'Public summary' }, { type: 'tool-call', id: CallId('call'), name: 'business_tool', arguments: '{}' },
    ] }),
    createToolResultMessage({ callId: CallId('call'), isError: false, content: [{ type: 'text', text: 'Revenue 200' }] }),
  ] })
  const recorded = await readFile(record, 'utf8')
  expect(recorded).toContain('Public summary')
  expect(recorded).toContain('Revenue 200')
  await expect(chunks(adapter, 'native-one', { messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'image', attachment: {} as never }] })] })).rejects.toThrow('text input only')
})

it('mounts the installed-command provider through a real Loader composition', async () => {
  const { ctx, config, root } = await fixture()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', import: async () => Plugin } as unknown as NonNullable<typeof ctx.loader.internal>
  const file = join(root, 'cordis.yml')
  await writeFile(file, JSON.stringify([{ name: 'test:codex-runtime', config }]))
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(file).href } })
  await ctx.loader.await()
  expect((await ctx.llm.listModels('codex-cli'))[0]?.id).toBe('native-one')
})


it('retains activity when a successful native turn has no assistant text', async () => {
  const { adapter } = await fixture('empty')
  const output = await chunks(adapter, 'default', { signal: new AbortController().signal })
  expect(output.some(chunk => chunk.type === 'text-delta')).toBe(false)
  expect(output.at(-1)?.type).toBe('finish')
})


it.each([{ temperature: 0.5 }, { maxTokens: 10 }, { stop: ['END'] }])('rejects unsupported native generation overrides: %s', async (options) => {
  const { adapter } = await fixture()
  await expect(chunks(adapter, 'default', options)).rejects.toThrow('sampling or token-limit overrides')
})

it('reserves and releases package ownership through its invariant companion', async () => {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(InvariantRegistry)
  const fiber = await ctx.plugin(Invariant)
  expect(() => ctx.invariants.register('@deepseek-ai/dsh-llm-codex-cli', () => {})).toThrow('already registered')
  await fiber.dispose()
  ctx.invariants.register('@deepseek-ai/dsh-llm-codex-cli', () => {})
})
