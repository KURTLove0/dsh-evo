import { describe, expect, it } from 'vitest'
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
    expect(() => { ctx.emit('business-workflow/stage', info('frozen' as BusinessWorkflowInfo['stage'])) })
      .toThrow(/unknown stage/)
  })

  it('rejects a non-contract transition', async () => {
    const ctx = await setup()
    ctx.emit('business-workflow/stage', info('ready'))
    expect(() => { ctx.emit('business-workflow/stage', info('verified')) })
      .toThrow(/does not admit/)
  })

  it('rejects an identity transition (a stage event fires exactly on change)', async () => {
    const ctx = await setup()
    ctx.emit('business-workflow/stage', info('composed'))
    expect(() => { ctx.emit('business-workflow/stage', info('composed')) })
      .toThrow(/does not admit/)
  })

  it('rejects a verification without a prior stage event', async () => {
    const ctx = await setup()
    expect(() => { ctx.emit('business-workflow/verification', info('verified'), summary()) })
      .toThrow(/no prior business-workflow\/stage/)
  })

  it('rejects a verification whose stage disagrees with the last stage event', async () => {
    const ctx = await setup()
    ctx.emit('business-workflow/stage', info('composed'))
    expect(() => { ctx.emit('business-workflow/verification', info('verified'), summary()) })
      .toThrow(/record's last stage event/)
  })

  it('rejects a passing verification that still reads composed', async () => {
    const ctx = await setup()
    ctx.emit('business-workflow/stage', info('composed'))
    expect(() => { ctx.emit('business-workflow/verification', info('composed'), summary({ passed: true })) })
      .toThrow(/reports passed=true at stage/)
  })

  it('rejects a failing verification that still reads verified', async () => {
    const ctx = await setup()
    ctx.emit('business-workflow/stage', info('ready'))
    ctx.emit('business-workflow/stage', info('composed'))
    ctx.emit('business-workflow/stage', info('verified'))
    expect(() => { ctx.emit('business-workflow/verification', info('verified'), summary({ passed: false })) })
      .toThrow(/reports passed=false at stage/)
  })

  it('rejects a non-natural caseCount and a non-boolean dryRun', async () => {
    const counted = await setup()
    counted.emit('business-workflow/stage', info('ready'))
    counted.emit('business-workflow/stage', info('composed'))
    counted.emit('business-workflow/stage', info('verified'))
    expect(() => { counted.emit('business-workflow/verification', info('verified'), summary({ caseCount: -1 })) })
      .toThrow(/non-natural caseCount/)

    const flagged = await setup()
    flagged.emit('business-workflow/stage', info('ready'))
    flagged.emit('business-workflow/stage', info('composed'))
    flagged.emit('business-workflow/stage', info('verified'))
    expect(() => { flagged.emit('business-workflow/verification', info('verified'), summary({ dryRun: 'yes' as unknown as boolean })) })
      .toThrow(/non-boolean dryRun/)
  })
})
