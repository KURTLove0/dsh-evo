import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { BusinessWorkflowError, BusinessWorkflowId } from '@deepseek-ai/dsh-business-workflow'
import type {
  AcceptanceCase, BusinessWorkflowId as BusinessWorkflowIdType,
  RequirementSubmission, WorkflowComposition,
} from '@deepseek-ai/dsh-business-workflow'
import LocalRuntime from '../src/index.ts'

let contexts: Context[] = []

async function runtime(config: Record<string, unknown> = {}): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LocalRuntime, config)
  return ctx
}

afterEach(async () => {
  for (const context of contexts) await context.fiber.dispose()
  contexts = []
})

const caseItem = (overrides: Partial<AcceptanceCase> = {}): AcceptanceCase => ({
  name: 'sample',
  given: { leads: ['alpha', 'beta'] },
  expect: { kind: 'nonEmpty' },
  ...overrides,
})

const completeSubmission = (overrides: Partial<RequirementSubmission> = {}): RequirementSubmission => ({
  summary: 'Rank inbound leads',
  objectives: [{ id: 'rank-leads', statement: 'Score every lead' }],
  inputs: [{ name: 'leads', description: 'Raw lead records' }],
  outputs: [
    { name: 'ranking', description: 'Scored ranking' },
    { name: 'source', description: 'The lead list as given' },
  ],
  acceptanceCases: [caseItem()],
  ...overrides,
})

const chainedComposition = (overrides: Partial<WorkflowComposition> = {}): WorkflowComposition => ({
  steps: [
    {
      id: 'collect',
      title: 'Collect leads',
      instruction: 'Normalize the lead records.',
      dependsOn: [],
      inputs: [{ name: 'leads', source: { kind: 'requirement', field: 'leads' } }],
      objectives: ['rank-leads'],
    },
    {
      id: 'score',
      title: 'Score leads',
      instruction: 'Score each normalized lead.',
      dependsOn: ['collect'],
      inputs: [{ name: 'raw', source: { kind: 'step', step: 'collect' } }],
      objectives: ['rank-leads'],
    },
  ],
  finalOutputs: [
    { name: 'ranking', source: { kind: 'step', step: 'score' } },
    { name: 'source', source: { kind: 'requirement', field: 'leads' } },
  ],
  ...overrides,
})

/** Drive one record through clarification and composition into the verifying stage. */
function verifiedStageReady(ctx: Context): BusinessWorkflowIdType {
  const analysis = ctx.businessWorkflows.submitRequirement({ submission: completeSubmission() })
  ctx.businessWorkflows.compose({ id: analysis.id, composition: chainedComposition() })
  return analysis.id
}

describe('clarification (submitRequirement)', () => {
  it('creates a clarifying record with one gap per missing aspect', async () => {
    const ctx = await runtime()
    const analysis = ctx.businessWorkflows.submitRequirement({
      submission: completeSubmission({
        objectives: [],
        inputs: [],
        outputs: [],
        acceptanceCases: [],
      }),
    })
    expect(analysis.id).toBe('bw-1')
    expect(analysis.stage).toBe('clarifying')
    expect(analysis.ready).toBe(false)
    expect(analysis.revision).toBe(1)
    expect(analysis.gaps.map(gap => gap.topic)).toEqual(['objectives', 'inputs', 'outputs', 'acceptance'])
    expect(analysis.spec).toBeUndefined()
    expect(ctx.businessWorkflows.get(analysis.id)).toMatchObject({
      id: 'bw-1', stage: 'clarifying', revision: 1, summary: 'Rank inbound leads',
    })
  })

  it('records the spec and moves to ready on a complete submission', async () => {
    const ctx = await runtime()
    const analysis = ctx.businessWorkflows.submitRequirement({ submission: completeSubmission() })
    expect(analysis.stage).toBe('ready')
    expect(analysis.ready).toBe(true)
    expect(analysis.gaps).toEqual([])
    expect(analysis.spec).toEqual({
      summary: 'Rank inbound leads',
      objectives: [{ id: 'rank-leads', statement: 'Score every lead' }],
      inputs: [{ name: 'leads', description: 'Raw lead records' }],
      outputs: [
        { name: 'ranking', description: 'Scored ranking' },
        { name: 'source', description: 'The lead list as given' },
      ],
      constraints: [],
      acceptanceCases: [caseItem()],
    })
  })

  it('iterates clarification by resubmitting with the record id', async () => {
    const ctx = await runtime()
    const first = ctx.businessWorkflows.submitRequirement({
      submission: completeSubmission({ acceptanceCases: [] }),
    })
    expect(first.stage).toBe('clarifying')
    const second = ctx.businessWorkflows.submitRequirement({
      id: first.id,
      submission: completeSubmission(),
    })
    expect(second.id).toBe(first.id)
    expect(second.revision).toBe(2)
    expect(second.stage).toBe('ready')
    expect(second.spec).toBeDefined()
  })

  it('collects every submission violation into one REQUIREMENT_INVALID error', async () => {
    const ctx = await runtime()
    expect(() => ctx.businessWorkflows.submitRequirement({
      submission: completeSubmission({
        summary: ' ',
        objectives: [{ id: 'dup', statement: 'x' }, { id: 'dup', statement: 'y' }],
      }),
    })).toThrow(BusinessWorkflowError)
    try {
      ctx.businessWorkflows.submitRequirement({ submission: completeSubmission({ summary: ' ' }) })
      throw new Error('expected REQUIREMENT_INVALID')
    } catch (error) {
      expect((error as BusinessWorkflowError).code).toBe('REQUIREMENT_INVALID')
    }
  })

  it('rejects an update for an unknown record', async () => {
    const ctx = await runtime()
    try {
      ctx.businessWorkflows.submitRequirement({
        id: BusinessWorkflowId('bw-404'),
        submission: completeSubmission(),
      })
      throw new Error('expected UNKNOWN_WORKFLOW')
    } catch (error) {
      expect((error as BusinessWorkflowError).code).toBe('UNKNOWN_WORKFLOW')
    }
  })

  it('enforces the record capacity', async () => {
    const ctx = await runtime({ maxWorkflows: 1 })
    ctx.businessWorkflows.submitRequirement({ submission: completeSubmission() })
    expect(() => ctx.businessWorkflows.submitRequirement({ submission: completeSubmission() }))
      .toThrow(/business workflow limit reached/)
  })
})

