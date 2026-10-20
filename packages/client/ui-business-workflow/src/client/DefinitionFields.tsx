/** Business fields and explicit source selectors for the visual workflow editor. */
import type { WorkflowDefinition, WorkflowNode } from '@deepseek-ai/dsh-business-workflow/workbench-types'
import type { AcceptanceCase, InputSource } from '@deepseek-ai/dsh-business-workflow/types'
import type { WorkbenchPageProps } from './WorkbenchPage.tsx'
import { JsonField } from './JsonField.tsx'
import css from './BusinessWorkflowPage.module.css'

type Copy = WorkbenchPageProps['t']
type DefinitionProps = {
  definition: WorkflowDefinition
  onChange: (definition: WorkflowDefinition) => void
  t: Copy
}

function SourceSelect({ definition, value, exclude, onChange, label, t }: {
  definition: WorkflowDefinition
  value?: InputSource | undefined
  exclude?: string
  onChange: (source: InputSource) => void
  label: string
  t: Copy
}) {
  const sources = [
    ...definition.requirement.inputs.map(field => ({
      source: { kind: 'requirement' as const, field: field.name },
      label: t('step.requirementSource', { name: field.name }),
    })),
    ...definition.nodes.filter(node => node.id !== exclude).map(node => ({
      source: { kind: 'step' as const, step: node.id },
      label: t('step.stepSource', { name: node.title }),
    })),
  ]
  return <label>{label}<select value={value === undefined ? '' : JSON.stringify(value)} onChange={(event) => {
    const source = sources.find(item => JSON.stringify(item.source) === event.target.value)
    if (source !== undefined) onChange(source.source)
  }}>
    <option value="">{t('wb.chooseSource')}</option>
    {sources.map(item => <option key={JSON.stringify(item.source)} value={JSON.stringify(item.source)}>{item.label}</option>)}
    {value !== undefined && !sources.some(item => JSON.stringify(item.source) === JSON.stringify(value))
      ? <option value={JSON.stringify(value)}>{t('wb.missingSource')}</option> : null}
  </select></label>
}

/**
 * Edit named objectives, business data fields, constraints, and final output sources.
 * @param props - the definition, edit operation, and localized copy.
 * @returns form fields with stable names and explicit source selectors.
 */
export function RequirementFields({ definition, onChange, onValidity, t }: DefinitionProps & {
  onValidity: (label: string, valid: boolean) => void
}) {
  const requirement = definition.requirement
  const updateCase = (index: number, patch: Partial<AcceptanceCase>): void => {
    onChange({ ...definition, requirement: {
      ...requirement,
      acceptanceCases: requirement.acceptanceCases.map((item, i) => i === index ? { ...item, ...patch } : item),
    } })
  }
  return <div className={css.businessFields}>
    <fieldset><legend>{t('wb.businessGoals')}</legend>
      {requirement.objectives.map((objective, index) => <div className={css.fieldRow} key={index}>
        <label>{t('wb.identifier')}<input value={objective.id} onChange={(event) =>{  onChange({ ...definition, requirement: {
          ...requirement, objectives: requirement.objectives.map((item, i) => i === index ? { ...item, id: event.target.value } : item),
        } }) }} /></label>
        <label>{t('wb.goalStatement')}<input value={objective.statement} onChange={(event) =>{  onChange({ ...definition, requirement: {
          ...requirement,
          objectives: requirement.objectives.map((item, i) => i === index ? { ...item, statement: event.target.value } : item),
        } }) }} /></label>
        <button type="button" aria-label={`${t('wb.remove')} ${objective.id}`} onClick={() =>{  onChange({ ...definition, requirement: { ...requirement, objectives: requirement.objectives.filter((_, i) => i !== index) } }) }}>{t('wb.remove')}</button>
      </div>)}
      <button type="button" onClick={() =>{  onChange({ ...definition, requirement: { ...requirement, objectives: [...requirement.objectives, { id: crypto.randomUUID(), statement: '' }] } }) }}>{t('wb.addGoal')}</button>
    </fieldset>
    {(['inputs', 'outputs'] as const).map(key => <fieldset key={key}><legend>{t(key === 'inputs' ? 'wb.businessInputs' : 'wb.businessOutputs')}</legend>
      {requirement[key].map((field, index) => <div className={css.fieldRow} key={index}>
        <label>{t('wb.fieldName')}<input value={field.name} onChange={(event) =>{  onChange({ ...definition, requirement: {
          ...requirement, [key]: requirement[key].map((item, i) => i === index ? { ...item, name: event.target.value } : item),
        } }) }} /></label>
        <label>{t('wb.meaning')}<input value={field.description} onChange={(event) =>{  onChange({ ...definition, requirement: {
          ...requirement, [key]: requirement[key].map((item, i) => i === index ? { ...item, description: event.target.value } : item),
        } }) }} /></label>
        <button type="button" aria-label={`${t('wb.remove')} ${field.name}`} onClick={() =>{  onChange({ ...definition, requirement: { ...requirement, [key]: requirement[key].filter((_, i) => i !== index) } }) }}>{t('wb.remove')}</button>
      </div>)}
      <button type="button" onClick={() =>{  onChange({ ...definition, requirement: { ...requirement, [key]: [...requirement[key], { name: '', description: '' }] } }) }}>{t(key === 'inputs' ? 'wb.addInput' : 'wb.addOutput')}</button>
    </fieldset>)}
    <fieldset><legend>{t('wb.businessConstraints')}</legend>
      {requirement.constraints.map((constraint, index) => <div className={css.fieldRow} key={index}>
        <label>{t('wb.constraint')}<textarea rows={2} value={constraint} onChange={(event) =>{  onChange({ ...definition, requirement: { ...requirement, constraints: requirement.constraints.map((item, i) => i === index ? event.target.value : item) } }) }} /></label>
        <button type="button" aria-label={`${t('wb.remove')} ${index + 1}`} onClick={() =>{  onChange({ ...definition, requirement: { ...requirement, constraints: requirement.constraints.filter((_, i) => i !== index) } }) }}>{t('wb.remove')}</button>
      </div>)}
      <button type="button" onClick={() =>{  onChange({ ...definition, requirement: { ...requirement, constraints: [...requirement.constraints, ''] } }) }}>{t('wb.addConstraint')}</button>
    </fieldset>
    <fieldset><legend>{t('wb.acceptance')}</legend>
      {requirement.acceptanceCases.map((sample, index) => <div className={css.fieldRow} key={index}>
        <label>{t('wb.caseName')}<input value={sample.name} onChange={(event) => {
          updateCase(index, { name: event.target.value })
        }} /></label>
        <JsonField label={t('wb.caseInputs', { number: index + 1 })} value={sample.given} onValidity={onValidity} onChange={(given) => {
          updateCase(index, { given })
        }} />
        <label>{t('wb.assertion')}<select value={sample.expect.kind} onChange={(event) => {
          const expect = event.target.value === 'contains' ? { kind: 'contains' as const, value: '' } : { kind: 'nonEmpty' as const }
          updateCase(index, { expect })
        }}><option value="nonEmpty">{t('wb.nonEmpty')}</option><option value="contains">{t('wb.contains')}</option></select></label>
        {sample.expect.kind === 'contains' ? <label>{t('wb.expectedText')}<input value={sample.expect.value} onChange={(event) => {
          updateCase(index, { expect: { kind: 'contains', value: event.target.value } })
        }} /></label> : null}
        <button type="button" aria-label={`${t('wb.remove')} ${sample.name}`} onClick={() => {
          onChange({ ...definition, requirement: {
            ...requirement, acceptanceCases: requirement.acceptanceCases.filter((_, i) => i !== index),
          } })
        }}>{t('wb.remove')}</button>
      </div>)}
      <button type="button" onClick={() => {
        onChange({ ...definition, requirement: { ...requirement, acceptanceCases: [...requirement.acceptanceCases, { name: '', given: {}, expect: { kind: 'nonEmpty' } }] } })
      }}>{t('wb.addCase')}</button>
    </fieldset>
    <fieldset><legend>{t('wb.outputSources')}</legend>
      {requirement.outputs.map(field => <SourceSelect key={field.name} label={field.name} definition={definition} t={t}
        value={definition.finalOutputs.find(binding => binding.name === field.name)?.source}
        onChange={(source) => {
          onChange({ ...definition, finalOutputs: [
            ...definition.finalOutputs.filter(binding => binding.name !== field.name), { name: field.name, source },
          ] })
        }} />)}
    </fieldset>
  </div>
}

