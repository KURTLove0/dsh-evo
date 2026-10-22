/** Durable failure categories and source-local evidence, without message-based guesses. */
import { expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { diagnosticCategory, sessionFindings } from '../src/diagnosis.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface TurnEndReasonMap {
    /** Test plugin's informational end reason has no owned failure semantics. */
    'diagnostic-extension': { kind: 'diagnostic-extension' }
  }
}
// Backend-validated event fixtures omit unrelated message IDs and surface projection fields.
const event = (type: string, seq: number, data: object): SessionEvent => ({ type, seq, time: seq * 10, data }) as SessionEvent
const end = (seq: number, reason: object) => event('turn/end', seq, { turn: 1, reason })
const result = (seq: number, id: string, isError?: boolean, code?: string) => event('tool/result', seq, {
  message: { content: [{ type: 'tool-result', toolCallId: id,
    content: [{ type: 'text', text: 'Original evidence' }, { type: 'image', url: 'private-data' }], ...(isError === undefined ? {} : { isError }) }] },
  ...(code === undefined ? {} : { error: { name: 'Failure', code } }),
})
it('classifies stable codes and never treats suggestive error text as a cause', () => {
  for (const code of ['MISSING_CREDENTIAL', 'NO_ADAPTER']) expect(diagnosticCategory(code, false)).toBe('configuration')
  for (const code of ['AUTH', 'INVALID_CREDENTIAL']) expect(diagnosticCategory(code, false)).toBe('authentication')
  for (const code of ['FS_PERMISSION_DENIED', 'TOOL_DENIED']) expect(diagnosticCategory(code, true)).toBe('denied')
  expect(diagnosticCategory('TOOL_RESULT_BLOCKED', true)).toBe('blocked')
  for (const code of ['TOOL_TIMEOUT', 'TIMEOUT']) expect(diagnosticCategory(code, true)).toBe('timeout')
  for (const code of ['RATE_LIMIT', 'QUOTA', 'NETWORK', 'SERVER_ERROR', 'CONTEXT_WINDOW_EXCEEDED', 'EMPTY_RESPONSE']) expect(diagnosticCategory(code, false)).toBe('model')
  for (const code of ['ABORTED', 'ABORTED_BEFORE_DISPATCH']) expect(diagnosticCategory(code, true)).toBe('cancelled')
  expect(diagnosticCategory(undefined, false)).toBe('unknown')
  for (const code of ['unrecognized-timeout', 'toString', '__proto__', 'constructor']) expect(diagnosticCategory(code, false)).toBe('unknown')
  expect(diagnosticCategory(undefined, true)).toBe('tool')
  const findings = sessionFindings([end(1, { kind: 'error', error: { code: 'UNKNOWN', message: 'AUTH denied timeout' } })], 0, 1, 1)
  expect(findings[0]).toMatchObject({ category: 'unknown', terminal: true, message: 'AUTH denied timeout', code: 'UNKNOWN' })
})
it('preserves failed tools as observations even when the owned execution completes successfully', () => {
  const findings = sessionFindings([
    event('tool/call', 1, { callId: 'call', name: 'read-file', arguments: 'secret-argument' }),
    result(2, 'call', true, 'TOOL_TIMEOUT'), result(3, 'orphan', true), result(4, 'success', false), result(5, 'unset'),
    end(6, { kind: 'completed' }), end(7, { kind: 'error', error: { code: 'AUTH', message: 'Later user work' } }),
  ], 3, 6, 6)
  expect(findings).toHaveLength(2)
  expect(findings[0]).toMatchObject({ source: 3, category: 'timeout', scope: 'tool', terminal: false, message: 'Original evidence', toolName: 'read-file', event: { seq: 2, time: 20, type: 'tool/result' } })
  expect(findings[1]?.toolName).toBeUndefined()
  expect(JSON.stringify(findings)).not.toContain('secret-argument')
  expect(JSON.stringify(findings)).not.toContain('private-data')
  expect(JSON.stringify(findings)).not.toContain('Later user work')
})
it('keeps cancellation, interruption, output limits, blocking, and plugin tags distinct', () => {
  const findings = sessionFindings([
    end(1, { kind: 'aborted', reason: { kind: 'user' } }), end(2, { kind: 'interrupted' }), end(3, { kind: 'max-tokens' }),
    end(4, { kind: 'blocked' }), end(5, { kind: 'diagnostic-extension' }),
  ], 0, 5)
  expect(findings.map(value => value.category)).toEqual(['cancelled', 'interrupted', 'output-limit', 'blocked', 'unknown'])
  expect(findings.every(value => !value.terminal)).toBe(true)
  expect(findings[0]?.message).toBe('{"kind":"aborted","reason":{"kind":"user"}}')
})
it('bounds child-session observations to the node timestamps without claiming a terminal root cause', () => {
  const findings = sessionFindings([end(1, { kind: 'interrupted' }), end(2, { kind: 'error', error: { code: 'AUTH', message: 'Node authentication rejected' } }),
    end(3, { kind: 'error', error: { code: 'TIMEOUT', message: 'Later user work' } })], 1, 3, undefined, { from: 15, to: 25 })
  expect(findings).toHaveLength(1)
  expect(findings[0]).toMatchObject({ category: 'authentication', terminal: false, message: 'Node authentication rejected' })
})
it('retains recovered model attempts and failed nested Code Mode tools without exposing their arguments', () => {
  const findings = sessionFindings([
    event('llm/retry', 1, { provider: 'model', failure: { code: 'RATE_LIMIT', message: 'Provider throttled', status: 429, requestId: 'provider-request' } }),
    event('tool/code-dispatch', 2, { name: 'nested-read', isError: true, arguments: 'private-argument', content: [{ type: 'text', text: 'Nested failure' }] }),
    event('tool/code-dispatch', 3, { name: 'nested-ok', isError: false, content: [] }),
    end(4, { kind: 'completed' }),
  ], 2, 4, 4)
  expect(findings).toHaveLength(2)
  expect(findings[0]).toMatchObject({ scope: 'model-attempt', terminal: false, category: 'model', modelFailure: { status: 429, requestId: 'provider-request' } })
  expect(findings[1]).toMatchObject({ scope: 'tool', terminal: false, category: 'tool', toolName: 'nested-read', message: 'Nested failure' })
  expect(JSON.stringify(findings)).not.toContain('private-argument')
})
