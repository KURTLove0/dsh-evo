/** Source-aware work statistics with explicit cohort and measurement coverage. */
import { useEffect } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot, WorkStatisticsSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkStatisticsCounts, WorkStatisticsQuery } from '@deepseek-ai/dsh-api-remotes/client'
import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import type { createRunStatisticsViewStore } from './run-view-store.ts'
import { runStatisticsQuery } from './run-view-store.ts'
import { formatTokens, billedInputTokens } from './StatsSection.tsx'
import css from './RunStatisticsPanel.module.css'

/** Entry-local observations and explicit query callbacks. */
export interface RunStatisticsInjected {
  hooks: { work: ObservableSnapshot<WorkStatisticsSnapshot>; hostDescription: HostDescriptionSource }
  choices: () => Promise<void>
  read: (query: WorkStatisticsQuery) => Promise<void>
  invalidate: () => void
}
/** Run controls and data use the framework's four prop shares. */
export type RunStatisticsProps = PropsRuntime<'settings.stats.runs'> & PropsLocale<'settings.stats'>
  & PropsStore<ReturnType<typeof createRunStatisticsViewStore>> & InjectFace<RunStatisticsInjected>
const average = (sample: WorkStatisticsCounts['elapsed']): string => {
  if (sample.count === 0) return '—'
  const ms = sample.totalMs / sample.count
  return ms < 1000 ? `${Math.round(ms)} ms` : `${Math.round(ms / 100) / 10} s`
}
const tokens = (counts: WorkStatisticsCounts): string => counts.tokens.reportedSteps === 0 ? '—'
  : formatTokens(billedInputTokens(counts.tokens.usage) + counts.tokens.usage.outputTokens)

/**
 * Render submitted cohort evidence independently of editable filter controls.
 * @param props - framework shares and read-only host callbacks.
 * @returns filters, coverage, aggregate cards, and dimension tables.
 */
