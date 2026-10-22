/** Remote authority, immutable input and native observations use only framework prop shares. */
import { useState } from 'react'
import { IconLinkOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteCallRequest, RemotePeer, RemotePeerId, RemoteSubmissionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ObservableSnapshot, RemoteWorkSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createRemoteViewStore, RemoteWrite } from './store.ts'
import { remoteTarget } from './target.ts'
import type {} from './locales.ts'
import css from './RemoteView.module.css'
/** Bare observations and callbacks bound at the plugin entry. */
export interface RemoteInjected {
  hooks: { remoteWork: ObservableSnapshot<RemoteWorkSnapshot>; hostDescription: HostDescriptionSource }
  refresh: () => Promise<void>
  choose: (peer: RemotePeerId) => Promise<void>
  select: (id: RemoteSubmissionId) => Promise<void>
  command: (request: RemoteCallRequest) => Promise<unknown>
}
type Shares = PropsLocale<'remoteWork'> & PropsStore<ReturnType<typeof createRemoteViewStore>> & InjectFace<RemoteInjected>
/** Framework-derived remote page properties. */
export type RemotePageProps = PropsRuntime<'shell.page'> & Shares
const pinned = (peer: RemotePeer, operation: RemoteWrite['operation']): RemoteWrite => ({ peer: peer.id,
  expected: { hostId: peer.hostId, principalId: peer.principalId }, operation })
const timestamp = (value: number) => new Date(value).toLocaleString()
async function commit(props: Shares, request: RemoteWrite): Promise<void> {
  try {
    await props.command(request); props.actions.settled(request, null)
    void props.select(request.operation.id)
  } catch (error) { props.actions.settled(request, error instanceof Error ? error.message : String(error)) }
}
function begin(props: Shares, request: RemoteWrite): void { props.actions.stage(request); void commit(props, request) }
/**
 * Present one selected authority, draft and independently observed native submission.
 * @param props - runtime, locale, store and injected operations.
 * @returns the remote execution page.
 */
