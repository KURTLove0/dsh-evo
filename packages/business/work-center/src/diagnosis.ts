/** Pure classification of durable execution facts, without interpreting diagnostic prose. */
import type {} from '@deepseek-ai/dsh-tools/types'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { DiagnosticCategory, DiagnosticFinding } from './types.ts'

const categories = new Map<string, DiagnosticCategory>(Object.entries({
  MISSING_CREDENTIAL: 'configuration', NO_ADAPTER: 'configuration',
  INVALID_CREDENTIAL: 'authentication', AUTH: 'authentication',
  FS_PERMISSION_DENIED: 'denied', TOOL_DENIED: 'denied', TOOL_RESULT_BLOCKED: 'blocked',
  TOOL_TIMEOUT: 'timeout', TIMEOUT: 'timeout',
  RATE_LIMIT: 'model', QUOTA: 'model', NETWORK: 'model', SERVER_ERROR: 'model',
  CONTEXT_WINDOW_EXCEEDED: 'model', EMPTY_RESPONSE: 'model',
  ABORTED: 'cancelled', ABORTED_BEFORE_DISPATCH: 'cancelled',
} satisfies Record<string, DiagnosticCategory>))
/**
 * Classify a stable source code; unknown model failures cannot establish a provider cause.
 * @param code - durable machine-routing code, if recorded.
 * @param tool - whether this is a failed tool result rather than a turn failure.
 * @returns an evidenced category or the source-specific unknown fallback.
 */
export function diagnosticCategory(code: string | undefined, tool: boolean): DiagnosticCategory {
  return (code === undefined ? undefined : categories.get(code)) ?? (tool ? 'tool' : 'unknown')
}
/**
 * Project recorded failed tool results and turn ends up to an owned sequence.
 * @param events - validated original session events.
 * @param source - index of this session's source record.
 * @param throughSeq - inclusive sequence upper bound owned by this execution.
 * @param terminalSeq - exact terminal event for an agent run, absent for node observations.
 * @param interval - optional recorded node timestamps limiting child-session observations.
 * @returns source-linked observations without tool arguments, private metadata, or reasoning.
 */
export function sessionFindings(
  events: readonly SessionEvent[], source: number, throughSeq: number,
  terminalSeq?: number, interval?: { from: number; to: number },
): DiagnosticFinding[] {
  const calls = new Map<string, string>()
  const findings: DiagnosticFinding[] = []
  for (const event of events) {
    if (event.seq > throughSeq) break
    if (interval !== undefined && (event.time < interval.from || event.time > interval.to)) continue
    if (event.type === 'tool/call') calls.set(event.data.callId, event.data.name)
    const link = { seq: event.seq, time: event.time, type: event.type }
    if (event.type === 'tool/result') {
      const result = event.data.message.content[0]
      if (result.isError !== true) continue
      const code = event.data.error?.code
      const name = calls.get(result.toolCallId)
      findings.push({ source, category: diagnosticCategory(code, true), scope: 'tool', terminal: false,
        message: result.content.filter(block => block.type === 'text').map(block => block.text).join('\n'), event: link,
        ...(code === undefined ? {} : { code }), ...(name === undefined ? {} : { toolName: name }) })
    } else if (event.type === 'tool/code-dispatch') {
      if (event.data.isError) findings.push({ source, category: 'tool', scope: 'tool', terminal: false,
        message: event.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n'),
        toolName: event.data.name, event: link })
    } else if (event.type === 'llm/retry') {
      const failure = event.data.failure
      findings.push({ source, category: diagnosticCategory(failure.code, false), scope: 'model-attempt', terminal: false,
        message: failure.message, code: failure.code, modelFailure: failure, provider: event.data.provider, event: link })
    } else if (event.type === 'turn/end') {
      const reason = event.data.reason
      const base = { source, event: link, scope: 'turn' as const, terminal: event.seq === terminalSeq }
      switch (reason.kind) {
        case 'completed': break
        case 'error': findings.push({ ...base, category: diagnosticCategory(reason.error.code, false), code: reason.error.code, message: reason.error.message, modelFailure: reason.error }); break
        case 'aborted': findings.push({ ...base, category: 'cancelled', code: reason.reason.kind, message: JSON.stringify(reason) }); break
        case 'interrupted': findings.push({ ...base, category: 'interrupted', message: JSON.stringify(reason) }); break
        case 'max-tokens': findings.push({ ...base, category: 'output-limit', message: JSON.stringify(reason) }); break
        case 'blocked': findings.push({ ...base, category: 'blocked', message: JSON.stringify(reason) }); break
        // Plugins can add end reasons; preserving their tag does not establish their failure semantics.
        default: findings.push({ ...base, category: 'unknown', message: JSON.stringify(reason) })
      }
    }
  }
  return findings
}
