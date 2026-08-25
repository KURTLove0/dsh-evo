#!/usr/bin/env node
/**
 * Interactive terminal UI for DeepSeek Harness: spawns the SDK JSON-RPC
 * runtime (the `dsh-jsonrpc-agent` bin with this leaf's `cordis.yml`) as a
 * child process, renders the live session event stream as it is recorded,
 * and turns keyboard input into queued prompts. No UI dependencies —
 * `node:readline` plus ANSI escape sequences.
 *
 * Run from the repository root so tsx resolves workspace imports through the
 * root tsconfig: `node --import tsx examples/tui-agent/src/tui.ts`. The
 * runtime child inherits this environment; `DEEPSEEK_API_KEY` is required by
 * the DeepSeek adapter, `DSH_MODEL` selects the route, and `DSH_CWD` /
 * `DSH_SESSION_ROOT` tune the workspace and durable session directory.
 * `NO_COLOR` or a non-TTY stdout disables styling.
 *
 * @module tui-agent/src/tui
 */

import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { HarnessClient } from '@deepseek-ai/dsh-sdk-client'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, TodoItem, TurnEndReason } from '@deepseek-ai/dsh-session'

/** The provider route every TUI session runs on. */
const PROVIDER = 'deepseek-official'

/** Prompt shown at the start of every input line. */
const PROMPT = 'you › '

/** Truncation bounds for rendered tool arguments and results. */
const ARG_BRIEF_LIMIT = 100
const RESULT_BRIEF_LIMIT = 240

/** ANSI escape sequences and OSC replies stripped from model-authored text. */
const ANSI_PATTERN = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g

/** C0/C1 control characters except tab and newline. */
const CONTROL_PATTERN = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g

/** Terminal styling helpers; a no-op pair when styling is disabled. */
interface Styles {
  readonly dim: (text: string) => string
  readonly red: (text: string) => string
  readonly cyan: (text: string) => string
}

const plain: Styles = {
  dim: text => text,
  red: text => text,
  cyan: text => text,
}

const ansi: Styles = {
  dim: text => `\x1b[2m${text}\x1b[22m`,
  red: text => `\x1b[31m${text}\x1b[39m`,
  cyan: text => `\x1b[36m${text}\x1b[39m`,
}

/**
 * The terminal face of one agent turn: whether output is streaming (the input
 * line is hidden), what the current step streamed, and what to summarize when
 * the whole agent goes idle.
 */
class TurnView {
  private readonly styles: Styles
  streaming = false
  private streamedText = false
  private turnNumber = 0
  private lastReason: TurnEndReason | undefined
  private inputTokens = 0
  private outputTokens = 0
  private reasoningChars = 0

  /** @param styles - active styling helpers. */
  constructor(styles: Styles) {
    this.styles = styles
  }

  /**
   * Hide the input line before the first output of a turn. Idempotent within
   * a turn; the caller re-shows the line when the agent goes idle.
   */
  begin(): void {
    if (this.streaming) return
    this.streaming = true
    this.streamedText = false
    process.stdout.write('\x1b[2K\r')
  }

  /** Reset per-step streaming bookkeeping. */
  beginStep(): void {
    this.streamedText = false
  }

  /**
   * Stream one assistant text delta verbatim.
   * @param text - the delta as delivered by the adapter.
   */
  textDelta(text: string): void {
    this.begin()
    this.streamedText = true
    process.stdout.write(sanitize(text))
  }

  /** Count reasoning characters without echoing them. */
  reasoningDelta(text: string): void {
    this.reasoningChars += text.length
  }

  /**
   * Fallback for steps whose adapter delivered no text deltas: print the
   * assembled message once.
   * @param content - the committed assistant message blocks.
   */
  assembled(content: readonly ContentBlock[]): void {
    if (this.streamedText) return
    const text = content
      .filter((block): block is ContentBlock & { type: 'text' } => block.type === 'text')
      .map(block => block.text)
      .join('')
    if (text.length > 0) this.textDelta(text)
  }

