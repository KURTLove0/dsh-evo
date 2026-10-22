/** Project-file directory and inert historical previews over framework prop shares. */
import { useState } from 'react'
import { IconArchiveOutline20, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ArtifactReceipt, ArtifactRegistration, WorkArtifactId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ArtifactSnapshot, ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-work-center/client'
import { artifactSelection, type ArtifactView, type createArtifactViewStore } from './store.ts'
import type {} from './locales.ts'
import css from './ArtifactView.module.css'
/** Bare observations and explicit remote operations supplied by the plugin entry. */
export interface ArtifactInjected {
  hooks: { artifacts: ObservableSnapshot<ArtifactSnapshot>; hostDescription: HostDescriptionSource }
  refresh: () => Promise<void>
  query: (selection: ReturnType<typeof artifactSelection>) => Promise<void>
  more: () => Promise<void>
  select: (id: WorkArtifactId, version: number) => Promise<void>
  inspect: () => Promise<void>
  register: (request: ArtifactRegistration) => Promise<ArtifactReceipt>
  openRegistered: (receipt: ArtifactReceipt) => void
  openWork: () => void
  openSession: (id: NonNullable<ArtifactSnapshot['preview']['detail']>['snapshot']['origin']['source']['sessionId']) => void
}
type Shares = PropsLocale<'workArtifacts'> & PropsStore<ReturnType<typeof createArtifactViewStore>> & InjectFace<ArtifactInjected>
/** Four framework shares for the project artifact directory. */
export type ArtifactPageProps = PropsRuntime<'shell.page'> & Shares
/** Work Center owns the selected execution and its committed review evidence. */
export type ArtifactCaptureProps = PropsRuntime<'work-center.delivery.artifacts'> & Shares
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
async function commit(props: Shares, request: ArtifactRegistration): Promise<void> {
  try { props.actions.acknowledged(request.requestId, await props.register(request)) }
  catch (error) { props.actions.failed(request.requestId, message(error)) }
}
function begin(props: Shares, request: Omit<ArtifactRegistration, 'requestId'>): void {
  const owned = { ...request, requestId: crypto.randomUUID() as ArtifactRegistration['requestId'] }
  props.actions.stage(owned); void commit(props, owned)
}
function Pending({ props, view, data, connected }: { props: Shares; view: ArtifactView; data: ArtifactSnapshot; connected: boolean }) {
  const { t, actions } = props
  return <>
    {view.pending === null ? null : <section className={css.pending} aria-label={t('pending')}>
      <h3>{t('pending')}</h3><p>{t(view.pending.source.ref.kind)} · <code>{view.pending.source.ref.id}</code> · {view.pending.path}</p><p className={css.hint}>{t('uncertain')}</p>
      <div className={css.actions}><button type="button" disabled={!connected || data.mutating} onClick={() => { if (view.pending !== null) void commit(props, view.pending) }}>{data.mutating ? t('registering') : t('retry')}</button><button type="button" disabled={data.mutating} onClick={() => { actions.discard() }}>{t('discard')}</button></div>
    </section>}
    {view.error === null ? null : <p role="alert" className={css.error}>{view.error}</p>}
    {view.receipt === null ? null : <p role="status">{t('registered')}: {view.receipt.path} · v{view.receipt.version} <button type="button" disabled={!connected} onClick={() => { if (view.receipt !== null) props.openRegistered(view.receipt) }}>{t('openRegistered')}</button></p>}
  </>
}
/**
 * Render source-pinned file registration without changing execution or human review.
 * @param props - Work Center execution owner and shared artifact drafts.
 * @returns an optional expanded form and recoverable request feedback.
 */
export function ArtifactCapture(props: ArtifactCaptureProps) {
  const { t, actions, detail } = props
  const view = props.useStore(value => value), data = props.useArtifacts(value => value)
  const connected = props.useHostDescription(value => value !== undefined)
  const [open, setOpen] = useState(false)
  const settled = !['queued', 'running', 'waiting', 'stopping'].includes(detail.status)
  const blocked = props.disabled || !connected || data.mutating || view.pending !== null || !settled
  const choices = [...(detail.priorReviews ?? []), ...(detail.review === undefined ? [] : [detail.review])].filter(review => review.decision === 'accepted')
    .flatMap(review => review.delivery.artifacts.filter(file => file.state === 'captured').map(file => ({ key: JSON.stringify([review.revision, file.path]), path: file.path, revision: review.revision })))
  const selected = choices.find(choice => choice.key === view.review)
  return <section className={css.widget} aria-label={t('captureTitle')}>
    <button type="button" aria-expanded={open} onClick={() => { setOpen(!open) }}>{t('captureTitle')}</button>
    {!open ? null : <>
      <p className={css.hint}>{t('captureIntro')}</p><p>{t(detail.ref.kind)} · <code>{detail.ref.id}</code></p>
      {!settled ? <p role="status">{t('unsettled')}</p> : null}
      <form aria-label={t('captureTitle')} onSubmit={(event) => {
        event.preventDefault()
        if (view.mode === 'current-file') begin(props, { path: view.path, expectedVersion: 0, source: { kind: 'current-file', ref: detail.ref } })
        else if (selected !== undefined) begin(props, { path: selected.path, expectedVersion: 0, source: { kind: 'accepted-review', ref: detail.ref, reviewRevision: selected.revision } })
      }}>
        <label>{t('mode')}<select disabled={blocked} value={view.mode} onChange={(event) => { actions.mode(event.target.value as ArtifactView['mode']) }}><option value="current-file">{t('current-file')}</option><option value="accepted-review">{t('accepted-review')}</option></select></label>
        {view.mode === 'current-file' ? <><label>{t('path')}<input required disabled={blocked} value={view.path} onChange={(event) => { actions.path(event.target.value) }} /></label><p className={css.hint}>{t('manualHint')}</p></> : <><label>{t('reviewFile')}<select disabled={blocked} value={view.review} onChange={(event) => { actions.review(event.target.value) }}><option value="">{t('selectReview')}</option>{choices.map(choice => <option key={choice.key} value={choice.key}>r{choice.revision} · {choice.path}</option>)}</select></label><p className={css.hint}>{t(choices.length === 0 ? 'noReview' : 'acceptedHint')}</p></>}
        {data.directory.options === undefined ? null : <p className={css.hint}>{t('limit', { n: data.directory.options.maxFileBytes })}</p>}
        <button type="submit" disabled={blocked || (view.mode === 'current-file' ? view.path.trim() === '' : selected === undefined)}>{t('register')}</button>
      </form>
    </>}
    <Pending props={props} view={view} data={data} connected={connected} />
  </section>
}
/**
 * Render metadata filters, immutable versions, and an explicitly requested live-file comparison.
 * @param props - framework shares and source-owned artifact callbacks.
 * @returns the project artifact page without live HTML or document execution.
 */
export function ArtifactPage(props: ArtifactPageProps) {
  const { t, actions } = props
  const view = props.useStore(value => value), data = props.useArtifacts(value => value)
  const workspaces = props.useWorkspaces(value => value)
  const sessions = props.useSessions(value => value)
  const connected = props.useHostDescription(value => value !== undefined)
  const [navigationError, setNavigationError] = useState<string | null>(null)
  const { directory, preview, current } = data, detail = preview.detail
  const workspaceChoices = new Map(workspaces.items.map(item => [String(item.workspaceId), item.title]))
  for (const item of directory.page?.items ?? []) {
    if (!workspaceChoices.has(item.workspaceId)) workspaceChoices.set(item.workspaceId, item.workspacePath)
  }
  if (view.workspace !== '' && !workspaceChoices.has(view.workspace)) workspaceChoices.set(view.workspace, view.workspace)
  const latest = directory.page?.items.find(item => item.id === detail?.entry.id)?.latest.version
  return <main className={css.page} aria-label={t('title')}>
    <header className={css.heading}><div><p className={css.eyebrow}>WORK / ARTIFACTS</p><h1>{t('title')}</h1><p className={css.hint}>{t('intro')}</p></div><button type="button" disabled={!connected || directory.loading} onClick={() => { void props.refresh() }}>{t('refresh')}</button></header>
    {!connected ? <p role="status">{t('disconnected')}</p> : null}
    <form className={css.filters} aria-label={t('filters')} onSubmit={(event) => { event.preventDefault(); void props.query(artifactSelection(view)) }}>
      <label>{t('search')}<input type="search" value={view.text} onChange={(event) => { actions.text(event.target.value) }} /></label>
      <label>{t('workspace')}<select value={view.workspace} onChange={(event) => { actions.workspace(event.target.value) }}><option value="">{t('all')}</option>{[...workspaceChoices].map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
      <label>{t('source')}<select value={view.source} onChange={(event) => { actions.source(event.target.value as ArtifactView['source']) }}><option value="all">{t('all')}</option><option value="agent">{t('agent')}</option><option value="workflow">{t('workflow')}</option></select></label>
      <label>{t('origin')}<select value={view.origin} onChange={(event) => { actions.origin(event.target.value as ArtifactView['origin']) }}><option value="all">{t('all')}</option><option value="current-file">{t('current-file')}</option><option value="accepted-review">{t('accepted-review')}</option></select></label><button type="submit" disabled={!connected || directory.loading}>{t('apply')}</button>
    </form>
    {directory.loading ? <p role="status">{t('loading')}</p> : null}{directory.stale && directory.page !== undefined ? <p role="status">{t('stale')}</p> : null}
    {directory.submitted === undefined ? null : <p className={css.hint}>{t('submitted')}: {directory.submitted.text || t('all')} · {directory.submitted.workspaceId ?? t('all')} · {t(directory.submitted.source ?? 'all')} · {t(directory.submitted.origin ?? 'all')}</p>}
    {directory.error === null ? null : <p role="alert" className={css.error}>{t('readError')} {directory.error}</p>}
    <Pending props={props} view={view} data={data} connected={connected} />
    <div className={css.columns}><section className={css.panel} aria-label={t('directory')}>
      <h2>{t('directory')}</h2>{directory.page === undefined ? null : <p className={css.hint}>{t('shown', { n: directory.page.items.length })}</p>}
      {directory.page?.items.length === 0 && !directory.stale ? <p>{t('empty')}</p> : null}
      <ul className={css.list}>{directory.page?.items.map(item => <li key={item.id}><button type="button" aria-pressed={preview.target?.id === item.id && preview.target.version === item.latest.version} onClick={() => { void props.select(item.id, item.latest.version) }} disabled={!connected}>
        <strong>{item.path}</strong><span>{workspaces.items.find(workspace => workspace.workspaceId === item.workspaceId)?.title ?? item.workspacePath}</span><span>{t('latest')} v{item.latest.version} · {t(item.latest.origin.kind)}</span><span>{t(item.latest.origin.source.ref.kind)} · {item.latest.origin.source.name}</span>
      </button></li>)}</ul>
      {directory.page?.next === undefined ? null : <button type="button" disabled={!connected || directory.loading || directory.stale} onClick={() => { void props.more() }}>{t('more')}</button>}
      <button type="button" onClick={props.openWork}>{t('openWork')}</button>
    </section><section className={css.panel} aria-label={t('preview')}>
      {preview.loading ? <p role="status">{t('loading')}</p> : null}{preview.error === null ? null : <p role="alert" className={css.error}>{preview.error}</p>}
      {detail === undefined ? <p>{t('choose')}</p> : <>
        <h2>{detail.entry.path}</h2><p className={css.hint}>{detail.entry.workspacePath}</p>
        <label>{t('history')}<select value={detail.snapshot.version} disabled={!connected} onChange={(event) => { void props.select(detail.entry.id, Number(event.target.value)) }}>{detail.versions.map(version => <option key={version.version} value={version.version}>v{version.version} · {t(version.origin.kind)}</option>)}</select></label>
        {latest !== undefined && latest > detail.entry.latest.version ? <p role="status">{t('newer')}</p> : null}
        <p>{t('captured')}: <time dateTime={new Date(detail.snapshot.capturedAt).toISOString()}>{new Date(detail.snapshot.capturedAt).toLocaleString()}</time></p>
        <p>{detail.snapshot.bytes} {t('bytes')} · SHA-256 <code>{detail.snapshot.sha256}</code></p>
        <p>{t(detail.snapshot.origin.kind)} · {t(detail.snapshot.origin.kind === 'accepted-review' ? 'acceptedHint' : 'manualHint')}</p>
        {detail.snapshot.origin.kind === 'accepted-review' ? <p>r{detail.snapshot.origin.reviewRevision} · <code>{detail.snapshot.origin.deliveryVersion}</code> · {new Date(detail.snapshot.origin.reviewedAt).toLocaleString()}</p> : null}
        <p>{t('sourceRun')}: {t(detail.snapshot.origin.source.ref.kind)} · {detail.snapshot.origin.source.name} · <code>{detail.snapshot.origin.source.ref.id}</code></p>
        <button type="button" disabled={!connected || sessions.byId[detail.snapshot.origin.source.sessionId] === undefined} onClick={() => { try { props.openSession(detail.snapshot.origin.source.sessionId) } catch (error) { setNavigationError(message(error)) } }}>{t('sourceSession')}</button>
        {navigationError === null ? null : <p role="alert" className={css.error}>{navigationError}</p>}
        <p className={css.hint}>{t('inert')}</p>{detail.snapshot.encoding === 'utf-8' ? <pre className={css.preview} tabIndex={0}>{detail.snapshot.content}</pre> : <p>{t('binary')}</p>}
        <div className={css.actions}><button type="button" disabled={!connected || current.loading} onClick={() => { void props.inspect() }}>{current.loading ? t('checking') : t('check')}</button>
          <button type="button" disabled={!connected || data.mutating || view.pending !== null} onClick={() => { begin(props, { id: detail.entry.id, expectedVersion: detail.entry.latest.version, path: detail.entry.path, source: { kind: 'current-file', ref: detail.snapshot.origin.source.ref } }) }}>{t('append')}</button></div>
        <p className={css.hint}>{t('appendHint')}</p>
      </>}
      {current.error === null ? null : <p role="alert" className={css.error}>{current.error}</p>}
      {current.observation === undefined ? null : <section className={css.observation} aria-label={t('observed')}>
        <h3>{t(`state-${current.observation.state}`)}</h3><p>{t('observed')}: {new Date(current.observation.observedAt).toLocaleString()}</p>
        {current.stale || !connected ? <p role="status">{t('observationStale')}</p> : null}
        {current.observation.state === 'unavailable' ? <p>{current.observation.message}</p> : current.observation.state === 'missing' ? null : <p>{current.observation.bytes} {t('bytes')} · <code>{current.observation.sha256}</code></p>}
        <p className={css.hint}>{t('observationHint')}</p>
      </section>}
    </section></div>
  </main>
}
/**
 * Open the artifact directory at either sidebar width.
 * @param props - sidebar width, locale, and page navigation callback.
 * @returns a labelled directory navigation control.
 */
export function ArtifactNavigation({ wide, t, open }: PropsRuntime<'sidebar.session.action'> & PropsLocale<'workArtifacts'> & { open: () => void }) {
  const button = <button type="button" className={css.nav} aria-label={t('title')} onClick={open}><IconArchiveOutline20 size={16} /><span hidden={!wide}>{t('title')}</span></button>
  return wide ? button : <Tooltip label={t('title')}>{button}</Tooltip>
}
