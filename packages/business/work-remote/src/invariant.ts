/** Relate committed machine submissions to their principal-qualified keys and frozen native identity. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { submissionKey, targetHash, nativeRequestId, type StoredSubmission } from './store.ts'
/** Companion identity. */
export const name = 'work-remote-invariant'
/** Invariants observe authoritative committed domain events. */
export const inject = ['invariants']
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('domain/changed', (change) => {
    if (change.domain !== 'remote_work' || change.table !== 'submissions' || change.operation !== 'put') return
    const value = change.value as StoredSubmission
    if (change.key !== submissionKey(value)) fail('Remote submission key differs from its principal and request.')
    if (value.inputHash !== targetHash(value.target) || value.requestId !== nativeRequestId(value))
      fail('Remote submission content or native request identity changed.')
    if (value.admission.state === 'admitted' && value.admission.ref.kind !== value.target.kind)
      fail('Remote admission kind differs from its authorized target.')
  })
}
/**
 * Register committed remote admission ownership checks.
 * @param ctx - invariant registry and domain events.
 * @returns registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-work-remote', install))
