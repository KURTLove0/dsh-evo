/** Package-owned business-workflow event invariants. @module @deepseek-ai/dsh-business-workflow/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {
  BusinessWorkflowInfo,
  BusinessWorkflowStage,
  VerificationSummary,
} from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-business-workflow'
const STAGES = new Set(['clarifying', 'ready', 'composed', 'verified'])

/** Cordis companion plugin name. */
export const name = 'business-workflow-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * The companion's private copy of the transition table. It deliberately does
 * NOT import `isBusinessWorkflowStageTransition`: an invariant re-derives the
 * contract independently so drift between the published predicate
 * (`./transition.ts`) and the event stream fails here instead of being
 * self-confirming, and the bundled `lib/invariant.js` entry stays self-contained.
 * @param from - the record's stage before the transition.
 * @param to - the record's stage after the transition.
 * @returns whether the pair is one of the contract's transitions.
 */
function isAdmittedTransition(from: BusinessWorkflowStage, to: BusinessWorkflowStage): boolean {
  if (from === to) return false
  switch (from) {
    case 'clarifying':
      return to === 'ready'
    case 'ready':
      return to === 'composed' || to === 'clarifying'
    case 'composed':
    case 'verified':
      return true
  }
}

/** Require an event payload's stage to be one of the four known stages. */
function assertStage(stage: string, fail: InvariantFailure): void {
  if (!STAGES.has(stage)) {
    fail(`business-workflow event carries unknown stage ${JSON.stringify(stage)}`)
  }
}

/** Install stage-transition and verification-consistency checks over the seam's events. */
const install: InvariantInstaller = (ctx, fail) => {
  const stages = new Map<string, string>()

  ctx.on('business-workflow/stage', (info: BusinessWorkflowInfo) => {
    assertStage(info.stage, fail)
    const id = String(info.id)
    const previous = stages.get(id)
    if (previous !== undefined && !isAdmittedTransition(previous as BusinessWorkflowStage, info.stage)) {
      fail(`business-workflow/stage for ${JSON.stringify(id)} moves ${JSON.stringify(previous)} to ${JSON.stringify(info.stage)}, which the transition contract does not admit`)
    }
    stages.set(id, info.stage)
  }, { global: true })

  ctx.on('business-workflow/verification', (info: BusinessWorkflowInfo, summary: VerificationSummary) => {
    const id = String(info.id)
    const stage = stages.get(id)
    if (stage === undefined) {
      fail(`business-workflow/verification for ${JSON.stringify(id)} has no prior business-workflow/stage event`)
      return
    }
    assertStage(info.stage, fail)
    if (stage !== info.stage) {
      fail(`business-workflow/verification for ${JSON.stringify(id)} carries stage ${JSON.stringify(info.stage)}, but the record's last stage event recorded ${JSON.stringify(stage)}`)
    }
    // The report is recorded and any promotion published before this event,
    // so a passing verification must already read as `verified` and a failing
    // one must have settled at `composed` (never still claiming `verified`).
    if (summary.passed !== (info.stage === 'verified')) {
      fail(`business-workflow/verification for ${JSON.stringify(id)} reports passed=${summary.passed} at stage ${JSON.stringify(info.stage)}`)
    }
    if (!Number.isSafeInteger(summary.caseCount) || summary.caseCount < 0) {
      fail(`business-workflow/verification for ${JSON.stringify(id)} carries a non-natural caseCount`)
    }
    if (typeof summary.dryRun !== 'boolean') {
      fail(`business-workflow/verification for ${JSON.stringify(id)} carries a non-boolean dryRun`)
    }
  }, { global: true })
}

/**
 * Register the business-workflow invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
