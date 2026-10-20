/** Controlled editor for an identity's revisioned configuration. */
import { Button, IconAgentPresetOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentCapabilities, AgentDefinition, AgentRuntime, AgentRun } from '@deepseek-ai/dsh-api-remotes/client'
import { AgentRuntimePicker } from './AgentRuntimePicker.tsx'
import { AgentSkillPicker } from './AgentSkillPicker.tsx'
import { AgentMcpEditor } from './AgentMcpEditor.tsx'
import type { AgentKey } from './locales.ts'
import css from './AgentPage.module.css'

interface EditorProps {
  formId: string
  definition: AgentDefinition
  maxConcurrency: number
  busy: boolean
  workspaces: readonly { workspaceId: AgentRun['workspaceId']; title: string }[]
  runtimes: () => Promise<AgentRuntime[]>
  capabilities: (workspaceId: AgentRun['workspaceId']) => Promise<AgentCapabilities>
  t: (key: AgentKey) => string
  change: (definition: AgentDefinition) => void
  save: () => void
}

/**
 * Edit fields without modifying persisted records until Save.
 * @param props - controlled draft and host mutation callbacks.
 * @returns the complete native-runtime configuration form.
 */
export function AgentEditor({
  formId, definition: value, maxConcurrency, busy, workspaces, capabilities, runtimes, t, change, save,
}: EditorProps) {
  const set = (patch: Partial<AgentDefinition>) => { change({ ...value, ...patch }) }
  const sections = ['identity', 'execution', 'instructions', 'skills', 'mcpServers', 'settings'] as const
  return <form id={formId} className={css.editor} onSubmit={(event) => { event.preventDefault(); save() }}>
    <div className={css.editorPreview}>
      <span className={css.profileAvatar}>{value.avatar || <IconAgentPresetOutline16 size={28} />}</span>
      <div><strong>{value.name || t('newTitle')}</strong><p>{value.description || t('createIntro')}</p></div>
    </div>
    <div className={css.editorLayout}>
      <nav className={css.editorNav} aria-label={t('editorNavigation')}>
        {sections.map(section => <button type="button" key={section} onClick={() => { document.getElementById(`${formId}-${section}`)?.scrollIntoView({ block: 'start', behavior: 'instant' }) }}>{t(section)}{section === 'skills' ? <span>{value.skills.filter(Boolean).length}</span> : section === 'mcpServers' ? <span>{value.mcpServers.length}</span> : null}</button>)}
      </nav>
      <fieldset disabled={busy}>
        <section id={`${formId}-identity`} className={css.editorSection}>
          <div className={css.sectionHeading}><h3>{t('identity')}</h3><p>{t('identityHint')}</p></div>
          <div className={css.identityFields}>
            <label>{t('name')}<input required maxLength={120} autoFocus value={value.name} onChange={(event) => { set({ name: event.target.value }) }} />
            </label>
            <label>{t('avatar')}<input maxLength={32} value={value.avatar} onChange={(event) => { set({ avatar: event.target.value }) }} />
            </label>
          </div>
          <label>{t('description')}<textarea maxLength={2000} value={value.description} onChange={(event) => { set({ description: event.target.value }) }} />
            <small>{t('descriptionHint')}</small>
          </label>
        </section>
        <section id={`${formId}-execution`} className={css.editorSection}>
          <AgentRuntimePicker value={value} load={runtimes} change={change} t={t} />
        </section>
        <section id={`${formId}-instructions`} className={css.editorSection}>
          <h3>{t('instructions')}</h3>
          <label>{t('instructions')}<textarea rows={7} value={value.instructions} onChange={(event) => { set({ instructions: event.target.value }) }} />
            <small>{t('instructionsHint')}</small>
          </label>
        </section>
        <section id={`${formId}-skills`} className={css.editorSection}>
          <AgentSkillPicker selected={value.skills} workspaces={workspaces} load={capabilities}
            change={(skills) => { set({ skills }) }} t={t} />
          <label>{t('skills')}<textarea aria-label={t('skills')} value={value.skills.join('\n')} onChange={(event) => { set({ skills: event.target.value.split('\n') }) }} />
            <small>{t('skillsHint')}</small>
          </label>
        </section>
        <section id={`${formId}-mcpServers`} className={css.editorSection}>
          <AgentMcpEditor servers={value.mcpServers} change={(mcpServers) => { set({ mcpServers }) }} t={t} />
        </section>
        <section id={`${formId}-settings`} className={css.editorSection}>
          <h3>{t('settings')}</h3>
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
        </section>
      </fieldset>
    </div>
  </form>
}