  /**
   * Accumulate one step's token accounting.
   * @param usage - token usage reported with the assistant message.
   */
  usage(usage: { readonly inputTokens: number; readonly outputTokens: number }): void {
    this.inputTokens += usage.inputTokens
    this.outputTokens += usage.outputTokens
  }

  /** Record why the turn ended for the idle summary. */
  end(reason: TurnEndReason): void {
    this.lastReason = reason
    this.turnNumber += 1
  }

  /**
   * End streaming and print the turn summary line.
   * @returns the rendered summary, or `undefined` when no output streamed.
   */
  finish(): string | undefined {
    if (!this.streaming) return undefined
    this.streaming = false
    this.streamedText = false
    const line = this.summary(this.lastReason)
    this.lastReason = undefined
    this.inputTokens = 0
    this.outputTokens = 0
    this.reasoningChars = 0
    process.stdout.write(`\n${line}\n`)
    return line
  }

  private summary(reason: TurnEndReason | undefined): string {
    const kind = reason?.kind ?? 'completed'
    const parts = [`turn ${this.turnNumber}`, describeReason(reason)]
    if (this.inputTokens > 0 || this.outputTokens > 0) {
      parts.push(`in ${formatTokens(this.inputTokens)} tok`, `out ${formatTokens(this.outputTokens)} tok`)
    }
    if (this.reasoningChars > 0) parts.push(`reasoning ${formatTokens(this.reasoningChars)} chars`)
    const line = `  · ${parts.join(' · ')}`
    return kind === 'error' ? this.styles.red(line) : this.styles.dim(line)
  }
}

/** Render one root-session event onto the terminal. */
function renderEvent(view: TurnView, styles: Styles, event: SessionEvent): void {
  switch (event.type) {
    case 'turn/start':
      view.begin()
      break
    case 'turn/end':
      view.end(event.data.reason)
      break
    case 'step/start':
      view.beginStep()
      break
    case 'assistant/chunk':
      if (event.data.chunk.type === 'text-delta') view.textDelta(event.data.chunk.text)
      else if (event.data.chunk.type === 'reasoning-delta') view.reasoningDelta(event.data.chunk.text)
      break
    case 'assistant/message':
      view.assembled(event.data.message.content)
      if (event.data.usage !== undefined) view.usage(event.data.usage)
      break
    case 'tool/call':
      view.begin()
      process.stdout.write(`${styles.cyan('⏺')} ${event.data.name}(${summarizeJson(event.data.arguments, ARG_BRIEF_LIMIT)})\n`)
      break
    case 'tool/result': {
      const brief = summarizeBlocks(event.data.message.content[0].content, RESULT_BRIEF_LIMIT)
      const failed = event.data.error !== undefined
      const mark = failed ? styles.red('  ⎿!') : styles.dim('  ⎿')
      const body = failed ? styles.red(brief) : styles.dim(brief)
      process.stdout.write(`${mark} ${body}\n`)
      break
    }
    case 'todo/write':
      view.begin()
      renderTodos(event.data.todos)
      break
    // Boundary markers, derived-history sources, and future plugin events
    // carry no TUI row: the event map is merge-extensible, so unknown or
    // log-only types fall through ignored by contract.
    default:
      break
  }
}

/** Render the latest whole-list todo snapshot. */
function renderTodos(todos: readonly TodoItem[]): void {
  if (todos.length === 0) {
    process.stdout.write('  · todos cleared\n')
    return
  }
  const marks: Record<TodoItem['status'], string> = { pending: '[ ]', in_progress: '[>]', completed: '[x]' }
  for (const todo of todos) {
    process.stdout.write(`  ${marks[todo.status]} ${sanitize(todo.content)}\n`)
  }
}

