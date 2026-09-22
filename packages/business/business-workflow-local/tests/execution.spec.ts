import { describe, expect, it } from 'vitest'
import type { FinalOutputBinding, WorkflowStep } from '@deepseek-ai/dsh-business-workflow'
import { assertAcceptance, renderThrown, resolveFinalOutput, resolveStepInputs, stepTrace } from '../src/execution.ts'

const step = (overrides: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id: 'score',
  title: 'Score leads',
  instruction: 'Score each lead.',
  dependsOn: [],
  inputs: [],
  objectives: [],
  ...overrides,
})

describe('resolveStepInputs', () => {
  it('resolves requirement sources from the case given values', () => {
    const resolved = resolveStepInputs(
      step({ inputs: [{ name: 'raw', source: { kind: 'requirement', field: 'leads' } }] }),
      { given: { leads: ['a'] }, outputs: new Map() },
    )
    expect(resolved).toEqual({ raw: ['a'] })
  })

  it('resolves step sources from completed predecessor outputs', () => {
    const resolved = resolveStepInputs(
      step({ inputs: [{ name: 'draft', source: { kind: 'step', step: 'collect' } }] }),
      { given: {}, outputs: new Map([['collect', 'collected text']]) },
    )
    expect(resolved).toEqual({ draft: 'collected text' })
  })

  it('falls back to an empty string for a step source with no recorded output', () => {
    const resolved = resolveStepInputs(
      step({ inputs: [{ name: 'draft', source: { kind: 'step', step: 'missing' } }] }),
      { given: {}, outputs: new Map() },
    )
    expect(resolved).toEqual({ draft: '' })
  })

  it('carries an absent requirement field as undefined', () => {
    const resolved = resolveStepInputs(
      step({ inputs: [{ name: 'raw', source: { kind: 'requirement', field: 'ghost' } }] }),
      { given: {}, outputs: new Map() },
    )
    expect(resolved).toEqual({ raw: undefined })
  })
})

describe('resolveFinalOutput', () => {
  it('serializes a requirement binding from the case given values', () => {
    const binding: FinalOutputBinding = { name: 'source', source: { kind: 'requirement', field: 'leads' } }
    expect(resolveFinalOutput(binding, { given: { leads: ['alpha'] }, outputs: new Map() }))
      .toBe('["alpha"]')
  })

  it('carries a step binding from the completed output', () => {
    const binding: FinalOutputBinding = { name: 'ranking', source: { kind: 'step', step: 'score' } }
    expect(resolveFinalOutput(binding, { given: {}, outputs: new Map([['score', 'ranked']]) }))
      .toBe('ranked')
  })

  it('falls back to empty text when the bound step never completed', () => {
    const binding: FinalOutputBinding = { name: 'ranking', source: { kind: 'step', step: 'missing' } }
    expect(resolveFinalOutput(binding, { given: {}, outputs: new Map() })).toBe('')
  })
})

describe('assertAcceptance', () => {
  it('nonEmpty passes when every bound output is non-empty text', () => {
    expect(assertAcceptance({ kind: 'nonEmpty' }, { ranking: 'high', note: ' n ' })).toBeUndefined()
  })

  it('nonEmpty names the first empty bound output', () => {
    expect(assertAcceptance({ kind: 'nonEmpty' }, { ranking: 'high', note: '  ' }))
      .toBe('final output "note" is empty')
  })

  it('contains passes when the serialized outputs include the value', () => {
    expect(assertAcceptance({ kind: 'contains', value: 'high' }, { ranking: 'high tier' })).toBeUndefined()
  })

  it('contains reports the missing value', () => {
    expect(assertAcceptance({ kind: 'contains', value: 'gold' }, { ranking: 'high tier' }))
      .toBe('serialized final outputs do not contain "gold"')
  })
})

describe('stepTrace', () => {
  it('keeps short details verbatim', () => {
    expect(stepTrace('score', 'completed', 'short output', 100)).toEqual({
      stepId: 'score',
      status: 'completed',
      detail: 'short output',
    })
  })

  it('truncates long details with a notice naming the remainder', () => {
    const trace = stepTrace('score', 'failed', 'x'.repeat(10), 4)
    expect(trace.detail).toBe('xxxx… [truncated: 6 more characters]')
  })
})

describe('renderThrown', () => {
  it('renders an ordinary error through String()', () => {
    expect(renderThrown(new Error('boom'))).toContain('boom')
    expect(renderThrown('plain')).toBe('plain')
  })

  it('falls back to a fixed label for an unrenderable value', () => {
    expect(renderThrown(Object.create(null))).toBe('[unrenderable thrown value]')
  })
})
