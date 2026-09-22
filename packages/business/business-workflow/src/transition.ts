/**
 * The stage-transition predicate shared by the Service Definition's public API
 * and its invariant companion. A leaf module so the bundled `lib/invariant.js`
 * entry inlines it instead of sharing a chunk with `lib/index.js`.
 *
 * @module @deepseek-ai/dsh-business-workflow/transition
 */

import type { BusinessWorkflowStage } from './types.ts'

/**
 * Whether one stage may follow another under the transition contract.
 * @param from - the record's stage before the transition.
 * @param to - the record's stage after the transition.
 * @returns whether the pair is one of the contract's transitions.
 */
export function isBusinessWorkflowStageTransition(
  from: BusinessWorkflowStage,
  to: BusinessWorkflowStage,
): boolean {
  // A stage event fires exactly on change, so an identical pair is not a transition.
  if (from === to) return false
  switch (from) {
    case 'clarifying':
      return to === 'ready'
    case 'ready':
      return to === 'composed' || to === 'clarifying'
    case 'composed':
    case 'verified':
      // Every non-identity pair here is admitted: a requirement revision
      // (ready/clarifying), a re-composition (composed), or a verification
      // verdict change (verified).
      return true
  }
}
