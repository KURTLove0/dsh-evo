import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime, { CallId, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as CursorRuntime from '../src/index.ts'
import {
  CursorCliAdapter,
  classifyCursorFailure,
  foldCursorPrompt,
  parseCursorModels,
  resolveConfig,
} from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function fixture(): Promise<{ command: string; cwd: string; recordPath: string }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-cursor-cli-'))
  const command = join(root, 'cursor-agent')
  const recordPath = join(root, 'request.json')
  await writeFile(command, `#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
const args = process.argv.slice(2)
if (args.includes('models')) {
  if (process.env.CURSOR_FIXTURE_MODE === 'model-error') {
    process.stderr.write(process.env.CURSOR_FIXTURE_STDERR ?? 'catalog failed')
    process.exit(2)
  }
  process.stdout.write(process.env.CURSOR_FIXTURE_MODELS ?? 'Available models\\nmodel-one - Model One (current/default)\\nmodel-two - Model Two\\n\\nTip: use --model <id>\\n')
  process.exit(Number(process.env.CURSOR_FIXTURE_EXIT_CODE ?? 0))
}
const input = readFileSync(0, 'utf8')
await writeFile(${JSON.stringify(recordPath)}, JSON.stringify({ args, input, cwd: process.cwd(), secret: process.env.DEEPSEEK_API_KEY ?? null, own: process.env.CURSOR_API_KEY ?? null }))
const ordinaryFrames = [
  { type: 'system', subtype: 'init', session_id: 'cursor-session', model: 'model-one' },
  { type: 'thinking', subtype: 'delta', text: 'inspect', session_id: 'cursor-session', timestamp_ms: 10 },
  { type: 'thinking', subtype: 'completed', session_id: 'cursor-session', timestamp_ms: 11 },
  { type: 'tool_call', subtype: 'started', call_id: 'call-1', tool_call: { shellToolCall: { args: { command: 'pwd' } } }, session_id: 'cursor-session', timestamp_ms: 12 },
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'duplicate before tool' }] }, session_id: 'cursor-session', timestamp_ms: 13, model_call_id: 'model-call-1' },
  { type: 'tool_call', subtype: 'completed', call_id: 'call-1', tool_call: { shellToolCall: { args: { command: 'pwd' }, result: { success: { stdout: '/workspace' } } } }, session_id: 'cursor-session', timestamp_ms: 14 },
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] }, session_id: 'cursor-session', timestamp_ms: 14 },
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'duplicate final flush' }] }, session_id: 'cursor-session' },
  { type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: 'cursor-session', usage: { inputTokens: 3, outputTokens: 2, cacheReadTokens: 1 } },
]
const configured = process.env.CURSOR_FIXTURE_FRAMES
process.stdout.write('\\n')
if (configured === 'malformed') process.stdout.write('{not-json}\\n')
else for (const frame of configured === undefined ? ordinaryFrames : JSON.parse(configured)) process.stdout.write(JSON.stringify(frame) + '\\n')
if (process.env.CURSOR_FIXTURE_STDERR !== undefined) process.stderr.write(process.env.CURSOR_FIXTURE_STDERR)
if (process.env.CURSOR_FIXTURE_DELAY_MS !== undefined) await new Promise(resolve => setTimeout(resolve, Number(process.env.CURSOR_FIXTURE_DELAY_MS)))
process.exit(Number(process.env.CURSOR_FIXTURE_EXIT_CODE ?? 0))
`)
  await chmod(command, 0o755)
  return { command, cwd: root, recordPath }
}

function request(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    provider: 'cursor-cli',
    model: 'model-one',
    messages: [],
    ...overrides,
  }
}

async function collect(adapter: CursorCliAdapter, options: GenerateOptions): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of adapter.stream(options)) chunks.push(chunk)
  return chunks
}

function fixtureAdapter(
  command: string,
  env: Record<string, string> = {},
  models: Parameters<typeof resolveConfig>[0]['models'] = [{ id: 'auto', name: 'Auto' }],
): CursorCliAdapter {
  if (context === undefined) throw new Error('test context is not initialized')
  return new CursorCliAdapter(context.subprocess, resolveConfig({ command, env, models }).connection)
}

