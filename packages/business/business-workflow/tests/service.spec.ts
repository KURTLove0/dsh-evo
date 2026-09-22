import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { BusinessWorkflowId, BusinessWorkflowError, BusinessWorkflowRuntime, isBusinessWorkflowStageTransition } from '../src/index.ts'
import type {
  BusinessWorkflowSnapshot, CompositionOutcome, CompositionRequest, RequirementAnalysis,
  RequirementSubmissionRequest, VerificationReport, VerificationRequest,
} from '../src/index.ts'

/**
 * Minimal concrete runtime: one canned record. The Service Definition owns
 * the contract only (identity, stage transitions, event dispatch); the
 * behavior suite lives with `@deepseek-ai/dsh-business-workflow-local`.
 */
class StubRuntime extends BusinessWorkflowRuntime {
  submitRequirement(request: RequirementSubmissionRequest): RequirementAnalysis {
    return {
      id: request.id ?? BusinessWorkflowId('bw-1'),
      stage: 'ready',
      revision: 1,
      ready: true,
      gaps: [],
      spec: {
        summary: 'draft',
        objectives: [],
        inputs: [],
        outputs: [],
        constraints: [],
        acceptanceCases: [],
      },
    }
  }

  compose(request: CompositionRequest): CompositionOutcome {
    this.emitBusinessWorkflowEvent('business-workflow/stage', { id: request.id, stage: 'composed' })
    return { id: request.id, stage: 'composed', issues: [], stepCount: 1 }
  }

  async verify(request: VerificationRequest): Promise<VerificationReport> {
    await request.runStep({ id: 's', title: 't', instruction: 'i', dependsOn: [], inputs: [], objectives: [] }, {}, { signal: new AbortController().signal })
    return { id: request.id, passed: true, staticChecks: [], caseResults: [], fixHints: [], dryRun: true }
  }

  get(id: BusinessWorkflowId): BusinessWorkflowSnapshot {
    return { id, stage: 'verified', revision: 1, summary: 'draft', stepCount: 1, verifiedAt: 0 }
  }

  list(): BusinessWorkflowSnapshot[] {
    return [this.get(BusinessWorkflowId('bw-1'))]
  }
}

describe('BusinessWorkflowRuntime seam', () => {
  it('a concrete subclass registers as ctx.businessWorkflows and serves the abstract API', async () => {
    const ctx = new Context()
    await ctx.plugin(StubRuntime)

    const analysis = ctx.businessWorkflows.submitRequirement({ submission: {
      summary: 'draft', objectives: [], inputs: [], outputs: [], acceptanceCases: [],
    } })
    expect(analysis.ready).toBe(true)
    const outcome = ctx.businessWorkflows.compose({ id: BusinessWorkflowId('bw-1'), composition: { steps: [], finalOutputs: [] } })
    expect(outcome.stage).toBe('composed')
    await expect(ctx.businessWorkflows.verify({
      id: BusinessWorkflowId('bw-1'),
      runStep: () => Promise.resolve(''),
    })).resolves.toMatchObject({ passed: true })
    expect(ctx.businessWorkflows.list()).toHaveLength(1)
    expect(ctx.businessWorkflows.get(BusinessWorkflowId('bw-1')).stage).toBe('verified')
  })

  it('loading a second implementation throws (one businessWorkflows service per context — cordis standard)', async () => {
    const ctx = new Context()
    await ctx.plugin(StubRuntime)
    class SecondRuntime extends StubRuntime {}
    await expect(ctx.plugin(SecondRuntime)).rejects.toThrow(/service "businessWorkflows" has been registered/)
  })

  it('mounting the abstract seam directly fails loudly at load (stale-composition fence)', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(BusinessWorkflowRuntime as unknown as typeof StubRuntime))
      .rejects.toThrow(/abstract business-workflow seam; load an implementation such as @deepseek-ai\/dsh-business-workflow-local/)
  })

  it('contains throwing and rejecting lifecycle listeners while emitting', async () => {
    const ctx = new Context()
    await ctx.plugin(StubRuntime)
    ctx.on('business-workflow/stage', () => { throw new Error('sync boom') })
    ctx.on('business-workflow/stage', () => { throw Object.create(null) })
    // Runtime listeners may return thenables even though the declaration's
    // observable result is void; each rejection stays contained.
    // oxlint-disable-next-line typescript/no-misused-promises -- exercises rejected-listener containment
    ctx.on('business-workflow/stage', async () => { throw new Error('async boom') })
    // A hostile non-Error rejection exercises the unrenderable-render path.
    // oxlint-disable-next-line typescript/no-misused-promises -- exercises the unrenderable-render containment path
    ctx.on('business-workflow/stage', async () => { throw Object.create(null) })
    // The emit must settle for every listener despite all four failing.
    const outcome = ctx.businessWorkflows.compose({
      id: BusinessWorkflowId('bw-1'),
      composition: { steps: [], finalOutputs: [] },
    })
    expect(outcome.stage).toBe('composed')
    // Await the event loop so the rejected-promise containment paths run.
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
  })

  it('BusinessWorkflowError keeps its machine-routable code', () => {
    const cause = new Error('cause')
    const error = new BusinessWorkflowError('message', 'STAGE_VIOLATION', { cause })
    expect(error).toBeInstanceOf(HarnessError)
    expect(error.code).toBe('STAGE_VIOLATION')
    expect(error.name).toBe('BusinessWorkflowError')
    expect(error.message).toBe('message')
    expect(error.cause).toBe(cause)
  })
})

describe('isBusinessWorkflowStageTransition', () => {
  it('admits exactly the contract transitions', () => {
    expect(isBusinessWorkflowStageTransition('clarifying', 'ready')).toBe(true)
    expect(isBusinessWorkflowStageTransition('ready', 'composed')).toBe(true)
    expect(isBusinessWorkflowStageTransition('ready', 'clarifying')).toBe(true)
    expect(isBusinessWorkflowStageTransition('composed', 'ready')).toBe(true)
    expect(isBusinessWorkflowStageTransition('composed', 'clarifying')).toBe(true)
    expect(isBusinessWorkflowStageTransition('composed', 'verified')).toBe(true)
    expect(isBusinessWorkflowStageTransition('verified', 'ready')).toBe(true)
    expect(isBusinessWorkflowStageTransition('verified', 'clarifying')).toBe(true)
    expect(isBusinessWorkflowStageTransition('verified', 'composed')).toBe(true)
  })

  it('rejects every non-contract pair', () => {
    expect(isBusinessWorkflowStageTransition('clarifying', 'clarifying')).toBe(false)
    expect(isBusinessWorkflowStageTransition('clarifying', 'composed')).toBe(false)
    expect(isBusinessWorkflowStageTransition('clarifying', 'verified')).toBe(false)
    expect(isBusinessWorkflowStageTransition('ready', 'ready')).toBe(false)
    expect(isBusinessWorkflowStageTransition('ready', 'verified')).toBe(false)
    expect(isBusinessWorkflowStageTransition('composed', 'composed')).toBe(false)
    expect(isBusinessWorkflowStageTransition('verified', 'verified')).toBe(false)
  })
})
