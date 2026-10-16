/**
 * Cursor CLI local model runtime. Each request starts a fresh
 * `cursor-agent --print` process, replays the Harness conversation through
 * stdin, and maps stream-json output plus native Cursor tool activity onto
 * the provider-neutral LLM stream.
 * @module @deepseek-ai/dsh-llm-cursor-cli
 */

import { createInterface } from 'node:readline'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  LlmAdapter,
  LlmError,
  resolveRetryPolicy,
  RetryPolicySchema,
} from '@deepseek-ai/dsh-llm'
import type {
  AgentInteraction,
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  Message,
  ResolvedRetryPolicy,
  RetryPolicyConfig,
  StreamChunk,
  TokenUsage,
} from '@deepseek-ai/dsh-llm'
import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { deadline, MAX_TIMER_DELAY_MS, timeoutOf } from '@deepseek-ai/dsh-timeout'

/** Default provider route registered for Cursor CLI. */
export const DEFAULT_PROVIDER = 'cursor-cli'
/** Default Cursor CLI executable. */
export const DEFAULT_COMMAND = 'cursor-agent'
/** Default hard deadline for one Cursor request: fifteen minutes. */
export const DEFAULT_TIMEOUT_MS = 900_000
/** Default catalog probe deadline. */
export const DEFAULT_CATALOG_TIMEOUT_MS = 30_000
/** Process-tree termination grace. */
export const PROCESS_GRACE_MS = 3_000

/** One configured fallback model advertised when native discovery is unavailable. */
export interface CursorCliCatalogModel {
  /** Model id accepted by Cursor's `--model` option. */
  id: string
  /** Selector label; defaults to {@link id}. */
  name?: string
  /** Optional selector detail. */
  description?: string
  /** Known combined request and response capacity. */
  contextWindow?: number
}

/** Cursor CLI plugin configuration. */
export interface Config {
  /** Executable name or absolute path. */
  command?: string
  /** Provider route registered when the executable is present. */
  provider?: string
  /** Hard deadline for one request. */
  timeoutMs?: number
  /** Hard deadline for one native model-catalog probe. */
  catalogTimeoutMs?: number
  /** Operator arguments appended before adapter-owned protocol flags. */
  extraArgs?: string[]
  /** Explicit child environment layered after the shared credential scrub. */
  env?: Record<string, string>
  /** Fallback advisory catalog merged after models reported by the CLI. */
  models?: CursorCliCatalogModel[]
  /** Provider-owned model-request retry policy. */
  retryPolicy?: RetryPolicyConfig
}

const catalogModel: z<CursorCliCatalogModel> = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
})

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  command: z.string().default(DEFAULT_COMMAND),
  provider: z.string().default(DEFAULT_PROVIDER),
  timeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_TIMEOUT_MS),
  catalogTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_CATALOG_TIMEOUT_MS),
  extraArgs: z.array(z.string()).default([]),
  env: z.dict(z.string()).default({}),
  models: z.array(catalogModel).default([{ id: 'auto', name: 'Auto' }]),
  retryPolicy: RetryPolicySchema,
})

/** Validated connection facts captured by one adapter instance. */
export interface CursorCliConnectionOptions {
  /** Resolved executable path. */
  command: string
  /** Operator arguments safe to combine with the owned protocol flags. */
  extraArgs: readonly string[]
  /** Explicit environment forwarded to the child. */
  env: Readonly<Record<string, string>>
  /** Fallback advisory catalog. */
  models: readonly CursorCliCatalogModel[]
  /** Request deadline. */
  timeoutMs: number
  /** Native model-catalog probe deadline. */
  catalogTimeoutMs: number
  /** Provider-owned retry policy. */
  retryPolicy: ResolvedRetryPolicy
}

/** Complete plugin resolution. */
export interface CursorCliResolution {
  /** Provider route. */
  provider: string
  /** Executable configured before presence resolution. */
  localCommand: string
  /** Connection facts except for executable canonicalization. */
  connection: CursorCliConnectionOptions
}