export function RunStatisticsPanel(props: RunStatisticsProps) {
  const { t, actions } = props
  const data = props.useWork(value => value), view = props.useStore(value => value)
  const workspaces = props.useWorkspaces(value => value.items)
  const connected = props.useHostDescription(value => value !== undefined)
  useEffect(() => { void props.choices() }, [props.choices])
  const report = data.report
  const available = report?.sources.some(source => source.state === 'available') === true
  const submit = (usage: WorkStatisticsQuery['usage']) => { void props.read(runStatisticsQuery(view, usage)) }
  const selected = view.executor === null ? '' : `${view.executor.kind}:${view.executor.id}`
  return <section className={css.panel} aria-label={t('workTitle')}>
    <div className={css.heading}><div><p className={css.eyebrow}>WORK / METRICS</p><h2>{t('workTitle')}</h2></div><button type="button" disabled={!connected || data.choicesLoading} onClick={() => { void props.choices() }}>{t('refreshChoices')}</button></div>
    <p className={css.hint}>{t('cohortHint')}</p>
    {!connected ? <p role="status">{t('disconnected')}</p> : null}
    <form className={css.filters} aria-label={t('workFilters')} onSubmit={(event) => { event.preventDefault(); submit('skip') }}>
      <label>{t('fromDate')}<input type="date" required value={view.from} max={view.to} onChange={(event) => { actions.dates(event.target.value, view.to); props.invalidate() }} /></label>
      <label>{t('toDate')}<input type="date" required value={view.to} min={view.from} onChange={(event) => { actions.dates(view.from, event.target.value); props.invalidate() }} /></label>
      <label>{t('workspace')}<select value={view.workspaceId} onChange={(event) => { actions.workspace(event.target.value); props.invalidate() }}><option value="">{t('all')}</option>{workspaces.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.title}</option>)}</select></label>
      <label>{t('source')}<select value={view.source} onChange={(event) => { actions.source(event.target.value as typeof view.source); props.invalidate() }}><option value="all">{t('all')}</option><option value="agent">{t('agent')}</option><option value="workflow">{t('workflow')}</option></select></label>
      <label className={css.executor}>{t('executor')}<select value={selected} onChange={(event) => {
        const choice = data.choices?.executors.find(item => `${item.ref.kind}:${item.ref.id}` === event.target.value)
        actions.executor(choice?.ref ?? null); props.invalidate()
      }}><option value="">{t('all')}</option>{data.choices?.executors.filter(item => (view.source === 'all' || item.ref.kind === view.source) &&
        (view.workspaceId === '' || item.workspaceId === undefined || item.workspaceId === view.workspaceId)).map(item =>
          <option key={`${item.ref.kind}:${item.ref.id}`} value={`${item.ref.kind}:${item.ref.id}`}>{t(item.ref.kind)} · {item.name}{item.archived ? ` · ${t('archived')}` : ''}</option>)}</select></label>
      <button type="submit" disabled={!connected || data.loading}>{t('readCounts')}</button>
    </form>
    <div className={css.actions}><button type="button" disabled={!connected || data.loading || view.from === '' || view.to === ''} onClick={() => { submit('recorded') }}>{t('readTokens')}</button><span className={css.hint}>{t('usageReadHint')}</span></div>
    {data.choicesError === null ? null : <p role="alert">{data.choicesError}</p>}
    {data.choices?.failures.map(item => <p role="alert" key={item.source}>{t(item.source)}: {item.message}</p>)}
    {data.loading ? <p role="status">{t('loadingWork')}</p> : null}
    {data.error === null ? null : <p role="alert">{data.error}</p>}
    {report === undefined ? <p>{t('workUnread')}</p> : <>
      {data.stale || !connected ? <p role="status">{t('workStale')}</p> : null}
      <p className={css.hint}>{t('observedAt')} <time dateTime={new Date(report.observedAt).toISOString()}>{new Date(report.observedAt).toLocaleString()}</time> · {report.query.timeZone}</p>
      <p>{t('submittedRange')}: {new Date(report.query.from).toLocaleString()} ≤ {t('submittedAt')} &lt; {new Date(report.query.to).toLocaleString()}</p>
      <p className={css.hint}>{t('submittedScope')}: {report.query.workspaceId ?? t('all')} · {report.query.executor === undefined ? t(report.query.source ?? 'all') : `${t(report.query.executor.kind)} · ${report.query.executor.id}`}</p>
      <ul className={css.sources}>{report.sources.map(source => <li key={source.source}>{t(source.source)} · {t(`source-${source.state}`)} · {source.runs}{source.message === undefined ? null : <p role="alert">{source.message}</p>}</li>)}</ul>
      {!available ? <p>{t('noAvailableSources')}</p> : <>
        <div className={css.cards}>
          <div><span>{t('runVolume')}</span><strong>{report.counts.runs}</strong><small>{t('queued')}: {report.counts.queued} · {t('active')}: {report.counts.active}</small></div>
          <div><span>{t('waiting')}</span><strong>{report.counts.waiting}</strong><small>{t('waitingHint')}</small></div>
          <div><span>{t('settledSuccess')}</span><strong>{report.counts.settled === 0 ? '—' : `${Math.round(report.counts.succeeded / report.counts.settled * 100)}%`}</strong><small>{report.counts.succeeded} / {report.counts.settled} · {t('executionOnly')}</small></div>
          <div><span>{t('averageElapsed')}</span><strong>{average(report.counts.elapsed)}</strong><small>{report.counts.elapsed.count} {t('durationSamples')}</small></div>
          <div><span>{t('reportedTokens')}</span><strong>{tokens(report.counts)}</strong><small>{report.counts.tokens.reportedSteps} {t('reportedSteps')}</small></div>
        </div>
        <p className={css.hint}>{t('durationHint')}</p>
        <p>{t('usageCoverage')}: {report.counts.tokens.checkedRuns} / {report.counts.runs} · {t('usageUnavailable')}: {report.counts.tokens.unavailableRuns} · {t('usageUnchecked')}: {report.counts.tokens.uncheckedRuns}</p>
        <p className={css.hint}>{t('usageAttempts')}: {report.usageSessions.attempted} / {report.usageSessions.limit}</p>
        <p className={css.hint}>{t('usageScopeHint')}</p>
        <p>{t('workKinds')}: {t('tasks')} {report.counts.taskRuns} · {t('designs')} {report.counts.designRuns} · {t('executions')} {report.counts.executionRuns} · {t('verifications')} {report.counts.verificationRuns}</p>
        <p>{t('failed')}: {report.counts.failed} · {t('cancelled')}: {report.counts.cancelled} · {t('interrupted')}: {report.counts.interrupted}</p>
        <label className={css.group}>{t('groupBy')}<select value={view.group} onChange={(event) => { actions.group(event.target.value as typeof view.group) }}><option value="executors">{t('byExecutor')}</option><option value="workspaces">{t('byWorkspace')}</option><option value="days">{t('byDay')}</option></select></label>
        {report[view.group].length === 0 ? <p>{t('noWorkRows')}</p> : <div className={css.tableScroll} tabIndex={0} role="region" aria-label={t(`table-${view.group}`)}><table><caption>{t(`table-${view.group}`)}</caption><thead><tr><th>{t('dimension')}</th><th>{t('runVolume')}</th><th>{t('waiting')}</th><th>{t('settledSuccess')}</th><th>{t('averageElapsed')}</th><th>{t('averageQueue')}</th><th>{t('reportedTokens')}</th></tr></thead><tbody>{report[view.group].map(group => <tr key={group.key}><th scope="row">{group.source === undefined ? null : `${t(group.source)} · `}{view.group === 'workspaces' ? workspaces.find(item => item.workspaceId === group.key)?.title ?? group.label : group.label}</th><td>{group.counts.runs}</td><td>{group.counts.waiting}</td><td>{group.counts.succeeded} / {group.counts.settled}</td><td>{average(group.counts.elapsed)}</td><td>{average(group.counts.queue)}</td><td>{tokens(group.counts)}</td></tr>)}</tbody></table></div>}
      </>}
    </>}
  </section>
}
