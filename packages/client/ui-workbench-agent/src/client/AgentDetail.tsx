/** Full-width identity profile with capability panels, work history, and a contextual summary. */
import { useId, type ReactNode } from 'react'
import type { AgentRun, WorkbenchAgent } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, IconAgentPresetOutline16, IconPlusOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { AgentStatistics } from './AgentStatistics.tsx'
import type { AgentDetailTab } from './view-store.ts'
import type { AgentKey } from './locales.ts'
import css from './AgentPage.module.css'

interface DetailProps {
  agent: WorkbenchAgent
  runtimeName: string
  runs: AgentRun[]
  running: number
  queued: number
  available: boolean
  busy: boolean
  tab: AgentDetailTab
  t: (key: AgentKey) => string
  navigate: (tab: AgentDetailTab) => void
  back: () => void
  edit: () => void
  copy: () => void
  archive: () => void
  utilities: ReactNode
  history: ReactNode
  composer: ReactNode
}

/**
 * Present one saved identity using committed configuration and recorded executions.
 * @param props - selected identity, work state, panel content, and explicit operations.
 * @returns the identity header, keyboard-accessible panels, and summary sidebar.
 */
export function AgentDetail({
  agent, runtimeName, runs, running, queued, available, busy, tab, t, navigate, back, edit, copy, archive, utilities, history, composer,
}: DetailProps) {
  const prefix = useId()
  const tabs: AgentDetailTab[] = ['overview', 'runs', 'instructions', 'skills', 'mcpServers', 'settings']
  const model = agent.model === undefined ? t('runtimeDefault') : `${agent.model.provider} / ${agent.model.model}${agent.model.reasoningEffort ? ` · ${agent.model.reasoningEffort}` : ''}`
  const status = agent.archived ? 'archived' : !available ? 'offline' : running > 0 ? 'running' : queued > 0 ? 'queued' : 'idle'
  const assign = () => {
    navigate('overview')
    requestAnimationFrame(() => {
      const target = document.getElementById(`${prefix}-task`)
      target?.scrollIntoView({ block: 'center', behavior: 'instant' })
      target?.querySelector('textarea')?.focus()
    })
  }
  const facts = <dl className={css.facts}>
    <dt>{t('runtime')}</dt><dd>{runtimeName}</dd>
    <dt>{t('model')}</dt><dd>{model}</dd>
    <dt>{t('concurrency')}</dt><dd>{agent.concurrency}</dd>
    <dt>{t('revision')}</dt><dd>v{agent.revision}</dd>
    <dt>{t('updatedAt')}</dt><dd><time dateTime={new Date(agent.updatedAt).toISOString()}>{new Date(agent.updatedAt).toLocaleString()}</time></dd>
  </dl>
  return <section className={css.detail} aria-label={agent.name}>
    <div className={css.detailTopline}><nav className={css.breadcrumb} aria-label={t('agents')}><button type="button" onClick={back}>{t('agents')}</button><span aria-hidden="true">/</span><span>{agent.name}</span></nav>{utilities}</div>
    <header className={css.profileHeader}>
      <span className={css.profileAvatar}>{agent.avatar || <IconAgentPresetOutline16 size={32} />}</span>
      <div className={css.profileIdentity}>
        <div className={css.detailTitle}><h1>{agent.name}</h1><span className={css.presence} data-status={status}><i aria-hidden="true" />{t(status)}</span></div>
        <p className={css.detailDescription}>{agent.description || t('noDescription')}</p>
        <div className={css.profileMeta}><span>{model}</span><span>{runtimeName}</span><span>{t('capacity')} {running}/{agent.concurrency}{queued > 0 ? ` · ${t('queued')} ${queued}` : ''}</span></div>
      </div>
      <div className={css.profileActions}>
        <Button variant="primary" disabled={busy || agent.archived || !available} onClick={assign}><IconPlusOutline16 />{t('task')}</Button>
        <Button variant="outline" disabled={busy || agent.archived} onClick={edit}>{t('edit')}</Button>
        <Button variant="outline" disabled={busy} onClick={copy}>{t('copy')}</Button>
        <Button variant="outline" disabled={busy} onClick={archive}>{t(agent.archived ? 'restore' : 'archive')}</Button>
      </div>
    </header>
    <div className={css.detailTabs} role="tablist" aria-label={agent.name}>
      {tabs.map(item => <button type="button" role="tab" key={item} id={`${prefix}-${item}`} aria-selected={tab === item} aria-controls={`${prefix}-panel`} tabIndex={tab === item ? 0 : -1}
        onClick={() => { navigate(item) }} onKeyDown={(event) => {
          const index = tabs.indexOf(item)
          const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined
          if (next === undefined) return
          event.preventDefault()
          const target = tabs[next] as AgentDetailTab
          navigate(target); document.getElementById(`${prefix}-${target}`)?.focus()
        }}>{t(item)}{item === 'skills' ? <span>{agent.skills.length}</span> : item === 'mcpServers' ? <span>{agent.mcpServers.length}</span> : null}</button>)}
    </div>
    <div className={css.detailGrid}>
      <div role="tabpanel" id={`${prefix}-panel`} aria-labelledby={`${prefix}-${tab}`} className={css.detailPanel}>
        {tab === 'overview' ? <>
          <section className={css.currentWork} aria-label={t('currentWork')}>
            <h2>{t('currentWork')}<span>{running + queued}</span></h2>
            {running + queued === 0 ? <p>{t('noCurrentWork')}</p> : <ul>{runs.filter(run => run.status === 'running' || run.status === 'queued').map(run => <li key={run.id}><span className={css.presence} data-status={run.status}><i aria-hidden="true" />{t(run.status)}</span><span>{run.prompt}</span></li>)}</ul>}
          </section>
          <div className={css.sectionTitle}><h2>{t('recentWork')}</h2><button type="button" onClick={() => { navigate('runs') }}>{t('viewAll')}</button></div>
          {history}
          {agent.archived ? null : <div id={`${prefix}-task`}>{composer}</div>}
        </> : tab === 'runs' ? <><div className={css.sectionTitle}><h2>{t('runs')}</h2><span>{runs.length}</span></div>{history}</>
          : tab === 'instructions' ? <section className={css.configurationPanel}><h2>{t('instructions')}</h2><p className={css.hint}>{t('instructionsHint')}</p><pre className={css.instructions}>{agent.instructions || t('noInstructions')}</pre></section>
            : tab === 'skills' ? <section className={css.configurationPanel}><h2>{t('skills')} <span className={css.count}>{agent.skills.length}</span></h2><p className={css.hint}>{t('skillsHint')}</p><div className={css.chips}>{agent.skills.map(name => <span key={name}>{name}</span>)}</div>{agent.skills.length === 0 ? <p>{t('noSkills')}</p> : null}</section>
              : tab === 'mcpServers' ? <section className={css.configurationPanel}><h2>{t('mcpServers')}</h2><p className={css.hint}>{t('mcpHint')}</p>{agent.mcpServers.map(server => <div className={css.connectionCard} key={server.name}><strong>{server.name}</strong><span>{server.transport}</span><code>{server.transport === 'stdio' ? server.command : server.url}</code></div>)}{agent.mcpServers.length === 0 ? <p>{t('noMcp')}</p> : null}</section>
                : <section className={css.configurationPanel}><h2>{t('settings')}</h2>{facts}</section>}
        {tab === 'overview' || tab === 'runs' ? null : <Button variant="outline" disabled={busy || agent.archived} onClick={edit}>{t('editCapabilities')}</Button>}
      </div>
      <aside className={css.profileSidebar} aria-label={t('agentProfile')}>
        <section><h2>{t('agentProfile')}</h2>{facts}</section>
        <section><h3>{t('skills')}<span>{agent.skills.length}</span></h3><div className={css.chips}>{agent.skills.map(name => <span key={name}>{name}</span>)}</div>{agent.skills.length === 0 ? <p className={css.hint}>{t('noSkills')}</p> : null}</section>
        <section><h3>{t('mcpServers')}<span>{agent.mcpServers.length}</span></h3><div className={css.chips}>{agent.mcpServers.map(server => <span key={server.name}>{server.name} · {server.transport}</span>)}</div></section>
        <AgentStatistics runs={runs} t={t} />
      </aside>
    </div>
  </section>
}
