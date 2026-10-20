/** Workspace-scoped skill discovery for reusable business-agent definitions. */
import { useEffect, useState } from 'react'
import type { AgentCapabilities, AgentRun } from '@deepseek-ai/dsh-api-remotes/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentKey } from './locales.ts'
import css from './AgentPage.module.css'

interface SkillPickerProps {
  selected: string[]
  workspaces: readonly { workspaceId: AgentRun['workspaceId']; title: string }[]
  load: (workspaceId: AgentRun['workspaceId']) => Promise<AgentCapabilities>
  change: (skills: string[]) => void
  t: (key: AgentKey) => string
}

/**
 * Select skills discovered through the deployment runtime without starting a task.
 * @param props - workspace directory, selected names, and capability discovery.
 * @returns a searchable catalogue that retains unresolved selections.
 */
export function AgentSkillPicker({ selected, workspaces, load, change, t }: SkillPickerProps) {
  const [workspace, setWorkspace] = useState('')
  const [query, setQuery] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [catalog, setCatalog] = useState<AgentCapabilities | null>(null)
  const [error, setError] = useState<string | null>(null)
  const selectedWorkspace = workspaces.find(item => item.workspaceId === workspace) ?? workspaces[0]
  const workspaceId = selectedWorkspace?.workspaceId
  useEffect(() => {
    let active = true
    setCatalog(null); setError(null)
    if (workspaceId !== undefined) {
      void load(workspaceId).then((value) => { if (active) setCatalog(value) }, (failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : String(failure))
      })
    }
    return () => { active = false }
  }, [workspaceId, load, attempt])
  const needle = query.trim().toLocaleLowerCase()
  const available = catalog?.skills ?? []
  const visible = available.filter(skill => [skill.name, skill.description].some(text => text.toLocaleLowerCase().includes(needle)))
  const missing = catalog === null ? [] : selected.filter(name => name.trim() !== '' && !available.some(skill => skill.name === name))
  return <section className={css.capability} aria-label={t('skillCatalog')}>
    <h3>{t('skillCatalog')}</h3><p className={css.hint}>{t('skillCatalogHint')}</p>
    <label>{t('skillWorkspace')}<select value={workspaceId ?? ''} onChange={(event) => { setWorkspace(event.target.value) }}>
      {workspaceId === undefined ? <option value="">{t('noWorkspace')}</option> : null}
      {workspaces.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.title}</option>)}
    </select></label>
    {workspaceId === undefined ? null : <>
      <input type="search" aria-label={t('searchSkills')} placeholder={t('searchSkills')} value={query} onChange={(event) => { setQuery(event.target.value) }} />
      {error === null ? null : <p role="alert" className={css.error}>{error}</p>}
      {catalog !== null || error !== null ? null : <p role="status">{t('loadingSkills')}</p>}
      <div className={css.skillChoices}>
        {visible.map(skill => <label key={skill.name} className={css.skillChoice}>
          <input type="checkbox" checked={selected.includes(skill.name)} onChange={(event) => {
            change(event.target.checked ? [...selected, skill.name] : selected.filter(name => name !== skill.name))
          }} />
          <span><strong>{skill.name}</strong><small>{skill.description}</small></span>
        </label>)}
        {missing.map(name => <label key={name} className={css.skillChoice}>
          <input type="checkbox" checked onChange={() => { change(selected.filter(value => value !== name)) }} />
          <span><strong>{name}</strong><small>{t('unavailableSkill')}</small></span>
        </label>)}
      </div>
      {catalog?.skills.length === 0 ? <p className={css.hint}>{t('noSkills')}</p> : null}
      <Button variant="outline" onClick={() => { setAttempt(value => value + 1) }}>{t('refreshSkills')}</Button>
    </>}
  </section>
}
