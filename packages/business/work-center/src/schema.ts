/** Durable human-assessment decoding; execution state is never persisted here. */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { DeliveryReview, WorkReference } from './types.ts'

/** Typed storage key includes the source discriminant. */
export type WorkKey = Branded<'WorkKey'>
/** One atomic record retains every idempotent decision for its source execution. */
export interface AssessmentRecord {
  ref: WorkReference
  history: DeliveryReview[]
}
const referenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('agent'), id: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('workflow'), id: z.string().min(1) }).strict(),
])
const deliverySchema = z.object({
  version: z.string().min(1), outputs: z.array(z.object({ name: z.string(), text: z.string() }).strict()),
  criteria: z.array(z.string()), evidence: z.enum(['recorded-response', 'recorded-workflow-output']),
  artifacts: z.array(z.discriminatedUnion('state', [
    z.object({ path: z.string(), state: z.literal('captured'), sha256: z.string(),
      bytes: z.number().int().nonnegative(), encoding: z.enum(['utf-8', 'base64']),
      content: z.string() }).strict(),
    z.object({ path: z.string(), state: z.literal('unavailable'), error: z.string() }).strict(),
  ])),
  assertion: z.object({ passed: z.boolean(), detail: z.string().optional() }).strict().optional(),
}).strict()
const reviewSchema = z.object({
  ref: referenceSchema, version: z.string().min(1), revision: z.number().int().positive(), decisionId: z.string().min(1),
  decision: z.enum(['accepted', 'changes-requested']), reason: z.string(), reviewedAt: z.number(),
  actor: z.literal('local-operator'), delivery: deliverySchema,
}).strict()
const recordSchema = z.object({ ref: referenceSchema, history: z.array(reviewSchema).min(1) })
  .strict() as unknown as z.ZodType<AssessmentRecord>

/** Separate business domain for immutable human decisions and their captured evidence. */
export const reviewDomain = defineDomain({ name: 'work_center_reviews', version: 1,
  tables: { assessments: domainTable<WorkKey, AssessmentRecord>(recordSchema) } })

/**
 * Qualify an execution ID with its source before storage lookup.
 * @param ref - typed execution reference.
 * @returns the source-qualified storage key.
 */
export function workKey(ref: WorkReference): WorkKey { return `${ref.kind}:${ref.id}` as WorkKey }
