/** Relate committed private template keys, immutable versions, and mutation receipts. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type { StoredTemplate } from './schema.ts'
/** Companion plugin identity. */
export const name = 'work-templates-invariant'
/** Registration capability. */
export const inject = ['invariants']
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('domain/changed', (change) => {
    if (change.domain !== 'work_templates' || change.table !== 'templates' || change.operation !== 'put') return
    const record = change.value as StoredTemplate
    if (record.id !== change.key) fail('Template key differs from its identity.')
    for (const [index, version] of record.versions.entries()) {
      if (version.version !== index + 1) fail('Template content versions are not contiguous.')
      if (version.content.kind !== record.versions[0]?.content.kind) fail('Template history changes content kind.')
    }
    if (record.requests.length !== record.revision) fail('Template revision differs from its retained mutation count.')
    if (new Set(record.requests.map(request => request.id)).size !== record.requests.length) fail('Template mutation IDs repeat.')
    for (const request of record.requests)
      if (request.version > record.versions.length || request.revision > record.revision) fail('Template receipt references an uncommitted version.')
  })
}
/**
 * Register committed template consistency checks.
 * @param ctx - host invariant registry.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-work-templates', install))
