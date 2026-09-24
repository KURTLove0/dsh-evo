/**
 * The model-facing business-workflow tools: `business_workflow_clarify`
 * (requirement analysis and clarification), `business_workflow_compose`
 * (orchestration generation with structural validation), and
 * `business_workflow_verify` (effect verification through a case dry-run).
 * They own the model-facing schemas and result rendering; record identity,
 * gap analysis, validation, ordering, and assertion live behind
 * `ctx.businessWorkflows` (`@deepseek-ai/dsh-business-workflow`), so a
 * different runtime swaps in without touching what the model sees. The
 * dry-run delegates each step to a fresh subagent through `ctx.subagents`.
 * @module @deepseek-ai/dsh-tool-business-workflow
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue, Session, SessionEventMap } from '@deepseek-ai/dsh-session'
import type { BusinessWorkflowStage, BusinessWorkflowStepRunner, InputSource } from '@deepseek-ai/dsh-business-workflow'
import { BusinessWorkflowId } from '@deepseek-ai/dsh-business-workflow'
import type {
  AcceptanceExpectation,
  RequirementSubmission,
  WorkflowComposition,
} from '@deepseek-ai/dsh-business-workflow'
import type {
  ToolBusinessWorkflowClarifiedData,
  ToolBusinessWorkflowComposedData,
  ToolBusinessWorkflowStartData,
  ToolBusinessWorkflowVerifiedData,
} from './types.ts'
// Declaration merge only: makes ctx.systemPrompt visible for the section registration.
import type {} from '@deepseek-ai/dsh-system-prompt'
// Declaration merge only: types the optional ctx.get('subagents') read.
import type {} from '@deepseek-ai/dsh-subagent'

export const name = 'tool-business-workflow'
export const inject = ['tools', 'businessWorkflows', 'systemPrompt']

/** Config: the model-facing tool name prefix, the dry-run subagent provider, and result rendering caps. */
export interface Config {
  /** The prefix for the three model-facing tool names (default `business_workflow`). */
  toolNamePrefix?: string
  /** The subagent provider name the dry-run delegates steps to (default `spawn`). */
  subagentProvider?: string
  /** Rendered-result ceiling, in characters: longer text is truncated with a notice (default 50000). */
  maxResultChars?: number
}

export const Config: z<Config> = z.object({
  toolNamePrefix: z.string().default('business_workflow'),
  subagentProvider: z.string().default('spawn'),
  maxResultChars: z.natural().min(1).default(50_000),
})

type ResolvedConfig = Required<Config>

/** Tool argument vocabulary for one input source. */
interface SourceArgs {
  kind: 'requirement' | 'step'
  field?: string
  step?: string
}

/** Convert one model-supplied input source into the seam's discriminated union. */
function toSource(raw: SourceArgs): InputSource {
  if (raw.kind === 'requirement') {
    if (raw.field === undefined || raw.field.length === 0) {
      throw new Error('source of kind "requirement" needs a non-empty field')
    }
    return { kind: 'requirement', field: raw.field }
  }
  if (raw.step === undefined || raw.step.length === 0) {
    throw new Error('source of kind "step" needs a non-empty step id')
  }
  return { kind: 'step', step: raw.step }
}

/** Convert one model-supplied expectation into the seam's discriminated union. */
function toExpectation(raw: { kind: 'nonEmpty' | 'contains'; value?: string }): AcceptanceExpectation {
  if (raw.kind === 'contains') {
    if (raw.value === undefined || raw.value.length === 0) {
      throw new Error('expectation of kind "contains" needs a non-empty value')
    }
    return { kind: 'contains', value: raw.value }
  }
  return { kind: 'nonEmpty' }
}

/**
 * Render a text summary of a stage plus its transition context.
 * @param stage - the stage a tool result carries.
 * @returns one line naming what the stage asks the model to do next.
 */