const OWNED_FLAGS = new Set([
  '-p', '--print', '--output-format', '--stream-partial-output', '--model',
  '-m', '--mode', '--plan', '--sandbox', '-f', '--force', '--yolo', '--resume', '--continue',
  '--workspace', '--add-dir', '-w', '--worktree', '--worktree-base', '--skip-worktree-setup',
  '--list-models', '--auto-review', '-a', '--api-key', '--trust', '--approve-mcps',
])

/**
 * Validate and default one plugin configuration.
 * @param config - raw Cordis plugin configuration.
 * @returns detached provider and connection facts.
 */
export function resolveConfig(config: Config): CursorCliResolution {
  const command = config.command ?? DEFAULT_COMMAND
  const provider = config.provider ?? DEFAULT_PROVIDER
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const catalogTimeoutMs = config.catalogTimeoutMs ?? DEFAULT_CATALOG_TIMEOUT_MS
  if (command.length === 0) throw new Error('llm-cursor-cli: command must be non-empty')
  if (!isAbsolute(command) && (command.includes('/') || command.includes('\\'))) {
    throw new Error('llm-cursor-cli: command must be an absolute path or bare executable name')
  }
  if (provider.length === 0) throw new Error('llm-cursor-cli: provider must be non-empty')
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`llm-cursor-cli: timeoutMs must be positive and no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  if (!Number.isFinite(catalogTimeoutMs) || catalogTimeoutMs <= 0 || catalogTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`llm-cursor-cli: catalogTimeoutMs must be positive and no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  const extraArgs = [...(config.extraArgs ?? [])]
  for (const argument of extraArgs) {
    const flag = argument.includes('=') ? argument.slice(0, argument.indexOf('=')) : argument
    if (OWNED_FLAGS.has(flag)) throw new Error(`llm-cursor-cli: extraArgs must not override ${flag}`)
  }
  const models = (config.models ?? [{ id: 'auto', name: 'Auto' }]).map((model) => {
    if (model.id.length === 0) throw new Error('llm-cursor-cli: model ids must be non-empty')
    if (model.name !== undefined && model.name.length === 0) {
      throw new Error(`llm-cursor-cli: model ${JSON.stringify(model.id)} has an empty name`)
    }
    return { ...model }
  })
  if (new Set(models.map(model => model.id)).size !== models.length) {
    throw new Error('llm-cursor-cli: model ids must be unique')
  }
  return {
    provider,
    localCommand: command,
    connection: {
      command,
      extraArgs,
      env: { ...(config.env ?? {}) },
      models,
      timeoutMs,
      catalogTimeoutMs,
      retryPolicy: resolveRetryPolicy(config.retryPolicy, 'llm-cursor-cli.retryPolicy'),
    },
  }
}

function blockText(message: Message): string {
  const parts: string[] = []
  for (const block of message.content) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        parts.push(block.text)
        break
      case 'tool-call':
        parts.push(`[tool call ${block.name} ${block.id}]\n${block.arguments}`)
        break
      case 'tool-result':
        parts.push(`[tool result ${block.toolCallId}${block.isError ? ' error' : ''}]\n${block.content.map(item => item.type === 'text' ? item.text : `[${item.type}]`).join('\n')}`)
        break
      case 'image':
        parts.push('[image attachment unavailable to Cursor CLI]')
        break
      default:
        parts.push(`[unsupported content block ${(block as { type: string }).type}]`)
    }
  }
  return parts.join('\n')
}

/**
 * Fold durable Harness history into Cursor's one-shot stdin prompt.
 * @param options - assembled model request.
 * @returns deterministic role-delimited prompt text.
 */
