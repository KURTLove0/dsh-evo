/**
 * Business-workflow seam vocabulary: the requirement, composition, and
 * verification types a runtime consumes and produces, plus the fields in the
 * `business-workflow/*` event payloads. Types only (plus the id-brand
 * factory), per the package convention.
 *
 * The pipeline has three capabilities over one record: clarification turns a
 * stated need into a complete requirement, composition turns a verified-ready
 * requirement into a step orchestration, and verification measures that
 * orchestration against the requirement's acceptance cases.
 *
 * @module @deepseek-ai/dsh-business-workflow/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one business-workflow record across its whole lifecycle. */
export type BusinessWorkflowId = Branded<'BusinessWorkflowId'>

/**
 * Brand a string as a {@link BusinessWorkflowId}.
 * @param id - the raw id string (the runtime mints `bw-N` ids; tests may pass fixtures).
 * @returns the same string, branded.
 */
export function BusinessWorkflowId(id: string): BusinessWorkflowId {
  return id as BusinessWorkflowId
}

/**
 * Lifecycle stage of one business-workflow record. CLOSED union:
 * `clarifying` = the requirement draft still has gaps; `ready` = the
 * requirement is complete but no composition is accepted; `composed` = a
 * composition passed structural checks; `verified` = verification passed.
 * A requirement revision discards the composition and returns to
 * `clarifying` or `ready`.
 */
export type BusinessWorkflowStage = 'clarifying' | 'ready' | 'composed' | 'verified'

/** One business objective a workflow must achieve. */
export interface RequirementObjective {
  /** Stable objective id steps reference to declare coverage (e.g. `rank-leads`). */
  id: string
  /** One-sentence statement of the business outcome. */
  statement: string
}

/** One named data field entering or leaving the workflow. */
export interface RequirementDataItem {
  /** The field name bindings and acceptance cases reference. */
  name: string
  /** The business meaning of the field. */
  description: string
}

/**
 * A deterministic acceptance assertion over a case's final outputs.
 * `nonEmpty` requires every bound final output to be non-empty text;
 * `contains` requires the serialized final outputs to contain `value`.
 */
export type AcceptanceExpectation =
  | { kind: 'nonEmpty' }
  | { kind: 'contains'; value: string }

/** One acceptance case: sample inputs plus the assertion its outputs must satisfy. */
export interface AcceptanceCase {
  /** The case's display name, unique within one requirement. */
  name: string
  /** Sample input values keyed by requirement input field names. */
  given: Record<string, unknown>
  /** The assertion the case's bound final outputs must satisfy. */
  expect: AcceptanceExpectation
}

/**
 * A model-authored requirement draft, submitted in full each round (a
 * submission replaces the previous draft, so clarification rounds are
 * idempotent resubmissions rather than patches).
 */
export interface RequirementSubmission {
  /** One-sentence summary of the business need. */
  summary: string
  /** The objectives the workflow must achieve. */
  objectives: RequirementObjective[]
  /** The named input fields the workflow consumes. */
  inputs: RequirementDataItem[]
  /** The named output fields the workflow produces. */
  outputs: RequirementDataItem[]
  /** Optional business constraints carried into prompts and reports. */
  constraints?: string[]
  /** The acceptance cases verification runs. */
  acceptanceCases: AcceptanceCase[]
}

/**
 * A complete requirement: the submission with every optional field resolved.
 * The runtime records it once clarification finds no gaps.
 */
export interface RequirementSpec {
  /** One-sentence summary of the business need. */
  summary: string
  /** The objectives the workflow must achieve. */
  objectives: RequirementObjective[]
  /** The named input fields the workflow consumes. */
  inputs: RequirementDataItem[]
  /** The named output fields the workflow produces. */
  outputs: RequirementDataItem[]
  /** Business constraints carried into prompts and reports (possibly empty). */
  constraints: string[]
  /** The acceptance cases verification runs. */
  acceptanceCases: AcceptanceCase[]
}

