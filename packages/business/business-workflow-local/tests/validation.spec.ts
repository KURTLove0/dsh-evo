import { describe, expect, it } from 'vitest'
import { BusinessWorkflowError } from '@deepseek-ai/dsh-business-workflow'
import type {
  AcceptanceCase, RequirementSpec, RequirementSubmission, WorkflowComposition, WorkflowStep,
} from '@deepseek-ai/dsh-business-workflow'
import { analyzeGaps, checkCaseInputCoverage, topologicalOrder, validateComposition, validateSubmission } from '../src/validation.ts'

const caseItem = (overrides: Partial<AcceptanceCase> = {}): AcceptanceCase => ({
  name: 'sample',
  given: { leads: ['a', 'b'] },
  expect: { kind: 'nonEmpty' },
  ...overrides,
})

const spec = (overrides: Partial<RequirementSpec> = {}): RequirementSpec => ({
  summary: 'Rank inbound leads',
  objectives: [{ id: 'rank-leads', statement: 'Score every lead' }],
  inputs: [{ name: 'leads', description: 'Raw lead records' }],
  outputs: [{ name: 'ranking', description: 'Scored ranking' }],
  constraints: [],
  acceptanceCases: [caseItem({ given: { leads: ['a'] } })],
  ...overrides,
})

const submission = (overrides: Partial<RequirementSubmission> = {}): RequirementSubmission => {
  const base = spec()
  return {
    summary: base.summary,
    objectives: base.objectives,
    inputs: base.inputs,
    outputs: base.outputs,
    acceptanceCases: base.acceptanceCases,
    ...overrides,
  }
}

const step = (overrides: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id: 'score',
  title: 'Score leads',
  instruction: 'Score each lead.',
  dependsOn: [],
  inputs: [{ name: 'raw', source: { kind: 'requirement', field: 'leads' } }],
  objectives: ['rank-leads'],
  ...overrides,
})

const composition = (overrides: Partial<WorkflowComposition> = {}): WorkflowComposition => ({
  steps: [step()],
  finalOutputs: [{ name: 'ranking', source: { kind: 'step', step: 'score' } }],
  ...overrides,
})

describe('validateSubmission', () => {
  it('normalizes an optional-free submission into a spec draft', () => {
    const draft = validateSubmission(submission({ constraints: ['Same-day'] }))
    expect(draft).toEqual(spec({ constraints: ['Same-day'] }))
  })

  it('defaults absent constraints to an empty list', () => {
    const draft = validateSubmission(submission())
    expect(draft.constraints).toEqual([])
  })

  it('collects every violation into one REQUIREMENT_INVALID error', () => {
    expect(() => validateSubmission(submission({
      summary: '  ',
      objectives: [
        { id: '', statement: 'Score every lead' },
        { id: 'rank-leads', statement: ' ' },
        { id: 'rank-leads', statement: 'Score every lead' },
      ],
      inputs: [
        { name: '', description: 'Raw lead records' },
        { name: 'leads', description: ' ' },
        { name: 'leads', description: 'Raw lead records' },
      ],
      outputs: [
        { name: '', description: 'Scored ranking' },
        { name: 'ranking', description: ' ' },
        { name: 'ranking', description: 'Scored ranking' },
      ],
      acceptanceCases: [
        { name: '', given: {}, expect: { kind: 'contains', value: '' } },
        { name: 'sample', given: {}, expect: { kind: 'nonEmpty' } },
      ],
      constraints: ['  '],
    }))).toThrow(BusinessWorkflowError)
    try {
      validateSubmission(submission({ summary: ' ' }))
      throw new Error('expected REQUIREMENT_INVALID')
    } catch (error) {
      expect((error as BusinessWorkflowError).code).toBe('REQUIREMENT_INVALID')
      expect((error as BusinessWorkflowError).message).toContain('summary')
    }
  })

  it('reports a duplicate case name', () => {
    expect(() => validateSubmission(submission({
      acceptanceCases: [caseItem(), caseItem()],
    }))).toThrow(/duplicate acceptanceCases/)
  })
})

