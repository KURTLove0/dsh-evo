/**
 * Dry-run execution logic for the process-local business-workflow runtime:
 * step input resolution, acceptance assertion, and trace rendering. Pure
 * functions; the service class owns the loops and effects.
 *
 * @module @deepseek-ai/dsh-business-workflow-local/execution
 */

import type {
  AcceptanceExpectation,
  FinalOutputBinding,
  StepExecutionTrace,
  WorkflowStep,
} from '@deepseek-ai/dsh-business-workflow'

/** Values available to one running step. */
export interface StepContext {
  /** The current case's given values, keyed by requirement input field. */
  given: Record<string, unknown>
  /** Completed predecessor outputs, keyed by step id. */
  outputs: ReadonlyMap<string, string>
}

/**
 * Resolve one step's named inputs from the case's given values and
 * predecessor outputs. Source validity is a composition-stage guarantee;
 * a missing predecessor output here means the caller skipped a failed step,
 * which the service never does.
 * @param step - the step about to run.
 * @param context - the case's given values and completed outputs.
 * @returns the step's inputs, keyed by the step's input names.
 */
export function resolveStepInputs(step: WorkflowStep, context: StepContext): Record<string, unknown> {
  const inputs: Record<string, unknown> = {}
  for (const input of step.inputs) {
    if (input.source.kind === 'requirement') {
      inputs[input.name] = context.given[input.source.field]
    } else {
      inputs[input.name] = context.outputs.get(input.source.step) ?? ''
    }
  }
  return inputs
}

/**
 * Resolve one final output binding's text value. A requirement binding
 * serializes its given value; a step binding carries the producing step's
 * output, or empty text when the producer never ran (a failed case's partial
 * trace, which callers treat as a failed assertion rather than an error).
 * @param binding - the output binding to resolve.
 * @param context - the case's given values and completed outputs.
 * @returns the bound output's text.
 */
export function resolveFinalOutput(binding: FinalOutputBinding, context: StepContext): string {
  if (binding.source.kind === 'requirement') {
    return JSON.stringify(context.given[binding.source.field])
  }
  return context.outputs.get(binding.source.step) ?? ''
}

/**
 * Judge one case's bound final outputs against its expectation.
 * @param expect - the case's assertion.
 * @param finalOutputs - the bound final outputs, keyed by output field name.
 * @returns the failure description, or undefined when the outputs pass.
 */
export function assertAcceptance(
  expect: AcceptanceExpectation,
  finalOutputs: Record<string, string>,
): string | undefined {
  switch (expect.kind) {
    case 'nonEmpty':
      for (const [name, value] of Object.entries(finalOutputs)) {
        if (value.trim().length === 0) return `final output ${JSON.stringify(name)} is empty`
      }
      return undefined
    case 'contains':
      return JSON.stringify(finalOutputs).includes(expect.value)
        ? undefined
        : `serialized final outputs do not contain ${JSON.stringify(expect.value)}`
  }
}

/**
 * Render one step's trace entry, truncating its detail to the cap.
 * @param stepId - the executed step's id.
 * @param status - whether the step's executor returned output.
 * @param detail - the output text or failure message.
 * @param maxTraceChars - detail ceiling in characters.
 * @returns the trace entry.
 */
export function stepTrace(
  stepId: string,
  status: StepExecutionTrace['status'],
  detail: string,
  maxTraceChars: number,
): StepExecutionTrace {
  return {
    stepId,
    status,
    detail: detail.length > maxTraceChars
      ? `${detail.slice(0, maxTraceChars)}… [truncated: ${detail.length - maxTraceChars} more characters]`
      : detail,
  }
}

/**
 * Render any thrown value for a failure detail without trusting it.
 * @param error - any thrown value.
 * @returns `String(error)`, or a fixed label when even coercion throws.
 */
export function renderThrown(error: unknown): string {
  try {
    return String(error)
  } catch {
    // String coercion itself may throw.
    return '[unrenderable thrown value]'
  }
}
