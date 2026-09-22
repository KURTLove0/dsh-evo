/**
 * Process-local provider for the business-workflow capability seam
 * (`ctx.businessWorkflows`). It keeps every record in memory, hands out
 * fresh snapshots, and drives the three-capability pipeline: requirement
 * clarification through deterministic gap analysis, composition through
 * structural validation, and verification through case-gated dry-run
 * execution with acceptance assertions.
 *
 * Submissions are whole-value replacements and never mutate a record
 * partially; a requirement revision discards the accepted composition, and a
 * rejected composition draft leaves the accepted one untouched.
 * @module @deepseek-ai/dsh-business-workflow-local
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  BusinessWorkflowError,
  BusinessWorkflowRuntime,
  BusinessWorkflowId,
} from '@deepseek-ai/dsh-business-workflow'
import type {
  BusinessWorkflowSnapshot,
  BusinessWorkflowStage,
  CaseResult,
  CompositionOutcome,
  CompositionRequest,
  RequirementAnalysis,
  RequirementSpec,
  RequirementSubmissionRequest,
  VerificationReport,
  VerificationRequest,
  WorkflowComposition,
} from '@deepseek-ai/dsh-business-workflow'
import { analyzeGaps, checkCaseInputCoverage, topologicalOrder, validateComposition, validateSubmission } from './validation.ts'
import { assertAcceptance, renderThrown, resolveFinalOutput, resolveStepInputs, stepTrace } from './execution.ts'

/** Default ceiling on records kept by one service instance. */
const DEFAULT_MAX_WORKFLOWS = 200

/** Default per-step trace detail ceiling, in characters. */
const DEFAULT_MAX_TRACE_CHARS = 2_000

/** Configuration for the process-local business-workflow runtime. */
export interface Config {
  /** Maximum records the runtime keeps; a further create fails (default 200). */
  maxWorkflows?: number
  /** Per-step trace detail ceiling in verification reports (default 2000). */
  maxTraceChars?: number
}

/** The runtime's mutable record (never handed out — see {@link LocalBusinessWorkflowRuntime.snapshot}). */
interface TrackedWorkflow {
  id: BusinessWorkflowId
  stage: BusinessWorkflowStage
  /** How many requirement submissions the record has received. */
  revision: number
  /** The latest submission's summary, kept for snapshots in every stage. */
  summary: string
  /** The recorded spec once the requirement is complete. */
  spec: RequirementSpec | undefined
  /** The accepted composition; a requirement revision discards it. */
  composition: WorkflowComposition | undefined
  /** Epoch ms of the latest passing verification. */
  verifiedAt: number | undefined
}

let neverAborted: AbortSignal | undefined

/** The shared never-aborting signal handed to step runners when no caller signal exists. */
function neverAbortSignal(): AbortSignal {
  neverAborted ??= new AbortController().signal
  return neverAborted
}

/**
 * The in-memory `businessWorkflows` runtime. See the Service Definition
 * contract in `@deepseek-ai/dsh-business-workflow` for the submission,
 * transition, and verification semantics this implementation honors.
 */
export class LocalBusinessWorkflowRuntime extends BusinessWorkflowRuntime {
  static Config: z<Config> = z.object({
    maxWorkflows: z.number()
      .step(1)
      .min(1)
      .max(Number.MAX_SAFE_INTEGER)
      .default(DEFAULT_MAX_WORKFLOWS),
    maxTraceChars: z.number()
      .step(1)
      .min(1)
      .max(Number.MAX_SAFE_INTEGER)
      .default(DEFAULT_MAX_TRACE_CHARS),
  })

  /** Schemastery-defaulted record ceiling. */
  private readonly maxWorkflows: number
  /** Schemastery-defaulted trace detail ceiling. */
  private readonly maxTraceChars: number
  private store = new Map<BusinessWorkflowId, TrackedWorkflow>()
  private counter = 0

  constructor(ctx: Context, config: Config) {
    super(ctx)
    // Schemastery validates and fills the defaults before constructing the service.
    this.maxWorkflows = (config as Required<Config>).maxWorkflows
    this.maxTraceChars = (config as Required<Config>).maxTraceChars
    ctx.effect(() => () => { this.disposeAll() }, 'business-workflows teardown')
  }