describe('analyzeGaps', () => {
  it('returns no gaps for a complete requirement', () => {
    expect(analyzeGaps(spec())).toEqual([])
  })

  it('returns one actionable gap per missing aspect', () => {
    const draft = spec({
      objectives: [],
      inputs: [],
      outputs: [],
      acceptanceCases: [],
    })
    const gaps = analyzeGaps(draft)
    expect(gaps.map(gap => gap.topic)).toEqual(['objectives', 'inputs', 'outputs', 'acceptance'])
    for (const gap of gaps) {
      expect(gap.question.length).toBeGreaterThan(0)
    }
  })
})

describe('validateComposition', () => {
  it('accepts a structurally valid composition', () => {
    expect(validateComposition(spec(), composition())).toEqual([])
  })

  it('rejects an empty step list and nothing else', () => {
    const issues = validateComposition(spec(), composition({ steps: [], finalOutputs: [] }))
    expect(issues.map(issueEntry => issueEntry.code)).toEqual(['STEPS_EMPTY'])
  })

  it('rejects empty and duplicate step ids', () => {
    const issues = validateComposition(spec(), composition({
      steps: [step({ id: '' }), step(), step()],
    }))
    expect(issues.map(issueEntry => issueEntry.code)).toEqual(['STEP_ID_EMPTY', 'STEP_ID_DUPLICATE'])
  })

  it('rejects a dependency on an unknown step', () => {
    const issues = validateComposition(spec(), composition({
      steps: [step({ dependsOn: ['ghost'] })],
    }))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ code: 'DEPENDENCY_UNKNOWN', ref: 'score' })
  })

  it('rejects a dependency cycle', () => {
    const issues = validateComposition(spec(), composition({
      steps: [
        step({ id: 'a', dependsOn: ['b'] }),
        step({ id: 'b', dependsOn: ['a'], inputs: [] }),
      ],
    }))
    expect(issues.map(issueEntry => issueEntry.code)).toContain('DEPENDENCY_CYCLE')
    expect(issues[0]?.ref).toBeDefined()
  })

  it('rejects an implicit dependency: reading a step output without depending on it', () => {
    const issues = validateComposition(spec(), composition({
      steps: [
        step(),
        step({
          id: 'polish',
          dependsOn: [],
          inputs: [{ name: 'draft', source: { kind: 'step', step: 'score' } }],
        }),
      ],
    }))
    expect(issues.map(issueEntry => issueEntry.code)).toEqual(['IMPLICIT_DEPENDENCY'])
  })

  it('rejects duplicate input names within one step', () => {
    const issues = validateComposition(spec(), composition({
      steps: [step({
        inputs: [
          { name: 'raw', source: { kind: 'requirement', field: 'leads' } },
          { name: 'raw', source: { kind: 'requirement', field: 'leads' } },
        ],
      })],
    }))
    expect(issues.map(issueEntry => issueEntry.code)).toEqual(['INPUT_NAME_DUPLICATE'])
  })

  it('rejects input sources naming unknown requirement fields and unknown steps', () => {
    const fieldIssues = validateComposition(spec(), composition({
      steps: [step({
        inputs: [{ name: 'raw', source: { kind: 'requirement', field: 'ghost' } }],
      })],
    }))
    expect(fieldIssues.map(issueEntry => issueEntry.code)).toEqual(['INPUT_SOURCE_UNKNOWN'])

    const stepIssues = validateComposition(spec(), composition({
      steps: [step({
        inputs: [{ name: 'raw', source: { kind: 'step', step: 'ghost' } }],
      })],
    }))
    expect(stepIssues.map(issueEntry => issueEntry.code)).toEqual(['INPUT_SOURCE_UNKNOWN'])
  })

  it('rejects references to unknown objectives and uncovered objectives', () => {
    const issues = validateComposition(spec(), composition({
      steps: [step({ objectives: ['ghost'] })],
    }))
    expect(issues.map(issueEntry => issueEntry.code)).toEqual(['OBJECTIVE_UNKNOWN', 'OBJECTIVE_UNCOVERED'])
    expect(issues[1]).toMatchObject({ code: 'OBJECTIVE_UNCOVERED', ref: 'rank-leads' })
  })

  it('rejects unknown, duplicate, and missing final output bindings', () => {
    const unknown = validateComposition(spec(), composition({
      finalOutputs: [{ name: 'ghost', source: { kind: 'step', step: 'score' } }],
    }))
    expect(unknown.map(issueEntry => issueEntry.code)).toEqual(['OUTPUT_NAME_UNKNOWN', 'OUTPUT_UNBOUND'])

    const duplicate = validateComposition(spec(), composition({
      finalOutputs: [
        { name: 'ranking', source: { kind: 'step', step: 'score' } },
        { name: 'ranking', source: { kind: 'step', step: 'score' } },
      ],
    }))
    expect(duplicate.map(issueEntry => issueEntry.code)).toEqual(['OUTPUT_DUPLICATE'])

    const boundElsewhere = validateComposition(spec(), composition({
      finalOutputs: [
        { name: 'ranking', source: { kind: 'step', step: 'score' } },
        { name: 'ranking', source: { kind: 'requirement', field: 'leads' } },
      ],
    }))
    expect(boundElsewhere.map(issueEntry => issueEntry.code)).toEqual(['OUTPUT_DUPLICATE'])
  })

  it('rejects final output sources naming unknown requirement fields and unknown steps', () => {
    const fieldIssues = validateComposition(spec(), composition({
      finalOutputs: [{ name: 'ranking', source: { kind: 'requirement', field: 'ghost' } }],
    }))
    expect(fieldIssues.map(issueEntry => issueEntry.code)).toEqual(['OUTPUT_SOURCE_UNKNOWN'])

    const stepIssues = validateComposition(spec(), composition({
      finalOutputs: [{ name: 'ranking', source: { kind: 'step', step: 'ghost' } }],
    }))
    expect(stepIssues.map(issueEntry => issueEntry.code)).toEqual(['OUTPUT_SOURCE_UNKNOWN'])
  })
})

