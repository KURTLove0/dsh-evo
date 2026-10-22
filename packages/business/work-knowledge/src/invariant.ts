/** Relate committed source identities and immutable captures to their durable metadata. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type { StoredKnowledgeSource } from './schema.ts'
/** Companion plugin identity. */
export const name = 'work-knowledge-invariant'
/** Invariant registry owner. */
export const inject = ['invariants']
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('domain/changed', (change) => {
    if (change.domain !== 'work_knowledge' || change.table !== 'sources' || change.operation !== 'put') return
    const source = change.value as StoredKnowledgeSource
    if (source.id !== change.key) fail('Knowledge source key differs from its granted identity.')
    for (const [i, capture] of source.versions.entries()) {
      if (capture.version !== i + 1 || capture.expectedRevision >= source.revision) fail('Knowledge capture order or revision differs from its source metadata.')
    }
    const last = source.lastAttempt
    if (last?.state === 'ready' && !source.versions.some(capture => capture.version === last.version && capture.requestId === last.requestId))
      fail('Knowledge ready attempt does not identify a retained capture.')
  })
}
/**
 * Register checks on authoritative committed knowledge records.
 * @param ctx - host invariant registry.
 * @returns registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-work-knowledge', install))