export function foldCursorPrompt(options: GenerateOptions): string {
  const sections: string[] = []
  if (options.system !== undefined && options.system.length > 0) sections.push(`[system]\n${options.system}`)
  for (const message of options.messages) sections.push(`[${message.role}]\n${blockText(message)}`)
  return sections.join('\n\n')
}

/**
 * Map a Cursor CLI diagnostic to the shared failure taxonomy.
 * @param text - CLI result or stderr diagnostic.
 * @returns stable provider-neutral failure code.
 */
export function classifyCursorFailure(text: string): string {
  const value = text.toLowerCase()
  if (/unauth|log[ -]?in|401|403|api key/.test(value)) return 'AUTH'
  if (/rate.?limit|429|too many requests/.test(value)) return 'RATE_LIMIT'
  if (/not found|unknown model/.test(value)) return 'NOT_FOUND'
  if (/invalid|bad request|400/.test(value)) return 'INVALID_REQUEST'
  if (/timed? out|timeout/.test(value)) return 'TIMEOUT'
  if (/server error|internal error|50[0-9]/.test(value)) return 'SERVER'
  return 'CLI_ERROR'
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
}

/**
 * Parse the human-readable `cursor-agent models` listing.
 * @param output - complete stdout from the native catalog command.
 * @returns models in native display order.
 */
export function parseCursorModels(output: string): Array<{ id: string; name: string }> {
  const models: Array<{ id: string; name: string }> = []
  for (const raw of stripAnsi(output).split(/\r?\n/)) {
    const line = raw.trim().replace(/\s+\((?:current|default)(?:\/default)?\)$/, '')
    if (line.length === 0 || line === 'Available models' || line.startsWith('Tip:')) continue
    const separator = line.indexOf(' - ')
    if (separator <= 0) continue
    const id = line.slice(0, separator).trim()
    const name = line.slice(separator + 3).trim()
    if (id.length > 0 && name.length > 0 && !models.some(model => model.id === id)) models.push({ id, name })
  }
  return models
}

interface JsonRecord { [key: string]: unknown }

function record(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined
}

