/** Strict durable-record decoding and editable-field validation. */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { AgentDefinition, AgentRun, AgentRunId, WorkbenchAgent, WorkbenchAgentId } from './types.ts'

/** Supported native runtime fields; unsupported configuration fails at save. */
export const definitionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  avatar: z.string().max(32),
  description: z.string().max(2000),
  instructions: z.string(),
  runtime: z.literal('harness'),
  model: z.object({
    provider: z.string().min(1), model: z.string().min(1), reasoningEffort: z.string().min(1).optional() }).strict().optional(),
  skills: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)).refine(values => new Set(values).size === values.length, 'Skills must be unique.'),
  starters: z.array(z.object({ label: z.string().trim().min(1).max(80), prompt: z.string().trim().min(1) }).strict()).max(3),
  concurrency: z.number().int().min(1),
}).strict() satisfies z.ZodType<AgentDefinition>

const documentSchema = definitionSchema.extend({
  id: z.string().min(1), revision: z.number().int().positive(), archived: z.boolean(), createdAt: z.number(), updatedAt: z.number(),
}).strict() as unknown as z.ZodType<WorkbenchAgent>

const runSchema = z.object({
  id: z.string().min(1), agentId: z.string().min(1),
  workspaceId: z.string().min(1), sessionId: z.string().min(1), prompt: z.string().min(1),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted']),
  definition: documentSchema.optional(), createdAt: z.number(), startedAt: z.number().optional(), endedAt: z.number().optional(),
  purpose: z.literal('design').optional(), candidate: definitionSchema.optional(),
  error: z.string().optional(), retryOf: z.string().min(1).optional(),
}).strict() as unknown as z.ZodType<AgentRun>

/** Independent versioned domain; no preset files or preset settings are written. */
export const agentDomain = defineDomain({
  name: 'workbench_agents', version: 1,
  tables: {
    agents: domainTable<WorkbenchAgentId, WorkbenchAgent>(documentSchema),
    runs: domainTable<AgentRunId, AgentRun>(runSchema),
  },
})
