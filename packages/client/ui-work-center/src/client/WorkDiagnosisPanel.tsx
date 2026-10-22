/** Source-linked failure observations and an explicit full retry, rendered from owner data. */
import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkCommand, WorkDiagnosis } from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkCenterSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkRetryDraft } from './view-store.ts'
import type { WorkCenterProps } from './WorkCenterPage.tsx'
import css from './WorkCenterPage.module.css'

type Props = Pick<WorkCenterProps, 't' | 'diagnose' | 'repair' | 'openSession' | 'command' | 'actions' | 'select'> & {
  data: WorkCenterSnapshot
  connected: boolean
  retry: WorkRetryDraft | null
}

/**
 * Display original failure text independently of proven categories and new-run intent.
 * @param props - authoritative observations, declared viewing draft, and explicit host operations.
 * @returns diagnostic evidence and recoverable full-retry confirmation.
 */
export function WorkDiagnosisPanel({ data, connected, retry, actions, t, diagnose, repair, openSession, command, select }: Props) {
  const report = data.diagnosis
  const preview = report?.retry
  const executor = preview?.kind === 'agent' ? data.executors.find(value => value.id === preview.agentId) : undefined
  const eligible = report !== undefined && (['failed', 'cancelled', 'interrupted'].includes(report.status) ||
    (preview?.kind === 'workflow' && preview.mode === 'verification' && preview.assertion?.passed === false)) &&
    (preview?.kind === 'agent' ? executor !== undefined && !executor.archived : preview?.kind === 'workflow')
  const matchingRetry = retry !== null && report?.ref.kind === retry.request.ref.kind && report.ref.id === retry.request.ref.id
  const retryRevisionMatches = retry?.request.kind !== 'retry-agent' || (executor !== undefined && !executor.archived && executor.revision === retry.request.expectedRevision)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const prepare = report?.ref.kind === 'agent' && executor !== undefined
    ? () => { actions.retry({ kind: 'retry-agent', ref: report.ref as Extract<WorkCommand, { kind: 'retry-agent' }>['ref'],
      expectedRevision: executor.revision, requestId: crypto.randomUUID() as Extract<WorkCommand, { kind: 'retry-agent' }>['requestId'] }) }
    : report?.ref.kind === 'workflow'
      ? () => { actions.retry({ kind: 'retry-workflow', ref: report.ref as Extract<WorkCommand, { kind: 'retry-workflow' }>['ref'],
        requestId: crypto.randomUUID() as Extract<WorkCommand, { kind: 'retry-workflow' }>['requestId'] }) }
      : undefined
  return <section className={css.panel} aria-label={t('diagnosis')}>
    <h2>{t('diagnosis')}</h2><p>{t('diagnosisHint')}</p>
    <div className={css.actions}><Button variant="outline" disabled={!connected || data.diagnosing || data.selected === undefined} onClick={() => { void diagnose() }}>{t(data.diagnosing ? 'diagnosing' : 'readDiagnosis')}</Button>
      <Button variant="outline" onClick={() => { repair('health') }}>{t('inspectCapabilities')}</Button><Button variant="outline" onClick={() => { repair('models') }}>{t('inspectModels')}</Button><Button variant="outline" onClick={() => { repair('runtimes') }}>{t('inspectRuntimes')}</Button>
    </div>
    {data.diagnosisError === null ? null : <p role="alert" className={css.error}>{data.diagnosisError}</p>}
    {report === undefined ? <p>{t('diagnosisUnread')}</p> : <>
      <p>{t('diagnosisObserved')}: <time dateTime={new Date(report.observedAt).toISOString()}>{new Date(report.observedAt).toLocaleString()}</time> · {t(report.status)}</p>
      {data.diagnosisStale || !connected ? <p role="status">{t('diagnosisStale')}</p> : null}
      <h3>{t('diagnosisSources')}</h3><ul>{report.sources.map((source, index) => <li key={index} className={css.diagnosticSource}>
        <strong>{source.nodeId ?? source.sessionId}</strong> · {t(source.kind === 'run' ? 'sourceRun' : 'sourceSession')} · {t(`source-${source.state}`)}
        {source.throughSeq === undefined ? null : <span> · {t('throughSeq')} {source.throughSeq}</span>}
        {source.interval === undefined ? null : <span> · {t('nodeInterval')}: {new Date(source.interval.from).toLocaleString()} — {new Date(source.interval.to).toLocaleString()}</span>}
        <Button variant="outline" disabled={!connected} onClick={() => { openSession(source.sessionId) }}>{t('transcript')}</Button>
      </li>)}</ul>
      {report.findings.length === 0 ? <p>{t('noFailureEvidence')}</p> : <ul className={css.diagnosticFindings}>{report.findings.map((finding, index) => {
        const source = report.sources[finding.source] as WorkDiagnosis['sources'][number]
        return <li key={index}><h3>{t(`diagnostic-${finding.category}`)} · {t(`scope-${finding.scope}`)}</h3><p>{t(finding.terminal ? 'terminalEvidence' : 'observedEvidence')}</p>
          <p>{source.nodeId ?? finding.nodeId ?? source.sessionId}{finding.toolName === undefined ? '' : ` · ${finding.toolName}`}{finding.code === undefined ? '' : ` · ${finding.code}`}</p>
          {finding.event === undefined ? null : <p>{finding.event.type} · #{finding.event.seq} ·
            <time dateTime={new Date(finding.event.time).toISOString()}>{new Date(finding.event.time).toLocaleString()}</time></p>}
          {finding.provider === undefined ? null : <p>{t('provider')}: {finding.provider}</p>}
          {finding.modelFailure?.status === undefined ? null : <p>HTTP {finding.modelFailure.status}</p>}{finding.modelFailure?.requestId === undefined ? null : <p>{t('providerRequest')}: <code>{finding.modelFailure.requestId}</code></p>}
          <details><summary>{t('originalEvidence')}</summary><pre>{finding.message || t('noErrorText')}</pre></details>
        </li>
      })}</ul>}
      <details open><summary>{t('retryPreview')}</summary>{report.retry.kind === 'agent' ? <><p>{report.retry.task}</p><p>{t(report.retry.purpose === 'design' ? 'designRetry' : 'taskRetry')}</p><div className={css.configs}><section><h3>{t('originalConfig')}</h3><pre>{report.retry.configuration === undefined ? t('noConfiguration') : JSON.stringify(report.retry.configuration, null, 2)}</pre></section><section><h3>{t('currentConfig')}</h3><pre>{executor === undefined ? t('noConfiguration') : JSON.stringify(executor, null, 2)}</pre></section></div></> : <><p>{t('publication')} v{report.retry.version} · <code>{report.retry.versionId}</code> · {t(report.retry.mode === 'verification' ? 'verificationRun' : 'executionRun')}</p><pre>{JSON.stringify(report.retry.inputs, null, 2)}</pre>{report.retry.feedback === undefined ? null : <pre>{report.retry.feedback}</pre>}<p>{t('workflowRetryModel')}</p><pre>{JSON.stringify(report.retry.execution, null, 2)}</pre></>}</details>
      {preview?.kind === 'workflow' && preview.mode === 'verification' ? <Button variant="outline" onClick={() => { repair('workflow') }}>{t('openVerification')}</Button> : null}
      <Button variant="outline" disabled={!connected || data.diagnosisStale || !eligible || retry !== null} onClick={prepare}>{t('prepareRetry')}</Button>
    </>}
    {retry === null ? null : <section className={css.check} aria-label={t('confirmRetry')}><h3>{t('confirmRetry')}</h3><p>{t('fullRetryWarning')}</p><code>{retry.request.ref.kind}:{retry.request.ref.id}</code>
      {retry.request.kind === 'retry-agent' ? <p>{t('requestRevision')} {retry.request.expectedRevision}</p> : null}
      {retry.submitted ? <p role="status">{t('uncertainRetry')}</p> : null}{error === null ? null : <p role="alert" className={css.error}>{error}</p>}
      <div className={css.actions}><Button variant="outline" disabled={!connected || busy} onClick={() => { void select(retry.request.ref) }}>{t('retrySource')}</Button><Button disabled={!connected || busy || (!retry.submitted && (data.diagnosisStale || !matchingRetry || !retryRevisionMatches))} onClick={() => {
        actions.retrySubmitted(); setBusy(true); setError(null)
        void command(retry.request).then(() => { actions.retryClear(retry.request.requestId) }, (failure: unknown) => {
          setError(failure instanceof Error ? failure.message : String(failure))
        }).finally(() => { setBusy(false) })
      }}>{t(retry.submitted ? 'recoverRetry' : 'confirmRetry')}</Button><Button variant="outline" disabled={busy} onClick={() => { actions.retryClear() }}>{t('discardRetry')}</Button></div>
    </section>}
  </section>
}
