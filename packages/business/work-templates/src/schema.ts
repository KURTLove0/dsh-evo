/** Strict decoding of private template histories and retained idempotency receipts. */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { taskBriefSchema } from '@deepseek-ai/dsh-workbench-agent/brief'
import { definitionSchema } from '@deepseek-ai/dsh-business-workflow/definition'
import type { TemplateRecord, TemplateRequestId, WorkTemplateId } from './types.ts'

/** Retained mutation hashes permit retries after newer versions or host restarts. */
export interface StoredTemplate extends TemplateRecord {
  requests: { id: TemplateRequestId; hash: string; revision: number; version: number }[]
}
const id = z.string().min(1)
const positive = z.number().int().positive()
const content = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('task'), brief: taskBriefSchema }).strict(),
  z.object({ kind: z.literal('workflow'), workflowId: id, versionId: id, definition: definitionSchema }).strict(),
])
const record = z.object({ id, revision: positive, archived: z.boolean(),
  versions: z.array(z.object({ version: positive, createdAt: z.number(), name: z.string().trim().min(1), content }).strict()).min(1),
  requests: z.array(z.object({ id, hash: id, revision: positive, version: positive }).strict()).min(1),
}).strict() as unknown as z.ZodType<StoredTemplate>
/** Private content storage; executions remain with their native owners. */
export const templateDomain = defineDomain({ name: 'work_templates', version: 1,
  tables: { templates: domainTable<WorkTemplateId, StoredTemplate>(record) } })
