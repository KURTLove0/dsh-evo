/** Template library and task-intake controls use only framework props and plain callbacks. */
import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TemplateMutation, TemplateCopyRequest, WorkTemplateId, TemplateRecord, TemplateVersion, TemplateReceipt, WorkflowReceipt } from '@deepseek-ai/dsh-api-remotes/client'
import type { ObservableSnapshot, TemplateSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-work-center/client'
import type { createTemplateViewStore } from './store.ts'
import css from './TemplateView.module.css'

/** Host operations and framework-bound observables. */
export interface TemplateInjected {
  hooks: { templates: ObservableSnapshot<TemplateSnapshot>; hostDescription: HostDescriptionSource }
  refresh: () => Promise<void>
  select: (id: WorkTemplateId) => Promise<void>
  command: (request: TemplateMutation) => Promise<TemplateReceipt>
  copy: (request: TemplateCopyRequest) => Promise<WorkflowReceipt>
  openWork: () => void
  openWorkflow: () => void
}
type Shares = PropsLocale<'workTemplates'> & PropsStore<ReturnType<typeof createTemplateViewStore>> & InjectFace<TemplateInjected>
const contentVersion = (record: TemplateRecord, requested: number): TemplateVersion =>
  record.versions.find(value => value.version === requested) ?? record.versions[record.versions.length - 1] as TemplateVersion

type PageProps = PropsRuntime<'shell.page'> & Shares
type IntakeProps = PropsRuntime<'work-center.intake.templates'> & Shares

function TemplateOverview({ version, t }: { version: TemplateVersion; t: Shares['t'] }) {
  const content = version.content
  return <section className={css.overview}><h3>{version.name}</h3>{content.kind === 'task' ? <>
    <h4>{t('goal')}</h4><p>{content.brief.goal}</p>
    <h4>{t('background')}</h4><p>{content.brief.background || t('notSpecified')}</p>
    <h4>{t('deliverables')}</h4>{content.brief.deliverables.length === 0 ? <p>{t('notSpecified')}</p>
      : <ul>{content.brief.deliverables.map((path, index) => <li key={index}>{path}</li>)}</ul>}
    <h4>{t('criteria')}</h4>{content.brief.acceptanceCriteria.length === 0 ? <p>{t('notSpecified')}</p>
      : <ul>{content.brief.acceptanceCriteria.map((value, index) => <li key={index}>{value}</li>)}</ul>}
    <h4>{t('constraints')}</h4><p>{content.brief.constraints || t('notSpecified')}</p>
  </> : <><p>{content.definition.requirement.summary}</p><h4>{t('objectives')}</h4>
    <ul>{content.definition.requirement.objectives.map(value => <li key={value.id}>{value.statement}</li>)}</ul>
    <h4>{t('inputs')}</h4><ul>{content.definition.requirement.inputs.map(value => <li key={value.name}>{value.name} · {value.description}</li>)}</ul>
    <h4>{t('steps')}</h4><ol>{content.definition.nodes.map(value => <li key={value.id}>{value.title} · {t(value.kind)}</li>)}</ol>
  </>}<details><summary>{t('advanced')}</summary><pre>{JSON.stringify(content, null, 2)}</pre></details></section>
}

/**
 * Render draft-only template application and saving inside task intake.
 * @param props - template data and the parent draft application callback.
 * @returns optional template controls without nested form submission.
 */
export function TemplateIntake(props: IntakeProps) {
  const { t, actions } = props
  const data = props.useTemplates(value => value)
  const view = props.useStore(value => value)
  const connected = props.useHostDescription(value => value !== undefined)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const record = data.record
  const template = record === undefined ? undefined : { record, version: contentVersion(record, view.version) }
  const version = template?.version
  const task = template?.version.content.kind === 'task'
    ? { ...template.version.content.brief, template: { id: template.record.id, version: template.version.version } } : undefined
  const save = (target?: TemplateRecord) => {
    const body = { kind: 'save-task' as const, expectedRevision: target?.revision ?? 0,
      ...(target === undefined ? {} : { id: target.id }), name: view.name, brief: props.brief }
    const { expectedRevision: _revision, ...intent } = body
    const signature = JSON.stringify(intent)
    const request = view.mutationRequest?.signature === signature ? view.mutationRequest.request
      : { ...body, requestId: crypto.randomUUID() as TemplateMutation['requestId'] }
    actions.stageMutation({ signature, request })
    setBusy(true); setError(''); setMessage('')
    void props.command(request)
      .then(() => { actions.acknowledged('mutationRequest', request.requestId); setMessage(t('saved')) }, (failure: unknown) => { setError(failure instanceof Error ? failure.message : String(failure)) })
      .finally(() => { setBusy(false) })
  }
  const disabled = props.disabled || busy || !connected
  return <details className={css.widget}><summary>{t('intake')}</summary><p>{t('hint')}</p>
    {props.brief.template === undefined ? null : <p>{t('provenance')}: <code>{props.brief.template.id}</code> · v{props.brief.template.version}</p>}
    {data.error === null ? null : <p role="alert">{data.error}</p>}{error === '' ? null : <p role="alert">{error}</p>}<p role="status">{message}</p>
    <div className={css.fields}><label>{t('select')}<select disabled={disabled} value={record?.id ?? ''} onChange={(event) => { actions.select(); void props.select(event.target.value as WorkTemplateId) }}><option value="" disabled>—</option>{data.items.filter(item => item.kind === 'task' && !item.archived).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>{t('version')}<select disabled={disabled || record === undefined} value={version?.version ?? ''} onChange={(event) => { actions.version(Number(event.target.value)) }}>{record?.versions.map(item => <option key={item.version} value={item.version}>{item.version} · {item.name}</option>)}</select></label></div>
    <div className={css.actions}><Button variant="outline" disabled={disabled || version?.content.kind !== 'task' || record?.archived !== false} onClick={task === undefined ? undefined : () => { props.load(task) }}>{t('load')}</Button></div>
    <label>{t('name')}<input value={view.name} disabled={disabled} onChange={(event) => { actions.field('name', event.target.value) }} /></label>
    <div className={css.actions}><Button variant="outline" disabled={disabled || view.name.trim() === '' || props.brief.goal.trim() === ''} onClick={() => { save() }}>{t('save')}</Button>
      <Button variant="outline" disabled={disabled || record?.archived !== false || record.versions[0]?.content.kind !== 'task' || view.name.trim() === '' || props.brief.goal.trim() === ''} onClick={() => { save(record) }}>{t('update')}</Button></div>
    {view.mutationRequest === null ? null : <div><p>{t('retryHint')}</p><Button variant="outline" disabled={disabled} onClick={() => { actions.discardRequests(['mutationRequest']); setError(''); setMessage(''); void props.refresh() }}>{t('discardRetry')}</Button></div>}
    <h3>{t('examples')}</h3><div className={css.actions}>{data.examples.map(example => <Button key={example.id} variant="outline" disabled={disabled} onClick={() => { props.load(example.brief) }}>{t(example.id)}</Button>)}</div>
  </details>
}

/**
 * Render saved content versions and independently copied workflow drafts.
 * @param props - framework shares and authoritative template callbacks.
 * @returns the private template library page.
 */
export function TemplatePage(props: PageProps) {
  const { t, actions } = props
  const data = props.useTemplates(value => value)
  const view = props.useStore(value => value)
  const workspaces = props.useWorkspaces(value => value)
  const connected = props.useHostDescription(value => value !== undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const record = data.record
  const selection = record === undefined ? undefined : { record, version: contentVersion(record, view.version) }
  const source = data.sources.find(value => value.id === view.source)
  const disabled = busy || !connected
  const perform = async (action: () => Promise<unknown>, label: string) => {
    setBusy(true); setError(''); setMessage('')
    try { await action(); setMessage(label) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  const commit = (body: Omit<Extract<TemplateMutation, { kind: 'save-workflow' }>, 'requestId'> | Omit<Extract<TemplateMutation, { kind: 'archive' }>, 'requestId'>) => {
    const { expectedRevision: _revision, ...intent } = body
    const signature = JSON.stringify(intent)
    const request = view.mutationRequest?.signature === signature ? view.mutationRequest.request
      : { ...body, requestId: crypto.randomUUID() as TemplateMutation['requestId'] }
    actions.stageMutation({ signature, request })
    void perform(async () => {
      await props.command(request); actions.acknowledged('mutationRequest', request.requestId)
    }, t('saved'))
  }
  return <main className={css.page} aria-label={t('title')}><header><p className={css.eyebrow}>WORK / TEMPLATES</p><h1>{t('title')}</h1><p>{t('intro')}</p><div className={css.actions}><Button variant="outline" disabled={disabled || data.loading} onClick={() => { void props.refresh() }}>{t('refresh')}</Button><Button variant="outline" onClick={props.openWork}>{t('openWork')}</Button></div></header>
    {!connected ? <p role="alert">{t('disconnected')}</p> : null}{error || data.error ? <p className={css.error} role="alert">{error || data.error}</p> : null}<p role="status">{busy || data.loading ? t('loading') : message}</p>
    {view.mutationRequest === null && view.copyRequest === null ? null : <div><p>{t('retryHint')}</p><Button variant="outline" disabled={disabled} onClick={() => { actions.discardRequests(['mutationRequest', 'copyRequest']); setError(''); setMessage(''); void props.refresh() }}>{t('discardRetry')}</Button></div>}
    <div className={css.columns}><section className={css.panel}><h2>{t('title')}</h2>{data.items.length === 0 ? (connected && !data.loading && data.error === null ? <p>{t('empty')}</p> : null) : <ul className={css.list}>{data.items.map(item => <li key={item.id}><button type="button" aria-pressed={data.selected === item.id} onClick={() => { actions.select(); void props.select(item.id) }}><strong>{item.name}</strong><span>{t(item.kind)} · v{item.version}{item.archived ? ` · ${t('archived')}` : ''}</span></button></li>)}</ul>}</section>
      <section className={css.panel} aria-label={t('history')}><h2>{t('history')}</h2>{selection === undefined ? <p>{t('select')}</p> : <><label>{t('version')}<select value={selection.version.version} onChange={(event) => { actions.version(Number(event.target.value)) }}>{selection.record.versions.map(value => <option key={value.version} value={value.version}>{value.version} · {value.name}</option>)}</select></label><Button variant="outline" disabled={disabled} onClick={() => { commit({ kind: 'archive', id: selection.record.id, expectedRevision: selection.record.revision, archived: !selection.record.archived }) }}>{t(selection.record.archived ? 'restore' : 'archive')}</Button>{selection.record.archived ? <p>{t('archivedHint')}</p> : null}
        <TemplateOverview version={selection.version} t={t} />{selection.version.content.kind === 'task' ? <p>{t('taskHint')}</p> : <><p>{t('draftOnly')}</p><div className={css.fields}><label>{t('workspace')}<select disabled={disabled} value={view.workspace} onChange={(event) => { actions.field('workspace', event.target.value) }}><option value="">—</option>{workspaces.items.map(value => <option key={value.workspaceId} value={value.workspaceId}>{value.title}</option>)}</select></label><label>{t('copyName')}<input value={view.copyName} disabled={disabled} onChange={(event) => { actions.field('copyName', event.target.value) }} /></label></div><div className={css.actions}><Button disabled={disabled || selection.record.archived || view.workspace === '' || view.copyName.trim() === ''} onClick={() => {
          const body = { id: selection.record.id, version: selection.version.version, name: view.copyName, workspaceId: view.workspace as TemplateCopyRequest['workspaceId'] }
          const signature = JSON.stringify(body)
          const request = view.copyRequest?.signature === signature ? view.copyRequest.request
            : { ...body, requestId: crypto.randomUUID() as TemplateCopyRequest['requestId'] }
          actions.stageCopy({ signature, request })
          void perform(async () => {
            await props.copy(request); actions.acknowledged('copyRequest', request.requestId)
          }, t('copied'))
        }}>{t('copy')}</Button><Button variant="outline" onClick={props.openWorkflow}>{t('openWorkflow')}</Button></div></>}</>}
      </section></div>
    <section className={css.panel} aria-label={t('saveWorkflow')}><h2>{t('saveWorkflow')}</h2><div className={css.fields}><label>{t('source')}<select value={view.source} disabled={disabled} onChange={(event) => { actions.field('source', event.target.value); actions.field('publication', '') }}><option value="">—</option>{data.sources.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>{t('publication')}<select value={view.publication} disabled={disabled} onChange={(event) => { actions.field('publication', event.target.value) }}><option value="">—</option>{source?.versions.map(item => <option key={item.id} value={item.id}>{item.number}</option>)}</select></label><label>{t('name')}<input value={view.name} disabled={disabled} onChange={(event) => { actions.field('name', event.target.value) }} /></label></div><div className={css.actions}>{[false, true].map(update => <Button key={String(update)} variant="outline" disabled={disabled || source === undefined || view.publication === '' || view.name.trim() === '' || (update && (record?.archived !== false || record.versions[0]?.content.kind !== 'workflow'))} onClick={source === undefined ? undefined : () => {
      const target = update ? record : undefined
      commit({ kind: 'save-workflow', expectedRevision: target?.revision ?? 0,
        ...(target === undefined ? {} : { id: target.id }), workflowId: source.id,
        versionId: view.publication as Extract<TemplateMutation, { kind: 'save-workflow' }>['versionId'], name: view.name })
    }}>{t(update ? 'update' : 'saveWorkflow')}</Button>)}</div></section>
  </main>
}