/** Render one server notification outside the root session event stream. */
function renderNotification(view: TurnView, styles: Styles, sessionId: string, notification: HarnessNotification): void {
  if (notification.method === 'subagent.started') {
    view.begin()
    process.stdout.write(`${styles.dim(`  ↳ subagent ${shortId(String(notification.params.childSessionId))} started`)}\n`)
  } else if (notification.method === 'subagent.finished') {
    const child = shortId(String(notification.params.childSessionId))
    const status = String(notification.params.status)
    const line = `  ↳ subagent ${child} ${status === 'ok' ? 'finished' : `failed (${status})`}`
    process.stdout.write(`${status === 'ok' ? styles.dim(line) : styles.red(line)}\n`)
  } else if (notification.method === 'session.status') {
    if (notification.params.sessionId === sessionId && notification.params.status === 'idle') {
      view.finish()
    }
  }
}

/**
 * Strip terminal-significant sequences from model- or tool-authored text:
 * ANSI escapes, OSC replies, and control characters other than tab and
 * newline become absent so streamed text cannot restyle or move the cursor.
 * @param text - untrusted display text.
 * @returns the sanitized text.
 */
function sanitize(text: string): string {
  return text.replaceAll(ANSI_PATTERN, '').replaceAll(CONTROL_PATTERN, '')
}

/** `1234` → `1.2k` for compact summary columns. */
function formatTokens(value: number): string {
  return value >= 10_000 ? `${(value / 1000).toFixed(1)}k` : String(value)
}

