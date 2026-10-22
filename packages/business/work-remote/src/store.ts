/** Durable receiver records bind admission to a Host, principal, fixed input, and one native identity. */
import stringify from 'fast-json-stable-stringify'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { submissionObjectSchema } from './protocol.ts'
import type { RemoteSubmission, RemoteSubmissionSummary, RemoteTarget } from './types.ts'
/** Composite storage key; callers never supply it independently. */
export type SubmissionKey = Branded<'RemoteSubmissionKey'>
/** Private recovery data never crosses the machine wire. */
export interface StoredSubmission extends RemoteSubmission { requestId: string; inputHash: string }
/**
 * Derive the principal-qualified durable key.
 * @param value - retained principal and caller identity.
 * @returns the unambiguous table key.
 */
export function submissionKey(value: Pick<RemoteSubmission, 'principalId' | 'id'>): SubmissionKey {
  return `${value.principalId}/${value.id}` as SubmissionKey
}
/**
 * Compare JSON inputs independently of object property insertion order.
 * @param target - validated native input.
 * @returns a stable SHA-256 digest.
 */
export function targetHash(target: RemoteTarget): string { return createHash('sha256').update(stringify(target)).digest('hex') }
/**
 * Namespace native requests across receivers and principals.
 * @param value - retained Host, principal, and submission identity.
 * @returns the same opaque native identity across restart and explicit recovery.
 */
export function nativeRequestId(value: Pick<RemoteSubmission, 'hostId' | 'principalId' | 'id'>): string {
  return `remote-work/${value.hostId}/${submissionKey(value)}`
}
/**
 * Project directory metadata without task content or native recovery fields.
 * @param value - complete retained submission.
 * @returns admission metadata and exact target identity.
 */
export function submissionSummary(value: RemoteSubmission): RemoteSubmissionSummary {
  const { id, hostId, principalId, createdAt, attempts, admission, target } = value
  return { id, hostId, principalId, createdAt, attempts, admission,
    target: { kind: target.kind, id: target.id, workspaceId: target.workspaceId } }
}
const stored = submissionObjectSchema.extend({ requestId: z.string().min(1), inputHash: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict().transform(value => value as StoredSubmission).superRefine((value, context) => {
    if (value.inputHash !== targetHash(value.target) || value.requestId !== nativeRequestId(value)
      || value.admission.state === 'admitted' && value.admission.ref.kind !== value.target.kind)
      context.addIssue({ code: 'custom', message: 'Remote submission identity, input digest, or native kind is inconsistent.' })
  })
const initialIdentity: { hostId?: string } = {}
/** Receiver identity survives empty histories and cannot be silently reassigned to another Host. */
export const remoteDomain = defineDomain({ name: 'remote_work', version: 1,
  global: { schema: z.object({ hostId: z.uuid().optional() }).strict(), initial: initialIdentity },
  tables: { submissions: domainTable<SubmissionKey, StoredSubmission>(stored) } })
