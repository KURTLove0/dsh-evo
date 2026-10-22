import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { WorkflowRun } from '../src/workbench-types.ts'
import { Context } from '@deepseek-ai/cordis'
import { BusinessWorkflowId } from '../src/index.ts'
import type { BusinessWorkflowInfo, VerificationSummary } from '../src/index.ts'
import * as BusinessWorkflowInvariant from '../src/invariant.ts'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(BusinessWorkflowInvariant)
  return ctx
}

const info = (stage: BusinessWorkflowInfo['stage'], id = 'bw-1'): BusinessWorkflowInfo => ({
  id: BusinessWorkflowId(id),
  stage,
})

const summary = (overrides: Partial<VerificationSummary> = {}): VerificationSummary => ({
  passed: true,
  caseCount: 1,
  dryRun: true,
  ...overrides,
})

describe('business-workflow invariants', () => {
  it('accepts a complete lifecycle: clarify, compose, verify, revise, and re-verify', async () => {
    const ctx = await setup()
    ctx.emit('business-workflow/stage', info('clarifying'))
    ctx.emit('business-workflow/stage', info('ready'))
    ctx.emit('business-workflow/stage', info('composed'))
    ctx.emit('business-workflow/stage', info('verified'))
    ctx.emit('business-workflow/verification', info('verified'), summary())
    ctx.emit('business-workflow/stage', info('composed'))
    ctx.emit('business-workflow/stage', info('verified'))
    ctx.emit('business-workflow/verification', info('verified'), summary())
  })

  it('accepts a failing verification that settles at composed', async () => {
    const ctx = await setup()
    ctx.emit('business-workflow/stage', info('clarifying'))
    ctx.emit('business-workflow/stage', info('ready'))
    ctx.emit('business-workflow/stage', info('composed'))
    ctx.emit('business-workflow/verification', info('composed'), summary({ passed: false }))
  })

  it('accepts a fresh record created directly at ready', async () => {
    const ctx = await setup()
    ctx.emit('business-workflow/stage', info('ready'))
    ctx.emit('business-workflow/stage', info('composed'))
    ctx.emit('business-workflow/stage', info('verified'))
    ctx.emit('business-workflow/verification', info('verified'), summary())
  })

  it('rejects an unknown stage value', async () => {
    const ctx = await setup()
    expect(() => {
      ctx.emit('business-workflow/stage', info('frozen' as BusinessWorkflowInfo['stage']))
    }).toThrow(/unknown stage/)
  })

  it('rejects a non-contract transition', async () => {
    const ctx = await setup()
    ctx.emit('business-workflow/stage', info('ready'))
    expect(() => {
      ctx.emit('business-workflow/stage', info('verified'))
    }).toThrow(/does not admit/)
  })

  it('rejects an identity transition (a stage event fires exactly on change)', async () => {
    const ctx = await setup()
    ctx.emit('business-workflow/stage', info('composed'))
    expect(() => {
      ctx.emit('business-workflow/stage', info('composed'))
    }).toThrow(/does not admit/)
  })

  it('rejects a verification without a prior stage event', async () => {
    const ctx = await setup()
    expect(() => {
      ctx.emit('business-workflow/verification', info('verified'), summary())
    }).toThrow(/no prior business-workflow\/stage/)
  })

  it('rejects a verification whose stage disagrees with the last stage event', async () => {
    const ctx = await setup()
    ctx.emit('business-workflow/stage', info('composed'))
    expect(() => {
      ctx.emit('business-workflow/verification', info('verified'), summary())
    }).toThrow(/record's last stage event/)
  })

  it('rejects a passing verification that still reads composed', async () => {
    const ctx = await setup()
    ctx.emit('business-workflow/stage', info('composed'))
    expect(() => {
      ctx.emit('business-workflow/verification', info('composed'), summary({ passed: true }))
    }).toThrow(/reports passed=true at stage/)
  })

  it('rejects a failing verification that still reads verified', async () => {
    const ctx = await setup()
    ctx.emit('business-workflow/stage', info('ready'))
    ctx.emit('business-workflow/stage', info('composed'))
    ctx.emit('business-workflow/stage', info('verified'))
    expect(() => {
      ctx.emit('business-workflow/verification', info('verified'), summary({ passed: false }))
    }).toThrow(/reports passed=false at stage/)
  })

  it('rejects a non-natural caseCount and a non-boolean dryRun', async () => {
    const counted = await setup()
    counted.emit('business-workflow/stage', info('ready'))
    counted.emit('business-workflow/stage', info('composed'))
    counted.emit('business-workflow/stage', info('verified'))
    expect(() => {
      counted.emit('business-workflow/verification', info('verified'), summary({ caseCount: -1 }))
    }).toThrow(/non-natural caseCount/)

    const flagged = await setup()
    flagged.emit('business-workflow/stage', info('ready'))
    flagged.emit('business-workflow/stage', info('composed'))
    flagged.emit('business-workflow/stage', info('verified'))
    expect(() => {
      flagged.emit('business-workflow/verification', info('verified'), summary({ dryRun: 'yes' as unknown as boolean }))
    }).toThrow(/non-boolean dryRun/)
  })
})

describe('workflow run checkpoint invariants', () => {
  function run(): WorkflowRun {
    return {
      id: 'run',
      workflowId: 'workflow',
      workspaceId: 'workspace',
      sessionId: 'audit',
      status: 'running',
      seq: 1,
      version: {
        id: 'v1',
        number: 1,
        revision: 1,
        createdAt: 0,
        definition: {
          requirement: {
            summary: 'Review',
            objectives: [],
            inputs: [],
            outputs: [],
            constraints: [],
            acceptanceCases: [],
          },
          nodes: [
            {
              id: 'review',
              kind: 'approval',
              title: 'Review',
              instruction: 'Confirm',
              preset: 'standard',
              dependsOn: [],
              inputs: [],
              objectives: [],
            },
          ],
          finalOutputs: [{ name: 'result', source: { kind: 'step', step: 'review' } }],
          positions: {},
        },
      },
      execution: { provider: 'mock', model: 'mock', subagentProvider: 'spawn' },
      mode: 'execution',
      inputs: {},
      outputs: {},
      createdAt: 0,
      updatedAt: 0,
      attempts: [{ id: 'attempt', nodeId: 'review', status: 'running', inputs: {}, preset: 'standard', cwd: '/tmp' }],
    } as unknown as WorkflowRun
  }
  it('accepts successive checkpoints from one audit and publication', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('audit'))
    const first = run()
    ctx.emit('session/event', session, { type: 'business-workflow/checkpoint', data: first, seq: 0, time: 0 })
    ctx.emit('session/event', session, {
      type: 'business-workflow/checkpoint',
      data: { ...first, seq: 2 },
      seq: 1,
      time: 0,
    })
    ctx.emit('session/event', session, { type: 'business-workflow/checkpoint',
      data: { ...first, seq: 3, status: 'succeeded', outputs: { result: 'Delivered' }, attempts: [{ ...first.attempts[0]!, status: 'succeeded' }] },
      seq: 2, time: 0 })
    ctx.emit('session/event', session, { type: 'session/info', data: { title: 'Other event' }, seq: 3, time: 0 } as never)
  })
  it('preserves complete retry identity across checkpoints and rejects conflicting ownership', async () => {
    const ctx = await setup(), session = Session.create(SessionId('audit'))
    const first = { ...run(), retryRequest: 'retry' as never, rerunOf: 'source' as never }
    const emit = (data: WorkflowRun) => { ctx.emit('session/event', session, { type: 'business-workflow/checkpoint', data, seq: data.seq, time: 0 }) }
    emit(first)
    expect(() => { emit({ ...first, seq: 2, rerunOf: undefined } as never) }).toThrow('lacks a distinct source')
    expect(() => { emit({ ...first, seq: 2, rerunOf: first.id }) }).toThrow('lacks a distinct source')
    expect(() => { emit({ ...first, seq: 2, requestId: 'ordinary' as never }) }).toThrow('conflicts with ordinary')
    expect(() => { emit({ ...first, seq: 2, retryRequest: 'other' as never }) }).toThrow('changes its retry')
    expect(() => { emit({ ...first, seq: 2, rerunOf: 'other' as never }) }).toThrow('changes its retry')
    emit({ ...first, seq: 2 })
    const ordinary = await setup()
    ordinary.emit('session/event', session, { type: 'business-workflow/checkpoint', data: run(), seq: 0, time: 0 })
    expect(() => { ordinary.emit('session/event', session, { type: 'business-workflow/checkpoint',
      data: { ...run(), seq: 2, requestId: 'changed' as never }, seq: 1, time: 0 }) }).toThrow('changes its retry')
  })
  it.each(['session', 'version', 'sequence', 'nodes', 'outputs'])(
    'rejects a checkpoint with inconsistent %s',
    async (fault) => {
      const ctx = await setup()
      const session = Session.create(SessionId('audit'))
      const first = run()
      ctx.emit('session/event', session, { type: 'business-workflow/checkpoint', data: first, seq: 0, time: 0 })
      const next = { ...structuredClone(first), seq: 2 }
      if (fault === 'session') next.sessionId = SessionId('other')
      if (fault === 'version') next.version.id = 'v2' as typeof next.version.id
      if (fault === 'sequence') next.seq = 9
      if (fault === 'nodes') next.attempts = []
      if (fault === 'outputs') next.status = 'succeeded'
      expect(() => {
        ctx.emit('session/event', session, { type: 'business-workflow/checkpoint', data: next, seq: 1, time: 0 })
      }).toThrow()
    },
  )
})