/** Short session id form for subagent rows. */
function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 12)}…` : id
}

/**
 * One-line brief of a raw JSON tool-call argument string: a single-key object
 * renders its value, anything else renders compact JSON, both truncated.
 * @param raw - the model-produced arguments JSON exactly as received.
 * @param limit - maximum rendered characters.
 * @returns the sanitized brief.
 */
function summarizeJson(raw: string, limit: number): string {
  let brief = raw
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const values = Object.values(parsed as Record<string, unknown>)
      if (values.length === 1 && typeof values[0] === 'string') brief = values[0]
      else brief = JSON.stringify(parsed)
    }
  } catch {
    // Unparseable arguments stay verbatim (truncated below).
  }
  return truncate(sanitize(brief), limit)
}

/** Concatenated text blocks of a tool result, truncated to one row. */
function summarizeBlocks(blocks: readonly ContentBlock[], limit: number): string {
  const text = blocks
    .filter((block): block is ContentBlock & { type: 'text' } => block.type === 'text')
    .map(block => block.text)
    .join('')
  return truncate(sanitize(text), limit) || '(no text output)'
}

/** Append an ellipsis when the value exceeds the limit. */
function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}

/**
 * Human label for a turn-end reason; the provider message travels with
 * failures. The reason union is merge-extensible, so unknown plugin-added
 * kinds fall through to a generic label.
 * @param reason - the reason carried by `turn/end`, if a turn ended.
 * @returns the rendered label.
 */
function describeReason(reason: TurnEndReason | undefined): string {
  if (reason === undefined) return 'idle'
  switch (reason.kind) {
    case 'completed':
      return 'completed'
    case 'aborted':
      return 'aborted'
    case 'blocked':
      return 'blocked'
    case 'error':
      return `error: ${reason.error.message}`
    case 'max-tokens':
      return 'max-tokens'
    case 'interrupted':
      return 'interrupted'
    default:
      return 'ended'
  }
}

/**
 * Boot the runtime child, run the input/render loop until `/exit` or SIGINT,
 * then close the client so the child is reaped through the dispose ladder.
 */
async function main(): Promise<void> {
  const styled = process.env['NO_COLOR'] === undefined && process.stdout.isTTY
  const styles = styled ? ansi : plain
  const here = fileURLToPath(new URL('.', import.meta.url))
  const repoRoot = resolve(here, '..', '..', '..')
  const workspace = resolve(process.env['DSH_CWD'] !== undefined && process.env['DSH_CWD'] !== ''
    ? process.env['DSH_CWD']
    : process.cwd())
  const sessionRoot = resolve(process.env['DSH_SESSION_ROOT'] !== undefined && process.env['DSH_SESSION_ROOT'] !== ''
    ? process.env['DSH_SESSION_ROOT']
    : join(workspace, '.dsh-tui-sessions'))
  const model = process.env['DSH_MODEL'] !== undefined && process.env['DSH_MODEL'] !== ''
    ? process.env['DSH_MODEL']
    : 'deepseek-v4-flash'
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_CWD: workspace,
    DSH_SESSION_ROOT: sessionRoot,
  }
  const client = new HarnessClient({
    command: process.execPath,
    args: [
      '--import',
      'tsx',
      join(repoRoot, 'packages/examples/jsonrpc-demo/src/bin.ts'),
      join(repoRoot, 'examples/tui-agent/cordis.yml'),
    ],
    cwd: repoRoot,
    env,
  })
  client.start()
  await client.initialize({ cwd: workspace, provider: PROVIDER, model })

  const view = new TurnView(styles)
  let sessionId = process.env['DSH_TUI_SESSION_ID'] ?? `tui-${randomUUID().slice(0, 8)}`
  // Held on an object: the quit path runs from readline/SIGINT closures while
  // the pump reads it in its own frame, and a bare `let` would be narrowed to
  // its initializer across that boundary.
  const lifecycle = { quitting: false }
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: styles.dim(PROMPT) })
  const echoInput = !process.stdin.isTTY

  const banner = (): void => {
    process.stdout.write(`${styles.cyan('DeepSeek Harness TUI')}\n`)
    process.stdout.write(styles.dim(`model    ${model}\ncwd      ${workspace}\nsession  ${sessionId}\n`))
    process.stdout.write(styles.dim('message to send · /new fresh session · /clear screen · /exit or Ctrl+C to quit\n'))
  }
  banner()
  rl.prompt()

  const quit = async (): Promise<void> => {
    if (lifecycle.quitting) return
    lifecycle.quitting = true
    rl.pause()
    try {
      await client.close()
    } finally {
      process.exit(process.exitCode ?? 0)
    }
  }

  rl.on('line', (line: string) => {
    const text = line.trim()
    if (text === '') {
      rl.prompt()
      return
    }
    if (echoInput) process.stdout.write(`${styles.dim(PROMPT)}${text}\n`)
    if (text === '/exit' || text === '/quit') {
      void quit()
      return
    }
    if (text === '/clear') {
      process.stdout.write('\x1b[2J\x1b[H')
      banner()
      rl.prompt()
      return
    }
    if (text === '/new') {
      sessionId = `tui-${randomUUID().slice(0, 8)}`
      process.stdout.write(`${styles.dim(`· new session ${sessionId}`)}\n`)
      rl.prompt()
      return
    }
    void client.prompt(sessionId, [{ type: 'text', text }]).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      process.stdout.write(`${styles.red(`prompt failed: ${message}`)}\n`)
      rl.prompt()
    })
  })
  rl.on('SIGINT', () => { void quit() })
  rl.on('close', () => { void quit() })
  process.on('SIGINT', () => { void quit() })

  const subscription = client.subscribe()
  const pump = (async (): Promise<void> => {
    try {
      for (;;) {
        const notification = await subscription.next()
        const wasStreaming = view.streaming
        if (notification.method === 'session.event' && notification.params.sessionId === sessionId) {
          renderEvent(view, styles, notification.params.event as SessionEvent)
        } else {
          renderNotification(view, styles, sessionId, notification)
        }
        if (!wasStreaming && view.streaming) rl.pause()
        else if (wasStreaming && !view.streaming) {
          rl.resume()
          rl.prompt(true)
        }
      }
    } catch {
      // The subscription rejects when the runtime exits: a requested quit is
      // silent; anything else is a runtime death the user must see.
      if (!lifecycle.quitting) {
        process.stdout.write(`${styles.red('runtime closed unexpectedly')}\n`)
        process.exitCode = 1
        void quit()
      }
    }
  })()
  await pump
}

await main()
