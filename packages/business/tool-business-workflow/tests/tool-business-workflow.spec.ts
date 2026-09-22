import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent'
import LocalBusinessWorkflowRuntime from '@deepseek-ai/dsh-business-workflow-local'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as toolBusinessWorkflow from '../src/index.ts'
import { presentCallCard, renderStage } from '../src/index.ts'

const testToolSignal = new AbortController().signal

let contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts) await context.fiber.dispose()
  contexts = []
})

/** A stub subagent provider echoing the step's prompt back as its output. */
function scriptedProvider(reply: string, captured: string[] = []): SubagentProvider {
  return {
    name: 'spawn',
    capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
    inheritsParentContext: false,
    start: async (request) => {
      captured.push(request.prompt.map(block => block.type === 'text' ? block.text : '').join('\n'))
      return {
        id: SessionId('stub-child'),
        localAgent: undefined,
        result: Promise.resolve({
          output: [{ type: 'text', text: reply }],
          stopReason: 'completed' as const,
        }),
        dispose: async () => {},
      }
    },
  }
}

/** A stub subagent provider failing every delegation, with or without a diagnostic. */
function failingProvider(diagnostic?: string): SubagentProvider {
  return {
    name: 'spawn',
    capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
    inheritsParentContext: false,
    start: async () => ({
      id: SessionId('stub-child'),
      localAgent: undefined,
      result: Promise.resolve({
        output: [],        ...diagnostic !== undefined ? { diagnostic } : {},
        stopReason: 'error' as const,
      }),
      dispose: async () => {},
    }),
  }
}

async function setup(options?: {
  config?: Record<string, unknown>
  subagents?: boolean
  reply?: string
  prompts?: string[]
  failureDiagnostic?: string | null
}): Promise<{ ctx: Context; parent: Agent }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalBusinessWorkflowRuntime, {})
  if (options?.subagents !== false) {
    await ctx.plugin(SubagentRuntime)
    const provider = options?.failureDiagnostic === undefined
      ? scriptedProvider(options?.reply ?? 'scored output', options?.prompts)
      : failingProvider(options.failureDiagnostic ?? undefined)
    ctx.subagents.registerProvider(provider)
  }
  await ctx.plugin(toolBusinessWorkflow, options?.config ?? {})
  const session = Session.create(SessionId('caller'))
  const parent = { id: session.id, options: {}, session } as unknown as Agent
  return { ctx, parent }
}

function execute(ctx: Context, name: string, args: unknown, extra?: { agent?: Agent }): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`call-${name}`),
    name,
    arguments: args,
    ...extra?.agent !== undefined ? { agent: extra.agent } : {},
  })
}

const REQUIREMENT = {
  summary: 'Rank inbound leads',
  objectives: [{ id: 'rank-leads', statement: 'Score every lead' }],
  inputs: [{ name: 'leads', description: 'Raw lead records' }],
  outputs: [{ name: 'ranking', description: 'Scored ranking' }],
  acceptance_cases: [{
    name: 'sample',
    given: { leads: ['alpha'] },
    expect: { kind: 'contains', value: 'scored' },
  }],
}

const STEPS = [{
  id: 'score',
  title: 'Score leads',
  instruction: 'Score each lead.',
  depends_on: [] as string[],
  inputs: [{ name: 'raw', source: { kind: 'requirement', field: 'leads' } }],
  objectives: ['rank-leads'],
}]

const FINAL_OUTPUTS = [{ name: 'ranking', source: { kind: 'step', step: 'score' } }]

/** Drive one record through clarify and compose. */
async function composedRecord(ctx: Context, parent: Agent): Promise<string> {
  const clarified = await execute(ctx, 'business_workflow_clarify', { requirement: REQUIREMENT }, { agent: parent })
  if (clarified.isError) throw new Error('clarify failed')
  const id = (clarified.value as { workflow_id: string }).workflow_id
  await execute(ctx, 'business_workflow_compose', { workflow_id: id, steps: STEPS, final_outputs: FINAL_OUTPUTS }, { agent: parent })
  return id
}