export function renderStage(stage: BusinessWorkflowStage): string {
  switch (stage) {
    case 'clarifying':
      return 'requirement incomplete — resolve the open questions and resubmit'
    case 'ready':
      return 'requirement complete — compose the workflow next'
    case 'composed':
      return 'composition accepted — verify the workflow next'
    case 'verified':
      return 'verification passed — the workflow is ready to use'
    /* v8 ignore start -- defensive: the closed stage union is validated by the seam */
    default:
      return `unknown stage ${String(stage satisfies never)}`
    /* v8 ignore stop */
  }
}

/** Clip rendered text to the configured ceiling. */
function clip(text: string, maxChars: number): string {
  return text.length > maxChars
    ? `${text.slice(0, maxChars)}\n… [truncated: ${text.length - maxChars} more characters]`
    : text
}

const CLARIFY_DESCRIPTION = `Submit a business-workflow requirement draft for deterministic gap analysis — the first step of building a business workflow. The submission is always the complete requirement: summary, objectives (id + statement each), inputs and outputs (name + description each), optional constraints, and acceptance cases (name, given input values, expect assertion: nonEmpty or contains a substring).

The tool reports the requirement's stage: gaps list every missing aspect as an actionable question — resolve them with the user or your own analysis and resubmit; when no gaps remain the requirement is complete (stage ready) and composition can begin. Provide workflow_id to update an existing workflow (a revision discards its composition); omit it to create a new one.`

const COMPOSE_DESCRIPTION = `Submit a business-workflow orchestration for structural validation — the second step of building a business workflow. Requires a workflow whose requirement is complete (stage ready or later).

An orchestration is steps plus final output bindings. Each step: id, title, instruction (a self-contained instruction for one delegated worker), depends_on (step ids it waits for), inputs (named values sourced from requirement inputs or step outputs — every step output source must also appear in depends_on), and objectives (requirement objective ids this step serves). final_outputs binds each requirement output field to a requirement input or a step output.

The tool validates structure deterministically (identity, dependency closure, acyclicity, source resolvability, objective coverage, output binding completeness). A rejected draft returns its issues with remedies and replaces nothing; an accepted draft records the composition (stage composed) and verification can begin.`

const VERIFY_DESCRIPTION = `Verify a business workflow's effect through its acceptance cases — the third step of building a business workflow. Requires a workflow with an accepted composition (stage composed or later).

For every acceptance case the tool runs the composed steps in dependency order, delegating each step to a fresh subagent with its resolved inputs, then asserts the bound final outputs against the case's expectation. The report lists static checks, each case's outcome with a step-by-step trace, and fix hints for every failure. A passing report promotes the workflow to stage verified; a failing one keeps or demotes it to composed — revise the composition (or the requirement) per the hints and verify again.`

/**
 * The pending-state card shared by the three tools.
 * @param title - the card title (the tool name plus its subject).
 * @param rawInput - the short raw subject to show, if one is available.
 * @returns a generic card view.
 */
export function presentCallCard(title: string, rawInput: string | undefined): ToolCallView {
  return { card: 'generic', title, ...rawInput !== undefined ? { rawInput } : {} }
}

/** Completed presentation: keep the pending card shape. */
function presentResultCard(): ToolResultView {
  return { card: 'generic' }
}

/** Build the subagent prompt for one dry-run step. */
function stepPrompt(stepTitle: string, instruction: string, inputs: Record<string, unknown>): string {
  return [
    'You execute exactly one step of a business workflow. Do this step\'s work yourself and return only this step\'s output text.',
    `Step: ${stepTitle}`,
    `Instruction:\n${instruction}`,
    `Inputs (JSON):\n${JSON.stringify(inputs)}`,
  ].join('\n\n')
}

/** Join a subagent's text blocks into its step output. */
function contentText(content: readonly ContentBlock[]): string {
  return content.filter(block => block.type === 'text').map(block => block.text).join('\n')
}

