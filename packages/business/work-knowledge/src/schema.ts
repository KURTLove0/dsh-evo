/** Durable source grants and captures; SQLite is a disposable derivative. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { FsTargetKey } from '@deepseek-ai/dsh-fs'
import type { KnowledgeAttempt, KnowledgeIndexId, KnowledgeSource, KnowledgeSourceId, KnowledgeVersion } from './types.ts'
/** Successful indexing receipts remain recoverable alongside their immutable text. */
export interface StoredKnowledgeVersion extends KnowledgeVersion {
  text: string
  requestId: KnowledgeIndexId
  expectedRevision: number
}
/** Last failed attempt is recoverable until another indexing attempt commits. */
export interface StoredKnowledgeSource extends Omit<KnowledgeSource, 'versions' | 'lastAttempt'> {
  rootKey: FsTargetKey
  targetKey: FsTargetKey
  versions: StoredKnowledgeVersion[]
  lastAttempt?: KnowledgeAttempt & { requestId: KnowledgeIndexId; expectedRevision: number }
}
/**
 * Hash exactly the decoded text, including captured line endings.
 * @param text - filesystem-decoded UTF-8 content.
 * @returns lowercase SHA-256 of its UTF-8 encoding.
 */
export const textDigest = (text: string): string => createHash('sha256').update(text).digest('hex')
const id = z.string().min(1), positive = z.number().int().positive(), digest = z.string().regex(/^[a-f0-9]{64}$/)
const version = z.object({ version: positive, capturedAt: z.number(), textSha256: digest,
  bytes: z.number().int().nonnegative(), lines: positive, text: z.string(), requestId: id, expectedRevision: positive }).strict()
const attempt = z.discriminatedUnion('state', [
  z.object({ state: z.literal('ready'), completedAt: z.number(), version: positive, requestId: id, expectedRevision: positive }).strict(),
  z.object({ state: z.literal('failed'), completedAt: z.number(), message: z.string(), requestId: id, expectedRevision: positive }).strict(),
])
const record = z.object({ id, workspaceId: id, workspacePath: id, path: id, rootKey: id, targetKey: id,
  enabled: z.boolean(), revision: positive, versions: z.array(version), lastAttempt: attempt.optional() }).strict()
  .superRefine((value, context) => {
    for (const [i, capture] of value.versions.entries()) {
      const previous = value.versions[i - 1]
      if (capture.version !== i + 1 || capture.textSha256 !== textDigest(capture.text)
        || capture.bytes !== Buffer.byteLength(capture.text) || capture.lines !== capture.text.split('\n').length
        || capture.expectedRevision >= value.revision
        || (previous !== undefined && capture.expectedRevision <= previous.expectedRevision))
        context.addIssue({ code: 'custom', message: 'Knowledge capture content, order, or revision is inconsistent.' })
    }
    if (new Set(value.versions.map(item => item.requestId)).size !== value.versions.length)
      context.addIssue({ code: 'custom', message: 'Knowledge indexing request identities repeat.' })
    const last = value.lastAttempt
    const latest = value.versions.at(-1)
    if (last !== undefined && (last.expectedRevision >= value.revision || (last.state === 'ready'
      && (latest?.version !== last.version || latest.requestId !== last.requestId
        || latest.expectedRevision !== last.expectedRevision || latest.capturedAt !== last.completedAt))
      || (last.state === 'failed' && value.versions.some(item => item.requestId === last.requestId))))
      context.addIssue({ code: 'custom', message: 'Knowledge attempt does not identify its committed capture or revision.' })
  }) as unknown as z.ZodType<StoredKnowledgeSource>
/** Single-record commits keep grant revisions, versions, and attempt receipts together. */
export const knowledgeDomain = defineDomain({ name: 'work_knowledge', version: 1,
  tables: { sources: domainTable<KnowledgeSourceId, StoredKnowledgeSource>(record) } })
