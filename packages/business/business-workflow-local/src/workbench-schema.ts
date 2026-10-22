/** Validates workflow records at durable, model-output, and RPC input reads. */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  WorkflowDocument,
  WorkflowRun,
  WorkflowRunId,
  WorkflowId,
  WorkflowOperation,
  WorkflowOperationId,
} from '@deepseek-ai/dsh-business-workflow/workbench-types'

import { definitionSchema } from '@deepseek-ai/dsh-business-workflow/definition'
export { definitionSchema } from '@deepseek-ai/dsh-business-workflow/definition'
const text = z.string().trim().min(1)
const id = z.string().min(1)

// Validated string ids receive their opaque brands at this durable parser.
const versionSchema = z
  .object({
    id,
    number: z.number().int().positive(),
    revision: z.number().int().positive(),
    createdAt: z.number(),
    definition: definitionSchema,
  })
  .strict()
const documentSchema = z
  .object({
    id,
    workspaceId: id,
    copiedFrom: z.object({ id, versionId: id,
      template: z.object({ id, version: z.number().int().positive() }).strict().optional() }).strict().optional(),
    copyRequest: z.object({ id, name: text }).strict().optional(),
    name: text,
    revision: z.number().int().positive(),
    createdAt: z.number(),
    updatedAt: z.number(),
    archived: z.boolean(),
    draft: definitionSchema,
    versions: z.array(versionSchema),
  })
  .strict() as unknown as z.ZodType<WorkflowDocument>

/** Checkpoint decoder shared by live and cold audit reads. */
export const runSchema = z
  .object({
    id,
    workflowId: id,
    workspaceId: id,
    version: versionSchema,
    sessionId: id,
    mode: z.enum(['execution', 'verification']),
    batchId: id.optional(),
    caseName: text.optional(),
    rerunOf: id.optional(),
    requestId: id.optional(),
    retryRequest: id.optional(),
    feedback: text.optional(),
    execution: z.object({ provider: text, model: text, reasoningEffort: text.optional(), subagentProvider: text }).strict(),
    inputs: z.record(z.string(), z.json()),
    status: z.enum(['queued', 'running', 'waiting', 'stopping', 'succeeded', 'failed', 'cancelled', 'interrupted']),
    seq: z.number().int().nonnegative(),
    createdAt: z.number(),
    updatedAt: z.number(),
    attempts: z.array(
      z
        .object({
          id,
          nodeId: text,
          status: z.enum([
            'queued',
            'running',
            'waiting',
            'stopping',
            'succeeded',
            'failed',
            'cancelled',
            'interrupted',
            'pending',
            'skipped',
          ]),
          inputs: z.record(z.string(), z.json()),
          sources: z.record(z.string(), z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('requirement'), field: text }).strict(),
            z.object({ kind: z.literal('step'), nodeId: text, attemptId: id }).strict(),
          ])),
          prompt: z.string().optional(),
          parentSessionId: id.optional(),
          childSessionId: id.optional(),
          provider: text.optional(),
          tools: z.array(text).optional(),
          model: text.optional(),
          preset: text,
          cwd: text,
          startedAt: z.number().optional(),
          endedAt: z.number().optional(),
          output: z.string().optional(),
          error: z.string().optional(),
        })
        .strict(),
    ),
    outputs: z.record(z.string(), z.string()),
    assertion: z.object({ passed: z.boolean(), detail: z.string().optional() }).strict().optional(),
    error: z.string().optional(),
  })
  .strict() as unknown as z.ZodType<WorkflowRun>

const operationSchema = z
  .object({
    id,
    workflowId: id,
    revision: z.number().int().positive(),
    status: z.enum(['running', 'succeeded', 'failed', 'interrupted']),
    description: text,
    candidate: definitionSchema.optional(),
    error: z.string().optional(),
  })
  .strict() as unknown as z.ZodType<WorkflowOperation>

/** Reservation links the independently persisted audit to its owning workflow. */
export interface RunIndex {
  /** Owning workflow id. */
  workflowId: WorkflowId
  /** Audit session id. */
  sessionId: SessionId
  /** Initial snapshot retained until the first audit checkpoint is durable. */
  pending?: WorkflowRun
}

/** Durable workflow definitions, audit references, and generation operations. */
export const workbenchDomain = defineDomain({
  name: 'business_workflows',
  version: 3,
  tables: {
    workflows: domainTable<WorkflowId, WorkflowDocument>(documentSchema),
    runs: domainTable<WorkflowRunId, RunIndex>(
      z
        .object({ workflowId: id, sessionId: id, pending: runSchema.optional() })
        .strict() as unknown as z.ZodType<RunIndex>,
    ),
    operations: domainTable<WorkflowOperationId, WorkflowOperation>(operationSchema),
  },
})
