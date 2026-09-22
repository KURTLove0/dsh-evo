/**
 * Service Definition for the business-workflow capability seam. Service
 * Providers own one record store and drive the three-capability pipeline —
 * requirement clarification, composition, and verification — while the model
 * authors the content through a Consumer's tools. The model and the service
 * split the work along one line: the model writes the requirement draft, the
 * composition draft, and (through a delegated runner) each step's output,
 * while the runtime owns record identity, stage transitions, deterministic
 * gap analysis, structural validation, execution ordering, and acceptance
 * assertion.
 *
 * This package owns the Service Definition role only. Service Providers
 * (`@deepseek-ai/dsh-business-workflow-local`) and the model-facing Consumer
 * (`@deepseek-ai/dsh-tool-business-workflow`) are separate packages.
 * @module @deepseek-ai/dsh-business-workflow
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type {
  BusinessWorkflowId,
  BusinessWorkflowInfo,
  BusinessWorkflowSnapshot,
  CompositionOutcome,
  CompositionRequest,
  RequirementAnalysis,
  RequirementSubmissionRequest,
  VerificationReport,
  VerificationRequest,
  VerificationSummary,
} from './types.ts'

export { BusinessWorkflowId } from './types.ts'
export { isBusinessWorkflowStageTransition } from './transition.ts'
export type {
  AcceptanceCase,
  AcceptanceExpectation,
  BusinessWorkflowInfo,
  BusinessWorkflowSnapshot,
  BusinessWorkflowStage,
  BusinessWorkflowStepRunner,
  ClarificationGap,
  CaseResult,
  CompositionIssue,
  CompositionIssueCode,
  CompositionOutcome,
  CompositionRequest,
  FinalOutputBinding,
  InputSource,
  RequirementAnalysis,
  RequirementDataItem,
  RequirementObjective,
  RequirementSpec,
  RequirementSubmission,
  RequirementSubmissionRequest,
  StaticCheck,
  StepExecutionTrace,
  StepInput,
  VerificationReport,
  VerificationRequest,
  VerificationSummary,
  WorkflowComposition,
  WorkflowStep,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    businessWorkflows: BusinessWorkflowRuntime
  }

  interface Events {
    /**
     * One record's stage changed — clarification closed or reopened, a
     * composition accepted, or verification promoted the record. Paired
     * events carry the same {@link BusinessWorkflowInfo#id}; the stage is the
     * value after the transition.
     * @param info - the record's identity and post-transition stage.
     * @mode emit
     */
    'business-workflow/stage'(info: BusinessWorkflowInfo): void
    /**
     * One verification settled (pass or fail). Emitted after the report is
     * recorded and any stage transition for it has been published, so an
     * observer reading `stage` sees the promoted state. Paired with the
     * record's earlier stage events by id.
     * @param info - the record's identity and current stage.
     * @param summary - the report's headline.
     * @mode emit
     */
    'business-workflow/verification'(info: BusinessWorkflowInfo, summary: VerificationSummary): void
  }
}

/** The full set of `business-workflow/*` event names {@link BusinessWorkflowRuntime.emitBusinessWorkflowEvent} dispatches. */
export type BusinessWorkflowEventName =
  | 'business-workflow/stage'
  | 'business-workflow/verification'

/**
 * Machine-routable business-workflow failures: a malformed submission, an
 * unknown record id, an operation the record's stage does not admit, or a
 * caller cancellation. Structural composition defects and verification
 * failures are ordinary outcomes (`issues`, failing reports), not errors.
 */
export type BusinessWorkflowErrorCode =
  | 'REQUIREMENT_INVALID'
  | 'COMPOSITION_INVALID'
  | 'UNKNOWN_WORKFLOW'
  | 'STAGE_VIOLATION'
  | 'CAPACITY'
  | 'ABORTED'

/** Typed error for business-workflow-seam failures; the `code` is machine-routable taxonomy. */
export class BusinessWorkflowError extends HarnessError {
  constructor(message: string, code: BusinessWorkflowErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'BusinessWorkflowError'
  }
}

