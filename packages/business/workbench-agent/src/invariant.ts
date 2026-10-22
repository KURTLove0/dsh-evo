/** Check run identity and configuration ownership on committed storage events. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type { AgentRun } from './types.ts'

/** Companion identity. */
export const name = 'workbench-agent-invariant'
/** Invariant registration service. */
export const inject = ['invariants']
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('domain/changed', (change) => {
    if (change.domain !== 'workbench_agents' || change.table !== 'runs' || change.operation !== 'put') return
    const run = change.value as AgentRun
    if (run.id !== change.key) fail('Agent run key differs from its committed identity.')
    if (run.definition !== undefined && run.definition.id !== run.agentId)
      fail('Agent run captured another identity’s configuration.')
    if (run.retryRequest !== undefined) {
      if (run.retryOf === undefined || run.retryOf === run.id) fail('Retry request does not reference another execution.')
      if (run.definition?.revision !== run.retryRequest.agentRevision) fail('Retry request revision differs from its captured configuration.')
      if (run.submission !== undefined && (run.submission.id !== run.retryRequest.id ||
        run.submission.agentRevision !== run.retryRequest.agentRevision))
        fail('Structured retry and submission identities differ.')
    }
    if (run.candidate !== undefined && (run.purpose !== 'design' || run.status !== 'completed'))
      fail('Agent configuration candidate belongs to an incomplete or non-design execution.')
  })
}
/**
 * Register run identity and configuration-ownership checks.
 * @param ctx - host context with invariant reporting.
 * @returns installed registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-workbench-agent', install))