/** The four package-owned durable events, all log-only. */
interface ToolBusinessWorkflowRecordEventMap {
  'tool-business-workflow/start': ToolBusinessWorkflowStartData
  'tool-business-workflow/clarified': ToolBusinessWorkflowClarifiedData
  'tool-business-workflow/composed': ToolBusinessWorkflowComposedData
  'tool-business-workflow/verified': ToolBusinessWorkflowVerifiedData
}

/** Render a contained recording failure without trusting the thrown value. */
function renderRecordingError(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}

/**
 * Project business-workflow activity into the calling parent Session without
 * letting recording failure affect tool execution: a failed append disables
 * further recording for the process, exactly as tool-workflow does.
 */
function createBusinessWorkflowRecorder(ctx: Context) {
  let durable = true
  const record = <Event extends keyof ToolBusinessWorkflowRecordEventMap>(
    session: Session | undefined,
    event: Event,
    data: SessionEventMap[Event],
  ): void => {
    // A caller without a live session (a direct non-agent invocation in a
    // test or embedding) has nowhere to record; the panel simply stays dark.
    if (!durable || session === undefined) return
    // These four package-owned events are all log-only. Narrowing the generic
    // append face here discharges Session.append's conditional options tuple.
    const appendRecord = session.append.bind(session) as <E extends keyof ToolBusinessWorkflowRecordEventMap>(
      e: E,
      value: SessionEventMap[E],
    ) => void
    try {
      appendRecord(event, data)
    } catch (error: unknown) {
      durable = false
      ctx.logger.warn(`tool-business-workflow: disabled durable record after ${event} append failed: ${renderRecordingError(error)}`)
    }
  }
  return { record }
}

