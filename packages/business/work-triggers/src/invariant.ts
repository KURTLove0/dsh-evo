/** Relate committed trigger identities, unfinished work, and native request ownership. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { StoredTrigger } from './schema.ts'
/** Companion identity. */
export const name = 'work-triggers-invariant'
/** Invariant registration is available before the observed domain mounts. */
export const inject = ['invariants']
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('domain/changed', (change) => {
    if (change.domain !== 'work_triggers' || change.table !== 'triggers' || change.operation !== 'put') return
    const record = change.value as StoredTrigger
    if (record.id !== change.key) fail('Trigger key differs from its identity.')
    if (record.occurrences.filter(item => item.admission.state !== 'settled').length > 1)
      fail('A trigger has concurrent unfinished occurrences.')
    const requests = new Set<string>()
    for (const occurrence of record.occurrences) {
      if (requests.has(occurrence.requestId)) fail('A native request belongs to multiple trigger occurrences.')
      requests.add(occurrence.requestId)
      if ('ref' in occurrence.admission && occurrence.admission.ref.kind !== record.definition.target.kind)
        fail('Trigger native run kind differs from its fixed target.')
    }
  })
}
/**
 * Register committed trigger ownership checks.
 * @param ctx - invariant and domain services.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-work-triggers', install))
