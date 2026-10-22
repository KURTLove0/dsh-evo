/** Strict versioned JSON decoding and complete wire bounds for the machine-only endpoint. */
import { z } from 'zod'
import { taskBriefSchema } from '@deepseek-ai/dsh-workbench-agent/brief'
import type { RemoteEnvelope, RemoteReply, RemoteSubmission, RemoteTarget } from './types.ts'
/** Fixed version-1 machine route, separate from the browser API carrier. */
export const REMOTE_WORK_PATH = '/remote-work/v1'
/** Stable protocol failures contain no native exception text or credential values. */
export class RemoteWorkFault extends Error {
  /** @param code - stable public failure classification without native diagnostic text. */
  constructor(readonly code: 'denied' | 'invalid-request' | 'conflict' | 'limit' | 'unavailable' | 'unknown-submission') {
    super(`Remote work: ${code}.`)
  }
}
/** Negative machine replies expose a fixed classification without native error text or identity details. */
export const failureSchema = z.object({ version: z.literal(1), error: z.object({
  code: z.enum(['denied', 'invalid-request', 'conflict', 'limit', 'unavailable', 'unknown-submission']),
}).strict() }).strict()
/** Receiver principal identifiers are operator-assigned opaque labels, not credential values. */
export const principalSchema = z.string().regex(/^[a-z][a-z0-9-]*$/)
/** Stable receiving deployment UUID parser used at configuration and wire boundaries. */
export const hostIdentitySchema = z.uuid()
const id = z.string().min(1), positive = z.number().int().positive(), time = z.number().int().min(0).max(8_640_000_000_000_000)
const ref = z.discriminatedUnion('kind', [z.object({ kind: z.literal('agent'), id }).strict(), z.object({ kind: z.literal('workflow'), id }).strict()])
/** Wire input validation also canonicalizes structured task fields. */
export const targetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('agent'), id, workspaceId: id, expectedRevision: positive, brief: taskBriefSchema }).strict(),
  z.object({ kind: z.literal('workflow'), id, workspaceId: id, versionId: id, inputs: z.record(z.string(), z.json()) }).strict(),
]) as unknown as z.ZodType<RemoteTarget>
const operation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('catalog') }).strict(),
  z.object({ kind: z.literal('list'), workspaceId: id.optional() }).strict(),
  z.object({ kind: z.literal('submit'), id: z.uuid(), target: targetSchema }).strict(),
  z.object({ kind: z.literal('inspect'), id: z.uuid() }).strict(),
  z.object({ kind: z.literal('recover'), id: z.uuid(), expectedAttempt: positive }).strict(),
  z.object({ kind: z.literal('stop'), id: z.uuid() }).strict(),
  z.object({ kind: z.literal('decide'), id: z.uuid(), attemptId: id, approve: z.boolean() }).strict(),
])
/** Machine envelope is validated after authentication and before any native operation. */
export const envelopeSchema = z.object({ version: z.literal(1), hostId: z.uuid(), principalId: principalSchema, operation })
  .strict() as unknown as z.ZodType<RemoteEnvelope>
const admission = z.discriminatedUnion('state', [z.object({ state: z.literal('unconfirmed') }).strict(),
  z.object({ state: z.literal('admitted'), ref }).strict()])
const submissionFields = { id: z.uuid(), hostId: z.uuid(), principalId: principalSchema, createdAt: time, attempts: positive, admission }
/** Public retained submission without private hashes or native request identities. */
export const submissionObjectSchema = z.object({ ...submissionFields, target: targetSchema }).strict()
/** Branded public projection after strict wire decoding. */
export const submissionSchema = submissionObjectSchema as unknown as z.ZodType<RemoteSubmission>
const summary = z.object({ ...submissionFields, target: z.object({ kind: z.enum(['agent', 'workflow']), id, workspaceId: id }).strict() }).strict()
const source = z.object({ ref, name: z.string(), workspaceId: id, sessionId: id,
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted', 'waiting', 'stopping', 'succeeded']) }).strict()
const catalog = z.object({ credentialOwner: z.literal('remote-host'), controls: z.object({ stop: z.boolean(), workflowDecisions: z.boolean() }).strict(),
  workspaces: z.array(z.object({ id, title: z.string(), path: id,
    agents: z.array(z.object({ id, name: z.string(), revision: positive, runtime: id,
      skills: z.array(z.string()), mcpServerNames: z.array(z.string()), archived: z.boolean() }).strict()),
    workflows: z.array(z.object({ id, name: z.string(), archived: z.boolean(),
      versions: z.array(z.object({ id, number: positive,
        inputs: z.array(z.object({ name: id, description: z.string() }).strict()) }).strict()) }).strict()),
  }).strict()) }).strict()
const result = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('catalog'), catalog, observedAt: time }).strict(),
  z.object({ kind: z.literal('list'), items: z.array(summary), observedAt: time }).strict(),
  z.object({ kind: z.literal('submission'), submission: summary }).strict(),
  z.object({ kind: z.literal('inspection'), submission: submissionSchema, observedAt: time, source: source.optional(),
    decisions: z.array(z.object({ attemptId: id, title: z.string(), instruction: z.string(),
      inputs: z.record(z.string(), z.json()) }).strict()).optional(), decisionsUnavailable: z.literal(true).optional(),
    delivery: z.object({ outputs: z.array(z.object({ name: z.string(), text: z.string() }).strict()),
      evidence: z.enum(['recorded-response', 'recorded-workflow-output']) }).strict().optional(), unavailable: z.literal(true).optional() }).strict(),
  z.object({ kind: z.literal('controlled'), id: z.uuid() }).strict(),
])
/** Validate every remote response before trusting its identity or execution data. */
export const replySchema = z.object({ version: z.literal(1), hostId: z.uuid(), principalId: principalSchema, result })
  .strict() as unknown as z.ZodType<RemoteReply>
/**
 * Encode complete JSON with its wrapper before checking the response/record budget.
 * @param value - complete owned payload.
 * @param maximum - deployment-selected UTF-8 byte bound.
 * @returns complete text; overflow rejects without truncation.
 */
export function encode(value: unknown, maximum: number): string {
  const text = JSON.stringify(value)
  if (Buffer.byteLength(text) > maximum) throw new RemoteWorkFault('limit')
  return text
}