describe('Cursor CLI adapter', () => {
  it('parses the native model listing and validates owned flags', () => {
    expect(parseCursorModels('\u001b[32mAvailable models\u001b[0m\nfoo - Foo (current/default)\nbar - Bar\n')).toEqual([
      { id: 'foo', name: 'Foo' },
      { id: 'bar', name: 'Bar' },
    ])
    expect(() => resolveConfig({ extraArgs: ['--model=wrong'] })).toThrow('must not override --model')
    expect(() => resolveConfig({ extraArgs: ['-m'] })).toThrow('must not override -m')
    expect(() => resolveConfig({ extraArgs: ['--plan'] })).toThrow('must not override --plan')
    expect(() => resolveConfig({ extraArgs: ['-a'] })).toThrow('must not override -a')
    expect(() => resolveConfig({ extraArgs: ['--add-dir=../outside'] })).toThrow('must not override --add-dir')
    expect(() => resolveConfig({ command: './cursor-agent' })).toThrow('absolute path or bare executable name')
    expect(() => resolveConfig({ command: '' })).toThrow('command must be non-empty')
    expect(() => resolveConfig({ provider: '' })).toThrow('provider must be non-empty')
    for (const timeoutMs of [0, Number.POSITIVE_INFINITY, 2_147_483_648]) {
      expect(() => resolveConfig({ timeoutMs })).toThrow('timeoutMs must be positive')
      expect(() => resolveConfig({ catalogTimeoutMs: timeoutMs })).toThrow('catalogTimeoutMs must be positive')
    }
    expect(() => resolveConfig({ models: [{ id: '' }] })).toThrow('model ids must be non-empty')
    expect(() => resolveConfig({ models: [{ id: 'one', name: '' }] })).toThrow('has an empty name')
    expect(() => resolveConfig({ models: [{ id: 'one' }, { id: 'one' }] })).toThrow('model ids must be unique')
    expect(resolveConfig({ extraArgs: ['--header', 'x-test: value'] }).connection.extraArgs)
      .toEqual(['--header', 'x-test: value'])

    expect(parseCursorModels('bad line\n - Empty id\none - \none - One\none - Duplicate\n')).toEqual([
      { id: 'one', name: 'One' },
    ])
    expect([
      'login required',
      '429 too many requests',
      'unknown model',
      '400 bad request',
      'request timed out',
      'internal server error 500',
      'unexpected failure',
    ].map(classifyCursorFailure)).toEqual([
      'AUTH', 'RATE_LIMIT', 'NOT_FOUND', 'INVALID_REQUEST', 'TIMEOUT', 'SERVER', 'CLI_ERROR',
    ])
  })

  it('folds every durable text representation into the one-shot prompt', () => {
    const message = createUserMessage({
      source: { kind: 'user' },
      content: [
        { type: 'reasoning', text: 'thought' },
        { type: 'tool-call', id: CallId('call-1'), name: 'bash', arguments: '{"cmd":"pwd"}' },
        {
          type: 'tool-result',
          toolCallId: CallId('call-1'),
          isError: true,
          content: [{ type: 'text', text: 'failed' }, { type: 'image' } as never],
        },
        { type: 'tool-result', toolCallId: CallId('call-2'), content: [{ type: 'text', text: 'ok' }] },
        { type: 'image' } as never,
        { type: 'future-block' } as never,
      ],
    })
    expect(foldCursorPrompt(request({ system: '', messages: [message] }))).toContain([
      '[user]',
      'thought',
      '[tool call bash call-1]',
      '{"cmd":"pwd"}',
      '[tool result call-1 error]',
      'failed',
      '[image]',
      '[tool result call-2]',
      'ok',
      '[image attachment unavailable to Cursor CLI]',
      '[unsupported content block future-block]',
    ].join('\n'))
  })

  it('runs stream-json through the managed subprocess and projects native work', async () => {
    const { command, cwd, recordPath } = await fixture()
    context = new Context()
    await context.plugin(LocalSubprocessRuntime)
    const resolved = resolveConfig({
      command,
      env: { CURSOR_API_KEY: 'cursor-fixture' },
      models: [{ id: 'fallback', name: 'Fallback' }],
    })
    const adapter = new CursorCliAdapter(context.subprocess, resolved.connection)
    const messages = [createUserMessage({
      content: [{ type: 'text', text: 'hello' }],
      source: { kind: 'user' },
    })]

    const chunks = []
    for await (const chunk of adapter.stream({
      provider: 'cursor-cli',
      model: 'model-one',
      system: 'system text',
      messages,
      cwd,
      sandboxMode: 'workspace-write',
    })) chunks.push(chunk)

    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'inspect' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'inspect' } },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: 'done' },
      { type: 'block-end', index: 1, block: { type: 'text', text: 'done' } },
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 2, cacheReadTokens: 1 } },
      {
        type: 'finish',
        reason: { kind: 'stop' },
        interactions: [{
          id: 'call-1',
          kind: 'command',
          title: 'pwd',
          status: 'completed',
          detail: JSON.stringify({ shellToolCall: { args: { command: 'pwd' }, result: { success: { stdout: '/workspace' } } } }),
        }],
      },
    ])
    const recorded = JSON.parse(await (await import('node:fs/promises')).readFile(recordPath, 'utf8')) as {
      args: string[]
      input: string
      secret: string | null
      own: string | null
    }
    expect(recorded.args).toContain('--force')
    expect(recorded.args).toContain('enabled')
    expect(recorded.input).toBe(foldCursorPrompt({
      provider: 'cursor-cli',
      model: 'model-one',
      system: 'system text',
      messages,
    }))
    expect(recorded.secret).toBeNull()
    expect(recorded.own).toBe('cursor-fixture')

    await expect(adapter.listModels('cursor-cli')).resolves.toEqual([
      { provider: 'cursor-cli', id: 'model-one', name: 'Model One', inputModalities: ['text'] },
      { provider: 'cursor-cli', id: 'model-two', name: 'Model Two', inputModalities: ['text'] },
      { provider: 'cursor-cli', id: 'fallback', name: 'Fallback', inputModalities: ['text'] },
    ])
  })

  it('maps read-only requests to Cursor ask mode', async () => {
    const { command, cwd, recordPath } = await fixture()
    context = new Context()
    await context.plugin(LocalSubprocessRuntime)
    const adapter = new CursorCliAdapter(context.subprocess, resolveConfig({ command }).connection)
    for await (const _chunk of adapter.stream({
      provider: 'cursor-cli',
      model: 'model-one',
      messages: [],
      cwd,
      sandboxMode: 'read-only',
    })) {
      // Drain the stream so process ownership reaches quiescence.
    }
    const recorded = JSON.parse(await (await import('node:fs/promises')).readFile(recordPath, 'utf8')) as { args: string[] }
    expect(recorded.args).toContain('ask')
    expect(recorded.args).toContain('--trust')
    expect(recorded.args).not.toContain('--force')
  })

  it('maps the remaining execution policies and auxiliary requests', async () => {
    const { command, recordPath } = await fixture()
    context = new Context()
    await context.plugin(LocalSubprocessRuntime)
    const adapter = fixtureAdapter(command)
    await collect(adapter, request({ sandboxMode: 'danger-full-access' }))
    let recorded = JSON.parse(await (await import('node:fs/promises')).readFile(recordPath, 'utf8')) as { args: string[] }
    expect(recorded.args).toEqual(expect.arrayContaining(['--force', '--sandbox', 'disabled']))
    await collect(adapter, request())
    recorded = JSON.parse(await (await import('node:fs/promises')).readFile(recordPath, 'utf8')) as { args: string[] }
    expect(recorded.args).not.toContain('--force')
    expect(recorded.args).toEqual(expect.arrayContaining(['--mode', 'ask', '--trust']))
    await collect(adapter, request({ purpose: 'session-title' }))
    recorded = JSON.parse(await (await import('node:fs/promises')).readFile(recordPath, 'utf8')) as { args: string[] }
    expect(recorded.args).toEqual(expect.arrayContaining(['--mode', 'ask', '--trust']))
  })

  it('rejects request controls the CLI cannot honor before spawning', async () => {
    const { command } = await fixture()
    context = new Context()
    await context.plugin(LocalSubprocessRuntime)
    const adapter = fixtureAdapter(command)
    for (const options of [
      { temperature: 0 },
      { maxTokens: 1 },
      { stop: ['stop'] },
      { reasoningEffort: ReasoningEffortId('high') },
      { messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'image' } as never] })] },
      { messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'tool-result', toolCallId: CallId('call-1'), content: [{ type: 'image' } as never] }] })] },
    ] satisfies Array<Partial<GenerateOptions>>) {
      await expect(collect(adapter, request(options))).rejects.toMatchObject({ code: 'UNSUPPORTED_OPTION' })
    }
  })

  it('uses terminal result text and projects all native tool categories', async () => {
    const { command } = await fixture()
    context = new Context()
    await context.plugin(LocalSubprocessRuntime)
    const frames = [
      { type: 'tool_call', subtype: 'started', call_id: 'file', tool_call: { writeToolCall: { args: { path: 'a.ts' } } } },
      { type: 'tool_call', subtype: 'completed', call_id: 'file', tool_call: { writeToolCall: { result: { error: { message: 'denied' } } } } },
      { type: 'tool_call', subtype: 'completed', call_id: 'read', tool_call: { readFileToolCall: { args: { path: 'a.ts' }, result: { success: { content: 'text' } } } } },
      { type: 'tool_call', subtype: 'completed', call_id: 'web', tool_call: { name: 'web_search', status: 'completed' } },
      { type: 'tool_call', subtype: 'completed', call_id: 'search', tool_call: { name: 'code_search', status: 'completed' } },
      { type: 'tool_call', subtype: 'completed', call_id: 'agent', tool_call: { type: 'subagent', status: 'completed' } },
      { type: 'tool_call', subtype: 'failed', call_id: 'failed', tool_call: { name: 'mcp_tool' } },
      { type: 'tool_call', call_id: 'unknown', tool_call: { name: 'unknown' } },
      { type: 'tool_call', subtype: 'started', call_id: 'plain', tool_call: { opaque: true } },
      { type: 'result', subtype: 'success', is_error: false, result: 'fallback answer', usage: { inputTokens: -1, outputTokens: 'bad', cacheWriteTokens: 4, reasoningTokens: 2 } },
    ]
    const adapter = fixtureAdapter(command, { CURSOR_FIXTURE_FRAMES: JSON.stringify(frames) })
    const chunks = await collect(adapter, request())
    expect(chunks).toEqual(expect.arrayContaining([
      { type: 'text-delta', index: 0, text: 'fallback answer' },
      { type: 'usage', usage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 4, reasoningTokens: 2 } },
    ]))
    const finish = chunks.at(-1)
    expect(finish).toMatchObject({
      type: 'finish',
      interactions: [
        { id: 'file', kind: 'file-change', title: 'a.ts', status: 'failed' },
        { id: 'read', kind: 'tool', title: 'a.ts', status: 'completed' },
        { id: 'web', kind: 'web-search', title: 'web_search', status: 'completed' },
        { id: 'search', kind: 'tool', title: 'code_search', status: 'completed' },
        { id: 'agent', kind: 'agent', title: 'subagent', status: 'completed' },
        { id: 'failed', kind: 'tool', title: 'mcp_tool', status: 'failed' },
        { id: 'unknown', kind: 'tool', title: 'unknown', status: 'started' },
        { id: 'plain', kind: 'tool', title: 'Cursor tool', status: 'started' },
      ],
    })
  })

  it('handles adjacent deltas and ignores incomplete protocol events', async () => {
    const { command } = await fixture()
    context = new Context()
    await context.plugin(LocalSubprocessRuntime)
    const frames = [
      { type: 'assistant', timestamp_ms: 1, message: {} },
      { type: 'assistant', timestamp_ms: 2, message: { content: [null, { type: 'text', text: '' }] } },
      { type: 'thinking', subtype: 'delta', text: '' },
      { type: 'thinking', subtype: 'completed' },
      { type: 'tool_call', subtype: 'started' },
      { type: 'thinking', subtype: 'delta', text: 'one' },
      { type: 'thinking', subtype: 'delta', text: 'two' },
      { type: 'assistant', timestamp_ms: 3, message: { content: [{ type: 'text', text: 'a' }] } },
      { type: 'assistant', timestamp_ms: 4, message: { content: [{ type: 'text', text: 'b' }] } },
      { type: 'assistant', timestamp_ms: 5, message: { content: [{ type: 'text', text: 'ab' }] } },
      { type: 'result', subtype: 'success', is_error: false },
    ]
    const chunks = await collect(fixtureAdapter(command, {
      CURSOR_FIXTURE_FRAMES: JSON.stringify(frames),
    }), request())
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'onetwo' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'onetwo' } },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: 'ab' },
      { type: 'block-end', index: 1, block: { type: 'text', text: 'ab' } },
      { type: 'finish', reason: { kind: 'stop' }, interactions: [] },
    ])

    const retried = await collect(fixtureAdapter(command, {
      CURSOR_FIXTURE_FRAMES: JSON.stringify([
        { type: 'thinking', subtype: 'delta', text: 'discarded' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'discarded' }] } },
        { type: 'retry', subtype: 'starting', attempt: 1 },
        { type: 'thinking', subtype: 'delta', text: 'kept' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'answer' }] } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'answer' }] } },
        { type: 'result', subtype: 'success', is_error: false },
      ]),
    }), request())
    expect(retried).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'kept' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'kept' } },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: 'answer' },
      { type: 'block-end', index: 1, block: { type: 'text', text: 'answer' } },
      { type: 'finish', reason: { kind: 'stop' }, interactions: [] },
    ])

    await expect(collect(fixtureAdapter(command, {
      CURSOR_FIXTURE_FRAMES: JSON.stringify([1]),
    }), request())).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' })

    await expect(collect(fixtureAdapter(command, {
      CURSOR_FIXTURE_FRAMES: JSON.stringify([{ type: 'result', subtype: 'success', is_error: false }]),
    }), request())).resolves.toEqual([{ type: 'finish', reason: { kind: 'stop' }, interactions: [] }])
  })

  it('reports protocol and process failures with stable codes', async () => {
    const { command } = await fixture()
    context = new Context()
    await context.plugin(LocalSubprocessRuntime)
    const cases: Array<{ env: Record<string, string>; code: string }> = [
      { env: { CURSOR_FIXTURE_FRAMES: 'malformed' }, code: 'MALFORMED_RESPONSE' },
      { env: { CURSOR_FIXTURE_FRAMES: '[]' }, code: 'STREAM_CLOSED' },
      { env: { CURSOR_FIXTURE_FRAMES: '[]', CURSOR_FIXTURE_EXIT_CODE: '2', CURSOR_FIXTURE_STDERR: 'login required' }, code: 'AUTH' },
      { env: { CURSOR_FIXTURE_FRAMES: '[]', CURSOR_FIXTURE_EXIT_CODE: '2' }, code: 'CLI_ERROR' },
      { env: { CURSOR_FIXTURE_FRAMES: JSON.stringify([{ type: 'result', subtype: 'error', is_error: true, result: '' }]) }, code: 'CLI_ERROR' },
    ]
    for (const { env, code } of cases) {
      await expect(collect(fixtureAdapter(command, env), request())).rejects.toMatchObject({ code })
    }
  })

  it('reports caller abort separately from the request deadline', async () => {
    const { command } = await fixture()
    context = new Context()
    await context.plugin(LocalSubprocessRuntime)
    const controller = new AbortController()
    const aborted = collect(fixtureAdapter(command, {
      CURSOR_FIXTURE_FRAMES: '[]',
      CURSOR_FIXTURE_DELAY_MS: '10000',
    }), request({ signal: controller.signal }))
    controller.abort()
    await expect(aborted).rejects.toMatchObject({ code: 'ABORTED' })

    const timed = new CursorCliAdapter(context.subprocess, resolveConfig({
      command,
      timeoutMs: 1,
      env: { CURSOR_FIXTURE_FRAMES: '[]', CURSOR_FIXTURE_DELAY_MS: '10000' },
    }).connection)
    await expect(collect(timed, request())).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('falls back when native model discovery fails and resolves configured metadata', async () => {
    const { command } = await fixture()
    context = new Context()
    await context.plugin(LocalSubprocessRuntime)
    const adapter = fixtureAdapter(command, { CURSOR_FIXTURE_MODE: 'model-error' }, [{
      id: 'configured',
      description: 'Configured model',
      contextWindow: 1234,
    }])
    await expect(adapter.listModels('cursor-cli')).resolves.toEqual([{
      provider: 'cursor-cli',
      id: 'configured',
      name: 'configured',
      description: 'Configured model',
      inputModalities: ['text'],
    }])
    await expect(adapter.resolveModel('cursor-cli', 'configured')).resolves.toEqual({
      provider: 'cursor-cli',
      id: 'configured',
      name: 'configured',
      description: 'Configured model',
      inputModalities: ['text'],
      context: { contextWindow: 1234 },
    })
    await expect(adapter.resolveModel('cursor-cli', 'unknown')).resolves.toEqual({
      provider: 'cursor-cli',
      id: 'unknown',
      name: 'unknown',
      inputModalities: ['text'],
    })
    expect(adapter.providerInfo('custom')).toEqual({ id: 'custom', name: 'Cursor CLI' })
    expect(adapter.providerRetryPolicy('custom')).toEqual(resolveConfig({}).connection.retryPolicy)

    const silentFailure = fixtureAdapter(command, {
      CURSOR_FIXTURE_MODE: 'model-error',
      CURSOR_FIXTURE_STDERR: '',
    }, [{ id: 'fallback' }])
    await expect(silentFailure.listModels('cursor-cli')).resolves.toHaveLength(1)

    const duplicate = fixtureAdapter(command, {}, [{ id: 'model-one', name: 'Configured duplicate' }])
    await expect(duplicate.listModels('cursor-cli')).resolves.toEqual(expect.arrayContaining([{
      provider: 'cursor-cli',
      id: 'model-one',
      name: 'Model One',
      inputModalities: ['text'],
    }]))
  })

  it('loads and unloads the route through a real Loader composition', async () => {
    const { command } = await fixture()
    const configPath = join(root!, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: '@deepseek-ai/dsh-subprocess-local'",
      "- name: '@deepseek-ai/dsh-llm-cursor-cli'",
      '  config:',
      `    command: ${JSON.stringify(command)}`,
      '',
    ].join('\n'))
    context = new Context()
    context.baseUrl = pathToFileURL(root!).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-llm', LlmRuntime],
      ['@deepseek-ai/dsh-subprocess-local', LocalSubprocessRuntime],
      ['@deepseek-ai/dsh-llm-cursor-cli', CursorRuntime],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    expect(context.llm.listProviders()).toEqual([{ id: 'cursor-cli', name: 'Cursor CLI' }])
    expect(context.llm.listConfigurableProviders()).toEqual([{
      provider: 'cursor-cli',
      displayName: 'Cursor CLI',
      settingsNs: '',
      settingsPath: [],
      localCommand: command,
      defaultModel: 'auto',
    }])

    const llm = context.llm
    await context.fiber.dispose()
    expect(llm.listProviders()).toEqual([])
    expect(llm.listConfigurableProviders()).toEqual([])
    context = undefined
  })

  it('keeps the provider directory dormant when the executable is missing', async () => {
    context = new Context()
    await context.plugin(LlmRuntime)
    await context.plugin(LocalSubprocessRuntime)
    await CursorRuntime.apply(context, { command: 'dsh-cursor-command-that-does-not-exist' })
    expect(context.llm.listProviders()).toEqual([])
    expect(context.llm.listConfigurableProviders()).toHaveLength(1)

    await context.fiber.dispose()
    context = new Context()
    await context.plugin(LlmRuntime)
    await context.plugin(LocalSubprocessRuntime)
    await CursorRuntime.apply(context, { command: '/dsh-cursor-command-that-does-not-exist' })
    expect(context.llm.listProviders()).toEqual([])

    await context.fiber.dispose()
    context = new Context()
    await context.plugin(LlmRuntime)
    await context.plugin(LocalSubprocessRuntime)
    vi.spyOn(context.subprocess, 'resolveExecutable').mockRejectedValueOnce('unexpected lookup failure')
    await expect(CursorRuntime.apply(context, {})).rejects.toBe('unexpected lookup failure')

    vi.spyOn(context.subprocess, 'resolveExecutable').mockRejectedValueOnce(new Error('unexpected lookup failure'))
    await expect(CursorRuntime.apply(context, { provider: 'cursor-cli-second' }))
      .rejects.toThrow('unexpected lookup failure')
  })
})
