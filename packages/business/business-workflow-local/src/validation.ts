/**
 * Deterministic requirement and composition analysis for the process-local
 * business-workflow runtime: submission validation, clarification-gap
 * analysis, and structural composition validation. Pure functions over the
 * seam's types; no state, no effects.
 *
 * @module @deepseek-ai/dsh-business-workflow-local/validation
 */

import { BusinessWorkflowError } from '@deepseek-ai/dsh-business-workflow'
import type {
  ClarificationGap,
  CompositionIssue,
  RequirementSpec,
  RequirementSubmission,
  WorkflowComposition,
  WorkflowStep,
} from '@deepseek-ai/dsh-business-workflow'

/** Require a trimmed-non-empty string field and name it in the error. */
function requireText(value: string, label: string, problems: string[]): void {
  if (value.trim().length === 0) problems.push(`${label} must be a non-empty string`)
}

/**
 * Validate one requirement submission and normalize it into a spec draft.
 * Every violation is collected into one thrown error so a corrected
 * resubmission can address the whole list at once.
 * @param submission - the model-authored draft.
 * @returns the normalized spec draft (optional fields resolved).
 * @throws BusinessWorkflowError `REQUIREMENT_INVALID` listing every violation.
 */
export function validateSubmission(submission: RequirementSubmission): RequirementSpec {
  const problems: string[] = []
  requireText(submission.summary, 'summary', problems)

  const objectiveIds = new Set<string>()
  submission.objectives.forEach((objective, index) => {
    requireText(objective.id, `objectives[${index}].id`, problems)
    requireText(objective.statement, `objectives[${index}].statement`, problems)
    if (objectiveIds.has(objective.id)) problems.push(`duplicate objective id ${JSON.stringify(objective.id)}`)
    objectiveIds.add(objective.id)
  })

  const inputNames = new Set<string>()
  submission.inputs.forEach((item, index) => {
    requireText(item.name, `inputs[${index}].name`, problems)
    requireText(item.description, `inputs[${index}].description`, problems)
    if (inputNames.has(item.name)) problems.push(`duplicate input name ${JSON.stringify(item.name)}`)
    inputNames.add(item.name)
  })

  const outputNames = new Set<string>()
  submission.outputs.forEach((item, index) => {
    requireText(item.name, `outputs[${index}].name`, problems)
    requireText(item.description, `outputs[${index}].description`, problems)
    if (outputNames.has(item.name)) problems.push(`duplicate output name ${JSON.stringify(item.name)}`)
    outputNames.add(item.name)
  })

  const caseNames = new Set<string>()
  submission.acceptanceCases.forEach((caseItem, index) => {
    requireText(caseItem.name, `acceptanceCases[${index}].name`, problems)
    if (caseNames.has(caseItem.name)) {
      problems.push(`duplicate acceptanceCases name ${JSON.stringify(caseItem.name)}`)
    }
    caseNames.add(caseItem.name)
    if (caseItem.expect.kind === 'contains') {
      requireText(caseItem.expect.value, `acceptanceCases[${index}].expect.value`, problems)
    }
  })

  const constraintList = submission.constraints ?? []
  constraintList.forEach((constraint, index) => {
    requireText(constraint, `constraints[${index}]`, problems)
  })

  if (problems.length > 0) {
    throw new BusinessWorkflowError(`invalid requirement submission: ${problems.join('; ')}`, 'REQUIREMENT_INVALID')
  }
  return {
    summary: submission.summary,
    objectives: submission.objectives,
    inputs: submission.inputs,
    outputs: submission.outputs,
    constraints: constraintList,
    acceptanceCases: submission.acceptanceCases,
  }
}

/**
 * Analyze a validated spec draft for clarification gaps: which required
 * aspects of a business requirement are still missing. The rules are
 * presence checks only — quality judgments belong to the model and the user.
 * @param spec - the normalized spec draft.
 * @returns one gap per missing aspect; empty once the requirement is complete.
 */
export function analyzeGaps(spec: RequirementSpec): ClarificationGap[] {
  const gaps: ClarificationGap[] = []
  if (spec.objectives.length === 0) {
    gaps.push({
      topic: 'objectives',
      question: 'State at least one business objective this workflow must achieve (an id plus a one-sentence statement).',
    })
  }
  if (spec.inputs.length === 0) {
    gaps.push({
      topic: 'inputs',
      question: 'Name at least one input field the workflow consumes (a field name plus its business meaning).',
    })
  }
  if (spec.outputs.length === 0) {
    gaps.push({
      topic: 'outputs',
      question: 'Name at least one output field the workflow must produce (a field name plus its business meaning).',
    })
  }
  if (spec.acceptanceCases.length === 0) {
    gaps.push({
      topic: 'acceptance',
      question: 'Provide at least one acceptance case: sample input values (given) and what the outputs must satisfy (expect).',
    })
  }
  return gaps
}

