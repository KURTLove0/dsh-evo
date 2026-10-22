/** Relate committed artifact identities, workspace provenance, and immutable version receipts. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type { StoredArtifact } from './schema.ts'
/** Companion plugin identity. */
export const name = 'work-artifacts-invariant'
/** Invariant registration capability. */
export const inject = ['invariants']
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('domain/changed', (change) => {
    if (change.domain !== 'work_artifacts' || change.table !== 'artifacts' || change.operation !== 'put') return
    const record = change.value as StoredArtifact
    if (record.id !== change.key) fail('Artifact key differs from its registered identity.')
    for (const [index, version] of record.versions.entries()) {
      if (version.version !== index + 1) fail('Artifact capture versions are not contiguous.')
      if (version.origin.source.workspaceId !== record.workspaceId) fail('Artifact source belongs to another workspace.')
    }
    if (new Set(record.versions.map(version => version.requestId)).size !== record.versions.length)
      fail('Artifact registration request identities repeat.')
  })
}
/**
 * Register committed artifact ownership checks.
 * @param ctx - host invariant registry.
 * @returns the installed registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-work-artifacts', install))
