/** Relate probe notifications to authoritative retained observations. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller, InvariantFailure } from '@deepseek-ai/dsh-invariants'
import type {} from './service.ts'
/** Invariant companion identity. */
export const name = 'capability-health-invariant'
/** Required registration service. */
export const inject = ['invariants']
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  ctx.on('capability-health/probe-changed', (id) => {
    const record = ctx.capabilityHealth.readProbe(id)
    if (record === null || record.id !== id) fail('Probe notification has no matching retained record.')
    else if (record.status !== 'running' && record.checkedAt < record.startedAt)
      fail('Probe completion precedes its start time.')
  })
}, { inject: ['capabilityHealth'] })
/**
 * @param ctx - invariant registry context.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-capability-health', install))
