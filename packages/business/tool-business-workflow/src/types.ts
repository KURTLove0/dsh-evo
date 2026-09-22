/**
 * Browser-safe durable business-workflow events written by the model-facing
 * business-workflow tools into their calling parent Session. The UI plugin
 * folds this stream into its per-session panel; replay recomputes the same
 * view from the log.
 *
 * @module @deepseek-ai/dsh-tool-business-workflow/types
 */

import type { BusinessWorkflowId } from '@deepseek-ai/dsh-business-workflow/types'
import type {
  BusinessWorkflowStage,
  CaseResult,
  ClarificationGap,
  CompositionIssue,
  VerificationSummary,
} from '@deepseek-ai/dsh-business-workflow/types'

/** Opens one durable business-workflow record: the record's identity and first stage. */
export interface ToolBusinessWorkflowStartData {
  readonly workflowId: BusinessWorkflowId
  /** The requirement's one-sentence summary (display). */
  readonly summary: string
  /** The stage after this submission. */
  readonly stage: BusinessWorkflowStage
  /** The submission's 1-based revision. */
  readonly revision: number
}

/** Records one clarification analysis: the gaps the next submission must resolve. */
export interface ToolBusinessWorkflowClarifiedData {
  readonly workflowId: BusinessWorkflowId
  /** The stage after the submission (`clarifying` while gaps remain). */
  readonly stage: BusinessWorkflowStage
  /** The 1-based submission revision this analysis judged. */
  readonly revision: number
  /** The gaps, each an actionable question; empty once the requirement is complete. */
  readonly gaps: readonly ClarificationGap[]
}

/** Records one composition verdict: acceptance or the structural issues that rejected the draft. */
export interface ToolBusinessWorkflowComposedData {
  readonly workflowId: BusinessWorkflowId
  /** The stage after the submission. */
  readonly stage: BusinessWorkflowStage
  /** The accepted composition's step count; `0` when the draft was rejected. */
  readonly stepCount: number
  /** The rejected draft's issues with remedies; empty when accepted. */
  readonly issues: readonly CompositionIssue[]
}

/** Settles one verification: the headline plus every case's outcome. */
export interface ToolBusinessWorkflowVerifiedData {
  readonly workflowId: BusinessWorkflowId
  /** The stage after the verification (`verified` on a pass, else `composed`). */
  readonly stage: BusinessWorkflowStage
  /** The report's headline (passed, case count, dry-run). */
  readonly summary: VerificationSummary
  /** One entry per acceptance case, in requirement order. */
  readonly cases: readonly CaseResult[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Opens one business-workflow record.
     * @param data - the record identity, summary, stage, and revision.
     */
    'tool-business-workflow/start': ToolBusinessWorkflowStartData
    /**
     * Records one clarification analysis.
     * @param data - the judged revision and its remaining gaps.
     */
    'tool-business-workflow/clarified': ToolBusinessWorkflowClarifiedData
    /**
     * Records one composition verdict.
     * @param data - acceptance or the draft's structural issues.
     */
    'tool-business-workflow/composed': ToolBusinessWorkflowComposedData
    /**
     * Settles one verification.
     * @param data - the report headline and every case's outcome.
     */
    'tool-business-workflow/verified': ToolBusinessWorkflowVerifiedData
  }
}