/**
 * Edit a node's named input bindings and objective coverage with dependency-safe selectors.
 * @param props - definition, selected node, edit operation, and localized copy.
 * @returns node input and objective form controls.
 */
export function NodeFields({ definition, node, onChange, t }: DefinitionProps & { node: WorkflowNode }) {
  const update = (patch: Partial<WorkflowNode>) => {
    onChange({ ...definition, nodes: definition.nodes.map(item => item.id === node.id ? { ...item, ...patch } : item) })
  }
  return <>
    <fieldset><legend>{t('step.inputs')}</legend>
      {node.inputs.map((input, index) => <div className={css.inputBinding} key={index}>
        <label>{t('wb.fieldName')}<input value={input.name} onChange={(event) =>{  update({ inputs: node.inputs.map((item, i) => i === index ? { ...item, name: event.target.value } : item) }) }} /></label>
        <SourceSelect definition={definition} t={t} label={t('wb.sourceValue')} exclude={node.id} value={input.source} onChange={(source) =>{  update({
          inputs: node.inputs.map((item, i) => i === index ? { ...item, source } : item),
          dependsOn: source.kind === 'step' && !node.dependsOn.includes(source.step) ? [...node.dependsOn, source.step] : node.dependsOn,
        }) }} />
        <button type="button" onClick={() =>{  update({ inputs: node.inputs.filter((_, i) => i !== index) }) }}>{t('wb.remove')}</button>
      </div>)}
      <button type="button" disabled={definition.requirement.inputs.length === 0 && definition.nodes.length <= 1} onClick={() => {
        const field = definition.requirement.inputs[0]
        const predecessor = definition.nodes.find(item => item.id !== node.id)
        if (field !== undefined) update({ inputs: [...node.inputs, { name: field.name, source: { kind: 'requirement', field: field.name } }] })
        else if (predecessor !== undefined) update({
          inputs: [...node.inputs, { name: predecessor.title, source: { kind: 'step', step: predecessor.id } }],
          dependsOn: node.dependsOn.includes(predecessor.id) ? node.dependsOn : [...node.dependsOn, predecessor.id],
        })
      }}>{t('wb.addInput')}</button>
    </fieldset>
    <fieldset><legend>{t('step.objectives')}</legend>
      {definition.requirement.objectives.map(objective => <label className={css.check} key={objective.id}>
        <input type="checkbox" checked={node.objectives.includes(objective.id)} onChange={(event) =>{  update({ objectives: event.target.checked ? [...node.objectives, objective.id] : node.objectives.filter(id => id !== objective.id) }) }} />
        {objective.statement || objective.id}
      </label>)}
    </fieldset>
  </>
}