describe('composition (compose)', () => {
  it('accepts a valid composition and emits the stage event', async () => {
    const ctx = await runtime()
    const events: string[] = []
    ctx.on('business-workflow/stage', info => events.push(`stage:${info.stage}`))
    const analysis = ctx.businessWorkflows.submitRequirement({ submission: completeSubmission() })
    const outcome = ctx.businessWorkflows.compose({
      id: analysis.id,
      composition: chainedComposition(),
    })
    expect(outcome).toEqual({ id: analysis.id, stage: 'composed', issues: [], stepCount: 2 })
    expect(events).toEqual(['stage:ready', 'stage:composed'])
    expect(ctx.businessWorkflows.get(analysis.id)).toMatchObject({ stage: 'composed', stepCount: 2 })
  })

  it('rejects a draft with issues, keeping the previously accepted composition', async () => {
    const ctx = await runtime()
    const analysis = ctx.businessWorkflows.submitRequirement({ submission: completeSubmission() })
    ctx.businessWorkflows.compose({ id: analysis.id, composition: chainedComposition() })
    const rejected = ctx.businessWorkflows.compose({
      id: analysis.id,
      composition: chainedComposition({ finalOutputs: [] }),
    })
    expect(rejected.stepCount).toBe(0)
    expect(rejected.issues.map(issueEntry => issueEntry.code)).toEqual(['OUTPUT_UNBOUND', 'OUTPUT_UNBOUND'])
    expect(rejected.issues.every(issueEntry => issueEntry.remedy.length > 0)).toBe(true)
    expect(ctx.businessWorkflows.get(analysis.id)).toMatchObject({ stage: 'composed', stepCount: 2 })
  })

  it('keeps a verified record at verified when a revision draft is rejected', async () => {
    const ctx = await runtime()
    const id = verifiedStageReady(ctx)
    return ctx.businessWorkflows.verify({
      id,
      runStep: () => Promise.resolve('scored output'),
    }).then(() => {
      const rejected = ctx.businessWorkflows.compose({
        id,
        composition: chainedComposition({ steps: [], finalOutputs: [] }),
      })
      expect(rejected.stage).toBe('verified')
      expect(ctx.businessWorkflows.get(id)).toMatchObject({ stage: 'verified', stepCount: 2 })
    })
  })

  it('refuses composition while clarifying', async () => {
    const ctx = await runtime()
    const analysis = ctx.businessWorkflows.submitRequirement({
      submission: completeSubmission({ acceptanceCases: [] }),
    })
    expect(() => ctx.businessWorkflows.compose({
      id: analysis.id,
      composition: chainedComposition(),
    })).toThrow(/still clarifying/)
  })

  it('rejects composition for an unknown record', async () => {
    const ctx = await runtime()
    expect(() => ctx.businessWorkflows.compose({
      id: 'bw-404' as never,
      composition: chainedComposition(),
    })).toThrow(BusinessWorkflowError)
  })
})

