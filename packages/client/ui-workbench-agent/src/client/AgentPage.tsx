/** Independent collaborator directory, configuration editor, and task history. */
import { useEffect, useId, useState } from 'react'
import type { AgentCommand, AgentReceipt, SessionId, WorkbenchAgent } from '@deepseek-ai/dsh-api-remotes/client'
import type { AgentDirectorySnapshot, ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { Button, IconAgentPresetOutline16, IconPlusOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { AgentDraft, createAgentViewStore } from './view-store.ts'
import { AgentEditor } from './AgentEditor.tsx'
import css from './AgentPage.module.css'

/** Host operations and the directory observable bound by the framework. */
export interface AgentPageInjected {
  hooks: { agentDirectory: ObservableSnapshot<AgentDirectorySnapshot> }
  refresh: () => Promise<void>
  command: (command: AgentCommand) => Promise<AgentReceipt>
  select: (id: WorkbenchAgent['id']) => Promise<void>
  closePage: () => void
  openSession: (id: SessionId) => void
}
/** Four shares supplied by shell-page registration. */
export type AgentPageProps = PropsRuntime<'shell.page'> & PropsLocale<'workbenchAgent'>
  & PropsStore<ReturnType<typeof createAgentViewStore>> & InjectFace<AgentPageInjected>

/**
 * Render actual workbench identities and their independently recorded tasks.
 * @param props - framework shares, directory, and host callbacks.
 * @returns the standalone management page.
 */
export function AgentPage(props: AgentPageProps) {
  const { t, actions, refresh } = props
  const data = props.useAgentDirectory(value => value)
  const view = props.useStore(value => value)
  const workspaces = props.useWorkspaces(value => value)
  const sessions = props.useSessions(value => value)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copy, setCopy] = useState<{ id: WorkbenchAgent['id']; name: string } | null>(null)
  const [archiving, setArchiving] = useState<WorkbenchAgent | null>(null)
  const editorFormId = useId()
  useEffect(() => { void refresh() }, [refresh])
  const editorDraft = view.draft
  const query = view.query.trim().toLocaleLowerCase()
  const workload = (id: WorkbenchAgent['id']) => data.workloads.find(row => row.agentId === id)
  const rows = data.agents.filter(agent =>
    [agent.name, agent.description].some(text => text.toLocaleLowerCase().includes(query)) &&
    (view.filter === 'archived' ? agent.archived : !agent.archived) &&
    (view.filter !== 'working' || (workload(agent.id)?.running ?? 0) > 0),
  )
  const selected = data.agents.find(agent => agent.id === data.selectedId)
  const workspace = workspaces.items.find(item => item.workspaceId === view.workspace) ?? workspaces.items[0]
  const perform = async (command: AgentCommand, then?: () => void) => {
    setBusy(true); setError(null)
    try { await props.command(command); then?.() }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  const create = () => { actions.edit({ definition: { name: '', avatar: '', description: '', instructions: '', runtime: 'harness', skills: [], starters: [], concurrency: data.defaultConcurrency } }) }
  const edit = (agent: WorkbenchAgent) => {
    const { id, revision, archived: _archived, createdAt: _created, updatedAt: _updated, ...definition } = agent
    actions.edit({ id, revision, definition })
  }
  const save = (draft: AgentDraft) => {
    const definition = { ...draft.definition, skills: draft.definition.skills.map(value => value.trim()).filter(Boolean) }
    void perform(draft.id === undefined ? { kind: 'create', definition }
      : { kind: 'save', id: draft.id, revision: draft.revision, definition }, () => { actions.edit(null) })
  }
  return <main className={css.page} aria-label={t('agents')}>
    <header className={css.header}>
      <div className={css.heading}>
        <IconAgentPresetOutline16 size={24} />
        <div>
          <h1>{t('agents')}</h1>
          <p>{t('intro')}</p>
        </div>
      </div>
      <div className={css.actions}>
        <Button variant="outline" onClick={props.closePage}>{t('back')}</Button>
        <Button variant="outline" disabled={data.loading} onClick={() => { void refresh() }}>{t('refresh')}</Button>
        <Button disabled={busy || data.loading} onClick={create}>
          <IconPlusOutline16 />{t('newAgent')}</Button>
      </div>
    </header>
    <div className={css.toolbar}>
      <input type="search" aria-label={t('search')} placeholder={t('search')} value={view.query} onChange={(event) => { actions.search(event.target.value) }} />
      <div className={css.filters} role="group" aria-label={t('agents')}>{(['active', 'working', 'archived'] as const).map(filter => <button type="button" key={filter} aria-pressed={view.filter === filter} onClick={() => { actions.filter(filter) }}>{t(filter)}</button>)}</div>
    </div>
    {data.loading ? <p role="status">{t('loading')}</p> : null}
    {error === null && data.error === null ? null : <p className={css.error} role="alert">{error ?? data.error}</p>}
    <div className={css.body}>
      <section aria-label={t('agents')} className={css.roster}>
        <ul className={css.list}>{rows.map((agent) => {
          const load = workload(agent.id)
          return <li key={agent.id}>
            <button type="button" className={css.agent} aria-label={agent.name} aria-pressed={selected?.id === agent.id} onClick={() => { void props.select(agent.id); setError(null) }}>
              <span className={css.avatar}>{agent.avatar || <IconAgentPresetOutline16 size={20} />}</span>
              <span className={css.identity}>
                <strong>{agent.name}</strong>
                <span className={css.description}>{agent.description || t('noDescription')}</span>
                <span className={css.status}>{t(agent.archived ? 'archived' : (load?.running ?? 0) > 0 ? 'running' : 'active')}{load?.queued ? ` · ${t('queued')} ${load.queued}` : ''}</span>
              </span>
            </button>
          </li>
        })}</ul>{rows.length === 0 && !data.loading ? <p className={css.empty}>{t(data.agents.length === 0 ? 'noAgents' : 'noMatches')}</p> : null}</section>
      {selected === undefined ? null : <section className={css.detail} aria-label={selected.name}>
        <div className={css.detailTitle}>
          <span className={css.avatar}>{selected.avatar || <IconAgentPresetOutline16 size={24} />}</span>
          <h2>{selected.name}</h2>
        </div>
        <p className={css.detailDescription}>{selected.description || t('noDescription')}</p>
        <div className={css.actions}>
          <Button variant="outline" disabled={busy || selected.archived} onClick={() => { edit(selected) }}>{t('edit')}</Button>
          <Button variant="outline" disabled={busy} onClick={() => { setCopy({ id: selected.id, name: `${selected.name} copy` }) }}>{t('copy')}</Button>
          <Button variant="outline" disabled={busy} onClick={() => {
            if (selected.archived) void perform({ kind: 'archive', id: selected.id, revision: selected.revision, archived: false })
            else setArchiving(selected)
          }}>{t(selected.archived ? 'restore' : 'archive')}</Button>
        </div>
        <div className={css.filters} role="group" aria-label={selected.name}>{(['overview', 'runs'] as const).map(tab => <button type="button" key={tab} aria-pressed={view.tab === tab} onClick={() => { actions.tab(tab) }}>{t(tab)}</button>)}</div>
        {view.tab === 'overview' ? <>
          <dl className={css.facts}>
            <dt>{t('runtime')}</dt>
            <dd>{t('nativeRuntime')} · {t(data.runtime.available ? 'online' : 'offline')}</dd>
            <dt>{t('model')}</dt>
            <dd>{selected.model === undefined ? t('defaultModel') : `${selected.model.provider} / ${selected.model.model}${selected.model.reasoningEffort ? ` · ${selected.model.reasoningEffort}` : ''}`}</dd>
            <dt>{t('concurrency')}</dt>
            <dd>{selected.concurrency}</dd>
            <dt>{t('skills')}</dt>
            <dd>{selected.skills.join(', ') || '—'}</dd>
          </dl>
          <h3>{t('instructions')}</h3>
          <pre className={css.instructions}>{selected.instructions || '—'}</pre>
          {selected.archived ? null : <form className={css.task} onSubmit={workspace === undefined ? undefined : (event) => {
            event.preventDefault()
            void perform({ kind: 'run', id: selected.id, workspaceId: workspace.workspaceId, prompt: view.prompt }, () => { actions.prompt(''); actions.tab('runs') })
          }}>
            <h3>{t('task')}</h3>
            <div className={css.starters}>{selected.starters.map((starter, index) => <Button key={index} variant="outline" disabled={busy} onClick={() => { actions.prompt(starter.prompt) }}>{starter.label}</Button>)}</div>
            <label>{t('workspace')}<select required value={workspace?.workspaceId ?? ''} onChange={(event) => { actions.workspace(event.target.value) }}>{workspace === undefined ? <option value="">{t('noWorkspace')}</option> : null}{workspaces.items.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.title}</option>)}</select>
            </label>
            <label>{t('prompt')}<textarea required rows={4} value={view.prompt} onChange={(event) => { actions.prompt(event.target.value) }} />
            </label>
            <Button type="submit" disabled={busy || !data.runtime.available || workspace === undefined || view.prompt.trim() === ''}>{t(busy ? 'saving' : 'run')}</Button>
            <p className={css.hint}>{t('designHint')}</p>
            <Button variant="outline" disabled={busy || !data.runtime.available || workspace === undefined || view.prompt.trim() === ''} onClick={workspace === undefined ? undefined : () => {
              void perform({ kind: 'design', id: selected.id, workspaceId: workspace.workspaceId, prompt: view.prompt }, () => { actions.tab('runs') })
            }}>{t('design')}</Button>
          </form>}
        </> : <div className={css.history}>
          {data.runs.length === 0 ? <p>{t('noRuns')}</p> : data.runs.map((run) => {
            const candidate = run.candidate
            return <article key={run.id} className={css.run}>
              <div className={css.runTitle}>
                <strong>{t(run.status)}</strong>
                <time dateTime={new Date(run.createdAt).toISOString()}>{new Date(run.createdAt).toLocaleString()}</time>
              </div>
              <p>{run.prompt}</p>{run.definition === undefined ? null : <small>{t('revision')} {run.definition.revision}</small>}
              {run.error === undefined ? null : <p className={css.error}>{run.error}</p>}
              <div className={css.actions}>
                {candidate === undefined ? null : <Button variant="outline" disabled={busy || selected.archived} onClick={() => {
                  actions.edit({ id: selected.id, revision: selected.revision, definition: candidate })
                }}>{t('reviewCandidate')}</Button>}
                {sessions.byId[run.sessionId] === undefined ? null : <Button variant="outline" onClick={() => { props.openSession(run.sessionId) }}>{t('transcript')}</Button>}
                {run.status === 'queued' || run.status === 'running' ? <Button variant="outline" disabled={busy} onClick={() => { void perform({ kind: 'stop', runId: run.id }) }}>{t('stop')}</Button> : null}
                {['failed', 'cancelled', 'interrupted'].includes(run.status) ? <Button variant="outline" disabled={busy || selected.archived} onClick={() => { void perform({ kind: 'retry', runId: run.id }) }}>{t('retry')}</Button> : null}
              </div>
            </article>})}
        </div>}
      </section>}
    </div>
    <Modal open={view.draft !== null} onClose={() => { if (!busy) actions.edit(null) }} title={t(view.draft?.id === undefined ? 'newTitle' : 'editTitle')} closeLabel={t('cancel')}
      className={css.editorModal ?? ''} contentClassName={css.editorContent ?? ''}
      footer={<div className={css.editorActions}>
        <Button variant="outline" disabled={busy} onClick={() => { actions.edit(null) }}>{t('cancel')}</Button>
        <Button type="submit" form={editorFormId} disabled={busy}>{t(busy ? 'saving' : 'save')}</Button>
      </div>}
    >
      {editorDraft === null ? null : <AgentEditor
        formId={editorFormId} definition={editorDraft.definition} maxConcurrency={data.maxConcurrency} busy={busy} t={t}
        change={(definition) => { actions.edit({ ...editorDraft, definition }) }}
        save={() => { save(editorDraft) }}
      />}
      {error === null ? null : <p className={css.error} role="alert">{error}</p>}
    </Modal>
    <Modal open={copy !== null} onClose={() => { if (!busy) setCopy(null) }} title={t('copy')} closeLabel={t('cancel')}>
      {copy === null ? null : <form className={css.editor} onSubmit={(event) => {
        event.preventDefault()
        void perform({ kind: 'copy', id: copy.id, name: copy.name }, () => { setCopy(null); actions.filter('active') })
      }}>
        <label>{t('copyName')}<input autoFocus required value={copy.name} onChange={(event) => { setCopy({ ...copy, name: event.target.value }) }} /></label>
        <Button type="submit" disabled={busy}>{t('confirmCopy')}</Button>
      </form>}
    </Modal>
    <Modal open={archiving !== null} onClose={() => { if (!busy) setArchiving(null) }} title={t('archive')} description={t('archiveHint')} closeLabel={t('cancel')}>
      {archiving === null ? null : <Button disabled={busy} onClick={() => {
        void perform({ kind: 'archive', id: archiving.id, revision: archiving.revision, archived: true }, () => { setArchiving(null) })
      }}>{t('confirmArchive')}</Button>}
    </Modal>
  </main>
}
