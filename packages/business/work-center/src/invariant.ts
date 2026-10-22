/** Verify source ownership and immutable delivery references on committed assessments. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type { AssessmentRecord } from './schema.ts'

/** Companion identity. */
export const name = 'work-center-invariant'
/** Registration capability. */
export const inject = ['invariants']
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('domain/changed', (change) => {
    if (change.domain !== 'work_center_reviews' || change.table !== 'assessments' || change.operation !== 'put') return
    const record = change.value as AssessmentRecord
    if (`${record.ref.kind}:${record.ref.id}` !== change.key) fail('Assessment key differs from its source execution.')
    for (const [index, review] of record.history.entries()) {
      if (`${review.ref.kind}:${review.ref.id}` !== change.key) fail('Assessment history references another execution.')
      if (review.version !== review.delivery.version) fail('Review version differs from its captured delivery.')
      if (review.revision !== index + 1) fail('Review revisions are not contiguous.')
    }
    if (new Set(record.history.map(review => review.decisionId)).size !== record.history.length)
      fail('Assessment contains duplicate decision identities.')
  })
}
/**
 * Register committed review ownership checks.
 * @param ctx - host invariant registry.
 * @returns the installed companion disposer.
 */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-work-center', install))
