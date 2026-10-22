/** Shared validation for durable and user-submitted structured task content. */
import { z } from 'zod'
import type { TaskBrief } from './types.ts'

/** Structured task JSON accepted on submission and durable reads. */
export const taskBriefSchema = z.object({
  version: z.literal(1), goal: z.string().trim().min(1), background: z.string(),
  deliverables: z.array(z.string().trim().min(1)), acceptanceCriteria: z.array(z.string().trim().min(1)),
  constraints: z.string(),
  template: z.object({ id: z.string().min(1), version: z.number().int().positive() }).strict().optional(),
}).strict() as unknown as z.ZodType<TaskBrief>
