/** Structured intake, live attention, and immutable delivery evidence through pure props. */
import { useEffect, useRef, useState } from 'react'
import type { AgentCommand, AgentReceipt, TaskBrief, TaskPreflight, WorkCommand, WorkQuery, WorkReceipt, WorkReference, SessionId, DeliverySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { ObservableSnapshot, WorkCenterSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { createWorkCenterViewStore } from './view-store.ts'
import type {} from './template-slot.ts'
import css from './WorkCenterPage.module.css'
import { WorkDiagnosisPanel } from './WorkDiagnosisPanel.tsx'

/** Host callbacks and bare observables bound by the slot renderer. */
export interface WorkCenterInjected {
  hooks: { work: ObservableSnapshot<WorkCenterSnapshot>; hostDescription: HostDescriptionSource }
  diagnose: () => Promise<void>
  repair: (target: 'health' | 'workflow' | 'models' | 'runtimes') => void
  refresh: () => Promise<void>
  query: (request: Pick<WorkQuery, 'workspaceId' | 'source' | 'state'>) => Promise<void>
  more: () => Promise<void>
  select: (ref: WorkReference) => Promise<void>
  command: (command: WorkCommand) => Promise<WorkReceipt>
  check: (request: { id: Extract<AgentCommand, { kind: 'submit-task' }>['id']; workspaceId: Extract<AgentCommand, { kind: 'submit-task' }>['workspaceId']; brief: TaskBrief }, revision?: { ref: Extract<WorkReference, { kind: 'agent' }>; reviewRevision: number }) => Promise<TaskPreflight>
  submit: (request: Extract<AgentCommand, { kind: 'submit-task' }>) => Promise<AgentReceipt>
  invalidateCheck: () => void
  configure: () => void
  openSession: (id: SessionId) => void
}
/** Framework-generated page shares. */
export type WorkCenterProps = PropsRuntime<'shell.page'> & PropsRenderSlots<'work-center.intake.templates' | 'work-center.delivery.artifacts' | 'work-center.delivery.triggers'> & PropsLocale<'workCenter'> & PropsStore<ReturnType<typeof createWorkCenterViewStore>> & InjectFace<WorkCenterInjected>
const lines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean)
const key = (ref: WorkReference) => `${ref.kind}:${ref.id}`

/**
 * Render recorded outputs without executing or interpreting artifact content.
 * @param props - immutable evidence and localized labels.
 * @returns the inspectable recorded content.
 */
function Evidence({ delivery, t }: { delivery: DeliverySnapshot; t: WorkCenterProps['t'] }) {
  return <div className={css.evidence}>
    <p className={css.hint}>{t('evidenceHint')}</p>
    <code className={css.version}>{delivery.version}</code>
    {delivery.criteria.length === 0 ? null : <section><h3>{t('criteriaTitle')}</h3><ul>{delivery.criteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul></section>}
    {delivery.outputs.map((output, index) => <section key={index}><h3>{t('response')} · {output.name}</h3><pre>{output.text}</pre></section>)}
    {delivery.assertion === undefined ? null : <p>{t('assertion')}: {t(delivery.assertion.passed ? 'assertionPassed' : 'assertionFailed')} {delivery.assertion.detail}</p>}
    {delivery.artifacts.length === 0 ? null : <section><h3>{t('artifacts')}</h3>{delivery.artifacts.map((artifact, index) => <details key={index}>
      <summary>{artifact.path} · {t(artifact.state === 'captured' ? 'captured' : 'unavailable')}</summary>
      {artifact.state === 'unavailable' ? <p role="alert" className={css.error}>{artifact.error}</p> : <><p>{artifact.bytes} {t('bytes')} · SHA-256 <code>{artifact.sha256}</code></p>{artifact.encoding === 'utf-8' ? <pre>{artifact.content}</pre> : <p>{t('binary')}</p>}</>}
    </details>)}</section>}
  </div>
}

/**
 * Render a unified work directory, task draft, and independent review actions.
 * @param props - framework shares and authoritative host operations.
 * @returns the standalone Work Center page.
 */
export function WorkCenterPage(props: WorkCenterProps) {
  const { t, actions } = props
  const data = props.useWork(value => value)
  const connected = props.useHostDescription(value => value !== undefined)
  const view = props.useStore(value => value)
  const workspaces = props.useWorkspaces(value => value)
  const sessions = props.useSessions(value => value)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [reason, setReason] = useState('')
  const [workflowConfirm, setWorkflowConfirm] = useState(false)
  const [attentionType, setAttentionType] = useState<'all' | 'approval' | 'question' | 'plan-review' | 'workflow'>('all')
  const decision = useRef<{ signature: string; id: string }>()
  const workflowRequest = useRef<{ signature: string; id: string }>()
  const fields = view.fields
  const selected = data.detail
  const submittedBrief = selected?.brief
  const sourceExecutor = selected?.agentId
  const inspectedDelivery = selected?.delivery
  const savedReview = selected?.review
  const origin = selected?.revisionOf
  const waiting = selected?.ref.kind === 'workflow' && selected.waitingAttemptId !== undefined
    ? { ref: selected.ref, attemptId: selected.waitingAttemptId } : undefined
  const executor = data.executors.find(item => item.id === fields.executorId)
  const workspace = workspaces.items.find(item => item.workspaceId === fields.workspaceId)
  useEffect(() => { void props.query({ ...(view.workspace === '' ? {} : { workspaceId: view.workspace as WorkQuery['workspaceId'] & string }), ...(view.source === 'all' ? {} : { source: view.source }), ...(view.state === 'all' ? {} : { state: view.state }) }) }, [props.query, view.workspace, view.source, view.state])
  useEffect(() => { setReason(''); setWorkflowConfirm(false); setError(null); setNotice('') }, [selected?.ref.kind, selected?.ref.id, selected?.delivery?.version, selected?.review?.revision])
  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null); setNotice('')
    try { await action(); setNotice(t('saved')) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  const field = (name: keyof typeof fields, value: string) => { props.invalidateCheck(); actions.field(name, value) }
  const brief = (): TaskBrief => ({ version: 1, goal: fields.goal.trim(), background: fields.background,
    deliverables: lines(fields.deliverables), acceptanceCriteria: lines(fields.criteria), constraints: fields.constraints,
    ...(view.template === null ? {} : { template: view.template }) })
  const ready = connected && executor !== undefined && !executor.archived && workspace !== undefined && fields.goal.trim() !== '' && data.readiness?.issues.length === 0 && data.readiness.agentRevision === executor.revision && data.readinessFor?.id === executor.id && data.readinessFor.workspaceId === workspace.workspaceId
  const attention = Object.values(sessions.byId).filter((item): item is typeof item & { pendingInteraction: NonNullable<typeof item.pendingInteraction> } => item.pendingInteraction !== undefined && (attentionType === 'all' || item.pendingInteraction === attentionType) && (view.workspace === '' || workspaces.items.find(item => item.workspaceId === view.workspace)?.sessionIds.includes(item.id) === true))
  const workflowAttention = attentionType === 'all' || attentionType === 'workflow' ? data.attention : []
  const filters = (patch: Partial<Pick<typeof view, 'source' | 'state' | 'workspace'>>) => { actions.filter({ source: view.source, state: view.state, workspace: view.workspace, ...patch }) }
  const review = (outcome: 'accepted' | 'changes-requested', source: NonNullable<typeof selected>, evidence: DeliverySnapshot) => {
    const signature = JSON.stringify([source.ref, evidence.version, source.review?.revision ?? 0, outcome, reason])
    if (decision.current?.signature !== signature) decision.current = { signature, id: crypto.randomUUID() }
    const version = evidence.version
    const decisionId = decision.current.id as Extract<WorkCommand, { kind: 'review' }>['decisionId']
    void perform(() => props.command({ kind: 'review', ref: source.ref, version, expectedRevision: source.review?.revision ?? 0, decisionId, decision: outcome, reason }))
  }
  return <main className={css.page} aria-label={t('title')}>
    <header className={css.header}><div><p className={css.eyebrow}>WORK / CONTROL</p><h1>{t('title')}</h1><p>{t('intro')}</p></div><div className={css.actions}>
      <Button variant="outline" onClick={props.configure}>{t('agents')}</Button><Button variant="outline" disabled={data.loading || !connected} onClick={() => { void props.refresh() }}>{t('refresh')}</Button>
      <Button variant="primary" onClick={() => { actions.form(true) }}>{t('newTask')}</Button>
    </div></header>
    {!connected ? <p role="alert" className={css.error}>{t('disconnected')}</p> : null}
    {error ?? data.error ? <p role="alert" className={css.error}>{error ?? data.error}</p> : null}
    <p role="status" className={css.hint}>{busy || data.loading ? t('loading') : notice}</p>
    {view.formOpen ? <section className={css.panel} aria-label={t('newTask')}><form onSubmit={(event) => {
      event.preventDefault()
      if (!ready) return
      const requestId = (view.requestId ?? crypto.randomUUID()) as Extract<AgentCommand, { kind: 'submit-task' }>['requestId']
      actions.prepare(requestId)
      void perform(async () => {
        if (view.revision === null) await props.submit({ kind: 'submit-task', id: executor.id, workspaceId: workspace.workspaceId, expectedRevision: executor.revision, requestId, brief: brief() })
        else await props.command({ kind: 'revise-agent', ref: view.revision.ref, reviewRevision: view.revision.reviewRevision, agentRevision: executor.revision, requestId, brief: brief() })
        actions.submitted(requestId)
      })
    }}>
      <h2>{t(view.revision === null ? 'newTask' : 'revisionTask')}</h2><p className={css.hint}>{t('draftHint')}</p>
      <fieldset disabled={busy} className={css.form}>
        <label>{t('executor')}<select required value={fields.executorId} disabled={view.revision !== null} onChange={(event) => { field('executorId', event.target.value) }}><option value="">{t('choose')}</option>{data.executors.filter(item => !item.archived).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>{t('workspace')}<select required value={fields.workspaceId} disabled={view.revision !== null} onChange={(event) => { field('workspaceId', event.target.value) }}><option value="">{t('choose')}</option>{workspaces.items.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.title}</option>)}</select></label>
        {(['goal', 'background', 'deliverables', 'criteria', 'constraints'] as const).map(name => <label key={name} className={css.full}>{t(name)}<textarea required={name === 'goal'} rows={name === 'background' ? 4 : 2} value={fields[name]} onChange={(event) => { field(name, event.target.value) }} /></label>)}
      </fieldset>
      {props.renderSlot('work-center.intake.templates', { brief: brief(), disabled: busy || !connected, load: (value) => { actions.loadTemplate(value); props.invalidateCheck() } })}
      {data.executorError === null ? null : <p role="alert">{data.executorError}</p>}
      {data.executors.length === 0 || workspaces.items.length === 0 ? <p>{t('configureFirst')}</p> : null}
      {view.revision === null ? null : <><p>{t('revisionHint')}</p><div className={css.configs}><section><h3>{t('originalConfig')}</h3><pre>{JSON.stringify(view.revision.configuration, null, 2)}</pre></section><section><h3>{t('currentConfig')}</h3><pre>{JSON.stringify(executor, null, 2)}</pre></section></div></>}
      <div className={css.actions}><Button variant="outline" disabled={busy || !connected || executor === undefined || workspace === undefined || fields.goal.trim() === ''} onClick={executor === undefined || workspace === undefined ? undefined : () => {
        props.invalidateCheck()
        const revision = view.revision === null ? undefined : { ref: view.revision.ref, reviewRevision: view.revision.reviewRevision }
        void perform(() => props.check({ id: executor.id, workspaceId: workspace.workspaceId, brief: brief() }, revision))
      }}>{t('check')}</Button><Button type="submit" variant="primary" disabled={busy || !ready}>{t('submit')}</Button><Button variant="outline" disabled={busy} onClick={() => { actions.form(false) }}>{t('closeDraft')}</Button><Button variant="outline" disabled={busy} onClick={() => { actions.clear(); props.invalidateCheck() }}>{t('clearDraft')}</Button></div>
      {data.readiness === undefined ? null : <section className={css.check}><h3>{t('checkedAt')} {new Date(data.readiness.checkedAt).toLocaleString()}</h3>{data.readiness.issues.length === 0 ? <p>{t('checked')}</p> : <ul role="alert">{data.readiness.issues.map(issue => <li key={issue.code}>{issue.message}</li>)}</ul>}{data.readiness.mcp.length === 0 ? null : <p>{t('mcpUnchecked')} {data.readiness.mcp.map(item => item.name).join(', ')}</p>}{data.readiness.prompt === undefined ? null : <details open><summary>{t('preview')}</summary><pre>{data.readiness.prompt}</pre></details>}</section>}
    </form></section> : null}
    <section className={css.panel} aria-label={t('attention')}><div className={css.sectionTitle}><h2>{t('attention')}</h2><span>{attention.length + workflowAttention.length}</span></div><p className={css.hint}>{t('attentionHint')}</p><label>{t('attentionType')}<select value={attentionType} onChange={(event) => { setAttentionType(event.target.value as typeof attentionType) }}>{(['all', 'approval', 'question', 'plan-review', 'workflow'] as const).map(type => <option key={type} value={type}>{t(type === 'workflow' ? 'workflowConfirmation' : type)}</option>)}</select></label>
      {data.attentionFailures.map(failure => <p key={failure.source} className={css.error} role="alert">{t('sourceFailure')}: {t(failure.source)} · {failure.message}</p>)}
      {attention.length + workflowAttention.length === 0 && connected && !data.loading && data.attentionFailures.length === 0 ? <p>{t(attentionType === 'all' ? 'noAttention' : 'noAttentionMatch')}</p> : null}
      <ul className={css.attention}>{attention.map(item => <li key={item.id}><strong>{item.title ?? item.id}</strong><span>{t(item.pendingInteraction)}</span><Button variant="outline" disabled={!connected} onClick={() => { props.openSession(item.id) }}>{t('transcript')}</Button></li>)}{workflowAttention.map(item => <li key={key({ kind: item.kind, id: item.run.id } as WorkReference)}><strong>{item.kind === 'workflow' ? item.run.workflowName : item.run.agentName}</strong><span>{t('waiting')}</span><Button variant="outline" disabled={!connected} onClick={() => { void props.select({ kind: item.kind, id: item.run.id } as WorkReference) }}>{t('open')}</Button></li>)}</ul>
      {data.attentionNext === undefined ? null : <Button variant="outline" onClick={() => { filters({ source: 'workflow', state: 'waiting' }) }}>{t('attentionMore')}</Button>}
    </section>
    <div className={css.toolbar}><label>{t('workspace')}<select value={view.workspace} onChange={(event) => { filters({ workspace: event.target.value }) }}><option value="">{t('all')}</option>{workspaces.items.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.title}</option>)}</select></label><label>{t('source')}<select value={view.source} onChange={(event) => { filters({ source: event.target.value as typeof view.source }) }}>{(['all', 'agent', 'workflow'] as const).map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label><div className={css.actions} role="group" aria-label={t('state')}>{(['all', 'active', 'finished', 'waiting'] as const).map(value => <Button key={value} variant="outline" aria-pressed={view.state === value} onClick={() => { filters({ state: value }) }}>{t(value)}</Button>)}</div>{view.workspace === '' && view.source === 'all' && view.state === 'all' ? null : <Button variant="outline" onClick={() => { filters({ workspace: '', source: 'all', state: 'all' }) }}>{t('reset')}</Button>}</div>
    {data.failures.map(failure => <p key={failure.source} className={css.error} role="alert">{t('sourceFailure')}: {t(failure.source)} · {failure.message}</p>)}
    <div className={css.columns}><section className={css.panel} aria-label={t('runs')}><div className={css.sectionTitle}><h2>{t('runs')}</h2><span>{t('loaded')} {data.items.length}</span></div><p className={css.hint}>{t('ordering')}</p><ul className={css.runs}>{data.items.map((item) => {
      const ref = { kind: item.kind, id: item.run.id } as WorkReference
      return <li key={key(ref)}><button type="button" aria-pressed={data.selected !== undefined && key(data.selected) === key(ref)} onClick={() => { void props.select(ref) }}><span className={css.runTitle}>{item.kind === 'agent' ? item.run.agentName : item.run.workflowName}</span>{item.kind === 'agent' ? <span className={css.runSummary}>{item.run.submission?.brief.goal ?? item.run.prompt}</span> : null}<span>{workspaces.items.find(workspace => workspace.workspaceId === item.run.workspaceId)?.title ?? item.run.workspaceId}</span><span>{t(item.kind)} · {t(item.run.status)}</span>{item.needsAttention ? <span>{item.kind === 'workflow' ? t('workflowConfirmation') : t(sessions.byId[item.run.sessionId]?.pendingInteraction ?? 'waiting')}</span> : null}<span>{t('createdAt')}: <time dateTime={new Date(item.run.createdAt).toISOString()}>{new Date(item.run.createdAt).toLocaleString()}</time></span><span>{t('executionUpdatedAt')}: <time dateTime={new Date(item.run.updatedAt).toISOString()}>{new Date(item.run.updatedAt).toLocaleString()}</time></span><span className={css.reviewTag}>{t('review')}: {t(item.review?.decision ?? 'pendingReview')}</span></button></li>
    })}</ul>{data.items.length === 0 && !data.loading ? <p>{t('noRuns')}</p> : null}{data.next === undefined ? null : <Button variant="outline" disabled={data.loading || !connected} onClick={() => { void props.more() }}>{t('more')}</Button>}<p className={css.hint}>{t('updated')} {data.observedAt === 0 ? '—' : new Date(data.observedAt).toLocaleString()}</p></section>
    <section className={css.panel} aria-label={t('delivery')}>{selected === undefined ? <p>{t('selectDetail')}</p> : <><div className={css.sectionTitle}><h2>{selected.name}</h2><span>{t(selected.status)}</span></div><code className={css.version}>{key(selected.ref)}</code>{selected.brief === undefined ? null : <details open><summary>{t('taskBrief')}</summary><p><strong>{t('goal')}: </strong>{selected.brief.goal}</p>{selected.brief.template === undefined ? null : <p>{t('templateOrigin')}: <code>{selected.brief.template.id}</code> · v{selected.brief.template.version}</p>}<pre>{selected.brief.background}</pre>{submittedBrief === undefined || sourceExecutor === undefined ? null : <Button variant="outline" disabled={busy} onClick={(event) => {
      actions.clear(); actions.loadTemplate(submittedBrief); actions.field('executorId', sourceExecutor); actions.field('workspaceId', selected.workspaceId); actions.form(true); props.invalidateCheck()
      const pageElement = event.currentTarget.closest('main') as HTMLElement
      pageElement.scrollTop = 0
    }}>{t('reuseBrief')}</Button>}<p>{selected.brief.constraints}</p></details>}{origin === undefined ? null : <Button variant="outline" disabled={!connected} onClick={() => { void props.select(origin) }}>{t('revisionOrigin')}</Button>}<div className={css.actions}><Button variant="outline" disabled={!connected} onClick={() => { props.openSession(selected.sessionId) }}>{t('transcript')}</Button>{waiting !== undefined ? ([true, false] as const).map(approve => <Button key={String(approve)} variant="outline" disabled={busy || !connected} onClick={() => { void perform(() => props.command({ kind: 'decide-workflow', ...waiting, approve })) }}>{t(approve ? 'approve' : 'reject')}</Button>) : null}</div>
    {selected.error === undefined ? null : <p role="alert" className={css.error}>{selected.error}</p>}{selected.deliveryError === undefined ? null : <p role="alert" className={css.error}>{selected.deliveryError}</p>}
    {inspectedDelivery === undefined ? <p>{t('noDelivery')}</p> : <><h3>{t('currentVersion')}</h3>{selected.review !== undefined && selected.review.version !== inspectedDelivery.version ? <p role="status">{t('changedDelivery')}</p> : null}<Evidence delivery={inspectedDelivery} t={t} /><section className={css.review}><h3>{t('review')}</h3><p>{t(selected.review?.decision ?? 'pendingReview')}</p><p className={css.hint}>{t('reviewHint')}</p><label>{t('reason')}<textarea rows={3} disabled={busy} value={reason} onChange={(event) => { setReason(event.target.value) }} /></label><div className={css.actions}><Button disabled={busy || !connected || inspectedDelivery.artifacts.some(item => item.state === 'unavailable')} onClick={() => { review('accepted', selected, inspectedDelivery) }}>{t('accept')}</Button><Button variant="outline" disabled={busy || !connected || reason.trim() === ''} onClick={() => { review('changes-requested', selected, inspectedDelivery) }}>{t('requestChanges')}</Button></div></section></>}
    {savedReview === undefined ? null : <section className={css.review}><p>{t(savedReview.decision)} · {t('decisionActor')} · {new Date(savedReview.reviewedAt).toLocaleString()}</p><p>{savedReview.reason}</p><details><summary>{t('savedVersion')}</summary><Evidence delivery={savedReview.delivery} t={t} /></details>{savedReview.decision === 'changes-requested' ? <><p className={css.hint}>{t('revisionHint')}</p>{selected.ref.kind === 'agent' ? <Button variant="outline" disabled={busy || !connected} onClick={() => { props.invalidateCheck(); actions.revise(selected) }}>{t('revisionTask')}</Button> : workflowConfirm ? <div className={css.actions}><Button disabled={busy || !connected} onClick={() => {
      const signature = JSON.stringify([selected.ref, savedReview.revision])
      if (workflowRequest.current?.signature !== signature) workflowRequest.current = { signature, id: crypto.randomUUID() }
      const ref = selected.ref as Extract<WorkReference, { kind: 'workflow' }>
      const reviewRevision = savedReview.revision
      const requestId = workflowRequest.current.id as Extract<WorkCommand, { kind: 'revise-workflow' }>['requestId']
      void perform(() => props.command({ kind: 'revise-workflow', ref, reviewRevision, requestId }))
    }}>{t('confirmWorkflowRevision')}</Button><Button variant="outline" disabled={busy} onClick={() => { setWorkflowConfirm(false) }}>{t('cancelRevision')}</Button></div> : <Button variant="outline" disabled={busy || !connected} onClick={() => { setWorkflowConfirm(true) }}>{t('createWorkflowRevision')}</Button>}</> : null}</section>}
    {selected.priorReviews?.map(review => <details key={review.revision}>
      <summary>{t(review.decision)} · {new Date(review.reviewedAt).toLocaleString()}</summary>
      <p>{review.reason}</p><Evidence delivery={review.delivery} t={t} />
    </details>)}
    {props.renderSlot('work-center.delivery.triggers', { detail: selected, disabled: busy || !connected })}
    {props.renderSlot('work-center.delivery.artifacts', { detail: selected, disabled: busy || !connected })}
    </>}</section></div>
    {selected === undefined && view.retry === null ? null : <WorkDiagnosisPanel
      data={data} retry={view.retry} actions={actions} connected={connected}
      t={t} select={props.select} diagnose={props.diagnose} repair={props.repair}
      openSession={props.openSession} command={props.command} />}
  </main>
}