/** One deterministic clarification gap the model resolves with the user or its own analysis. */
export interface ClarificationGap {
  /** The missing requirement aspect. */
  topic: 'objectives' | 'inputs' | 'outputs' | 'acceptance'
  /** An actionable question naming what to add to the next submission. */
  question: string
}

/** The result of one requirement submission: fresh analysis plus the record's stage. */
export interface RequirementAnalysis {
  /** The record the analysis belongs to. */
  id: BusinessWorkflowId
  /** The record's stage after the submission. */
  stage: BusinessWorkflowStage
  /** How many submissions the record has received (1-based). */
  revision: number
  /** Whether the requirement is complete (`stage` is not `clarifying`). */
  ready: boolean
  /** The gaps the next submission must resolve; empty once `ready`. */
  gaps: ClarificationGap[]
  /** The recorded spec once `ready`, else absent. */
  spec?: RequirementSpec
}

/** A requirement submission request: a fresh draft, optionally updating an existing record. */
export interface RequirementSubmissionRequest {
  /** The record to update; omit to create a new one. */
  id?: BusinessWorkflowId
  /** The full replacement draft. */
  submission: RequirementSubmission
}

/** Where one named step input or final output reads its value from. */
export type InputSource =
  | { kind: 'requirement'; field: string }
  | { kind: 'step'; step: string }

/** One named input a step consumes. */
export interface StepInput {
  /** The name the step's instruction refers to this input by. */
  name: string
  /** Where the value comes from. */
  source: InputSource
}

/** One orchestrated step: a self-contained instruction executed by a delegated worker. */
export interface WorkflowStep {
  /** Unique step id within the composition (e.g. `score`). */
  id: string
  /** Short display title. */
  title: string
  /** The complete instruction for the step's executor. */
  instruction: string
  /** Ids of steps this step explicitly waits for. */
  dependsOn: string[]
  /** The named inputs this step consumes. */
  inputs: StepInput[]
  /** Requirement objective ids this step serves. */
  objectives: string[]
}

/** Binds one requirement output field to the source of its value. */
export interface FinalOutputBinding {
  /** A requirement output field name. */
  name: string
  /** Where the value comes from. */
  source: InputSource
}

/** A model-authored orchestration: steps plus final output bindings. */
export interface WorkflowComposition {
  /** The steps, in any order (execution order is the dependency topology). */
  steps: WorkflowStep[]
  /** One binding per requirement output field. */
  finalOutputs: FinalOutputBinding[]
}

/** A composition submission request. */
export interface CompositionRequest {
  /** The record whose requirement is `ready`. */
  id: BusinessWorkflowId
  /** The orchestration draft. */
  composition: WorkflowComposition
}

/**
 * Structural composition defects the runtime detects deterministically.
 * CLOSED union; consumers may exhaust.
 */
export type CompositionIssueCode =
  | 'STEPS_EMPTY'
  | 'STEP_ID_EMPTY'
  | 'STEP_ID_DUPLICATE'
  | 'DEPENDENCY_UNKNOWN'
  | 'DEPENDENCY_CYCLE'
  | 'IMPLICIT_DEPENDENCY'
  | 'INPUT_NAME_DUPLICATE'
  | 'INPUT_SOURCE_UNKNOWN'
  | 'OBJECTIVE_UNKNOWN'
  | 'OBJECTIVE_UNCOVERED'
  | 'OUTPUT_UNBOUND'
  | 'OUTPUT_NAME_UNKNOWN'
  | 'OUTPUT_DUPLICATE'
  | 'OUTPUT_SOURCE_UNKNOWN'

/** One structural defect with its location and deterministic remedy. */
export interface CompositionIssue {
  /** The defect class. */
  code: CompositionIssueCode
  /** The offending step, output, or objective id, when one exists. */
  ref?: string
  /** What is wrong. */
  message: string
  /** The concrete change that removes the defect. */
  remedy: string
}