/** Event types recorded into the parent session, in append order. */
function recordedEvents(session: Session): { type: string; data: unknown }[] {
  return session.events.map(event => ({ type: event.type, data: event.data }))
}

describe('durable session records', () => {
  it('records start and clarified on the first submission, without start on later revisions', async () => {
    const { ctx, parent } = await setup()
    const session = parent.session
    const first = await execute(ctx, 'business_workflow_clarify', { requirement: REQUIREMENT }, { agent: parent })
    const id = (first.value as { workflow_id: string }).workflow_id
    const second = await execute(ctx, 'business_workflow_clarify', { workflow_id: id, requirement: REQUIREMENT }, { agent: parent })
    expect(second.value).toMatchObject({ revision: 2 })
    const types = recordedEvents(session).map(entry => entry.type)
    expect(types).toEqual(['tool-business-workflow/start', 'tool-business-workflow/clarified', 'tool-business-workflow/clarified'])
    const start = session.events[0]?.data as unknown as { workflowId: string; summary: string; stage: string; revision: number }
    expect(start).toEqual({ workflowId: id, summary: 'Rank inbound leads', stage: 'ready', revision: 1 })
  })

  it('records composed and verified verdicts', async () => {
    const { ctx, parent } = await setup()
    const session = parent.session
    const id = await composedRecord(ctx, parent)
    await execute(ctx, 'business_workflow_verify', { workflow_id: id }, { agent: parent })
    const types = recordedEvents(session).map(entry => entry.type)
    expect(types).toEqual([
      'tool-business-workflow/start',
      'tool-business-workflow/clarified',
      'tool-business-workflow/composed',
      'tool-business-workflow/verified',
    ])
    const composed = session.events[2]?.data as unknown as { workflowId: string; stage: string; stepCount: number; issues: unknown[] }
    expect(composed).toEqual({ workflowId: id, stage: 'composed', stepCount: 1, issues: [] })
    const verified = session.events[3]?.data as unknown as {
      workflowId: string
      stage: string
      summary: { passed: boolean; caseCount: number; dryRun: boolean }
      cases: { name: string; status: string; steps: { stepId: string; status: string; detail: string }[] }[]
    }
    expect(verified).toEqual({
      workflowId: id,
      stage: 'verified',
      summary: { passed: true, caseCount: 1, dryRun: true },
      cases: [{
        name: 'sample',
        status: 'passed',
        steps: [{ stepId: 'score', status: 'completed', detail: 'scored output' }],
      }],
    })
  })

  it('records nothing for a caller with no session and stays silent on append failure', async () => {
    const { ctx } = await setup()
    // A ghost agent shape (no session) must not throw and must not record.
    const ghost = { id: SessionId('ghost') } as unknown as Agent
    const result = await execute(ctx, 'business_workflow_clarify', { requirement: REQUIREMENT }, { agent: ghost })
    expect(result.isError).toBe(false)

    // A throwing append disables recording without breaking later calls.
    const breaking = Session.create(SessionId('breaking'))
    vi.spyOn(breaking, 'append').mockImplementation(() => { throw new Error('log closed') })
    const brokenParent = { id: breaking.id, options: {}, session: breaking } as unknown as Agent
    const warned = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => ctx.logger)
    const stillRuns = await execute(ctx, 'business_workflow_clarify', { requirement: REQUIREMENT }, { agent: brokenParent })
    expect(stillRuns.isError).toBe(false)
    expect(String(warned.mock.calls[0]?.[0])).toContain('disabled durable record')
    await expect(execute(ctx, 'business_workflow_compose', {
      workflow_id: (stillRuns.value as { workflow_id: string }).workflow_id,
      steps: STEPS,
      final_outputs: FINAL_OUTPUTS,
    }, { agent: brokenParent })).resolves.toMatchObject({ isError: false })
  })
})

