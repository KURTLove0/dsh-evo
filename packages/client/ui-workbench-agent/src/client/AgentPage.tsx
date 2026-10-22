/** Independent collaborator directory, configuration editor, and task history. */
import { useEffect, useId, useState } from 'react'
import type { AgentCapabilities, AgentCommand, AgentReceipt, AgentRun, AgentRuntime, SessionId, WorkbenchAgent } from '@deepseek-ai/dsh-api-remotes/client'
import type { AgentDirectorySnapshot, ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { Button, IconAgentPresetOutline16, IconPlusOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { AgentDraft, createAgentViewStore } from './view-store.ts'
import { AgentEditor } from './AgentEditor.tsx'
import { AgentDetail } from './AgentDetail.tsx'
import { AgentRunHistory } from './AgentRunHistory.tsx'
import css from './AgentPage.module.css'

/** Host operations and the directory observable bound by the framework. */
export interface AgentPageInjected {
  hooks: { agentDirectory: ObservableSnapshot<AgentDirectorySnapshot> }
  refresh: () => Promise<void>
  command: (command: AgentCommand) => Promise<AgentReceipt>
  runtimes: () => Promise<AgentRuntime[]>
  capabilities: (workspaceId: AgentRun['workspaceId']) => Promise<AgentCapabilities>
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
  const [runtimeCatalog, setRuntimeCatalog] = useState<AgentRuntime[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copy, setCopy] = useState<{ id: WorkbenchAgent['id']; name: string } | null>(null)
  const [archiving, setArchiving] = useState<WorkbenchAgent | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const editorFormId = useId()
  const runtimeSelectionKey = JSON.stringify(data.agents.map(agent => agent.runtime))
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    let active = true
    void props.runtimes().then((rows) => { if (active) setRuntimeCatalog(rows) }, (failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : String(failure))
    })
    return () => { active = false }
  }, [props.runtimes, runtimeSelectionKey])
  const retry = view.retry
  const retryRun = data.runs.find(run => run.id === retry?.request.runId)
  const retryAgent = data.agents.find(agent => agent.id === retryRun?.agentId)
  const retryConfiguration = (agent: WorkbenchAgent) => ({
    revision: agent.revision, name: agent.name, runtime: agent.runtime, model: agent.model,
    instructions: agent.instructions, skills: agent.skills,
    mcpServers: agent.mcpServers.map(server => ({ name: server.name, transport: server.transport })), concurrency: agent.concurrency,
  })
  const editorDraft = view.draft
  const query = view.query.trim().toLocaleLowerCase()
  const workload = (id: WorkbenchAgent['id']) => data.workloads.find(row => row.agentId === id)
  const rows = data.agents.filter(agent =>
    [agent.name, agent.description, ...agent.skills].some(text => text.toLocaleLowerCase().includes(query)) &&
    (view.filter === 'archived' ? agent.archived : !agent.archived) &&
    (view.filter !== 'working' || (workload(agent.id)?.running ?? 0) > 0) &&
    (view.filter !== 'waiting' || (workload(agent.id)?.queued ?? 0) > 0),
  ).sort((a, b) => view.sort === 'updated' ? b.updatedAt - a.updatedAt || a.name.localeCompare(b.name) : a.name.localeCompare(b.name))
  const selected = data.agents.find(agent => agent.id === data.selectedId)
  const selectedRuntime = runtimeCatalog?.find(runtime => runtime.id === selected?.runtime)
  const runtimeAvailable = data.runtime.available && (runtimeCatalog === null || selectedRuntime?.available === true)
  const showDetail = view.detailOpen && selected !== undefined
  const composer = selected === undefined ? undefined : view.composers[selected.id]
  const prompt = composer?.prompt ?? ''
  const workspace = workspaces.items.find(item => item.workspaceId === composer?.workspace) ?? workspaces.items[0]
  const running = data.workloads.reduce((total, row) => total + row.running, 0)
  const queued = data.workloads.reduce((total, row) => total + row.queued, 0)
  const perform = async (command: AgentCommand, then?: () => void) => {
    setBusy(true); setError(null)
    try { await props.command(command); then?.() }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  const create = () => { actions.tab('overview'); actions.edit({ definition: { name: '', avatar: '', description: '', instructions: '', runtime: '', skills: [], mcpServers: [], starters: [], concurrency: data.defaultConcurrency } }) }
  const edit = (agent: WorkbenchAgent) => {
    const { id, revision, archived: _archived, createdAt: _created, updatedAt: _updated, ...definition } = agent
    actions.edit({ id, revision, definition })
  }
  const save = (draft: AgentDraft) => {
    const definition = { ...draft.definition, skills: draft.definition.skills.map(value => value.trim()).filter(Boolean) }
    void perform(draft.id === undefined ? { kind: 'create', definition }
      : { kind: 'save', id: draft.id, revision: draft.revision, definition }, () => { actions.edit(null); actions.detail(true) })
  }
  const closeEditor = () => {
    if (busy) return
    if (JSON.stringify(view.draft?.definition) !== JSON.stringify(view.originalDefinition)) setDiscarding(true)
    else actions.edit(null)
  }
  const pageActions = <div className={css.actions}>
    <Button variant="outline" onClick={props.closePage}>{t('back')}</Button>
    <Button variant="outline" disabled={data.loading} onClick={() => { void refresh() }}>{t('refresh')}</Button>
    <Button variant="primary" disabled={busy || data.loading} onClick={create}>
      <IconPlusOutline16 />{t('newAgent')}</Button>
  </div>
  return <main className={css.page} aria-label={t('agents')}>
    {showDetail ? null : <header className={css.header}>
      <div className={css.heading}>
        <IconAgentPresetOutline16 size={24} />
        <div>
          <h1>{t('agents')}</h1>
          <p>{t('intro')}</p>
        </div>
      </div>
      {pageActions}
    </header>}
    {showDetail ? null : <>
      <dl className={css.summary} aria-label={t('workload')}>
        <div><dt>{t('active')}</dt><dd>{data.agents.filter(agent => !agent.archived).length}</dd></div>
        <div><dt>{t('running')}</dt><dd>{running}</dd></div>
        <div><dt>{t('queued')}</dt><dd>{queued}</dd></div>
        <div><dt>{t('runtime')}</dt><dd>{t(data.runtime.available ? 'online' : 'offline')}</dd></div>
      </dl>
      <div className={css.toolbar}>
        <input type="search" aria-label={t('search')} placeholder={t('search')} value={view.query} onChange={(event) => { actions.search(event.target.value) }} />
        <div className={css.filters} role="group" aria-label={t('agents')}>{(['active', 'working', 'waiting', 'archived'] as const).map(filter => <button type="button" key={filter} aria-pressed={view.filter === filter} onClick={() => { actions.filter(filter) }}>{t(filter)}</button>)}</div>
        <label className={css.sort}>{t('sort')}<select value={view.sort} onChange={(event) => { actions.sort(event.target.value as typeof view.sort) }}>
          <option value="name">{t('sortName')}</option><option value="updated">{t('sortUpdated')}</option>
        </select></label>
      </div>
    </>}
    {data.loading ? <p role="status">{t('loading')}</p> : null}
    {error === null && data.error === null ? null : <p className={css.error} role="alert">{error ?? data.error}</p>}
    <div className={css.body}>
      {showDetail ? null : <section aria-label={t('agents')} className={css.roster}>
        <ul className={css.list}>{rows.map((agent) => {
          const load = workload(agent.id)
          return <li key={agent.id}>
            <button type="button" className={css.agent} aria-label={agent.name} aria-pressed={selected?.id === agent.id} onClick={() => { void props.select(agent.id); actions.detail(true); actions.tab('overview'); setError(null) }}>
              <span className={css.avatar}>{agent.avatar || <IconAgentPresetOutline16 size={20} />}</span>
              <span className={css.identity}>
                <strong>{agent.name}</strong>
                <span className={css.description}>{agent.description || t('noDescription')}</span>
                {agent.skills.length === 0 ? null : <span className={css.badges}>{agent.skills.join(' · ')}</span>}
                <span className={css.status}>{t(agent.archived ? 'archived' : (load?.running ?? 0) > 0 ? 'running' : (load?.queued ?? 0) > 0 ? 'queued' : 'active')} · {t('capacity')} {load?.running ?? 0}/{agent.concurrency}{load?.queued ? ` · ${t('queued')} ${load.queued}` : ''}</span>
              </span>
            </button>
          </li>
        })}</ul>{rows.length === 0 && !data.loading ? <p className={css.empty}>{t(data.agents.length === 0 ? 'noAgents' : 'noMatches')}</p> : null}</section>}
      {!showDetail ? null : <AgentDetail
        utilities={pageActions}
        agent={selected} runtimeName={selectedRuntime?.name ?? selected.runtime} runs={data.runs}
        running={workload(selected.id)?.running ?? 0} queued={workload(selected.id)?.queued ?? 0}
        available={runtimeAvailable} busy={busy} tab={view.tab} t={t} navigate={actions.tab} back={() => { actions.detail(false) }}
        edit={() => { edit(selected) }} copy={() => { setCopy({ id: selected.id, name: `${selected.name} copy` }) }}
        archive={() => {
          if (selected.archived) void perform({ kind: 'archive', id: selected.id, revision: selected.revision, archived: false })
          else setArchiving(selected)
        }}
        composer={<form className={css.task} onSubmit={workspace === undefined ? undefined : (event) => {
          event.preventDefault()
          void perform({ kind: 'run', id: selected.id, workspaceId: workspace.workspaceId, prompt }, () => { actions.prompt(selected.id, ''); actions.runQuery(''); actions.runStatus('all'); actions.runKind('all'); actions.tab('runs') })
        }}>
          <h3>{t('task')}</h3>
          <div className={css.starters}>{selected.starters.map((starter, index) => <Button key={index} variant="outline" disabled={busy} onClick={() => { actions.prompt(selected.id, starter.prompt) }}>{starter.label}</Button>)}</div>
          <label>{t('workspace')}<select required disabled={busy} value={workspace?.workspaceId ?? ''} onChange={(event) => { actions.workspace(selected.id, event.target.value) }}>{workspace === undefined ? <option value="">{t('noWorkspace')}</option> : null}{workspaces.items.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.title}</option>)}</select>
          </label>
          <label>{t('prompt')}<textarea required disabled={busy} rows={4} value={prompt} onChange={(event) => { actions.prompt(selected.id, event.target.value) }} />
          </label>
          <Button variant="primary" type="submit" disabled={busy || !runtimeAvailable || workspace === undefined || prompt.trim() === ''}>{t(busy ? 'saving' : 'run')}</Button>
          <p className={css.hint}>{t('designHint')}</p>
          <Button variant="outline" disabled={busy || !runtimeAvailable || workspace === undefined || prompt.trim() === ''} onClick={workspace === undefined ? undefined : () => {
            void perform({ kind: 'design', id: selected.id, workspaceId: workspace.workspaceId, prompt }, () => { actions.runQuery(''); actions.runStatus('all'); actions.runKind('all'); actions.tab('runs') })
          }}>{t('design')}</Button>
        </form>}
        history={<AgentRunHistory
          runs={view.tab === 'overview' ? data.runs.filter(run => run.status !== 'running' && run.status !== 'queued') : data.runs}
          kind={view.runKind} filterKind={actions.runKind}
          limit={view.tab === 'overview' ? 10 : undefined}
          workspaces={Object.fromEntries(workspaces.items.map(item => [item.workspaceId, item.title]))}
          sessions={new Set(Object.values(sessions.byId).map(session => session.id))} query={view.runQuery} status={view.runStatus}
          busy={busy} archived={selected.archived} runtimeAvailable={runtimeAvailable} t={t}
          search={actions.runQuery} filter={actions.runStatus}
          retry={(run) => { actions.retry({ kind: 'retry', runId: run.id, expectedRevision: selected.revision,
            requestId: crypto.randomUUID() as Extract<AgentCommand, { kind: 'retry' }>['requestId'] }) }}
          command={(command) => { void perform(command) }} openSession={props.openSession}
          review={(definition) => { actions.edit({ id: selected.id, revision: selected.revision, definition }) }}
        />}
      />}

    </div>
    <Modal open={view.draft !== null && !discarding} onClose={closeEditor} title={t(view.draft?.id === undefined ? 'newTitle' : 'editTitle')} closeLabel={t('cancel')}
      className={css.editorModal} contentClassName={css.editorContent}
      footer={<div className={css.editorActions}>
        <Button variant="outline" disabled={busy} onClick={closeEditor}>{t('cancel')}</Button>
        <Button variant="primary" type="submit" form={editorFormId} disabled={busy}>{t(busy ? 'saving' : 'save')}</Button>
      </div>}
    >
      {editorDraft === null ? null : <AgentEditor
        formId={editorFormId} definition={editorDraft.definition} maxConcurrency={data.maxConcurrency} busy={busy} t={t}
        workspaces={workspaces.items} capabilities={props.capabilities} runtimes={props.runtimes}
        change={(definition) => { actions.edit({ ...editorDraft, definition }) }}
        save={() => { save(editorDraft) }}
      />}
      {error === null ? null : <p className={css.error} role="alert">{error}</p>}
    </Modal>
    <Modal open={discarding} onClose={() => { setDiscarding(false) }} title={t('unsaved')} closeLabel={t('keepEditing')}
      footer={<div className={css.editorActions}>
        <Button variant="outline" onClick={() => { setDiscarding(false) }}>{t('keepEditing')}</Button>
        <Button onClick={() => { actions.edit(null); setDiscarding(false) }}>{t('discard')}</Button>
      </div>}
    />
    <Modal open={copy !== null} onClose={() => { if (!busy) setCopy(null) }} title={t('copy')} closeLabel={t('cancel')}>
      {copy === null ? null : <form className={css.editor} onSubmit={(event) => {
        event.preventDefault()
        void perform({ kind: 'copy', id: copy.id, name: copy.name }, () => { setCopy(null); actions.filter('active'); actions.tab('overview'); actions.detail(true) })
      }}>
        <label>{t('copyName')}<input autoFocus required value={copy.name} onChange={(event) => { setCopy({ ...copy, name: event.target.value }) }} /></label>
        <Button type="submit" disabled={busy}>{t('confirmCopy')}</Button>
      </form>}
    </Modal>
    {retry === null ? null : <Button variant="outline" onClick={() => { actions.retryOpen(true) }}>{t('pendingRetry')}</Button>}
    <Modal open={retry?.open === true} onClose={() => { if (!busy) actions.retryOpen(false) }} title={t('fullRetry')} description={t('retryWarning')} closeLabel={t('closeRetry')}>
      {retry === null ? null : <>
        <p>{t('retryOf')}: <code>{retry.request.runId}</code> · {t('revision')} {retry.request.expectedRevision}</p>
        {retryAgent?.revision === retry.request.expectedRevision ? null : <p role="status">{t('retryChanged')}</p>}
        <div className={css.retryConfigs}><section><h3>{t('retryOriginal')}</h3><pre className={css.instructions}>{retryRun?.definition === undefined ? t('retryNotCaptured') : JSON.stringify(retryConfiguration(retryRun.definition), null, 2)}</pre></section><section><h3>{t('retryCurrent')}</h3><pre className={css.instructions}>{retryAgent === undefined ? t('retryNotCaptured') : JSON.stringify(retryConfiguration(retryAgent), null, 2)}</pre></section></div>
        <p>{t('retryConnections')}</p>
        {retry.submitted ? <p role="status">{t('retryPending')}</p> : null}
        {error === null ? null : <p role="alert" className={css.error}>{error}</p>}
        <div className={css.actions}><Button disabled={busy || (!retry.submitted &&
          (retryAgent === undefined || retryAgent.archived || retryAgent.revision !== retry.request.expectedRevision))} onClick={() => {
          actions.retrySubmitted()
          void perform(retry.request, () => { actions.retryClear(retry.request.requestId) })
        }}>{t(retry.submitted ? 'recoverRetry' : 'confirmRetry')}</Button><Button variant="outline" disabled={busy} onClick={() => { actions.retryOpen(false) }}>{t('closeRetry')}</Button><Button variant="outline" disabled={busy} onClick={() => { actions.retryClear() }}>{t('discardRetry')}</Button></div>
      </>}
    </Modal>
    <Modal open={archiving !== null} onClose={() => { if (!busy) setArchiving(null) }} title={t('archive')} description={t('archiveHint')} closeLabel={t('cancel')}>
      {archiving === null ? null : <Button disabled={busy} onClick={() => {
        void perform({ kind: 'archive', id: archiving.id, revision: archiving.revision, archived: true }, () => { setArchiving(null) })
      }}>{t('confirmArchive')}</Button>}
    </Modal>
  </main>
}