describe('verification (verify)', () => {
  it('runs the dry-run, asserts each case, and promotes to verified', async () => {
    const ctx = await runtime()
    const events: string[] = []
    ctx.on('business-workflow/stage', info => events.push(`stage:${info.stage}`))
    ctx.on('business-workflow/verification', (_info, summary) => events.push(`verification:${summary.passed}`))
    const id = verifiedStageReady(ctx)
    const report = await ctx.businessWorkflows.verify({
      id,
      runStep: step => Promise.resolve(`done:${step.id}`),
    })
    expect(report.passed).toBe(true)
    expect(report.dryRun).toBe(true)
    expect(report.caseResults).toEqual([{
      name: 'sample',
      status: 'passed',
      steps: [
        { stepId: 'collect', status: 'completed', detail: 'done:collect' },
        { stepId: 'score', status: 'completed', detail: 'done:score' },
      ],
    }])
    expect(report.fixHints).toEqual([])
    expect(events).toEqual([
      'stage:ready', 'stage:composed', 'stage:verified', 'verification:true',
    ])
    expect(ctx.businessWorkflows.get(id)).toMatchObject({ stage: 'verified' })
    expect(ctx.businessWorkflows.get(id).verifiedAt).toBeGreaterThanOrEqual(0)
  })

  it('passes step outputs to dependents and binds outputs from both source kinds', async () => {
    const ctx = await runtime()
    const id = verifiedStageReady(ctx)
    const seenInputs: Array<[string, Record<string, unknown>]> = []
    const report = await ctx.businessWorkflows.verify({
      id,
      runStep: (step, inputs) => {
        seenInputs.push([step.id, inputs])
        return Promise.resolve(step.id === 'collect' ? 'normalized' : 'ranked: gold')
      },
    })
    expect(seenInputs).toEqual([
      ['collect', { leads: ['alpha', 'beta'] }],
      ['score', { raw: 'normalized' }],
    ])
    expect(report.passed).toBe(true)
  })

  it('reports a failed step with its trace and fix hint, staying composed', async () => {
    const ctx = await runtime()
    const id = verifiedStageReady(ctx)
    const report = await ctx.businessWorkflows.verify({
      id,
      runStep: step => step.id === 'score'
        ? Promise.reject(new Error('model refused'))
        : Promise.resolve('normalized'),
    })
    expect(report.passed).toBe(false)
    expect(report.caseResults[0]).toMatchObject({
      name: 'sample',
      status: 'failed',
      detail: 'step "score" failed: Error: model refused',
    })
    expect(report.caseResults[0]?.steps).toEqual([
      { stepId: 'collect', status: 'completed', detail: 'normalized' },
      { stepId: 'score', status: 'failed', detail: 'Error: model refused' },
    ])
    expect(report.fixHints).toHaveLength(1)
    expect(report.fixHints[0]).toContain('sample')
    expect(ctx.businessWorkflows.get(id).stage).toBe('composed')
  })

  it('demotes a verified record to composed on a failing re-verification', async () => {
    const ctx = await runtime()
    const id = verifiedStageReady(ctx)
    await ctx.businessWorkflows.verify({ id, runStep: () => Promise.resolve('ok') })
    expect(ctx.businessWorkflows.get(id).stage).toBe('verified')
    const report = await ctx.businessWorkflows.verify({
      id,
      runStep: () => Promise.resolve('  '),
    })
    expect(report.passed).toBe(false)
    expect(ctx.businessWorkflows.get(id)).toMatchObject({ stage: 'composed' })
    expect(ctx.businessWorkflows.get(id).verifiedAt).toBeUndefined()
  })

  it('skips the dry-run when a case given misses a requirement input', async () => {
    const ctx = await runtime()
    const analysis = ctx.businessWorkflows.submitRequirement({
      submission: completeSubmission({
        acceptanceCases: [caseItem({ name: 'sparse', given: {} })],
      }),
    })
    ctx.businessWorkflows.compose({ id: analysis.id, composition: chainedComposition() })
    const runner = vi.fn()
    const report = await ctx.businessWorkflows.verify({ id: analysis.id, runStep: runner })
    expect(report.passed).toBe(false)
    expect(report.dryRun).toBe(false)
    expect(report.staticChecks).toEqual([{
      name: 'case-input-coverage',
      passed: false,
      detail: 'case "sparse" is missing input "leads"',
    }])
    expect(report.caseResults).toEqual([{
      name: 'sparse', status: 'skipped', detail: 'static case checks failed; dry-run skipped',
    }])
    expect(report.fixHints[0]).toContain('Provide every requirement input field')
    expect(runner).not.toHaveBeenCalled()
    expect(ctx.businessWorkflows.get(analysis.id).stage).toBe('composed')
  })

  it('fails a case whose final output violates a nonEmpty expectation', async () => {
    const ctx = await runtime()
    const id = verifiedStageReady(ctx)
    const report = await ctx.businessWorkflows.verify({
      id,
      runStep: () => Promise.resolve('  '),
    })
    expect(report.caseResults[0]).toMatchObject({ status: 'failed', detail: 'final output "ranking" is empty' })
  })

  it('fails a case whose outputs miss a contains expectation', async () => {
    const ctx = await runtime()
    const analysis = ctx.businessWorkflows.submitRequirement({
      submission: completeSubmission({
        acceptanceCases: [caseItem({ expect: { kind: 'contains', value: 'gold' } })],
      }),
    })
    ctx.businessWorkflows.compose({ id: analysis.id, composition: chainedComposition() })
    const report = await ctx.businessWorkflows.verify({
      id: analysis.id,
      runStep: () => Promise.resolve('silver tier'),
    })
    expect(report.caseResults[0]?.detail).toBe('serialized final outputs do not contain "gold"')
  })

  it('aborts before any step when the signal already fired', async () => {
    const ctx = await runtime()
    const id = verifiedStageReady(ctx)
    const controller = new AbortController()
    controller.abort()
    const runner = vi.fn()
    await expect(ctx.businessWorkflows.verify({ id, runStep: runner, signal: controller.signal }))
      .rejects.toThrow(BusinessWorkflowError)
    expect(runner).not.toHaveBeenCalled()
  })

  it('aborts mid-run when a step failure coincides with the caller signal', async () => {
    const ctx = await runtime()
    const id = verifiedStageReady(ctx)
    const controller = new AbortController()
    await expect(ctx.businessWorkflows.verify({
      id,
      runStep: async () => {
        controller.abort()
        throw new Error('cancelled underneath')
      },
      signal: controller.signal,
    })).rejects.toThrow(/aborted/)
  })

  it('refuses verification before a composition is accepted', async () => {
    const ctx = await runtime()
    const analysis = ctx.businessWorkflows.submitRequirement({ submission: completeSubmission() })
    await expect(ctx.businessWorkflows.verify({
      id: analysis.id,
      runStep: () => Promise.resolve('x'),
    })).rejects.toThrow(/no accepted composition/)
  })

  it('rejects verification for an unknown record', async () => {
    const ctx = await runtime()
    await expect(ctx.businessWorkflows.verify({
      id: 'bw-404' as never,
      runStep: () => Promise.resolve('x'),
    })).rejects.toThrow(BusinessWorkflowError)
  })

  it('traces each step detail at the configured cap', async () => {
    const ctx = await runtime({ maxTraceChars: 4 })
    const id = verifiedStageReady(ctx)
    const report = await ctx.businessWorkflows.verify({
      id,
      runStep: () => Promise.resolve('0123456789'),
    })
    expect(report.caseResults[0]?.steps?.[0]?.detail).toBe('0123… [truncated: 6 more characters]')
  })
})

