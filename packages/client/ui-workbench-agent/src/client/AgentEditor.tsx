/** Controlled editor for an identity's revisioned configuration. */
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentDefinition } from '@deepseek-ai/dsh-api-remotes/client'
import type { AgentKey } from './locales.ts'
import css from './AgentPage.module.css'

interface EditorProps {
  formId: string
  definition: AgentDefinition
  maxConcurrency: number
  busy: boolean
  t: (key: AgentKey) => string
  change: (definition: AgentDefinition) => void
  save: () => void
}

/**
 * Edit fields without modifying persisted records until Save.
 * @param props - controlled draft and host mutation callbacks.
 * @returns the complete native-runtime configuration form.
 */
export function AgentEditor({ formId, definition: value, maxConcurrency, busy, t, change, save }: EditorProps) {
  const set = (patch: Partial<AgentDefinition>) => { change({ ...value, ...patch }) }
  const setModel = (field: 'provider' | 'model' | 'reasoningEffort', text: string) => {
    const next = { provider: '', model: '', ...value.model, [field]: text }
    if (next.reasoningEffort === '') delete next.reasoningEffort
    set({ model: next.provider === '' && next.model === '' && next.reasoningEffort === undefined ? undefined : next })
  }
  return <form id={formId} className={css.editor} onSubmit={(event) => { event.preventDefault(); save() }}>
    <fieldset disabled={busy}>
      <div className={css.identityFields}>
        <label>{t('name')}<input required maxLength={120} autoFocus value={value.name} onChange={(event) => { set({ name: event.target.value }) }} />
        </label>
        <label>{t('avatar')}<input maxLength={32} value={value.avatar} onChange={(event) => { set({ avatar: event.target.value }) }} />
        </label>
      </div>
      <label>{t('description')}<textarea maxLength={2000} value={value.description} onChange={(event) => { set({ description: event.target.value }) }} />
        <small>{t('descriptionHint')}</small>
      </label>
      <label>{t('instructions')}<textarea rows={7} value={value.instructions} onChange={(event) => { set({ instructions: event.target.value }) }} />
        <small>{t('instructionsHint')}</small>
      </label>
      <label>{t('runtime')}<select value={value.runtime}>
        <option value="harness">{t('nativeRuntime')}</option>
      </select>
      </label>
      <p className={css.hint}>{t('defaultModel')}</p>
      <div className={css.modelFields}>
        <label>{t('provider')}<input value={value.model?.provider ?? ''} onChange={(event) => { setModel('provider', event.target.value) }} />
        </label>
        <label>{t('model')}<input value={value.model?.model ?? ''} onChange={(event) => { setModel('model', event.target.value) }} />
        </label>
        <label>{t('effort')}<input value={value.model?.reasoningEffort ?? ''} onChange={(event) => { setModel('reasoningEffort', event.target.value) }} />
        </label>
      </div>
      <label>{t('skills')}<textarea value={value.skills.join('\n')} onChange={(event) => { set({ skills: event.target.value.split('\n') }) }} />
        <small>{t('skillsHint')}</small>
      </label>
      <label>{t('concurrency')}<input required type="number" min={1} max={maxConcurrency} value={value.concurrency} onChange={(event) => { set({ concurrency: Number(event.target.value) }) }} />
      </label>
      <h3>{t('starters')}</h3>
      <p className={css.hint}>{t('starterHint')}</p>
      {value.starters.map((starter, index) => <div className={css.starter} key={index}>
        <label>{t('starterLabel')} {index + 1}<input required maxLength={80} value={starter.label} onChange={(event) => { set({ starters: value.starters.map((item, i) => i === index ? { ...item, label: event.target.value } : item) }) }} />
        </label>
        <label>{t('starterPrompt')} {index + 1}<textarea required value={starter.prompt} onChange={(event) => { set({ starters: value.starters.map((item, i) => i === index ? { ...item, prompt: event.target.value } : item) }) }} />
        </label>
        <Button variant="outline" onClick={() => { set({ starters: value.starters.filter((_, i) => i !== index) }) }}>{t('remove')} {index + 1}</Button>
      </div>)}
      <Button variant="outline" disabled={value.starters.length >= 3} onClick={() => { set({ starters: [...value.starters, { label: '', prompt: '' }] }) }}>{t('addStarter')}</Button>
    </fieldset>
  </form>
}
