/** Local runtime and provider-owned model selection for an identity. */
import { useEffect, useState } from 'react'
import type { AgentDefinition, AgentRuntime } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, IconRuntimeOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentKey } from './locales.ts'
import css from './AgentPage.module.css'

/**
 * Bind execution to a declared local service without changing the system model.
 * @param props - draft, local catalog loader, and controlled update callback.
 * @returns runtime and model selectors with explicit unavailable states.
 */
export function AgentRuntimePicker({ value, load, change, t }: {
  value: AgentDefinition
  load: () => Promise<AgentRuntime[]>
  change: (value: AgentDefinition) => void
  t: (key: AgentKey) => string
}) {
  const [catalog, setCatalog] = useState<AgentRuntime[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setCatalog(null); setError(null)
    void load().then((rows) => { if (active) setCatalog(rows) }, (failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : String(failure))
    })
    return () => { active = false }
  }, [load, attempt])
  const modelOverride = value.model
  const runtime = catalog?.find(row => row.id === value.runtime)
  return <section className={css.execution}>
    <div className={css.sectionHeading}><h3>{t('execution')}</h3><p>{t('executionHint')}</p></div>
    {catalog === null && error === null ? <p role="status">{t('loadingRuntimes')}</p> : null}
    {error === null ? null : <p role="alert" className={css.error}>{error}</p>}
    <div className={css.executionCard}>
      <label>{t('runtime')}<div className={css.runtimeSelect}>
        <IconRuntimeOutline16 size={22} />
        <select aria-label={t('runtime')} required value={value.runtime} onChange={(event) => { change({ ...value, runtime: event.target.value, model: undefined }) }}>
          <option value="">{t('chooseRuntime')}</option>
          {value.runtime !== '' && runtime === undefined ? <option value={value.runtime} disabled>{value.runtime} · {t('offline')}</option> : null}
          {catalog?.map(row => <option key={row.id} value={row.id} disabled={!row.available}>{row.name}{row.available ? '' : ` · ${t('offline')}`}</option>)}
        </select>
      </div><small>{runtime === undefined ? t('localRuntimeHint') : `${t('localRuntime')} · ${runtime.command}`}</small></label>
      <label>{t('model')}<div className={css.runtimeSelect}>
        <select aria-label={t('model')} required={runtime?.defaultModel === undefined} disabled={runtime === undefined || !runtime.available} value={value.model?.model ?? ''}
          onChange={(event) => { change({ ...value, model: event.target.value === '' ? undefined : { provider: value.runtime, model: event.target.value } }) }}>
          <option value="">{runtime?.defaultModel === undefined ? t('chooseModel') : t('runtimeDefault')}</option>
          {modelOverride !== undefined && !runtime?.models.some(model => model.id === modelOverride.model)
            ? <option value={modelOverride.model}>{modelOverride.model}</option> : null}
          {runtime?.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
      </div><small>{t('runtimeModelHint')}</small></label>
    </div>
    {modelOverride === undefined ? null : <label>{t('effort')}<input value={modelOverride.reasoningEffort ?? ''} onChange={(event) => {
      change({ ...value, model: { ...modelOverride, reasoningEffort: event.target.value || undefined } })
    }} /></label>}
    {runtime?.error === undefined ? null : <p role="alert" className={css.error}>{runtime.error}</p>}
    {catalog?.length === 0 ? <p className={css.hint}>{t('noLocalRuntimes')}</p> : null}
    <Button variant="outline" onClick={() => { setAttempt(value => value + 1) }}>{t('refreshRuntimes')}</Button>
  </section>
}
