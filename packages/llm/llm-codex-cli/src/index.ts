/** Installed Codex app-server runtime over the shared line-delimited JSON-RPC transport. */
import type { Context } from '@deepseek-ai/cordis'
import schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { LlmAdapter, LlmError, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, AgentInteraction, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import { deadline, MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Native process and catalog limits owned by the deployment. */
export interface Config {
  /** Installed executable name or absolute path. */
  command: string
  /** Local provider route. */
  provider: string
  /** Maximum duration of one native turn, in milliseconds. */
  timeoutMs: number
  /** Maximum duration of a model catalog request, in milliseconds. */
  catalogTimeoutMs: number
  /** Reuse a successful native catalog for this duration, in milliseconds. */
  catalogCacheMs: number
  /** Process-tree termination grace, in milliseconds. */
  graceMs: number
  /** Retained native stderr diagnostic bytes per process. */
  diagnosticMaxBytes: number
}
/** Validated process settings. */
export const Config: schema<Config> = schema.object({
  command: schema.string().default('codex'),
  provider: schema.string().default('codex-cli'),
  timeoutMs: schema.number().min(1).max(MAX_TIMER_DELAY_MS).default(900_000),
  catalogTimeoutMs: schema.number().min(1).max(MAX_TIMER_DELAY_MS).default(30_000),
  catalogCacheMs: schema.number().min(0).max(MAX_TIMER_DELAY_MS).default(60_000),
  graceMs: schema.number().min(1).max(MAX_TIMER_DELAY_MS).default(3_000),
  diagnosticMaxBytes: schema.number().step(1).min(1).default(65_536),
})
const nativeModel = z.object({
  model: z.string().min(1), displayName: z.string(), description: z.string().optional(),
  defaultReasoningEffort: z.string().optional(),
  supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string(), description: z.string() })).optional(),
})
const catalogSchema = z.object({ data: z.array(nativeModel), nextCursor: z.string().nullable().optional() })

function prompt(options: GenerateOptions): string {
  const sections = options.system === undefined ? [] : [`[system]\n${options.system}`]
  for (const message of options.messages) {
    sections.push(`[${message.role}]\n${message.content.map((block) => {
      switch (block.type) {
        case 'text': case 'reasoning': return block.text
        case 'tool-result': return JSON.stringify(block.content)
        case 'tool-call': return `${block.name} ${block.arguments}`
        case 'image': throw new LlmError('Codex local runtime currently accepts text input only.', 'UNSUPPORTED_OPTION')
        /* v8 ignore next -- future merged content variants require explicit native translation. */
        default: throw new LlmError('Unsupported content in the Codex local runtime.', 'UNSUPPORTED_OPTION')
      }
    }).join('\n')}`)
  }
  return sections.join('\n\n')
}

/** Ephemeral native threads inherit the user's Codex authentication and integrations. */
export class CodexCliAdapter extends LlmAdapter {
  private cached: { time: number; models: LlmResolvedModelInfo[] } | undefined
  private pending: Promise<LlmResolvedModelInfo[]> | undefined
  /**
   * @param subprocess - process-tree owner in the current execution world.
   * @param config - validated process limits and local route settings.
   */
  constructor(private readonly subprocess: SubprocessRuntime, private readonly config: Config) { super() }

  override providerInfo(provider: string) { return { id: provider, name: 'Codex CLI' } }