/**
 * Business-workflow Service Definition contract. Implementations must honor
 * these semantics:
 *
 * - Submissions are whole-value replacements: a requirement submission
 *   replaces the previous draft (revision increments) and discards any
 *   accepted composition; a composition submission replaces the accepted
 *   composition only when it passes validation. No call mutates a record
 *   partially.
 * - Invalid input throws before any state change; a rejected composition
 *   draft leaves the previously accepted composition and stage untouched.
 * - Stage transitions are exactly: `clarifying`→`ready` (a complete
 *   requirement), `ready`→`composed` (an accepted composition),
 *   `composed`/`verified`→`ready` (a requirement revision discarding the
 *   composition), and `composed`→`verified` (a passing verification). A
 *   passing verification of an already-`verified` record records the new
 *   report without a stage event.
 * - Verification awaits its dry-run work, observes the caller signal between
 *   steps, and settles a report (never a throw) for assertion and execution
 *   failures; only invalid input and cancellation throw.
 * - Snapshots are fresh objects; events carry identity data, never live
 *   records.
 */
export abstract class BusinessWorkflowRuntime extends Service {
  constructor(ctx: Context) {
    // `abstract` erases at runtime, so a composition row naming this package
    // would register a `ctx.businessWorkflows` with no method implementations
    // and fail far from the misconfiguration. Fail loud at load instead.
    if (new.target === BusinessWorkflowRuntime) {
      throw new Error('@deepseek-ai/dsh-business-workflow is the abstract business-workflow seam; load an implementation such as @deepseek-ai/dsh-business-workflow-local instead')
    }
    super(ctx, 'businessWorkflows')
  }

  /**
   * Submit a requirement draft (clarification round) and return the fresh
   * gap analysis. Creating a record and updating one take the same request;
   * the analysis states whether the requirement is complete.
   * @param request - the full replacement draft and, for an update, the record id.
   * @returns the record's stage, revision, remaining gaps, and recorded spec.
   */
  abstract submitRequirement(request: RequirementSubmissionRequest): RequirementAnalysis

  /**
   * Submit a composition draft and validate its structure. Validation is
   * deterministic (identity, dependency, source, binding, and coverage
   * rules); a rejected draft returns its issues and changes nothing.
   * @param request - the record id and the orchestration draft.
   * @returns the record's stage, the draft's issues, and its step count.
   */
  abstract compose(request: CompositionRequest): CompositionOutcome

  /**
   * Verify the accepted composition: static case checks always, plus a
   * dry-run through the supplied runner that executes every step per
   * acceptance case and asserts the bound final outputs. Assertion and
   * execution failures settle into the report; only invalid input and
   * cancellation throw.
   * @param request - the record id, an optional step runner, and an optional
   *   cancellation signal.
   * @returns the complete verification report.
   */
  abstract verify(request: VerificationRequest): Promise<VerificationReport>

  /**
   * Return one record's snapshot.
   * @param id - the record to look up.
   * @returns a fresh snapshot.
   */
  abstract get(id: BusinessWorkflowId): BusinessWorkflowSnapshot

  /**
   * List every record's snapshot in creation order.
   * @returns fresh snapshots.
   */
  abstract list(): BusinessWorkflowSnapshot[]

  /**
   * Emit a lifecycle event while containing and logging each listener failure.
   * @param name - the `business-workflow/*` event to dispatch.
   * @param args - the event's payload, matching its declared signature.
   */
  protected emitBusinessWorkflowEvent(name: BusinessWorkflowEventName, ...args: unknown[]): void {
    for (const callback of this.ctx.events.dispatch('emit', [name, ...args])) {
      try {
        const returned: unknown = (callback as (...payload: unknown[]) => unknown)(...args)
        void Promise.resolve(returned).catch((error: unknown) => {
          this.ctx.logger.warn(`business-workflow: ${name} listener rejected: ${renderListenerError(error)}`)
        })
      } catch (error: unknown) {
        this.ctx.logger.warn(`business-workflow: ${name} listener threw: ${renderListenerError(error)}`)
      }
    }
  }
}

/**
 * Render any thrown value without violating listener containment.
 * @param error - any thrown value.
 * @returns `String(error)`, or a fixed label when even coercion throws.
 */
function renderListenerError(error: unknown): string {
  try {
    return String(error)
  } catch {
    // String coercion itself may throw.
    return '[unrenderable thrown value]'
  }
}

export default BusinessWorkflowRuntime
