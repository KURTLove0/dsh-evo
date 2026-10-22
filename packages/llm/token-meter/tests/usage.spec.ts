/** Execution interval measurements reuse durable usage replacement, including failed-stream samples. */
import { expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { measureReportedUsage } from '../src/usage.ts'

it('replaces repeated step reports, retains failed-stream usage, and does not invent reports', () => {
  const events = [
    { type: 'request/header', data: {} },
    { type: 'assistant/chunk', data: { turn: 1, step: 0, chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } } } },
    { type: 'assistant/message', data: { turn: 1, step: 0, usage: { inputTokens: 12, outputTokens: 3, cacheReadTokens: 4, cacheWriteTokens: 5 } } },
    { type: 'assistant/message', data: { turn: 1, step: 0, usage: { inputTokens: 12, outputTokens: 3, cacheReadTokens: 4, cacheWriteTokens: 5 } } },
    { type: 'request/header', data: {} },
    { type: 'assistant/chunk', data: { turn: 2, step: 0, chunk: { type: 'usage', usage: { inputTokens: 20, outputTokens: 7 } } } },
    { type: 'turn/end', data: {} },
  ] as unknown as SessionEvent[]
  expect(measureReportedUsage(events)).toEqual({
    usage: { uncachedInputTokens: 32, outputTokens: 10, cacheReadTokens: 4, cacheWriteTokens: 5 }, requests: 2, reportedSteps: 2 })
  expect(measureReportedUsage([])).toEqual({
    usage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, requests: 0, reportedSteps: 0 })
})