/** The result of one composition submission. */
export interface CompositionOutcome {
  /** The record the submission targeted. */
  id: BusinessWorkflowId
  /** The record's stage after the submission (`clarifying` records reject before this returns). */
  stage: 'ready' | 'composed' | 'verified'
  /** The defects of the rejected draft; empty when accepted. */
  issues: CompositionIssue[]
  /** The accepted draft's step count; `0` when the draft was rejected. */
  stepCount: number
}

/**
 * Executes one step and returns its text output. The consumer supplies this
 * (the model-facing tool delegates to a subagent); the runtime owns ordering,
 * input resolution, and assertion, so a different execution backend swaps in
 * without touching the pipeline.
 */
export interface BusinessWorkflowStepRunner {
  /**
   * Run one step to completion.
   * @param step - the step definition, verbatim.
   * @param inputs - the step's named inputs, resolved from requirement inputs
   *   and predecessor outputs.
   * @param context - the verification's cancellation signal.
   * @returns the step's output text.
   */
  (step: WorkflowStep, inputs: Record<string, unknown>, context: { signal: AbortSignal }): Promise<string>
}

/** A verification request: static case checks gate a dry-run through the supplied runner. */
export interface VerificationRequest {
  /** The record whose stage is `composed` or `verified`. */
  id: BusinessWorkflowId
  /** Supplies step execution for the dry-run; verification always executes it. */
  runStep: BusinessWorkflowStepRunner
  /** Cancellation of the verification itself; checked before every step. */
  signal?: AbortSignal
}

/** One static (deterministic, execution-free) verification check. */
export interface StaticCheck {
  /** The check that ran. */
  name: 'case-input-coverage'
  /** Whether the check passed. */
  passed: boolean
  /** The failure detail, present iff the check failed. */
  detail?: string
}

/** One step's dry-run execution entry in a case result. */
export interface StepExecutionTrace {
  /** The executed step's id. */
  stepId: string
  /** Whether the step's executor returned output. */
  status: 'completed' | 'failed'
  /** The (truncated) output text, or the failure message. */
  detail: string
}

/** One acceptance case's outcome. */
export interface CaseResult {
  /** The case's name. */
  name: string
  /** `passed` = assertion satisfied; `failed` = assertion or execution failed; `skipped` = static checks blocked the dry-run. */
  status: 'passed' | 'failed' | 'skipped'
  /** Why the case failed or was skipped; absent for a pass. */
  detail?: string
  /** The case's step-by-step trace, present iff the dry-run reached it. */
  steps?: StepExecutionTrace[]
}

/** The full verification report. */
export interface VerificationReport {
  /** The verified record. */
  id: BusinessWorkflowId
  /** Whether every static check and every case passed. */
  passed: boolean
  /** The static checks that ran. */
  staticChecks: StaticCheck[]
  /** One result per acceptance case, in requirement order. */
  caseResults: CaseResult[]
  /** Deterministic repair guidance for every failure. */
  fixHints: string[]
  /** Whether the dry-run executed (static checks passed); a static failure skips it. */
  dryRun: boolean
}

/** A read-only projection of one record, safe to hand to listeners and tools. */
export interface BusinessWorkflowSnapshot {
  /** The record's id. */
  id: BusinessWorkflowId
  /** The record's current stage. */
  stage: BusinessWorkflowStage
  /** How many requirement submissions the record has received (1-based). */
  revision: number
  /** The requirement summary, from the latest submission. */
  summary: string
  /** The accepted composition's step count; absent before one is accepted. */
  stepCount?: number
  /** Epoch ms of the latest passing verification; absent before one passes. */
  verifiedAt?: number
}

/** Identifying detail for one record, carried by every `business-workflow/*` event. */
export interface BusinessWorkflowInfo {
  /** The record's id. */
  id: BusinessWorkflowId
  /** The record's stage as of the event. */
  stage: BusinessWorkflowStage
}

/** The `business-workflow/verification` payload: a report's headline. */
export interface VerificationSummary {
  /** Whether the verification passed. */
  passed: boolean
  /** How many acceptance cases the verification judged. */
  caseCount: number
  /** Whether the dry-run executed. */
  dryRun: boolean
}
