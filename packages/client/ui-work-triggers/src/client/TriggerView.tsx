/** Trigger directory and original-execution preparation consume only framework prop shares. */
import { useState } from 'react'
import { IconRefreshOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TriggerCommand, TriggerDefinition, TriggerQuery, TriggerReceipt, WorkReference, WorkTriggerId, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ObservableSnapshot, TriggerSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-work-center/client'
import type { createTriggerViewStore, TriggerView } from './store.ts'
import { parseTriggerTime } from './time.ts'
import type {} from './locales.ts'
import css from './TriggerView.module.css'
/** Bare observations and explicit operations bound by the entry closure. */
export interface TriggerInjected {
  hooks: { triggers: ObservableSnapshot<TriggerSnapshot>; hostDescription: HostDescriptionSource }
  refresh: () => Promise<void>
  query: (query: TriggerQuery) => Promise<void>
  select: (id: WorkTriggerId) => Promise<void>
  command: (request: TriggerCommand) => Promise<TriggerReceipt>
  prepare: (source: WorkReference) => void
  openWork: () => void
  openSession: (id: SessionId) => void
  openRun: (ref: WorkReference) => Promise<void>
}
type Shares = PropsLocale<'workTriggers'> & PropsStore<ReturnType<typeof createTriggerViewStore>> & InjectFace<TriggerInjected>
/** Framework-bound trigger directory props. */
export type TriggerPageProps = PropsRuntime<'shell.page'> & Shares
/** Selected-execution props owned by Work Center. */
export type TriggerCaptureProps = PropsRuntime<'work-center.delivery.triggers'> & Shares
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const time = (at: number) => `${new Date(at).toLocaleString()} · ${new Date(at).toISOString()}`
async function commit(props: Shares, request: TriggerCommand): Promise<void> {
  try {
    const receipt = await props.command(request)
    props.actions.settled(request, null)
    if (request.kind === 'create') void props.select(receipt.id)
  } catch (error) { props.actions.settled(request, message(error)) }
}
function begin(props: Shares, request: TriggerCommand): void { props.actions.stage(request); void commit(props, request) }
function Target({ target, t }: { target: TriggerDefinition['target']; t: Shares['t'] }) {
  return <section aria-label={t('fixed')} className={css.target}>
    <h3>{t('fixed')}</h3><p>{t(target.kind)} · <code>{target.id}</code></p><p>{t('workspace')}: <code>{target.workspaceId}</code></p>
    <p>{t(target.kind === 'agent' ? 'revision' : 'publication')}: <code>{target.kind === 'agent' ? target.expectedRevision : target.versionId}</code></p>
    <details><summary>{t('content')}</summary><pre tabIndex={0}>{JSON.stringify(target.kind === 'agent' ? target.brief : target.inputs, null, 2)}</pre></details>
  </section>
}
function Creation({ props, view, data, connected }: { props: Shares; view: TriggerView; data: TriggerSnapshot; connected: boolean }) {
  const { t, actions } = props, draft = view.draft
  if (draft === null) return null
  const at = parseTriggerTime(view.at), intervalMs = Number(view.minutes) * 60000
  const minimum = data.directory.options?.minIntervalMs
  const validInterval = minimum !== undefined && Number.isSafeInteger(intervalMs) && intervalMs >= minimum
  const blocked = !connected || data.mutating || view.pending !== null
  const rule: TriggerDefinition['rule'] | undefined = view.rule === 'on-settled'
    ? { kind: 'on-settled', source: draft.source }
    : at === undefined ? undefined : view.rule === 'at' ? { kind: 'at', at } : { kind: 'every', firstAt: at, intervalMs }
  const valid = rule !== undefined && view.name.trim() !== '' && (rule.kind === 'on-settled'
    || (rule.kind === 'at' ? rule.at : rule.firstAt) > Date.now() && (rule.kind !== 'every' || validInterval))
  const create = (enabled: boolean) => {
    if (!valid) return
    begin(props, { kind: 'create', id: crypto.randomUUID() as WorkTriggerId, enabled,
      definition: { name: view.name.trim(), rule, target: draft.target } })
  }
  return <section className={css.panel} aria-label={t('create')}>
    <h2>{t('create')}</h2><Target target={draft.target} t={t} /><p className={css.hint}>{t('immutable')}</p>
    <form onSubmit={(event) => { event.preventDefault(); create(true) }}>
      <label>{t('name')}<input required value={view.name} disabled={blocked} onChange={(event) => { actions.field('name', event.target.value) }} /></label>
      <label>{t('rule')}<select value={view.rule} disabled={blocked} onChange={(event) => { actions.rule(event.target.value as TriggerView['rule']) }}><option value="at">{t('at')}</option><option value="every">{t('every')}</option><option value="on-settled">{t('on-settled')}</option></select></label>
      {view.rule === 'on-settled' ? <><p className={css.hint}>{t('eventHint')}</p><p>{t('source')}: <code>{draft.source.kind}/{draft.source.id}</code></p></> : <>
        <label>{t('utcInput')}<input required placeholder="2026-10-22T09:00:00+08:00" value={view.at} disabled={blocked} onChange={(event) => { actions.field('at', event.target.value) }} /></label>
        <p className={css.hint}>{t('utcHint')} · {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
        {at === undefined ? view.at === '' ? null : <p role="alert">{t('invalidTime')}</p> : <><p role="status">{t('interpreted')}: <time dateTime={new Date(at).toISOString()}>{time(at)}</time></p>{at <= Date.now() ? <p>{t('past')}</p> : null}</>}
        {view.rule !== 'every' ? null : <><label>{t('minutes')}<input type="number" min={minimum === undefined ? undefined : minimum / 60000} step="any" value={view.minutes} disabled={blocked} onChange={(event) => { actions.field('minutes', event.target.value) }} /></label>{minimum === undefined ? null : <p className={css.hint}>{t('minimum', { n: minimum / 60000 })}</p>}{validInterval ? null : <p role="alert">{t('invalidInterval')}</p>}</>}
      </>}
      <div className={css.actions}><button type="submit" disabled={blocked || !valid}>{t('createEnabled')}</button><button type="button" disabled={blocked || !valid} onClick={() => { create(false) }}>{t('savePaused')}</button></div>
    </form>
  </section>
}
/**
 * Prepare an original execution without adding another Work Center intake form.
 * @param props - selected execution and preparation callback.
 * @returns one explicit navigation control with retained pending protection.
 */
export function TriggerCapture(props: TriggerCaptureProps) {
  const data = props.useTriggers(value => value), pending = props.useStore(value => value.pending)
  const connected = props.useHostDescription(value => value !== undefined)
  return <section className={css.widget}><button type="button" disabled={props.disabled || !connected || data.mutating || pending !== null} onClick={() => { props.actions.resetDraft(); props.prepare(props.detail.ref) }}>{props.t('prepare')}</button><p className={css.hint}>{props.t('prepareHint')}</p></section>
}
/**
 * Render independent rule, handoff, outcome, and retained notice state.
 * @param props - framework shares and explicit host callbacks.
 * @returns the trigger directory and immutable creation/inspection panels.
 */
export function TriggerPage(props: TriggerPageProps) {
  const { t, actions } = props, view = props.useStore(value => value), data = props.useTriggers(value => value)
  const workspaces = props.useWorkspaces(value => value)
  const connected = props.useHostDescription(value => value !== undefined)
  const [navigationError, setNavigationError] = useState<string | null>(null)
  const { directory, detail, preparation } = data, record = detail.value
  const prepared = preparation.value, pending = view.pending
  const busy = !connected || data.mutating || pending !== null
  const choices = new Map(workspaces.items.map(value => [String(value.workspaceId), value.title]))
  for (const item of directory.value?.items ?? []) if (!choices.has(item.workspaceId)) choices.set(item.workspaceId, item.workspaceId)
  if (view.workspace !== '' && !choices.has(view.workspace)) choices.set(view.workspace, view.workspace)
  const runLink = (ref: WorkReference) => () => { openRun(ref) }
  const openRun = (ref: WorkReference) => { void props.openRun(ref).catch((error: unknown) => { setNavigationError(message(error)) }) }
  return <main className={css.page} aria-label={t('title')}>
    <header className={css.heading}><div><p className={css.eyebrow}>WORK / TRIGGERS</p><h1>{t('title')}</h1><p className={css.hint}>{t('intro')}</p></div><button type="button" disabled={!connected || directory.loading || detail.loading} onClick={() => { void props.refresh() }}>{t('refresh')}</button></header>
    {!connected ? <p role="status">{t('disconnected')}</p> : null}
    <form className={css.filters} onSubmit={(event) => { event.preventDefault(); void props.query({ text: view.text,
      ...(view.workspace === '' ? {} : { workspaceId: view.workspace as NonNullable<TriggerQuery['workspaceId']> }), ...(view.enabled === 'all' ? {} : { enabled: view.enabled === 'true' }) }) }}>
      <label>{t('search')}<input type="search" value={view.text} onChange={(event) => { actions.field('text', event.target.value) }} /></label>
      <label>{t('workspace')}<select value={view.workspace} onChange={(event) => { actions.field('workspace', event.target.value) }}><option value="">{t('all')}</option>{[...choices].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>{t('enabledFilter')}<select value={view.enabled} onChange={(event) => { actions.enabled(event.target.value as TriggerView['enabled']) }}><option value="all">{t('all')}</option><option value="true">{t('enabled')}</option><option value="false">{t('paused')}</option></select></label><button type="submit" disabled={!connected || directory.loading}>{t('apply')}</button>
    </form>
    {directory.loading || detail.loading || preparation.loading ? <p role="status">{t('loading')}</p> : null}
    {directory.submitted === undefined ? null : <p className={css.hint}>{t('submitted')}: {directory.submitted.text || t('all')} · {directory.submitted.workspaceId ?? t('all')} · {t(directory.submitted.enabled === undefined ? 'all' : directory.submitted.enabled ? 'enabled' : 'paused')}</p>}
    {directory.stale && directory.value !== undefined ? <p role="status">{t('stale')}</p> : null}
    {[directory.error, detail.error, preparation.error, navigationError].filter(value => value !== null).map((error, index) => <p role="alert" className={css.error} key={index}>{t('readError')}: {error}</p>)}
    {pending === null ? null : <section className={css.pending} aria-label={t('commandPending')}><h2>{t('commandPending')}</h2><p>{pending.kind} · <code>{pending.id}</code></p><details><summary>{t('content')}</summary><pre>{JSON.stringify(pending, null, 2)}</pre></details><p>{t('uncertain')}</p>
      <div className={css.actions}>{pending.kind !== 'create' ? null : <button type="button" disabled={!connected || data.mutating} onClick={() => { void commit(props, pending) }}>{t('retryCreate')}</button>}
        <button type="button" disabled={data.mutating} onClick={() => { actions.clear() }}>{t('clear')}</button></div><p className={css.hint}>{t('clearHint')}</p>{view.error === null ? null : <p role="alert" className={css.error}>{view.error}</p>}</section>}
    {prepared === undefined || view.draft !== null ? null : <section className={css.panel}><Target target={prepared.target} t={t} /><button type="button" disabled={busy} onClick={() => { actions.draft(prepared, prepared.source) }}>{t('useTarget')}</button></section>}
    <Creation props={props} view={view} data={data} connected={connected} />
    <div className={css.columns}><section className={css.panel} aria-label={t('directory')}><h2>{t('directory')}</h2>
      {directory.value?.items.length === 0 && !directory.stale ? <p>{t('empty')}</p> : null}
      <ul className={css.list}>{directory.value?.items.map(item => <li key={item.id}><button type="button" disabled={!connected} aria-pressed={detail.id === item.id} onClick={() => { void props.select(item.id) }}><strong>{item.name}</strong><span>{t(item.status)} · {t(item.target)}</span><span>{choices.get(item.workspaceId)}</span>{item.nextAt === undefined ? null : <span>{t('next')}: {time(item.nextAt)}</span>}{item.latest === undefined ? null : <span>{t(item.latest.admission.state)}</span>}<span>{t('unread')}: {item.unread}</span></button></li>)}</ul>
      {directory.value?.failures.map(failure => <p role="alert" key={failure.id}>{t('workerError')} <code>{failure.id}</code> · {time(failure.observedAt)}</p>)}
      <button type="button" onClick={props.openWork}>{t('openWork')}</button>
    </section><section className={css.panel} aria-label={t('detail')}>
      {record === undefined ? <p>{t('choose')}</p> : <><h2>{record.definition.name}</h2><p>{t(record.enabled ? 'enabled' : 'paused')} · r{record.revision}</p>
        {detail.stale ? <p role="status">{t('stale')}</p> : null}
        <Target target={record.definition.target} t={t} /><p>{t('rule')}: {t(record.definition.rule.kind)}</p>
        {record.definition.rule.kind === 'on-settled' ? <><p>{t('source')}: <code>{record.definition.rule.source.kind}/{record.definition.rule.source.id}</code></p><p className={css.hint}>{t('eventHint')}</p><button type="button" disabled={!connected} onClick={runLink(record.definition.rule.source)}>{t('openRun')}</button></> : <p>{time(record.definition.rule.kind === 'at' ? record.definition.rule.at : record.definition.rule.firstAt)}{record.definition.rule.kind === 'every' ? ` · ${record.definition.rule.intervalMs / 60000} ${t('minutes')}` : ''}</p>}
        <p>{record.nextAt === undefined ? t('noNext') : `${t('next')}: ${time(record.nextAt)}`}</p>
        <p className={css.hint}>{t('pauseHint')}</p><p className={css.hint}>{t('capacityHint')}</p><p className={css.hint}>{t('admissionHint')}</p>
        <button type="button" disabled={busy || detail.stale || detail.loading} onClick={() => { begin(props, { kind: 'set-enabled', id: record.id, expectedRevision: record.revision, enabled: !record.enabled }) }}>{t(record.enabled ? 'pause' : 'resume')}</button>
        <h3>{t('history')}</h3>{record.occurrences.map(occurrence => <article key={occurrence.id} className={css.occurrence}>
          <h3>{t(occurrence.admission.state)}</h3><code>{occurrence.id}</code><p>{t('due')}: {time(occurrence.dueAt)}</p><p>{t('claimed')}: {time(occurrence.claimedAt)}</p><p>{t('skipped')}: {occurrence.skippedIntervals} · {t('attempts')}: {occurrence.attempts}</p>
          {occurrence.admission.state === 'unconfirmed' ? <><p>{t('recoverHint')}</p><button type="button" disabled={busy || detail.stale || detail.loading || !record.enabled} onClick={() => { begin(props, { kind: 'recover', id: record.id, occurrenceId: occurrence.id, expectedAttempt: occurrence.attempts }) }}>{t('recover')}</button></> : null}
          {occurrence.admission.state === 'admitted' || occurrence.admission.state === 'settled' ? <><p><code>{occurrence.admission.ref.kind}/{occurrence.admission.ref.id}</code></p><button type="button" disabled={!connected} onClick={runLink(occurrence.admission.ref)}>{t('openRun')}</button>{occurrence.admission.observation === undefined ? null : <p>{t(occurrence.admission.observation.status)} · {t('observed')}: {time(occurrence.admission.observation.observedAt)}</p>}{occurrence.admission.state === 'admitted' && occurrence.admission.unavailableAt !== undefined ? <p role="status">{t('unavailable')} · {time(occurrence.admission.unavailableAt)}</p> : null}</> : null}
          <h3>{t('notices')}</h3><p className={css.hint}>{t('noticeHint')}</p><ul className={css.notices}>{occurrence.notices.map(notice => <li key={notice.id}><p>{notice.kind === 'admission-unconfirmed' ? t('historicalUncertain') : t(notice.status)}</p><p>{time(notice.createdAt)} · {t(notice.readAt === undefined ? 'unread' : 'read')}</p>{notice.readAt !== undefined ? null : <button type="button" disabled={busy || detail.stale} onClick={() => { begin(props, { kind: 'acknowledge', id: record.id, noticeId: notice.id }) }}>{t('acknowledge')}</button>}</li>)}</ul>
        </article>)}
      </>}
    </section></div>
  </main>
}
/**
 * Open the durable trigger directory from either sidebar width.
 * @param props - locale, sidebar width, and navigation callback.
 * @returns a labelled navigation control.
 */
export function TriggerNavigation({ wide, t, open }: PropsRuntime<'sidebar.session.action'> & PropsLocale<'workTriggers'> & { open: () => void }) {
  const button = <button type="button" className={css.nav} aria-label={t('title')} onClick={open}><IconRefreshOutline16 size={16} /><span hidden={!wide}>{t('title')}</span></button>
  return wide ? button : <Tooltip label={t('title')}>{button}</Tooltip>
}
