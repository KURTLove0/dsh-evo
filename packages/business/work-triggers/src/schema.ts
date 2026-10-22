/** Strict durable trigger decoding keeps definitions, native requests, occurrences, and notices in one record. */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { taskBriefSchema } from '@deepseek-ai/dsh-workbench-agent/brief'
import type { TaskRequestId } from '@deepseek-ai/dsh-workbench-agent/types'
import type { WorkflowRequestId } from '@deepseek-ai/dsh-business-workflow/workbench-types'
import type { TriggerDefinition, TriggerOccurrence, WorkTrigger, WorkTriggerId } from './types.ts'
/** Native submission identities are retained before any execution owner is invoked. */
export interface StoredOccurrence extends TriggerOccurrence { requestId: TaskRequestId | WorkflowRequestId }
/** The immutable creation hash distinguishes retries from conflicting reuse of the caller's identity. */
export interface StoredTrigger extends Omit<WorkTrigger, 'occurrences'> { creationHash: string; occurrences: StoredOccurrence[] }
/** UUID identity parser shared by creation and durable reads. */
export const triggerIdSchema = z.uuid()
const id = z.string().min(1), uuid = triggerIdSchema, count = z.number().int().nonnegative()
const time = z.number().int().min(0).max(8_640_000_000_000_000)
const positive = z.number().int().positive()
const ref = z.discriminatedUnion('kind', [z.object({ kind: z.literal('agent'), id }).strict(), z.object({ kind: z.literal('workflow'), id }).strict()])
const terminal = z.enum(['completed', 'succeeded', 'failed', 'cancelled', 'interrupted'])
const observation = z.object({ status: z.enum(['queued', 'running', 'waiting', 'stopping', ...terminal.options]),
  observedAt: time }).strict()
const rule = z.discriminatedUnion('kind', [z.object({ kind: z.literal('at'), at: time }).strict(),
  z.object({ kind: z.literal('every'), firstAt: time, intervalMs: positive }).strict(),
  z.object({ kind: z.literal('on-settled'), source: ref }).strict()])
const target = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('agent'), id, workspaceId: id, expectedRevision: positive, brief: taskBriefSchema }).strict(),
  z.object({ kind: z.literal('workflow'), id, workspaceId: id, versionId: id,
    inputs: z.record(z.string(), z.json()) }).strict(),
])
/** Parse fixed creation input at the RPC/service boundary and canonicalize task content. */
export const definitionSchema = z.object({ name: z.string().trim().min(1), rule, target })
  .strict() as unknown as z.ZodType<TriggerDefinition>
const phase = z.discriminatedUnion('state', [
  z.object({ state: z.literal('pending'), lastAttemptAt: time.optional() }).strict(),
  z.object({ state: z.literal('unconfirmed'), lastAttemptAt: time }).strict(),
  z.object({ state: z.literal('admitted'), ref, acceptedAt: time, observation: observation.optional(), unavailableAt: time.optional() }).strict(),
  z.object({ state: z.literal('settled'), ref, acceptedAt: time,
    observation: z.object({ status: terminal, observedAt: time }).strict() }).strict(),
])
const notice = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('admission-unconfirmed'), id: uuid, createdAt: time, readAt: time.optional() }).strict(),
  z.object({ kind: z.literal('settled'), id: uuid, createdAt: time, readAt: time.optional(), status: terminal }).strict(),
])
const occurrence = z.object({ id: uuid, requestId: uuid, dueAt: time, claimedAt: time, skippedIntervals: count, attempts: count,
  admission: phase, notices: z.array(notice) }).strict()
const record = z.object({ id: uuid, creationHash: z.string().regex(/^[a-f0-9]{64}$/), revision: positive,
  definition: definitionSchema, enabled: z.boolean(), createdAt: time, updatedAt: time, nextAt: time.optional(),
  occurrences: z.array(occurrence),
}).strict().superRefine((value, context) => {
  const fail = (message: string) => { context.addIssue({ code: 'custom', message }) }
  const { rule } = value.definition
  if (rule.kind === 'on-settled' && value.nextAt !== undefined) fail('Settlement triggers have no nominal clock target.')
  if (rule.kind === 'at' && (value.occurrences.length === 0 ? value.nextAt !== rule.at : value.nextAt !== undefined))
    fail('One-shot consumption and nominal time disagree.')
  if (rule.kind !== 'every' && value.occurrences.length > 1) fail('A one-shot trigger has more than one occurrence.')
  if (rule.kind === 'every' && (value.nextAt === undefined || value.nextAt < rule.firstAt || (value.nextAt - rule.firstAt) % rule.intervalMs !== 0))
    fail('Interval target is not anchor-aligned.')
  const ids = value.occurrences.map(item => item.id), requests = value.occurrences.map(item => item.requestId)
  if (new Set(ids).size !== ids.length || new Set(requests).size !== requests.length) fail('Occurrence or native request identities repeat.')
  if (value.occurrences.filter(item => item.admission.state !== 'settled').length > 1) fail('A trigger has concurrent unfinished occurrences.')
  const notices = value.occurrences.flatMap(item => item.notices.map(notice => notice.id))
  if (new Set(notices).size !== notices.length) fail('Notice identities repeat.')
  for (const item of value.occurrences) {
    if (new Set(item.notices.map(notice => notice.kind)).size !== item.notices.length) fail('An occurrence repeats a notice kind.')
    if (item.admission.state !== 'pending' && item.attempts === 0) fail('An admitted or uncertain occurrence has no attempted handoff.')
    if ('ref' in item.admission && item.admission.ref.kind !== value.definition.target.kind) fail('Native execution kind differs from the fixed target.')
  }
}) as unknown as z.ZodType<StoredTrigger>
/** One KV replacement commits reservation, interval advancement, history, and notices together. */
export const triggerDomain = defineDomain({ name: 'work_triggers', version: 1,
  tables: { triggers: domainTable<WorkTriggerId, StoredTrigger>(record) } })