export function apply(ctx: Context, config: Config): void {
  // schemastery (the exported Config schema) has already filled the defaulted
  // fields; the assertion records that resolution, not a hidden fallback.
  const { toolNamePrefix, subagentProvider, maxResultChars } = config as ResolvedConfig
  if (toolNamePrefix.length === 0) {
    throw new Error('tool-business-workflow: toolNamePrefix must be a non-empty string')
  }
  if (subagentProvider.length === 0 || subagentProvider !== subagentProvider.trim()) {
    throw new Error('tool-business-workflow: subagentProvider must be a non-empty normalized string')
  }
  const service = ctx.businessWorkflows
  const recorder = createBusinessWorkflowRecorder(ctx)

  ctx.systemPrompt.section({
    name: `tool:${toolNamePrefix}`,
    order: 116,
    text: `Use the ${toolNamePrefix}_clarify / _compose / _verify tools when the user wants a business workflow built or changed: submit the full requirement draft first (resolve the reported gaps with the user), then the step orchestration (fix reported structural issues), then verify — and only present the workflow as done once verification passes. Skip the tools for ordinary one-shot tasks.`,
  })

  ctx.tools.register(defineTool({
    name: `${toolNamePrefix}_clarify`,
    description: CLARIFY_DESCRIPTION,
    parameters: {
      workflow_id: { type: 'string', description: 'Existing workflow id to update; omit to create a new workflow.' },
      requirement: {
        type: 'object',
        required: true,
        additionalProperties: false,
        description: 'The complete requirement draft.',
        properties: {
          summary: { type: 'string', required: true, description: 'One-sentence summary of the business need.' },
          objectives: {
            type: 'array',
            required: true,
            description: 'Business objectives the workflow must achieve.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true, description: 'Stable objective id steps reference.' },
                statement: { type: 'string', required: true, description: 'One-sentence outcome statement.' },
              },
            },
          },
          inputs: {
            type: 'array',
            required: true,
            description: 'Named input fields the workflow consumes.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true, description: 'Input field name.' },
                description: { type: 'string', required: true, description: 'The field\'s business meaning.' },
              },
            },
          },
          outputs: {
            type: 'array',
            required: true,
            description: 'Named output fields the workflow produces.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true, description: 'Output field name.' },
                description: { type: 'string', required: true, description: 'The field\'s business meaning.' },
              },
            },
          },
          constraints: {
            type: 'array',
            description: 'Optional business constraints.',
            items: { type: 'string' },
          },
          acceptance_cases: {
            type: 'array',
            required: true,
            description: 'Acceptance cases verification runs.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true, description: 'Case display name.' },
                given: {
                  type: 'object',
                  required: true,
                  additionalProperties: true,
                  description: 'Sample input values keyed by requirement input field name.',
                },
                expect: {
                  type: 'object',
                  required: true,
                  additionalProperties: false,
                  description: 'The assertion the case outputs must satisfy.',
                  properties: {
                    kind: { type: 'string', required: true, enum: ['nonEmpty', 'contains'] },
                    value: { type: 'string', description: 'Substring a contains expectation requires.' },
                  },
                },
              },
            },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          workflow_id: { type: 'string', required: true },
          stage: { type: 'string', required: true, enum: ['clarifying', 'ready', 'composed', 'verified'] },
          revision: { type: 'integer', required: true },
          ready: { type: 'boolean', required: true },
          gaps: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                topic: { type: 'string', required: true, enum: ['objectives', 'inputs', 'outputs', 'acceptance'] },
                question: { type: 'string', required: true },
              },
            },
          },
          spec: { type: 'json' },
        },
      },
      render: (args, value) => {
        void args
        const lines = [`business workflow ${value.workflow_id}: ${renderStage(value.stage)} (revision ${value.revision})`]
        for (const gap of value.gaps) {
          lines.push(`- [${gap.topic}] ${gap.question}`)
        }
        if (value.spec !== null && value.spec !== undefined) {
          lines.push(`Recorded requirement:\n${JSON.stringify(value.spec, null, 2)}`)
        }
        return [{ type: 'text', text: clip(lines.join('\n'), maxResultChars) }]
      },
    },
    execute(args, exec) {
      const submission: RequirementSubmission = {
        summary: args.requirement.summary,
        objectives: args.requirement.objectives,
        inputs: args.requirement.inputs,
        outputs: args.requirement.outputs,
        ...args.requirement.constraints !== undefined ? { constraints: args.requirement.constraints } : {},
        acceptanceCases: args.requirement.acceptance_cases.map(kase => ({
          name: kase.name,
          given: kase.given,
          expect: toExpectation(kase.expect),
        })),
      }
      const analysis = service.submitRequirement({
        ...args.workflow_id !== undefined ? { id: BusinessWorkflowId(args.workflow_id) } : {},
        submission,
      })
      // Recording requires a calling agent's session; a caller without one
      // still gets its analysis — the durable panel simply stays dark for it.
      if (exec.agent !== undefined) {
        if (analysis.revision === 1) {
          recorder.record(exec.agent.session, 'tool-business-workflow/start', {
            workflowId: analysis.id,
            summary: submission.summary,
            stage: analysis.stage,
            revision: analysis.revision,
          })
        }
        recorder.record(exec.agent.session, 'tool-business-workflow/clarified', {
          workflowId: analysis.id,
          stage: analysis.stage,
          revision: analysis.revision,
          gaps: analysis.gaps,
        })
      }
      return Promise.resolve({
        workflow_id: analysis.id,
        stage: analysis.stage,
        revision: analysis.revision,
        ready: analysis.ready,
        gaps: analysis.gaps,
        ...analysis.spec !== undefined ? { spec: analysis.spec as unknown as JsonValue } : {},
      })
    },
    presentCall: args => presentCallCard(`${toolNamePrefix}_clarify`, args.requirement.summary),
    presentResult: () => presentResultCard(),
  }))

  const SOURCE_SCHEMA = {
    type: 'object',
    required: true,
    additionalProperties: false,
    description: 'Where the value comes from.',
    properties: {
      kind: { type: 'string', required: true, enum: ['requirement', 'step'] },
      field: { type: 'string', description: 'Requirement input field name (kind requirement).' },
      step: { type: 'string', description: 'Producing step id (kind step).' },
    },
  } as const

  ctx.tools.register(defineTool({
    name: `${toolNamePrefix}_compose`,
    description: COMPOSE_DESCRIPTION,
    parameters: {
      workflow_id: { type: 'string', required: true, description: 'The workflow whose requirement is complete.' },
      steps: {
        type: 'array',
        required: true,
        description: 'The orchestration steps.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: 'Unique step id.' },
            title: { type: 'string', required: true, description: 'Short display title.' },
            instruction: { type: 'string', required: true, description: 'Complete instruction for the step\'s worker.' },
            depends_on: {
              type: 'array',
              required: true,
              description: 'Step ids this step waits for.',
              items: { type: 'string' },
            },
            inputs: {
              type: 'array',
              required: true,
              description: 'Named inputs this step consumes.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string', required: true, description: 'Input name the instruction refers to.' },
                  source: SOURCE_SCHEMA,
                },
              },
            },
            objectives: {
              type: 'array',
              required: true,
              description: 'Requirement objective ids this step serves.',
              items: { type: 'string' },
            },
          },
        },
      },
      final_outputs: {
        type: 'array',
        required: true,
        description: 'One binding per requirement output field.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true, description: 'Requirement output field name.' },
            source: SOURCE_SCHEMA,
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stage: { type: 'string', required: true, enum: ['ready', 'composed', 'verified'] },
          step_count: { type: 'integer', required: true },
          issues: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                code: { type: 'string', required: true },
                ref: { type: 'string' },
                message: { type: 'string', required: true },
                remedy: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (args, value) => {
        void args
        const lines = [`composition ${value.step_count > 0 ? `accepted (${value.step_count} steps; stage ${value.stage})` : `rejected (stage stays ${value.stage})`}`]
        for (const issueEntry of value.issues) {
          lines.push(`- [${issueEntry.code}] ${issueEntry.message}\n  Fix: ${issueEntry.remedy}`)
        }
        return [{ type: 'text', text: clip(lines.join('\n'), maxResultChars) }]
      },
    },
    execute(args, exec) {
      const composition: WorkflowComposition = {
        steps: args.steps.map(step => ({
          id: step.id,
          title: step.title,
          instruction: step.instruction,
          dependsOn: step.depends_on,
          inputs: step.inputs.map(input => ({ name: input.name, source: toSource(input.source) })),
          objectives: step.objectives,
        })),
        finalOutputs: args.final_outputs.map(binding => ({
          name: binding.name,
          source: toSource(binding.source),
        })),
      }
      const outcome = service.compose({ id: BusinessWorkflowId(args.workflow_id), composition })
      if (exec.agent !== undefined) {
        recorder.record(exec.agent.session, 'tool-business-workflow/composed', {
          workflowId: outcome.id,
          stage: outcome.stage,
          stepCount: outcome.stepCount,
          issues: outcome.issues,
          // The board projects the accepted draft only; a rejected draft leaves
          // the previous composition (or none) on the panel.
          steps: outcome.stepCount > 0
            ? composition.steps.map(step => ({ id: step.id, title: step.title, dependsOn: step.dependsOn }))
            : [],
        })
      }
      return Promise.resolve({
        stage: outcome.stage,
        step_count: outcome.stepCount,
        issues: outcome.issues.map(issueEntry => ({
          code: issueEntry.code,
          ...issueEntry.ref !== undefined ? { ref: issueEntry.ref } : {},
          message: issueEntry.message,
          remedy: issueEntry.remedy,
        })),
      })
    },
    presentCall: args => presentCallCard(`${toolNamePrefix}_compose`, `${args.steps.length} steps`),
    presentResult: () => presentResultCard(),
  }))

  ctx.tools.register(defineTool({
    name: `${toolNamePrefix}_verify`,
    description: VERIFY_DESCRIPTION,
    parameters: {
      workflow_id: { type: 'string', required: true, description: 'The workflow with an accepted composition.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          passed: { type: 'boolean', required: true },
          stage: { type: 'string', required: true, enum: ['composed', 'verified'] },
          dry_run: { type: 'boolean', required: true },
          static_checks: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                passed: { type: 'boolean', required: true },
                detail: { type: 'string' },
              },
            },
          },
          case_results: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                status: { type: 'string', required: true, enum: ['passed', 'failed', 'skipped'] },
                detail: { type: 'string' },
                steps: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      step_id: { type: 'string', required: true },
                      status: { type: 'string', required: true, enum: ['completed', 'failed'] },
                      detail: { type: 'string', required: true },
                    },
                  },
                },
              },
            },
          },
          fix_hints: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (args, value) => {
        void args
        const lines = [
          `verification ${value.passed ? 'passed' : 'failed'} (stage ${value.stage}${value.dry_run ? ', dry-run executed' : ', dry-run skipped'})`,
        ]
        for (const check of value.static_checks) {
          if (!check.passed) lines.push(`- static check ${check.name} failed: ${check.detail}`)
        }
        for (const caseResult of value.case_results) {
          const detail = caseResult.detail !== undefined ? ` — ${caseResult.detail}` : ''
          lines.push(`- case ${caseResult.name}: ${caseResult.status}${detail}`)
          for (const step of caseResult.steps ?? []) {
            lines.push(`  · ${step.step_id} ${step.status}: ${step.detail}`)
          }
        }
        for (const hint of value.fix_hints) {
          lines.push(`Fix: ${hint}`)
        }
        return [{ type: 'text', text: clip(lines.join('\n'), maxResultChars) }]
      },
    },
    async execute(args, exec) {
      const parent = exec.agent
      if (!parent) {
        // The loop sets `exec.agent` for every model-driven call; without one
        // there is no parent to attribute the step delegations to.
        throw new Error('business_workflow_verify requires a calling agent (exec.agent was undefined)')
      }
      const subagents = ctx.get('subagents')
      if (subagents === undefined) {
        throw new Error('business_workflow_verify requires a subagent provider (load a dsh-subagent provider in this composition)')
      }
      const runStep: BusinessWorkflowStepRunner = async (step, inputs, context) => {
        const run = await subagents.start(subagentProvider, {
          label: `business workflow step ${step.id}`,
          prompt: [{ type: 'text', text: stepPrompt(step.title, step.instruction, inputs) }],
          parent,
          signal: context.signal,
        })
        try {
          const result = await run.result
          if (result.stopReason !== 'completed') {
            throw new Error(`step delegation ended ${result.stopReason}${result.diagnostic !== undefined ? `: ${result.diagnostic}` : ''}`)
          }
          return contentText(result.output)
        } finally {
          await run.dispose()
        }
      }
      const report = await service.verify({
        id: BusinessWorkflowId(args.workflow_id),
        runStep,
        signal: exec.signal,
      })
      const stage = service.get(BusinessWorkflowId(args.workflow_id)).stage === 'verified' ? 'verified' as const : 'composed' as const
      recorder.record(parent.session, 'tool-business-workflow/verified', {
        workflowId: report.id,
        stage,
        summary: {
          passed: report.passed,
          caseCount: report.caseResults.length,
          dryRun: report.dryRun,
        },
        cases: report.caseResults,
      })
      return {
        passed: report.passed,
        stage,
        dry_run: report.dryRun,
        static_checks: report.staticChecks.map(check => ({
          name: check.name,
          passed: check.passed,
          ...check.detail !== undefined ? { detail: check.detail } : {},
        })),
        case_results: report.caseResults.map(caseResult => ({
          name: caseResult.name,
          status: caseResult.status,
          ...caseResult.detail !== undefined ? { detail: caseResult.detail } : {},
          ...caseResult.steps !== undefined ? {
            steps: caseResult.steps.map(step => ({
              step_id: step.stepId,
              status: step.status,
              detail: step.detail,
            })),
          } : {},
        })),
        fix_hints: report.fixHints,
      }
    },
    presentCall: args => presentCallCard(`${toolNamePrefix}_verify`, args.workflow_id),
    presentResult: () => presentResultCard(),
  }))
}