  submitRequirement(request: RequirementSubmissionRequest): RequirementAnalysis {
    const spec = validateSubmission(request.submission)
    const gaps = analyzeGaps(spec)
    const target: BusinessWorkflowStage = gaps.length > 0 ? 'clarifying' : 'ready'

    let record: TrackedWorkflow
    if (request.id !== undefined) {
      record = this.expect(request.id)
    } else {
      if (this.store.size >= this.maxWorkflows) {
        throw new BusinessWorkflowError(
          `business workflow limit reached (${this.maxWorkflows}); finish work on existing records or raise maxWorkflows`,
          'CAPACITY',
        )
      }
      record = {
        id: BusinessWorkflowId(`bw-${++this.counter}`),
        stage: 'clarifying',
        revision: 0,
        summary: '',
        spec: undefined,
        composition: undefined,
        verifiedAt: undefined,
      }
      this.store.set(record.id, record)
    }

    // A requirement revision discards the composition: the accepted
    // orchestration was validated against the previous requirement.
    record.revision += 1
    record.summary = spec.summary
    record.spec = gaps.length > 0 ? undefined : spec
    record.composition = undefined
    record.verifiedAt = undefined
    this.transition(record, target)
    return {
      id: record.id,
      stage: record.stage,
      revision: record.revision,
      ready: record.stage !== 'clarifying',
      gaps,
      ...record.spec !== undefined ? { spec: record.spec } : {},
    }
  }

  compose(request: CompositionRequest): CompositionOutcome {
    const record = this.expect(request.id)
    if (record.stage === 'clarifying') {
      throw new BusinessWorkflowError(
        `workflow ${record.id} requirement is still clarifying; submit a complete requirement before composing`,
        'STAGE_VIOLATION',
      )
    }
    const spec = this.readySpec(record)
    const issues = validateComposition(spec, request.composition)
    if (issues.length > 0) {
      return { id: record.id, stage: record.stage, issues, stepCount: 0 }
    }
    record.composition = request.composition
    record.verifiedAt = undefined
    this.transition(record, 'composed')
    return { id: record.id, stage: record.stage, issues: [], stepCount: request.composition.steps.length }
  }

  async verify(request: VerificationRequest): Promise<VerificationReport> {
    const record = this.expect(request.id)
    if (record.stage !== 'composed' && record.stage !== 'verified') {
      throw new BusinessWorkflowError(
        `workflow ${record.id} has no accepted composition to verify; submit a composition first`,
        'STAGE_VIOLATION',
      )
    }
    const spec = this.readySpec(record)
    const composition = this.acceptedComposition(record)

    const coverageDetail = checkCaseInputCoverage(spec)
    const staticChecks = [{
      name: 'case-input-coverage' as const,
      passed: coverageDetail === undefined,
      ...coverageDetail !== undefined ? { detail: coverageDetail } : {},
    }]
    if (coverageDetail !== undefined) {
      const report: VerificationReport = {
        id: record.id,
        passed: false,
        staticChecks,
        caseResults: spec.acceptanceCases.map(kase => ({
          name: kase.name,
          status: 'skipped' as const,
          detail: 'static case checks failed; dry-run skipped',
        })),
        fixHints: [`Provide every requirement input field in each acceptance case's given: ${coverageDetail}`],
        dryRun: false,
      }
      this.recordVerification(record, report)
      return report
    }

    const signal = request.signal ?? neverAbortSignal()
    const caseResults: CaseResult[] = []
    for (const kase of spec.acceptanceCases) {
      caseResults.push(await this.runCase(record.id, composition, kase, request.runStep, signal))
    }
    const passed = caseResults.every(result => result.status === 'passed')
    const fixHints = caseResults
      .filter(result => result.status === 'failed')
      .map(result => `Case ${JSON.stringify(result.name)}: ${result.detail}; revise the steps it names or the expectation`)
    const report: VerificationReport = {
      id: record.id,
      passed,
      staticChecks,
      caseResults,
      fixHints,
      dryRun: true,
    }
    this.recordVerification(record, report)
    return report
  }

  get(id: BusinessWorkflowId): BusinessWorkflowSnapshot {
    return this.snapshot(this.expect(id))
  }

  list(): BusinessWorkflowSnapshot[] {
    return [...this.store.values()].map(record => this.snapshot(record))
  }

  /** Look up a record or fail loud. */
  private expect(id: BusinessWorkflowId): TrackedWorkflow {
    const record = this.store.get(id)
    if (record === undefined) throw new BusinessWorkflowError(`unknown business workflow ${id}`, 'UNKNOWN_WORKFLOW')
    return record
  }

