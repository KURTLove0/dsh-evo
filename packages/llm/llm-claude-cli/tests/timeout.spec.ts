import { describe, expect, it } from 'vitest'
import {
  CODEX_DEFAULT_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
  resolveAdapterOptions,
  resolveCodexAdapterOptions,
} from '@deepseek-ai/dsh-llm-claude-cli'

describe('CLI timeout defaults', () => {
  it('leaves native Codex Agent runs unbounded unless configured', () => {
    expect(CODEX_DEFAULT_TIMEOUT_MS).toBe(0)
    expect(resolveCodexAdapterOptions({}).connection.timeoutMs).toBe(0)
    expect(resolveCodexAdapterOptions({ timeoutMs: 900_000 }).connection.timeoutMs).toBe(900_000)
  })

  it('keeps the Claude request deadline', () => {
    expect(resolveAdapterOptions({}).connection.timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
  })

  it.each([0, -1, Number.POSITIVE_INFINITY])('rejects an explicit Codex timeout of %s', (timeoutMs) => {
    expect(() => resolveCodexAdapterOptions({ timeoutMs })).toThrow(
      'llm-claude-cli (codex): timeoutMs must be a positive finite number no greater than 2147483647',
    )
  })
})
