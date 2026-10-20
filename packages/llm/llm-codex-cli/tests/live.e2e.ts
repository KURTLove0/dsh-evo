/** Opt-in read-only inference through the installed CLI's own authentication. */
import { Context } from '@deepseek-ai/cordis'
import Llm, { createUserMessage } from '@deepseek-ai/dsh-llm'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { expect, it } from 'vitest'
import * as Plugin from '../src/index.ts'

it.skipIf(process.env.DSH_CODEX_CLI_E2E !== '1')('answers through the installed Codex runtime', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(Llm)
    await ctx.plugin(LocalSubprocess)
    await ctx.plugin(Plugin, { command: 'codex', provider: 'codex-cli', timeoutMs: 60000, catalogTimeoutMs: 30000, catalogCacheMs: 60000, graceMs: 3000, diagnosticMaxBytes: 65536 }).await()
    let text = ''
    for await (const chunk of ctx.llm.stream({ provider: 'codex-cli', model: 'default', sandboxMode: 'read-only',
      messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Reply exactly LOCAL_RUNTIME_OK. Do not use any tools or change any files.' }] })],
    })) {
      if (chunk.type === 'text-delta') text += chunk.text
      if (chunk.type === 'finish' && chunk.reason.kind !== 'stop') throw new Error(JSON.stringify(chunk.reason))
    }
    expect(text.trim()).toBe('LOCAL_RUNTIME_OK')
  } finally {
    await ctx.fiber.dispose()
  }
}, 75000)