describe('dsh-tool-business-workflow', () => {
  it('registers the three tools under the configured prefix', async () => {
    const { ctx } = await setup({ config: { toolNamePrefix: 'bizflow' } })
    const names = ctx.tools.schemas().map(schema => schema.name).filter(name => name.startsWith('bizflow')).sort()
    expect(names).toEqual(['bizflow_clarify', 'bizflow_compose', 'bizflow_verify'])
  })

  it('refuses an empty toolNamePrefix at load', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalBusinessWorkflowRuntime, {})
    await expect(ctx.plugin(toolBusinessWorkflow, { toolNamePrefix: '' }))
      .rejects.toThrow(/toolNamePrefix must be a non-empty string/)
  })

  it('refuses an empty or untrimmed subagentProvider at load', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalBusinessWorkflowRuntime, {})
    await expect(ctx.plugin(toolBusinessWorkflow, { subagentProvider: '' }))
      .rejects.toThrow(/subagentProvider must be a non-empty normalized string/)
    await expect(ctx.plugin(toolBusinessWorkflow, { subagentProvider: ' spawn ' }))
      .rejects.toThrow(/subagentProvider must be a non-empty normalized string/)
  })

  it('truncates rendered results at the configured cap', async () => {
    const { ctx, parent } = await setup({ config: { maxResultChars: 20 } })
    const result = await execute(ctx, 'business_workflow_clarify', { requirement: REQUIREMENT }, { agent: parent })
    expect(result.isError).toBe(false)
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    expect(text.length).toBeLessThanOrEqual(20 + '\n… [truncated: '.length + 20)
    expect(text).toContain('truncated:')
  })

  it('carries optional constraints into the submission', async () => {
    const { ctx, parent } = await setup()
    const result = await execute(ctx, 'business_workflow_clarify', {
      requirement: { ...REQUIREMENT, constraints: ['Same-day turnaround'] },
    }, { agent: parent })
    expect(result.isError).toBe(false)
    const spec = (result.value as { spec: { constraints: string[] } }).spec
    expect(spec.constraints).toEqual(['Same-day turnaround'])
  })

  it('clarifies a complete requirement and renders the recorded spec', async () => {
    const { ctx, parent } = await setup()
    const result = await execute(ctx, 'business_workflow_clarify', { requirement: REQUIREMENT }, { agent: parent })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected clarify success')
    expect(result.value).toMatchObject({
      workflow_id: 'bw-1',
      stage: 'ready',
      revision: 1,
      ready: true,
      gaps: [],
    })
    expect(result.content[0]?.type === 'text' ? result.content[0].text : '')
      .toContain('requirement complete — compose the workflow next')
  })

  it('reports one gap per missing aspect for an incomplete draft', async () => {
    const { ctx, parent } = await setup()
    const result = await execute(ctx, 'business_workflow_clarify', {
      requirement: {
        summary: 'Rank inbound leads',
        objectives: [],
        inputs: [],
        outputs: [],
        acceptance_cases: [],
      },
    }, { agent: parent })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected clarify success')
    const value = result.value as { stage: string; gaps: { topic: string }[] }
    expect(value.stage).toBe('clarifying')
    expect(value.gaps.map(gap => gap.topic)).toEqual(['objectives', 'inputs', 'outputs', 'acceptance'])
  })

  it('updates an existing record when workflow_id names one', async () => {
    const { ctx, parent } = await setup()
    const first = await execute(ctx, 'business_workflow_clarify', {
      requirement: { ...REQUIREMENT, objectives: [] },
    }, { agent: parent })
    const id = (first.value as { workflow_id: string }).workflow_id
    const second = await execute(ctx, 'business_workflow_clarify', {
      workflow_id: id,
      requirement: REQUIREMENT,
    }, { agent: parent })
    expect(second.value).toMatchObject({ workflow_id: id, revision: 2, stage: 'ready' })
  })

  it('rejects a contains expectation without a value', async () => {
    const { ctx, parent } = await setup()
    const result = await execute(ctx, 'business_workflow_clarify', {
      requirement: {
        ...REQUIREMENT,
        acceptance_cases: [{ name: 'broken', given: { leads: [] }, expect: { kind: 'contains' } }],
      },
    }, { agent: parent })
    expect(result.isError).toBe(true)
  })

  it('accepts a nonEmpty expectation', async () => {
    const { ctx, parent } = await setup()
    const result = await execute(ctx, 'business_workflow_clarify', {
      requirement: {
        ...REQUIREMENT,
        acceptance_cases: [{ name: 'present', given: { leads: ['alpha'] }, expect: { kind: 'nonEmpty' } }],
      },
    }, { agent: parent })
    expect(result.isError).toBe(false)
  })

  it('renders every stage line and the pending card with and without raw input', () => {
    expect(renderStage('clarifying')).toContain('resolve the open questions')
    expect(renderStage('ready')).toContain('compose the workflow next')
    expect(renderStage('composed')).toContain('verify the workflow next')
    expect(renderStage('verified')).toContain('ready to use')
    expect(presentCallCard('t', 'raw')).toEqual({ card: 'generic', title: 't', rawInput: 'raw' })
    expect(presentCallCard('t', undefined)).toEqual({ card: 'generic', title: 't' })
  })

  it('presents generic pending and completed cards for the three tools', async () => {
    const { ctx, parent } = await setup()
    const clarify = ctx.tools.get('business_workflow_clarify')!
    expect(clarify.presentCall!({ requirement: REQUIREMENT })).toEqual({
      card: 'generic',
      title: 'business_workflow_clarify',
      rawInput: 'Rank inbound leads',
    })
    const compose = ctx.tools.get('business_workflow_compose')!
    expect(compose.presentCall!({ workflow_id: 'bw-1', steps: STEPS, final_outputs: FINAL_OUTPUTS }))
      .toEqual({ card: 'generic', title: 'business_workflow_compose', rawInput: '1 steps' })
    const verify = ctx.tools.get('business_workflow_verify')!
    expect(verify.presentCall!({ workflow_id: 'bw-1' })).toEqual({
      card: 'generic', title: 'business_workflow_verify', rawInput: 'bw-1',
    })
    const completed = { content: [], isError: false }
    expect(clarify.presentResult!({ requirement: REQUIREMENT }, completed)).toEqual({ card: 'generic' })
    expect(compose.presentResult!({ workflow_id: 'bw-1', steps: STEPS, final_outputs: FINAL_OUTPUTS }, completed))
      .toEqual({ card: 'generic' })
    expect(verify.presentResult!({ workflow_id: 'bw-1' }, completed)).toEqual({ card: 'generic' })
    // Soft validation: malformed presentation args fall back to undefined.
    expect(clarify.presentCall!({ not: 'the schema' })).toBeUndefined()
    void parent
  })

  it('rejects a compose draft whose step list is empty', async () => {
    const { ctx, parent } = await setup()
    const clarified = await execute(ctx, 'business_workflow_clarify', { requirement: REQUIREMENT }, { agent: parent })
    const id = (clarified.value as { workflow_id: string }).workflow_id
    const result = await execute(ctx, 'business_workflow_compose', {
      workflow_id: id,
      steps: [],
      final_outputs: [],
    }, { agent: parent })
    expect(result.isError).toBe(false)
    const value = result.value as { stage: string; step_count: number; issues: { code: string; ref?: string }[] }
    expect(value.step_count).toBe(0)
    expect(value.issues).toEqual([{
      code: 'STEPS_EMPTY',
      message: 'the composition declares no steps',
      remedy: 'Add at least one step that works toward a requirement objective.',
    }])
  })

  it('composes a valid orchestration and reports the accepted stage', async () => {
    const { ctx, parent } = await setup()
    const id = await composedRecord(ctx, parent)
    expect(ctx.businessWorkflows.get(require_businessWorkflowId(id)).stage).toBe('composed')
    const rejected = await execute(ctx, 'business_workflow_compose', {
      workflow_id: id,
      steps: STEPS,
      final_outputs: [],
    }, { agent: parent })
    expect(rejected.isError).toBe(false)
    const value = rejected.value as { stage: string; step_count: number; issues: { code: string }[] }
    expect(value.stage).toBe('composed')
    expect(value.step_count).toBe(0)
    expect(value.issues.map(issueEntry => issueEntry.code)).toEqual(['OUTPUT_UNBOUND'])
  })

  it('rejects a compose source naming no field or step', async () => {
    const { ctx, parent } = await setup()
    const id = await composedRecord(ctx, parent)
    const missingField = await execute(ctx, 'business_workflow_compose', {
      workflow_id: id,
      steps: [{
        ...STEPS[0]!,
        inputs: [{ name: 'raw', source: { kind: 'requirement' } }],
      }],
      final_outputs: FINAL_OUTPUTS,
    }, { agent: parent })
    expect(missingField.isError).toBe(true)

    const missingStep = await execute(ctx, 'business_workflow_compose', {
      workflow_id: id,
      steps: [{
        ...STEPS[0]!,
        inputs: [{ name: 'raw', source: { kind: 'step' } }],
      }],
      final_outputs: FINAL_OUTPUTS,
    }, { agent: parent })
    expect(missingStep.isError).toBe(true)
  })

  it('rejects a compose source with a blank field or step id', async () => {
    const { ctx, parent } = await setup()
    const id = await composedRecord(ctx, parent)
    const blankField = await execute(ctx, 'business_workflow_compose', {
      workflow_id: id,
      steps: [{
        ...STEPS[0]!,
        inputs: [{ name: 'raw', source: { kind: 'requirement', field: '' } }],
      }],
      final_outputs: FINAL_OUTPUTS,
    }, { agent: parent })
    expect(blankField.isError).toBe(true)

    const blankStep = await execute(ctx, 'business_workflow_compose', {
      workflow_id: id,
      steps: [{
        ...STEPS[0]!,
        inputs: [{ name: 'raw', source: { kind: 'step', step: '' } }],
      }],
      final_outputs: FINAL_OUTPUTS,
    }, { agent: parent })
    expect(blankStep.isError).toBe(true)
  })

  it('rejects a contains expectation with a blank value', async () => {
    const { ctx, parent } = await setup()
    const result = await execute(ctx, 'business_workflow_clarify', {
      requirement: {
        ...REQUIREMENT,
        acceptance_cases: [{ name: 'blank', given: { leads: [] }, expect: { kind: 'contains', value: '' } }],
      },
    }, { agent: parent })
    expect(result.isError).toBe(true)
  })

  it('verifies through the dry-run and promotes the record to verified', async () => {
    const prompts: string[] = []
    const { ctx, parent } = await setup({ prompts })
    const id = await composedRecord(ctx, parent)
    const result = await execute(ctx, 'business_workflow_verify', { workflow_id: id }, { agent: parent })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected verify success')
    expect(result.value).toMatchObject({
      passed: true,
      stage: 'verified',
      dry_run: true,
      fix_hints: [],
    })
    const value = result.value as { case_results: { name: string; status: string; steps: { step_id: string }[] }[] }
    expect(value.case_results[0]).toMatchObject({ name: 'sample', status: 'passed' })
    expect(value.case_results[0]?.steps).toEqual([
      { step_id: 'score', status: 'completed', detail: 'scored output' },
    ])
    // The delegated prompt carries the step identity and its resolved inputs.
    expect(prompts[0]).toContain('Step: Score leads')
    expect(prompts[0]).toContain('Score each lead.')
    expect(prompts[0]).toContain('{"raw":["alpha"]}')
    expect(result.content[0]?.type === 'text' ? result.content[0].text : '')
      .toContain('verification passed (stage verified, dry-run executed)')
  })

  it('reports a failing verification instead of erroring when a step delegation fails', async () => {
    const { ctx, parent } = await setup({ reply: '  ' })
    const id = await composedRecord(ctx, parent)
    const result = await execute(ctx, 'business_workflow_verify', { workflow_id: id }, { agent: parent })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected verify success')
    expect(result.value).toMatchObject({ passed: false, stage: 'composed' })
  })

  it('names the delegated stop reason, with and without a diagnostic', async () => {
    const withDiagnostic = await setup({ failureDiagnostic: 'transport down' })
    const idWith = await composedRecord(withDiagnostic.ctx, withDiagnostic.parent)
    const diagnosed = await execute(withDiagnostic.ctx, 'business_workflow_verify', { workflow_id: idWith }, { agent: withDiagnostic.parent })
    expect(diagnosed.isError).toBe(false)
    if (diagnosed.isError) throw new Error('expected verify success')
    const failedCase = (diagnosed.value as { case_results: { detail?: string }[] }).case_results[0]
    expect(failedCase?.detail).toContain('step delegation ended error: transport down')

    const withoutDiagnostic = await setup({ failureDiagnostic: null })
    const idWithout = await composedRecord(withoutDiagnostic.ctx, withoutDiagnostic.parent)
    const bare = await execute(withoutDiagnostic.ctx, 'business_workflow_verify', { workflow_id: idWithout }, { agent: withoutDiagnostic.parent })
    expect(bare.isError).toBe(false)
    const bareCase = (bare.value as { case_results: { detail?: string }[] }).case_results[0]
    expect(bareCase?.detail).toContain('step delegation ended error')
    expect(bareCase?.detail).not.toContain(': transport')
  })

  it('skips the dry-run when the static case check fails and renders the failure', async () => {
    const { ctx, parent } = await setup()
    const clarified = await execute(ctx, 'business_workflow_clarify', {
      requirement: {
        ...REQUIREMENT,
        acceptance_cases: [{ name: 'sparse', given: {}, expect: { kind: 'nonEmpty' } }],
      },
    }, { agent: parent })
    const id = (clarified.value as { workflow_id: string }).workflow_id
    await execute(ctx, 'business_workflow_compose', { workflow_id: id, steps: STEPS, final_outputs: FINAL_OUTPUTS }, { agent: parent })
    const result = await execute(ctx, 'business_workflow_verify', { workflow_id: id }, { agent: parent })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected verify success')
    expect(result.value).toMatchObject({
      passed: false,
      stage: 'composed',
      dry_run: false,
      fix_hints: ['Provide every requirement input field in each acceptance case\'s given: case "sparse" is missing input "leads"'],
    })
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    expect(text).toContain('dry-run skipped')
    expect(text).toContain('- static check case-input-coverage failed')
    expect(text).toContain('case sparse: skipped')
  })

  it('errors when verify runs without a calling agent', async () => {
    const { ctx } = await setup()
    const id = await composedRecord(ctx, { id: SessionId('ghost') } as unknown as Agent)
    const result = await execute(ctx, 'business_workflow_verify', { workflow_id: id })
    expect(result.isError).toBe(true)
  })

  it('errors when verify runs without a subagent provider', async () => {
    const { ctx, parent } = await setup({ subagents: false })
    const id = await composedRecord(ctx, parent)
    const result = await execute(ctx, 'business_workflow_verify', { workflow_id: id }, { agent: parent })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('expected verify failure')
    expect(result.content[0]?.type === 'text' ? result.content[0].text : '')
      .toContain('requires a subagent provider')
  })
})

/** Brand a workflow id string the tests obtained from tool results. */
function require_businessWorkflowId(id: string): Parameters<LocalBusinessWorkflowRuntime['get']>[0] {
  return id as never
}