  private async connection<T>(cwd: string, signal: AbortSignal, run: (wire: JsonRpcLineTransport) => Promise<T>): Promise<T> {
    const child = this.subprocess.spawn({ argv: [this.config.command, 'app-server', '--listen', 'stdio://'], cwd,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: this.config.diagnosticMaxBytes } }, signal, graceMs: this.config.graceMs,
    })
    const wire = new JsonRpcLineTransport(child.stdout as NonNullable<typeof child.stdout>, child.stdin as NonNullable<typeof child.stdin>)
    wire.onRequest(method => Promise.reject(new LlmError(`Codex requested unsupported host interaction: ${method}`, 'INTERACTION_REQUIRED')))
    wire.start()
    const exited = child.done.then((outcome) => {
      const diagnostic = child.collected.stderr?.readFrom(0).text.trim()
      throw new LlmError(diagnostic || `Codex exited before completing the request (${outcome.exitCode}).`, 'CLI_ERROR')
    })
    try {
      const operation = (async () => {
        await wire.request('initialize', { clientInfo: { name: 'deepseek_harness', title: 'DeepSeek Harness', version: '0.1.0' }, capabilities: { experimentalApi: true } }, signal)
        wire.notify('initialized')
        return run(wire)
      })()
      return await Promise.race([operation, exited])
    } catch (error) {
      child.terminate()
      await child.done.catch(() => { /* A failed spawn is already represented by the active operation. */ })
      const diagnostic = child.collected.stderr?.readFrom(0).text.trim()
      if (signal.aborted) throw new LlmError('Codex request was cancelled or timed out.', 'ABORTED')
      if (diagnostic) throw new LlmError(diagnostic, 'CLI_ERROR')
      throw error
    } finally {
      wire.close(); child.terminate()
      await child.done.catch(() => { /* Spawn failures are reported by the active request. */ })
      await child.waitForExit()
    }
  }

  override async listModels(provider: string): Promise<LlmModelInfo[]> {
    return (await this.models()).map(model => ({ ...model, provider }))
  }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const listed = (await this.models()).find(entry => entry.id === model)
    return { ...listed, provider, id: model, name: listed?.name ?? (model === 'default' ? 'Codex default' : model) }
  }

  private async models(): Promise<LlmResolvedModelInfo[]> {
    if (this.cached !== undefined && Date.now() - this.cached.time < this.config.catalogCacheMs) return this.cached.models
    if (this.pending !== undefined) return this.pending
    this.pending = (async () => {
      using timeout = deadline(undefined, this.config.catalogTimeoutMs, 'CODEX_CATALOG_TIMEOUT')
      const models = await this.connection(process.cwd(), timeout.signal, async (wire) => {
        const result: LlmResolvedModelInfo[] = []
        let cursor: string | null | undefined
        do {
          const page = catalogSchema.parse(await wire.request('model/list', { cursor: cursor ?? null, limit: 100 }, timeout.signal))
          for (const model of page.data) result.push({ provider: this.config.provider, id: model.model, name: model.displayName,
            ...(model.description === undefined ? {} : { description: model.description }),
            ...(model.supportedReasoningEfforts === undefined ? {} : { reasoning: {
              efforts: model.supportedReasoningEfforts.map(effort => ({
                id: ReasoningEffortId(effort.reasoningEffort), name: effort.reasoningEffort, description: effort.description,
              })),
              ...(model.defaultReasoningEffort === undefined ? {} : { defaultEffort: ReasoningEffortId(model.defaultReasoningEffort) }),
            } }),
          })
          cursor = page.nextCursor
        } while (cursor)
        return result
      })
      this.cached = { time: Date.now(), models }
      return models
    })()
    try { return await this.pending }
    finally { this.pending = undefined }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.temperature !== undefined || options.maxTokens !== undefined || options.stop !== undefined) {
      throw new LlmError('Codex native turns do not support Harness sampling or token-limit overrides.', 'UNSUPPORTED_OPTION')
    }
    const text = prompt(options)
    const lifetime = new AbortController()
    const upstream = options.signal === undefined ? lifetime.signal : AbortSignal.any([options.signal, lifetime.signal])
    using timeout = deadline(upstream, this.config.timeoutMs, 'CODEX_TURN_TIMEOUT')
    const completed = Promise.withResolvers<void>()
    void completed.promise.catch(() => { /* Notifications may fail before turn/start acknowledges. */ })
    let output!: ReadableStreamDefaultController<StreamChunk>
    const chunks = new ReadableStream<StreamChunk>({ start(controller) { output = controller } })
    const interactions = new Map<string, AgentInteraction>()
    let answer = ''
    let usage: TokenUsage | undefined
    let started = false
    const run = this.connection(options.cwd ?? process.cwd(), timeout.signal, async (wire) => {
      wire.onNotification((method, params) => {
        try {
          if (method === 'item/agentMessage/delta') {
            const delta = z.object({ delta: z.string() }).parse(params).delta
            if (!started) { output.enqueue({ type: 'block-start', index: 0, blockType: 'text' }); started = true }
            answer += delta; output.enqueue({ type: 'text-delta', index: 0, text: delta })
          } else if (method === 'item/started' || method === 'item/completed') {
            const item = z.object({ item: z.looseObject({ id: z.string(), type: z.string() }) }).parse(params).item
            if (item.type === 'agentMessage' && method === 'item/completed' && !started && typeof item.text === 'string') {
              answer = item.text; started = true
              output.enqueue({ type: 'block-start', index: 0, blockType: 'text' })
              output.enqueue({ type: 'text-delta', index: 0, text: answer })
            }
            if (item.type !== 'reasoning' && item.type !== 'agentMessage') interactions.set(item.id, {
              id: item.id, kind: item.type === 'commandExecution' ? 'command' : item.type === 'fileChange' ? 'file-change' : 'tool',
              title: item.type, status: method === 'item/started' ? 'started' : 'completed', detail: JSON.stringify(item),
            })
          } else if (method === 'thread/tokenUsage/updated') {
            const nativeUsage = z.object({ tokenUsage: z.object({ last: z.object({
              inputTokens: z.number(), cachedInputTokens: z.number(), outputTokens: z.number(),
            }) }) }).parse(params).tokenUsage.last
            usage = { inputTokens: nativeUsage.inputTokens - nativeUsage.cachedInputTokens,
              cacheReadTokens: nativeUsage.cachedInputTokens, outputTokens: nativeUsage.outputTokens }
          } else if (method === 'turn/completed') {
            const turn = z.object({ turn: z.object({
              status: z.string(), error: z.object({ message: z.string() }).nullable().optional(),
            }) }).parse(params).turn
            if (turn.status === 'completed') completed.resolve()
            else completed.reject(new LlmError(turn.error?.message ?? `Codex turn ${turn.status}`, 'CLI_ERROR'))
          }
        } catch (error) { completed.reject(error) }
      })
      const thread = z.object({ thread: z.object({ id: z.string() }) }).parse(await wire.request('thread/start', {
        cwd: options.cwd ?? process.cwd(), ephemeral: true, approvalPolicy: 'never',
        sandbox: options.purpose === undefined ? options.sandboxMode ?? 'read-only' : 'read-only',
        model: options.model === 'default' ? null : options.model,
      }, timeout.signal))
      await wire.request('turn/start', { threadId: thread.thread.id, input: [{ type: 'text', text }],
        ...(options.reasoningEffort === undefined ? {} : { effort: options.reasoningEffort }),
      }, timeout.signal)
      await completed.promise
      if (started) output.enqueue({ type: 'block-end', index: 0, block: { type: 'text', text: answer } })
      if (usage !== undefined) output.enqueue({ type: 'usage', usage })
      output.enqueue({ type: 'finish', reason: { kind: 'stop' }, interactions: [...interactions.values()] })
    }).then(() => { output.close() }, (error: unknown) => { output.error(error) })
    const reader = chunks.getReader()
    try {
      while (true) {
        const next = await reader.read()
        if (next.done) break
        yield next.value
      }
    } finally {
      reader.releaseLock()
      lifetime.abort(new Error('Codex stream consumer closed.'))
      await run
    }
  }
}

/** Services used by native model discovery and execution. */
export const inject = ['llm', 'subprocess']
/**
 * Publish the local service and activate it only when the installed executable resolves.
 * @param ctx - runtime registry and process service.
 * @param config - validated native process settings.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (config.command.trim() === '' || config.provider.trim() === '') throw new Error('Codex command and provider must be non-empty.')
  ctx.llm.registerConfigurableProviders([{ provider: config.provider, displayName: 'Codex CLI', settingsNs: '', settingsPath: [], localCommand: config.command, defaultModel: 'default' }])
  let command: string
  try { command = await ctx.subprocess.resolveExecutable(config.command, {}) }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('was not found on PATH') || message.includes('is not an executable file')) return
    throw error
  }
  ctx.llm.registerAdapter([config.provider], new CodexCliAdapter(ctx.subprocess, {
    command, provider: config.provider, timeoutMs: config.timeoutMs,
    catalogTimeoutMs: config.catalogTimeoutMs, catalogCacheMs: config.catalogCacheMs, graceMs: config.graceMs,
    diagnosticMaxBytes: config.diagnosticMaxBytes,
  }))
}