export function RemotePage(props: RemotePageProps) {
  const { t, actions } = props, view = props.useStore(value => value), data = props.useRemoteWork(value => value)
  const connected = props.useHostDescription(value => value !== undefined)
  const [confirmation, setConfirmation] = useState<RemoteWrite | null>(null)
  const peer = data.peers.value?.find(value => value.id === data.peer), catalog = data.catalog.value?.catalog
  const workspace = catalog?.workspaces.find(value => value.id === view.workspace)
  const agent = workspace?.agents.find(value => value.id === view.executor)
  const workflow = workspace?.workflows.find(value => value.id === view.executor)
  const publication = workflow?.versions.find(value => value.id === view.publication)
  const target = remoteTarget(view, catalog), detail = data.detail.value, record = detail?.submission
  const pending = view.pending, busy = !connected || data.mutating || pending !== null
  const fresh = peer !== undefined && peer.authorization.configured && !data.peers.stale && !data.catalog.stale && !data.catalog.loading
  const pendingMatches = pending !== null && peer !== undefined && pending.peer === peer.id
    && pending.expected.hostId === peer.hostId && pending.expected.principalId === peer.principalId
  const controls = !busy && fresh && !data.detail.stale && !data.detail.loading
  const control = (peer: RemotePeer, operation: RemoteWrite['operation']) => { setConfirmation(pinned(peer, operation)) }
  const textField = (key: 'goal' | 'background' | 'deliverables' | 'criteria' | 'constraints') => <label>{t(key)}<textarea value={view[key]}
    disabled={busy} onChange={(event) =>{  actions.field(key, event.target.value) }} rows={key === 'goal' ? 3 : 2} /></label>
  return <main className={css.page} aria-label={t('title')}>
    <header className={css.heading}><div><p className={css.eyebrow}>WORK / REMOTE</p><h1>{t('title')}</h1><p className={css.hint}>{t('intro')}</p></div>
      <button type="button" disabled={!connected || data.peers.loading} onClick={() => { void props.refresh() }}>{t('refresh')}</button></header>
    {!connected ? <p role="status">{t('disconnected')}</p> : null}
    <div className={css.columns}><aside className={css.panel} aria-label={t('scope')}>
      <label>{t('machine')}<select value={data.peer ?? ''} disabled={!connected || data.peers.loading || data.peers.stale || data.mutating || pending !== null}
        onChange={(event) => { actions.target(); setConfirmation(null); void props.choose(event.target.value as RemotePeerId) }}>
        <option value="" disabled>{t('choose')}</option>{data.peers.value?.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}
      </select></label>
      {data.peers.loading ? <p role="status">{t('loading')}</p> : null}
      {data.peers.value?.length === 0 ? <p>{t('emptyPeers')}</p> : null}
      {peer === undefined ? null : <><dl><dt>{t('endpoint')}</dt><dd><code>{peer.origin}</code></dd><dt>{t('host')}</dt><dd><code>{peer.hostId}</code></dd>
        <dt>{t('principal')}</dt><dd><code>{peer.principalId}</code></dd><dt>{t('transport')}</dt><dd><code>{peer.authorization.reference}</code> · {t(peer.authorization.configured ? 'configured' : 'missing')}</dd></dl>
      <p className={css.hint}>{t('ownership')}</p></>}
      <h2>{t('history')}</h2>
      {data.history.loading ? <p role="status">{t('loading')}</p> : null}
      {data.history.value?.items.length === 0 ? <p>{t('empty')}</p> : null}
      <ul className={css.list}>{data.history.value?.items.map(item => <li key={item.id}><button type="button" aria-pressed={data.detail.id === item.id}
        disabled={!connected || data.peers.stale} onClick={() => { setConfirmation(null); void props.select(item.id) }}>
        <strong>{t(item.target.kind)}</strong><span>{t(item.admission.state)}</span><code>{item.id}</code></button></li>)}</ul>
    </aside><div className={css.content}>
      {([data.peers, data.catalog, data.history, data.detail]).map((read, index) => read.error === null ? null
        : <p key={index} className={css.error} role="alert">{t('readError')}: {read.error}</p>)}
      {(peer !== undefined && (data.catalog.stale || data.history.stale)) || (record !== undefined && data.detail.stale) ? <p role="status">{t('stale')}</p> : null}
      {pending === null ? null : <section className={css.pending} aria-label={t('pending')}><h2>{t('pending')}</h2><p>{t('uncertain')}</p>
        <p><code>{pending.expected.hostId}/{pending.expected.principalId}</code></p>
        <pre tabIndex={0}>{JSON.stringify(pending.operation, null, 2)}</pre>
        {!pendingMatches ? <p role="alert">{t('authorityChanged')}</p> : null}
        {view.error === null ? null : <p role="alert" className={css.error}>{view.error}</p>}
        <div className={css.actions}><button type="button" disabled={!connected || data.mutating || !pendingMatches || data.peers.stale}
          onClick={() => { void props.select(pending.operation.id) }}>{t('inspect')}</button>
        {pending.operation.kind === 'submit' ? <button type="button" disabled={!connected || data.mutating || !pendingMatches || data.peers.stale}
          onClick={() => { void commit(props, pending) }}>{t('retry')}</button> : null}
        <button type="button" disabled={data.mutating} onClick={() => { actions.clear(); setConfirmation(null) }}>{t('clear')}</button></div><p className={css.hint}>{t('clearHint')}</p>
      </section>}
      <section className={css.panel} aria-label={t('draft')}><h2>{t('draft')}</h2><form onSubmit={(event) => {
        event.preventDefault(); if (target !== undefined && peer !== undefined && fresh && !busy) begin(props, pinned(peer, { kind: 'submit', id: crypto.randomUUID() as RemoteSubmissionId, target }))
      }}><div className={css.fields}>
          <label>{t('workspace')}<select value={view.workspace} disabled={busy || !fresh} onChange={(event) => { actions.field('workspace', event.target.value); actions.field('executor', ''); actions.field('publication', '') }}><option value="" disabled>{t('choose')}</option>{catalog?.workspaces.map(value => <option key={value.id} value={value.id}>{value.title} · {value.path}</option>)}</select></label>
          <label>{t('kind')}<select value={view.kind} disabled={busy} onChange={(event) =>{  actions.kind(event.target.value as 'agent' | 'workflow') }}><option value="agent">{t('agent')}</option><option value="workflow">{t('workflow')}</option></select></label>
          <label>{t('executor')}<select value={view.executor} disabled={busy || !fresh || workspace === undefined} onChange={(event) => { actions.field('executor', event.target.value); actions.field('publication', '') }}><option value="" disabled>{t('choose')}</option>{(view.kind === 'agent' ? workspace?.agents : workspace?.workflows)?.filter(value => !value.archived).map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
          {view.kind === 'workflow' ? <label>{t('publication')}<select value={view.publication} disabled={busy || !fresh} onChange={(event) =>{  actions.field('publication', event.target.value) }}><option value="" disabled>{t('choose')}</option>{workflow?.versions.map(value => <option key={value.id} value={value.id}>v{value.number} · {value.id}</option>)}</select></label> : null}
        </div>
        {workspace === undefined ? null : <p><code>{workspace.path}</code></p>}
        {view.kind === 'agent' ? <>{agent === undefined ? null : <p className={css.hint}>{t('revision')}: {agent.revision} · {t('runtime')}: {agent.runtime}<br />{t('skills')}: {agent.skills.join(', ')} · {t('mcp')}: {agent.mcpServerNames.join(', ')}</p>}{textField('goal')}<details><summary>{t('background')} / {t('criteria')}</summary><div className={css.extra}>{textField('background')}{textField('deliverables')}{textField('criteria')}{textField('constraints')}</div></details></>
          : <><p>{t('requiredInputs')}: {publication?.inputs.map(input => `${input.name} — ${input.description}`).join('; ')}</p><label>{t('inputs')}<textarea rows={5} value={view.inputs} disabled={busy} onChange={(event) =>{  actions.field('inputs', event.target.value) }} /></label>{publication !== undefined && target === undefined ? <p className={css.error} role="alert">{t('invalidInputs')}</p> : null}</>}
        <button className={css.primary} type="submit" disabled={busy || !fresh || target === undefined}>{data.mutating ? t('loading') : t('submit')}</button></form></section>
      <section className={css.panel} aria-label={t('detail')}><h2>{t('detail')}</h2>
        {record === undefined || detail === undefined || peer === undefined ? <p>{t('select')}</p> : <><p className={css.state}>{t(record.admission.state)}</p><p className={css.hint}>{t('admissionHint')}</p><dl><dt>{t('submission')}</dt><dd><code>{record.id}</code></dd><dt>{t('attempts')}</dt><dd>{record.attempts}</dd><dt>{t('created')}</dt><dd>{timestamp(record.createdAt)}</dd><dt>{t('observed')}</dt><dd>{timestamp(detail.observedAt)}</dd></dl>
          <details><summary>{t('fixed')}</summary><pre tabIndex={0}>{JSON.stringify(record.target, null, 2)}</pre></details>
          {record.admission.state === 'unconfirmed' ? <><p>{t('recoverHint')}</p><button type="button" disabled={!controls} onClick={() =>{  control(peer, { kind: 'recover', id: record.id, expectedAttempt: record.attempts }) }}>{t('recover')}</button></>
            : <><p>{t('native')}: <code>{record.admission.ref.kind}/{record.admission.ref.id}</code></p>{detail.source === undefined ? null : <><p>{t(detail.source.status)}</p><p>{t('session')}: <code>{detail.source.sessionId}</code></p></>}</>}
          <p className={css.hint}>{t('sessionHint')}</p>
          {detail.unavailable ? <p role="status">{t('unavailable')}</p> : null}
          {detail.delivery === undefined ? null : <section aria-label={t('output')}><h3>{t('output')}</h3>{detail.delivery.outputs.map((output, index) => <div key={index}><h4>{output.name}</h4><pre tabIndex={0}>{output.text}</pre></div>)}</section>}
          {catalog?.controls.stop && detail.source !== undefined && ['queued', 'running', 'waiting'].includes(detail.source.status) ? <button type="button" disabled={!controls} onClick={() =>{  control(peer, { kind: 'stop', id: record.id }) }}>{t('stop')}</button> : null}
          {detail.decisionsUnavailable ? <p role="status">{t('decisionUnavailable')}</p> : null}
          {detail.decisions?.map(decision => <section key={decision.attemptId} className={css.decision} aria-label={decision.title}><h3>{decision.title}</h3><p>{t('decisionHint')}</p><p>{decision.instruction}</p><pre tabIndex={0}>{JSON.stringify(decision.inputs, null, 2)}</pre><code>{decision.attemptId}</code><div className={css.actions}>
            <button type="button" disabled={!controls || !catalog?.controls.workflowDecisions} onClick={() =>{  control(peer, { kind: 'decide', id: record.id, attemptId: decision.attemptId, approve: true }) }}>{t('approve')}</button>
            <button type="button" disabled={!controls || !catalog?.controls.workflowDecisions} onClick={() =>{  control(peer, { kind: 'decide', id: record.id, attemptId: decision.attemptId, approve: false }) }}>{t('reject')}</button></div></section>)}
        </>}
        {confirmation === null ? null : <section className={css.pending} aria-label={t('confirm')}><h3>{t('confirm')}</h3><pre tabIndex={0}>{JSON.stringify(confirmation.operation, null, 2)}</pre><div className={css.actions}><button type="button" disabled={!controls} onClick={() => { begin(props, confirmation); setConfirmation(null) }}>{t('confirm')}</button><button type="button" onClick={() => { setConfirmation(null) }}>{t('cancel')}</button></div></section>}
      </section>
    </div></div>
  </main>
}
/**
 * Open authenticated remote work from either sidebar width.
 * @param props - sidebar width, labels and navigation callback.
 * @returns a labelled focusable navigation control.
 */
export function RemoteNavigation({ wide, t, open }: PropsRuntime<'sidebar.session.action'> & PropsLocale<'remoteWork'> & { open: () => void }) {
  const button = <button type="button" className={css.nav} aria-label={t('title')} onClick={open}><IconLinkOutline16 size={16} /><span hidden={!wide}>{t('title')}</span></button>
  return wide ? button : <Tooltip label={t('title')}>{button}</Tooltip>
}
