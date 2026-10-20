/** Browser-safe parser for editable definitions and model-generated candidates. */
import { z } from 'zod'
import type { WorkflowDefinition } from './workbench-types.ts'

const text = z.string().trim().min(1)
const source = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('requirement'), field: text }).strict(),
  z.object({ kind: z.literal('step'), step: text }).strict(),
])
const requirement = z
  .object({
    summary: text,
    objectives: z.array(z.object({ id: text, statement: text }).strict()),
    inputs: z.array(z.object({ name: text, description: text }).strict()),
    outputs: z.array(z.object({ name: text, description: text }).strict()),
    constraints: z.array(text),
    acceptanceCases: z.array(
      z
        .object({
          name: text,
          given: z.record(z.string(), z.json()),
          expect: z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('nonEmpty') }).strict(),
            z.object({ kind: z.literal('contains'), value: text }).strict(),
          ]),
        })
        .strict(),
    ),
  })
  .strict()

/** All supported editable fields; unsupported node kinds and fields reject. */
export const definitionSchema = z
  .object({
    requirement,
    nodes: z.array(
      z
        .object({
          id: text,
          kind: z.enum(['agent', 'approval']),
          title: text,
          instruction: text,
          preset: text,
          dependsOn: z.array(text),
          objectives: z.array(text),
          inputs: z.array(z.object({ name: text, source }).strict()),
        })
        .strict(),
    ),
    finalOutputs: z.array(z.object({ name: text, source }).strict()),
    positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() }).strict()),
  })
  .strict() satisfies z.ZodType<WorkflowDefinition>
