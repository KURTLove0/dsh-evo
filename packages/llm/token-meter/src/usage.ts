/** Bounded-log reuse of the token meter's canonical provider-usage fold. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ReportedTokenUsage } from './types.ts'
import { tokenUsageProjectionDefinition } from './usage-projection.ts'

/**
 * Fold an already selected execution interval using the same replacement rules as session usage.
 * @param events - validated events belonging to one session and execution interval, in log order.
 * @returns reported buckets, model-request headers, and steps with a usage sample; absent reports are not estimates.
 */
export function measureReportedUsage(events: readonly SessionEvent[]): ReportedTokenUsage {
  let state: Parameters<typeof tokenUsageProjectionDefinition.apply>[0] = tokenUsageProjectionDefinition.init()
  let requests = 0, reportedSteps = 0
  for (const event of events) {
    if (event.type === 'request/header') requests++
    const next = tokenUsageProjectionDefinition.apply(state, event)
    if (next.last !== null && (state.last === null ||
      next.last.turn !== state.last.turn || next.last.step !== state.last.step)) reportedSteps++
    state = next
  }
  return { usage: state.totals, requests, reportedSteps }
}