describe('topologicalOrder', () => {
  it('orders a linear chain dependencies-first', () => {
    const steps = [
      step({ id: 'c', dependsOn: ['b'], inputs: [{ name: 'x', source: { kind: 'step', step: 'b' } }] }),
      step({ id: 'a', dependsOn: [], inputs: [] }),
      step({ id: 'b', dependsOn: ['a'], inputs: [{ name: 'x', source: { kind: 'step', step: 'a' } }] }),
    ]
    expect(topologicalOrder(steps).order.map(ordered => ordered.id)).toEqual(['a', 'b', 'c'])
    expect(topologicalOrder(steps).cyclicIds).toEqual([])
  })

  it('orders a diamond with shared roots first', () => {
    const steps = [
      step({ id: 'left', dependsOn: ['root'], inputs: [] }),
      step({ id: 'right', dependsOn: ['root'], inputs: [] }),
      step({ id: 'join', dependsOn: ['left', 'right'], inputs: [] }),
      step({ id: 'root', dependsOn: [], inputs: [] }),
    ]
    const order = topologicalOrder(steps).order.map(ordered => ordered.id)
    expect(order.indexOf('root')).toBe(0)
    expect(order.indexOf('join')).toBe(3)
  })

  it('peels steps whose dependencies are unknown ids (reported separately, not cyclic)', () => {
    const steps = [step({ id: 'a', dependsOn: ['ghost'], inputs: [] })]
    const result = topologicalOrder(steps)
    expect(result.order.map(ordered => ordered.id)).toEqual(['a'])
    expect(result.cyclicIds).toEqual([])
  })

  it('reports every step inside or downstream of a cycle', () => {
    const steps = [
      step({ id: 'a', dependsOn: ['b'], inputs: [] }),
      step({ id: 'b', dependsOn: ['a'], inputs: [] }),
      step({ id: 'c', dependsOn: ['a'], inputs: [] }),
      step({ id: 'free', dependsOn: [], inputs: [] }),
    ]
    const result = topologicalOrder(steps)
    expect(result.cyclicIds.sort()).toEqual(['a', 'b', 'c'])
    expect(result.order.map(ordered => ordered.id)).toEqual(['free'])
  })
})

describe('checkCaseInputCoverage', () => {
  it('passes when every case provides every input field', () => {
    expect(checkCaseInputCoverage(spec())).toBeUndefined()
  })

  it('names every case and field a missing given value leaves open', () => {
    const detail = checkCaseInputCoverage(spec({
      acceptanceCases: [caseItem({ name: 'first', given: {} }), caseItem({ name: 'second', given: {} })],
    }))
    expect(detail).toContain('first')
    expect(detail).toContain('second')
    expect(detail).toContain('leads')
  })

  it('distinguishes an absent key from a present-but-null value', () => {
    expect(checkCaseInputCoverage(spec({
      acceptanceCases: [caseItem({ given: { leads: null } })],
    }))).toBeUndefined()
  })
})