/** Push one issue with its message and remedy, keeping the four-field shape. */
function issue(
  issues: CompositionIssue[],
  code: CompositionIssue['code'],
  message: string,
  remedy: string,
  ref?: string,
): void {
  issues.push({ code, message, remedy, ...ref !== undefined ? { ref } : {} })
}

/**
 * Validate one composition draft against the requirement it must satisfy.
 * The rules are structural and deterministic: identity and uniqueness,
 * dependency closure and acyclicity, input-source resolvability and explicit
 * dependency, objective reference and coverage, and final-output binding
 * completeness.
 * @param spec - the record's recorded requirement spec.
 * @param composition - the orchestration draft.
 * @returns every defect; empty when the draft is structurally valid.
 */
export function validateComposition(
  spec: RequirementSpec,
  composition: WorkflowComposition,
): CompositionIssue[] {
  const issues: CompositionIssue[] = []
  const steps = composition.steps
  if (steps.length === 0) {
    issue(issues, 'STEPS_EMPTY',
      'the composition declares no steps',
      'Add at least one step that works toward a requirement objective.')
    return issues
  }

  const stepIds = new Set<string>()
  for (const step of steps) {
    if (step.id.trim().length === 0) {
      issue(issues, 'STEP_ID_EMPTY',
        'a step has an empty id',
        'Give every step a non-empty id.')
    } else if (stepIds.has(step.id)) {
      issue(issues, 'STEP_ID_DUPLICATE',
        `step id ${JSON.stringify(step.id)} is declared more than once`,
        'Use one unique id per step.',
        step.id)
    } else {
      stepIds.add(step.id)
    }
  }

  const inputFields = new Set(spec.inputs.map(item => item.name))
  const objectiveIds = new Set(spec.objectives.map(objective => objective.id))

  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      if (!stepIds.has(dependency)) {
        issue(issues, 'DEPENDENCY_UNKNOWN',
          `step ${JSON.stringify(step.id)} depends on unknown step ${JSON.stringify(dependency)}`,
          'Reference only step ids the composition declares.',
          step.id)
      }
    }

    const inputNames = new Set<string>()
    for (const input of step.inputs) {
      if (inputNames.has(input.name)) {
        issue(issues, 'INPUT_NAME_DUPLICATE',
          `step ${JSON.stringify(step.id)} declares input name ${JSON.stringify(input.name)} twice`,
          'Use one unique input name per step.',
          step.id)
      }
      inputNames.add(input.name)
      if (input.source.kind === 'requirement') {
        if (!inputFields.has(input.source.field)) {
          issue(issues, 'INPUT_SOURCE_UNKNOWN',
            `step ${JSON.stringify(step.id)} reads unknown requirement input ${JSON.stringify(input.source.field)}`,
            'Source requirement inputs by a field the requirement declares.',
            step.id)
        }
      } else {
        if (!stepIds.has(input.source.step)) {
          issue(issues, 'INPUT_SOURCE_UNKNOWN',
            `step ${JSON.stringify(step.id)} reads unknown step ${JSON.stringify(input.source.step)}`,
            'Source step inputs by a step id the composition declares.',
            step.id)
        } else if (!step.dependsOn.includes(input.source.step)) {
          issue(issues, 'IMPLICIT_DEPENDENCY',
            `step ${JSON.stringify(step.id)} reads step ${JSON.stringify(input.source.step)}'s output without depending on it`,
            'Add the producing step to this step\'s dependsOn.',
            step.id)
        }
      }
    }

    for (const objective of step.objectives) {
      if (!objectiveIds.has(objective)) {
        issue(issues, 'OBJECTIVE_UNKNOWN',
          `step ${JSON.stringify(step.id)} references unknown objective ${JSON.stringify(objective)}`,
          'Reference only objective ids the requirement declares.',
          step.id)
      }
    }
  }

  const cyclic = topologicalOrder(steps).cyclicIds
  if (cyclic.length > 0) {
    const first = cyclic[0] as string
    issue(issues, 'DEPENDENCY_CYCLE',
      `the step dependencies form a cycle through step ${JSON.stringify(first)}`,
      'Break the cycle: a step may only read outputs of steps that cannot reach it.',
      first)
  }

  const coveredObjectives = new Set(steps.flatMap(step => step.objectives))
  for (const objective of spec.objectives) {
    if (!coveredObjectives.has(objective.id)) {
      issue(issues, 'OBJECTIVE_UNCOVERED',
        `objective ${JSON.stringify(objective.id)} is not served by any step`,
        `Add a step (or extend one) whose objectives include ${JSON.stringify(objective.id)}.`,
        objective.id)
    }
  }

  const outputNames = new Set(spec.outputs.map(item => item.name))
  const boundOutputs = new Set<string>()
  for (const binding of composition.finalOutputs) {
    if (!outputNames.has(binding.name)) {
      issue(issues, 'OUTPUT_NAME_UNKNOWN',
        `final output binding names ${JSON.stringify(binding.name)}, which the requirement does not declare`,
        'Bind only requirement output field names.',
        binding.name)
    } else if (boundOutputs.has(binding.name)) {
      issue(issues, 'OUTPUT_DUPLICATE',
        `final output ${JSON.stringify(binding.name)} is bound more than once`,
        'Leave exactly one binding per requirement output field.',
        binding.name)
    } else {
      boundOutputs.add(binding.name)
    }
    if (binding.source.kind === 'requirement') {
      if (!inputFields.has(binding.source.field)) {
        issue(issues, 'OUTPUT_SOURCE_UNKNOWN',
          `final output ${JSON.stringify(binding.name)} reads unknown requirement input ${JSON.stringify(binding.source.field)}`,
          'Source requirement bindings by a field the requirement declares.',
          binding.name)
      }
    } else if (!stepIds.has(binding.source.step)) {
      issue(issues, 'OUTPUT_SOURCE_UNKNOWN',
        `final output ${JSON.stringify(binding.name)} reads unknown step ${JSON.stringify(binding.source.step)}`,
        'Source step bindings by a step id the composition declares.',
        binding.name)
    }
  }
  for (const output of spec.outputs) {
    if (!boundOutputs.has(output.name)) {
      issue(issues, 'OUTPUT_UNBOUND',
        `requirement output ${JSON.stringify(output.name)} has no final output binding`,
        `Add a finalOutputs binding for ${JSON.stringify(output.name)}.`,
        output.name)
    }
  }

  return issues
}