  /** The spec a `ready`-or-later record must carry. */
  private readySpec(record: TrackedWorkflow): RequirementSpec {
    /* v8 ignore start -- the stage guard at each call site keeps this unreachable */
    if (record.spec === undefined) {
      throw new BusinessWorkflowError(`workflow ${record.id} has no recorded requirement spec`, 'STAGE_VIOLATION')
    }
    /* v8 ignore stop */
    return record.spec
  }

  /** The composition a `composed`-or-later record must carry. */
  private acceptedComposition(record: TrackedWorkflow): WorkflowComposition {
    /* v8 ignore start -- the stage guard above keeps this unreachable */
    if (record.composition === undefined) {
      throw new BusinessWorkflowError(`workflow ${record.id} has no accepted composition`, 'STAGE_VIOLATION')
    }
    /* v8 ignore stop */
    return record.composition
  }

  /** Move one record to `to`, emitting the stage event exactly on a change. */
  private transition(record: TrackedWorkflow, to: BusinessWorkflowStage): void {
    if (record.stage === to) return
    record.stage = to
    this.emitBusinessWorkflowEvent('business-workflow/stage', { id: record.id, stage: to })
  }

  /** Record a settled verification: promote, demote, and publish its event. */
  private recordVerification(record: TrackedWorkflow, report: VerificationReport): void {
    if (report.passed) {
      record.verifiedAt = Date.now()
      this.transition(record, 'verified')
    } else {
      record.verifiedAt = undefined
      this.transition(record, 'composed')
    }
    this.emitBusinessWorkflowEvent('business-workflow/verification',
      { id: record.id, stage: record.stage },
      { passed: report.passed, caseCount: report.caseResults.length, dryRun: report.dryRun },
    )
  }

  /**
   * Fail with `ABORTED` when the caller cancelled the verification. Called
   * across a method boundary so `signal.aborted` stays unnarrowed at each read.
   */
  private assertLive(id: BusinessWorkflowId, signal: AbortSignal): void {
    if (signal.aborted) {
      throw new BusinessWorkflowError(`verification of workflow ${id} aborted`, 'ABORTED')
    }
  }

  /** Execute one acceptance case through the dependency topology. */
  private async runCase(
    id: BusinessWorkflowId,
    composition: WorkflowComposition,
    kase: RequirementSpec['acceptanceCases'][number],
    runStep: VerificationRequest['runStep'],
    signal: AbortSignal,
  ): Promise<CaseResult> {
    const outputs = new Map<string, string>()
    const steps: CaseResult['steps'] = []
    const order = topologicalOrder(composition.steps).order
    for (const step of order) {
      this.assertLive(id, signal)
      const inputs = resolveStepInputs(step, { given: kase.given, outputs })
      let output: string
      try {
        output = await runStep(step, inputs, { signal })
      } catch (error) {
        if (signal.aborted) {
          throw new BusinessWorkflowError(`verification of workflow ${id} aborted`, 'ABORTED', { cause: error })
        }
        const detail = renderThrown(error)
        steps.push(stepTrace(step.id, 'failed', detail, this.maxTraceChars))
        return {
          name: kase.name,
          status: 'failed',
          detail: `step ${JSON.stringify(step.id)} failed: ${detail}`,
          steps,
        }
      }
      outputs.set(step.id, output)
      steps.push(stepTrace(step.id, 'completed', output, this.maxTraceChars))
    }

    const finalOutputs: Record<string, string> = {}
    for (const binding of composition.finalOutputs) {
      finalOutputs[binding.name] = resolveFinalOutput(binding, { given: kase.given, outputs })
    }
    const failure = assertAcceptance(kase.expect, finalOutputs)
    if (failure !== undefined) {
      return { name: kase.name, status: 'failed', detail: failure, steps }
    }
    return { name: kase.name, status: 'passed', steps }
  }

  /** Project a fresh read-only snapshot from the mutable record. */
  private snapshot(record: TrackedWorkflow): BusinessWorkflowSnapshot {
    return {
      id: record.id,
      stage: record.stage,
      revision: record.revision,
      summary: record.summary,
      ...record.composition !== undefined ? { stepCount: record.composition.steps.length } : {},
      ...record.verifiedAt !== undefined ? { verifiedAt: record.verifiedAt } : {},
    }
  }

  /** Service teardown drops every record; verification holds no owned resources. */
  private disposeAll(): void {
    this.store.clear()
  }
}

export default LocalBusinessWorkflowRuntime
