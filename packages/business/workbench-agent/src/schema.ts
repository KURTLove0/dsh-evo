/** Strict durable-record decoding and editable-field validation. */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { AgentDefinition, AgentRun, AgentRunId, WorkbenchAgent, WorkbenchAgentId } from './types.ts'

const uniqueNames = (values: { name: string }[]) => new Set(values.map(value => value.name)).size === values.length
const environment = z.array(z.object({ name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), value: z.string().refine(value => !value.includes('\0'), 'Environment values cannot contain NUL.') }).strict())
  .refine(uniqueNames, 'Environment variable names must be unique.')
const headers = z.array(z.object({
  name: z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/),
  value: z.string().refine(value => !/[\r\n\0]/.test(value), 'Header values cannot contain line breaks or NUL.'),
}).strict()).refine(values => uniqueNames(values.map(value => ({ name: value.name.toLowerCase() }))), 'Header names must be unique.')
const serverName = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/)
const mcpServerSchema = z.discriminatedUnion('transport', [
  z.object({ name: serverName, transport: z.literal('stdio'), command: z.string().trim().min(1), args: z.array(z.string()), env: environment }).strict(),
  z.object({ name: serverName, transport: z.literal('streamable-http'), url: z.url().refine(value => /^https?:\/\//i.test(value), 'Use an HTTP or HTTPS MCP endpoint.'), headers }).strict(),
])

/** Supported native runtime fields; unsupported configuration fails at save. */
export const definitionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  avatar: z.string().max(32),
  description: z.string().max(2000),
  instructions: z.string(),
  runtime: z.string().min(1),
  model: z.object({
    provider: z.string().min(1), model: z.string().min(1), reasoningEffort: z.string().min(1).optional() }).strict().optional(),
  skills: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)).refine(values => new Set(values).size === values.length, 'Skills must be unique.'),
  mcpServers: z.array(mcpServerSchema).refine(uniqueNames, 'MCP server names must be unique.'),
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
  name: 'workbench_agents', version: 3,
  tables: {
    agents: domainTable<WorkbenchAgentId, WorkbenchAgent>(documentSchema),
    runs: domainTable<AgentRunId, AgentRun>(runSchema),
  },
})