function textAt(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberAt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

interface CursorToolView {
  name: string
  payload: JsonRecord
}

function cursorToolView(tool: JsonRecord): CursorToolView {
  const explicitName = textAt(tool.name) ?? textAt(tool.type)
  if (explicitName !== undefined) return { name: explicitName, payload: tool }
  for (const [name, value] of Object.entries(tool)) {
    const payload = record(value)
    if (payload !== undefined) return { name, payload }
  }
  return { name: 'Cursor tool', payload: tool }
}

function interactionKind(tool: CursorToolView): AgentInteraction['kind'] {
  const discriminator = tool.name.toLowerCase()
  if (/shell|command|terminal/.test(discriminator)) return 'command'
  if (/write|edit|delete|patch/.test(discriminator)) return 'file-change'
  if (/web|browser/.test(discriminator)) return 'web-search'
  if (/agent|subagent/.test(discriminator)) return 'agent'
  return 'tool'
}

function interactionTitle(tool: CursorToolView): string {
  const args = record(tool.payload.args) ?? record(tool.payload.arguments)
  return textAt(args?.command)
    ?? textAt(args?.path)
    ?? textAt(args?.filePath)
    ?? textAt(args?.query)
    ?? textAt(args?.url)
    ?? tool.name
}

function interactionDetail(tool: JsonRecord): string | undefined {
  try {
    return JSON.stringify(tool)
  /* v8 ignore next -- tool payloads arrive from JSON.parse and therefore cannot be cyclic. */
  } catch (_unserializableCursorToolPayload) {
    /* v8 ignore next -- defensive for a future non-JSON protocol source. */
    return undefined
  }
}

function isFailedTool(tool: CursorToolView): boolean {
  const result = record(tool.payload.result)
  const status = `${textAt(tool.payload.status) ?? ''} ${textAt(tool.payload.result) ?? ''} ${result === undefined ? '' : Object.keys(result).join(' ')}`.toLowerCase()
  return /fail|error|reject|cancel/.test(status)
    || tool.payload.is_error === true
    || result?.error !== undefined
}

function cursorArgs(config: CursorCliConnectionOptions, options: GenerateOptions): string[] {
  const args = [
    ...config.extraArgs,
    '-p',
    '--output-format', 'stream-json',
    '--stream-partial-output',
    '--model', options.model,
  ]
  if (options.purpose !== undefined) {
    args.push('--mode', 'ask', '--sandbox', 'enabled', '--trust')
    return args
  }
  switch (options.sandboxMode) {
    case 'read-only':
      args.push('--mode', 'ask', '--sandbox', 'enabled', '--trust')
      break
    case 'danger-full-access':
      args.push('--force', '--sandbox', 'disabled')
      break
    case 'workspace-write':
      args.push('--force', '--sandbox', 'enabled')
      break
    case undefined:
      args.push('--mode', 'ask', '--sandbox', 'enabled', '--trust')
      break
  }
  return args
}

function unsupportedOption(options: GenerateOptions): string | undefined {
  if (options.temperature !== undefined) return 'temperature'
  if (options.maxTokens !== undefined) return 'maxTokens'
  if (options.stop !== undefined) return 'stop'
  if (options.reasoningEffort !== undefined) return 'reasoningEffort'
  if (options.messages.some(message => message.content.some(block =>
    block.type === 'image'
    || (block.type === 'tool-result' && block.content.some(item => item.type === 'image'))))) return 'image content'
  return undefined
}

async function settleProcess(child: SubprocessHandle): Promise<void> {
  child.terminate()
  /* v8 ignore next -- the child already produced a protocol stream; spawn-level rejection cannot follow. */
  await child.done.catch(() => {})
  await child.waitForExit()
}

/** Cursor CLI adapter backed by the shared managed-subprocess service. */
export class CursorCliAdapter extends LlmAdapter {
  /** @param subprocess - process capability owning child lifetime and environment scrubbing. @param config - resolved provider facts. */
  constructor(
    private readonly subprocess: SubprocessRuntime,
    private readonly config: CursorCliConnectionOptions,
  ) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Cursor CLI' }
  }

  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy {
    return this.config.retryPolicy
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const native = await this.nativeModels().catch(() => [])
    const merged = new Map<string, CursorCliCatalogModel>(native.map(model => [model.id, model]))
    for (const model of this.config.models) if (!merged.has(model.id)) merged.set(model.id, model)
    return [...merged.values()].map(model => ({
      provider,
      id: model.id,
      name: model.name ?? model.id,
      ...(model.description === undefined ? {} : { description: model.description }),
      inputModalities: ['text'],
    }))
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const configured = this.config.models.find(entry => entry.id === model)
    return Promise.resolve({
      provider,
      id: model,
      name: configured?.name ?? model,
      ...(configured?.description === undefined ? {} : { description: configured.description }),
      inputModalities: ['text'],
      ...(configured?.contextWindow === undefined ? {} : { context: { contextWindow: configured.contextWindow } }),
    })
  }

  private async nativeModels(): Promise<CursorCliCatalogModel[]> {
    using requestDeadline = deadline(undefined, this.config.catalogTimeoutMs, 'CURSOR_CATALOG_TIMEOUT')
    const child = this.subprocess.spawn({
      argv: [this.config.command, ...this.config.extraArgs, 'models'],
      cwd: process.cwd(),
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 1_048_576 },
        stderr: { maxBytes: 65_536 },
      },
      graceMs: PROCESS_GRACE_MS,
      signal: requestDeadline.signal,
      env: this.config.env,
    })
    const outcome = await child.done
    await child.waitForExit()
    /* v8 ignore next -- collect-mode stdout always exposes a reader by the subprocess contract. */
    const stdout = child.collected.stdout?.readFrom(0).text ?? ''
    if (outcome.exitCode !== 0) {
      /* v8 ignore next -- collect-mode stderr always exposes a reader by the subprocess contract. */
      const stderr = child.collected.stderr?.readFrom(0).text ?? ''
      throw new LlmError(stderr.trim() || 'Cursor model discovery failed', classifyCursorFailure(stderr))
    }
    return parseCursorModels(stdout)
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const unsupported = unsupportedOption(options)
    if (unsupported !== undefined) {
      throw new LlmError(`Cursor CLI does not support Harness ${unsupported}`, 'UNSUPPORTED_OPTION')
    }
    using requestDeadline = deadline(options.signal, this.config.timeoutMs, 'CURSOR_TIMEOUT')
    const child = this.subprocess.spawn({
      argv: [this.config.command, ...cursorArgs(this.config, options)],
      cwd: options.cwd ?? process.cwd(),
      stdio: {
        stdin: { data: foldCursorPrompt(options) },
        stdout: 'pipe',
        stderr: { maxBytes: 65_536 },
      },
      graceMs: PROCESS_GRACE_MS,
      signal: requestDeadline.signal,
      env: this.config.env,
    })
    const stdout = child.stdout
    /* v8 ignore start -- pipe-mode stdout always exposes a stream by the subprocess contract. */
    if (stdout === undefined) {
      await settleProcess(child)
      throw new LlmError('Cursor CLI stdout pipe is unavailable', 'CLI_PROTOCOL')
    }
    /* v8 ignore stop */

    let terminal = false
    let resultText = ''
    let assistantText = ''
    let reasoningText = ''
    let usage: TokenUsage | undefined
    const interactions = new Map<string, AgentInteraction>()

    try {
      const lines = createInterface({ input: stdout, crlfDelay: Infinity })
      for await (const line of lines) {
        if (line.trim().length === 0) continue
        let event: JsonRecord
        try {
          const parsed = record(JSON.parse(line))
          if (parsed === undefined) throw new Error('frame is not an object')
          event = parsed
        } catch (cause) {
          throw new LlmError('Cursor CLI emitted malformed stream-json', 'MALFORMED_RESPONSE', { cause })
        }
        const type = textAt(event.type)
        if (type === 'assistant') {
          const content = record(event.message)?.content
          if (!Array.isArray(content)) continue
          for (const item of content) {
            const part = record(item)
            if (part?.type !== 'text' || typeof part.text !== 'string' || part.text.length === 0) continue
            if (part.text !== assistantText) assistantText += part.text
          }
          continue
        }
        if (type === 'thinking' && event.subtype === 'delta' && typeof event.text === 'string' && event.text.length > 0) {
          reasoningText += event.text
          continue
        }
        if (type === 'retry' && event.subtype === 'starting') {
          assistantText = ''
          reasoningText = ''
          continue
        }
        if (type === 'tool_call') {
          const id = textAt(event.call_id)
          const rawTool = record(event.tool_call)
          if (id === undefined || rawTool === undefined) continue
          const tool = cursorToolView(rawTool)
          const previous = interactions.get(id)
          const subtype = textAt(event.subtype) ?? ''
          const settled = subtype === 'completed' || /fail|error|reject|cancel/.test(subtype)
          const failed = /fail|error|reject|cancel/.test(subtype) || isFailedTool(tool)
          const detail = interactionDetail(rawTool)
          interactions.set(id, {
            id,
            kind: previous?.kind ?? interactionKind(tool),
            title: previous?.title ?? interactionTitle(tool),
            status: settled ? (failed ? 'failed' : 'completed') : 'started',
            /* v8 ignore next -- JSON-parsed tool payloads are always serializable. */
            ...(detail === undefined ? {} : { detail }),
          })
          continue
        }
        if (type === 'result') {
          terminal = true
          resultText = textAt(event.result) ?? ''
          const rawUsage = record(event.usage)
          if (rawUsage !== undefined) {
            const cacheReadTokens = numberAt(rawUsage.cacheReadTokens)
            const cacheWriteTokens = numberAt(rawUsage.cacheWriteTokens)
            const reasoningTokens = numberAt(rawUsage.reasoningTokens)
            usage = {
              inputTokens: numberAt(rawUsage.inputTokens) ?? 0,
              outputTokens: numberAt(rawUsage.outputTokens) ?? 0,
              ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
              ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
              ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
            }
          }
          if (event.is_error === true || event.subtype !== 'success') {
            throw new LlmError(resultText || 'Cursor CLI returned an error result', classifyCursorFailure(resultText))
          }
        }
      }

      const outcome = await child.done
      await child.waitForExit()
      if (requestDeadline.signal.aborted) {
        const timeout = timeoutOf(requestDeadline.signal, 'CURSOR_TIMEOUT')
        throw new LlmError(timeout === undefined ? 'Cursor CLI request was aborted' : timeout.message, timeout === undefined ? 'ABORTED' : 'TIMEOUT')
      }
      if (outcome.exitCode !== 0) {
        /* v8 ignore next -- collect-mode stderr always exposes a reader by the subprocess contract. */
        const stderr = child.collected.stderr?.readFrom(0).text.trim() ?? ''
        /* v8 ignore next -- a non-zero normal exit has a numeric code; signal exits are paired with request abort. */
        throw new LlmError(stderr || `Cursor CLI exited with code ${outcome.exitCode ?? 'signal'}`, classifyCursorFailure(stderr))
      }
      if (!terminal) throw new LlmError('Cursor CLI exited without a result frame', 'STREAM_CLOSED')
      let index = 0
      if (reasoningText.length > 0) {
        yield { type: 'block-start', index, blockType: 'reasoning' }
        yield { type: 'reasoning-delta', index, text: reasoningText }
        yield { type: 'block-end', index, block: { type: 'reasoning', text: reasoningText } }
        index += 1
      }
      const finalText = resultText.length > 0 ? resultText : assistantText
      if (finalText.length > 0) {
        yield { type: 'block-start', index, blockType: 'text' }
        yield { type: 'text-delta', index, text: finalText }
        yield { type: 'block-end', index, block: { type: 'text', text: finalText } }
      }
      if (usage !== undefined) yield { type: 'usage', usage }
      yield { type: 'finish', reason: { kind: 'stop' }, interactions: [...interactions.values()] }
    } catch (cause) {
      await settleProcess(child)
      if (requestDeadline.signal.aborted) {
        const timeout = timeoutOf(requestDeadline.signal, 'CURSOR_TIMEOUT')
        throw new LlmError(timeout === undefined ? 'Cursor CLI request was aborted' : timeout.message, timeout === undefined ? 'ABORTED' : 'TIMEOUT', { cause })
      }
      throw cause
    }
  }
}

/** Cordis plugin name. */
export const name = 'llm-cursor-cli'
/** Required services. */
export const inject = ['llm', 'subprocess']

/**
 * Declare Cursor in the runtime directory and register its adapter when the
 * configured executable exists in the subprocess provider's execution world.
 * @param ctx - Cordis context carrying LLM and subprocess services.
 * @param config - plugin configuration.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved = resolveConfig(config)
  ctx.llm.registerConfigurableProviders([{
    provider: resolved.provider,
    displayName: 'Cursor CLI',
    settingsNs: '',
    settingsPath: [],
    localCommand: resolved.localCommand,
  }])
  let command: string
  try {
    command = await ctx.subprocess.resolveExecutable(
      resolved.localCommand,
      resolved.connection.env,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('was not found on PATH') || message.includes('is not an executable file')) return
    throw error
  }
  ctx.llm.registerAdapter(
    [resolved.provider],
    new CursorCliAdapter(ctx.subprocess, { ...resolved.connection, command }),
  )
}