describe('snapshots and lifecycle', () => {
  it('projects fresh snapshots in creation order', async () => {
    const ctx = await runtime()
    ctx.businessWorkflows.submitRequirement({ submission: completeSubmission() })
    ctx.businessWorkflows.submitRequirement({
      submission: completeSubmission({ summary: 'Second need' }),
    })
    const list = ctx.businessWorkflows.list()
    expect(list.map(snapshot => snapshot.summary)).toEqual(['Rank inbound leads', 'Second need'])
    const again = ctx.businessWorkflows.list()
    expect(again[0]).toEqual(list[0])
    expect(again[0]).not.toBe(list[0])
    const before = ctx.businessWorkflows.get(list[0]!.id)
    expect(ctx.businessWorkflows.get(list[0]!.id)).toEqual(before)
    expect(ctx.businessWorkflows.get(list[0]!.id)).not.toBe(before)
  })

  it('discards the composition when a requirement revision arrives', async () => {
    const ctx = await runtime()
    const id = verifiedStageReady(ctx)
    await ctx.businessWorkflows.verify({ id, runStep: () => Promise.resolve('ok') })
    expect(ctx.businessWorkflows.get(id)).toMatchObject({ stage: 'verified', stepCount: 2 })
    const revised = ctx.businessWorkflows.submitRequirement({
      id,
      submission: completeSubmission({ summary: 'Rank leads, faster' }),
    })
    expect(revised.stage).toBe('ready')
    expect(ctx.businessWorkflows.get(id)).toMatchObject({
      stage: 'ready', revision: 2, summary: 'Rank leads, faster',
    })
    expect(ctx.businessWorkflows.get(id).stepCount).toBeUndefined()
    expect(ctx.businessWorkflows.get(id).verifiedAt).toBeUndefined()
  })

  it('clears its records on service disposal', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LocalRuntime, {})
    ctx.businessWorkflows.submitRequirement({ submission: completeSubmission() })
    expect(ctx.businessWorkflows.list()).toHaveLength(1)
    await ctx.fiber.dispose()
    expect(ctx.get('businessWorkflows')).toBeUndefined()
  })
})