/** The dependency analysis of one composition: a peeling order and its residue. */
export interface TopologicalOrder {
  /** Steps in dependency order (dependencies first), acyclic part only. */
  order: WorkflowStep[]
  /** Step ids inside or downstream of a dependency cycle; empty when acyclic. */
  cyclicIds: string[]
}

/** One step's peelable node: remaining in-degree plus the nodes waiting on it. */
interface StepNode {
  readonly step: WorkflowStep
  degree: number
  readonly dependents: StepNode[]
}

/**
 * Order a composition's steps by Kahn's algorithm. Unknown dependency ids do
 * not block peeling — they are reported separately as `DEPENDENCY_UNKNOWN`.
 * @param steps - the composition's steps.
 * @returns the dependency order and every cyclic step id.
 */
export function topologicalOrder(steps: WorkflowStep[]): TopologicalOrder {
  const nodeOf = new Map<string, StepNode>()
  const nodes: StepNode[] = steps.map((step) => {
    const node: StepNode = { step, degree: 0, dependents: [] }
    nodeOf.set(step.id, node)
    return node
  })
  for (const node of nodes) {
    for (const dependency of node.step.dependsOn) {
      const producer = nodeOf.get(dependency)
      // An unknown dependency id is a DEPENDENCY_UNKNOWN defect, not a cycle;
      // leaving it uncounted keeps the known graph peelable.
      if (producer === undefined) continue
      node.degree += 1
      producer.dependents.push(node)
    }
  }
  const queue: StepNode[] = nodes.filter(node => node.degree === 0)
  const order: WorkflowStep[] = []
  // Array iteration observes entries pushed during the walk, so one for-of
  // consumes the whole growing queue without an index or a shifting head.
  for (const node of queue) {
    order.push(node.step)
    for (const dependent of node.dependents) {
      dependent.degree -= 1
      if (dependent.degree === 0) queue.push(dependent)
    }
  }
  const resolved = new Set(order)
  return {
    order,
    cyclicIds: steps.filter(step => !resolved.has(step)).map(step => step.id),
  }
}

/**
 * Check every acceptance case's given values against the requirement inputs.
 * @param spec - the record's recorded requirement spec.
 * @returns the missing-field detail, or undefined when every case provides
 *   every input field.
 */
export function checkCaseInputCoverage(spec: RequirementSpec): string | undefined {
  const missing: string[] = []
  for (const caseItem of spec.acceptanceCases) {
    for (const input of spec.inputs) {
      if (!Object.hasOwn(caseItem.given, input.name)) {
        missing.push(`case ${JSON.stringify(caseItem.name)} is missing input ${JSON.stringify(input.name)}`)
      }
    }
  }
  return missing.length > 0 ? missing.join('; ') : undefined
}
