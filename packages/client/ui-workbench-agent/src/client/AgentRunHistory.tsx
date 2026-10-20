/** Searchable execution records and the configuration captured by the host. */
import type { AgentCommand, AgentDefinition, AgentRun, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, IconCheckOutline16, IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentKey } from './locales.ts'
import css from './AgentPage.module.css'

interface HistoryProps {
  runs: AgentRun[]
  limit?: number | undefined
  workspaces: Record<string, string>
  sessions: ReadonlySet<SessionId>
  kind: 'all' | 'task' | 'design'
  filterKind: (kind: HistoryProps['kind']) => void
  query: string
  status: 'all' | AgentRun['status']
  busy: boolean
  archived: boolean
  runtimeAvailable: boolean
  t: (key: AgentKey) => string
  search: (query: string) => void
  filter: (status: HistoryProps['status']) => void
  command: (command: AgentCommand) => void
  openSession: (id: SessionId) => void
  review: (definition: AgentDefinition) => void
}

/**
 * Inspect committed runs without substituting the agent's current configuration.
 * @param props - recorded history, viewing state, and explicit host operations.
 * @returns searchable records with transcript, cancellation, and retry actions.
 */
export function AgentRunHistory({
  runs, limit, kind, filterKind, workspaces, sessions, query, status, busy, archived, runtimeAvailable, t,
  search, filter, command, openSession, review,
}: HistoryProps) {
  const needle = query.trim().toLocaleLowerCase()
  const visible = runs.filter(run => (kind === 'all' || (run.purpose === 'design' ? 'design' : 'task') === kind) && (status === 'all' || run.status === status)
    && [run.prompt, run.error ?? '', workspaces[run.workspaceId] ?? run.workspaceId]
      .some(text => text.toLocaleLowerCase().includes(needle)))
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
  const shown = limit === undefined ? visible : visible.slice(0, limit)
  return <section className={css.history} aria-label={t('runs')}>
    <div className={css.workFilters} role="group" aria-label={t('taskType')}>
      {(['all', 'task', 'design'] as const).map(value => <button type="button" key={value} aria-pressed={kind === value} onClick={() => { filterKind(value) }}>{t(value === 'all' ? 'allWork' : value === 'task' ? 'taskRun' : 'designRun')}</button>)}
      <span>{t('shownRuns')} {shown.length} / {runs.length}</span>
    </div>
    <div className={css.historyToolbar}>
      <input type="search" aria-label={t('searchRuns')} placeholder={t('searchRuns')} value={query} onChange={(event) => { search(event.target.value) }} />
      <label>{t('runStatus')}<select value={status} onChange={(event) => { filter(event.target.value as HistoryProps['status']) }}>
        {(['all', 'queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted'] as const).map(value => <option key={value} value={value}>{t(value)}</option>)}
      </select></label>
    </div>
    {visible.length === 0 ? <p>{t(runs.length === 0 ? 'noRuns' : 'noMatchingRuns')}</p> : shown.map((run) => {
      const candidate = run.candidate
      return <article key={run.id} className={css.run}>
        <div className={css.runTitle}>
          <span className={css.runSymbol} data-status={run.status} aria-hidden="true">{run.status === 'completed' ? <IconCheckOutline16 /> : run.status === 'failed' ? <IconCloseOutline16 /> : <span />}</span>
          <strong>{run.prompt}</strong>
          <span className={css.badge}>{t(run.purpose === 'design' ? 'designRun' : 'taskRun')}</span>
        </div>
        <div className={css.runMeta}>
          <span className={css.presence} data-status={run.status}>{t(run.status)}</span>
          {run.startedAt === undefined || run.endedAt === undefined ? null : <span>
            {Math.floor((run.endedAt - run.startedAt) / 60000)}m {Math.floor((run.endedAt - run.startedAt) / 1000) % 60}s
          </span>}
        </div>
        <dl className={css.runFacts}>
          <dt>{t('workspace')}</dt><dd>{workspaces[run.workspaceId] ?? run.workspaceId}</dd>
          <dt>{t('createdAt')}</dt><dd><time dateTime={new Date(run.createdAt).toISOString()}>{new Date(run.createdAt).toLocaleString()}</time></dd>
          {run.startedAt === undefined ? null : <><dt>{t('startedAt')}</dt><dd><time dateTime={new Date(run.startedAt).toISOString()}>{new Date(run.startedAt).toLocaleString()}</time></dd></>}
          {run.endedAt === undefined ? null : <><dt>{t('endedAt')}</dt><dd><time dateTime={new Date(run.endedAt).toISOString()}>{new Date(run.endedAt).toLocaleString()}</time></dd></>}
          {run.retryOf === undefined ? null : <><dt>{t('retryOf')}</dt><dd>{run.retryOf}</dd></>}
        </dl>
        {run.definition === undefined ? null : <details className={css.captured}>
          <summary>{t('capturedConfiguration')} · {t('revision')} {run.definition.revision}</summary>
          <dl className={css.facts}>
            <dt>{t('name')}</dt><dd>{run.definition.name}</dd>
            <dt>{t('runtime')}</dt><dd>{run.definition.runtime}</dd>
            <dt>{t('model')}</dt><dd>{run.definition.model === undefined ? t('runtimeDefault') : `${run.definition.model.provider} / ${run.definition.model.model}${run.definition.model.reasoningEffort ? ` · ${run.definition.model.reasoningEffort}` : ''}`}</dd>
            <dt>{t('concurrency')}</dt><dd>{run.definition.concurrency}</dd>
            <dt>{t('skills')}</dt><dd>{run.definition.skills.join(', ') || '—'}</dd>
            <dt>{t('mcpServers')}</dt><dd>{run.definition.mcpServers.map(server => `${server.name} · ${server.transport}`).join(', ') || '—'}</dd>
          </dl>
          <h3>{t('instructions')}</h3><pre className={css.instructions}>{run.definition.instructions || '—'}</pre>
        </details>}
        {run.error === undefined ? null : <p className={css.error}>{run.error}</p>}
        <div className={css.actions}>
          {candidate === undefined ? null : <Button variant="outline" disabled={busy || archived} onClick={() => { review(candidate) }}>{t('reviewCandidate')}</Button>}
          {sessions.has(run.sessionId) ? <Button variant="outline" onClick={() => { openSession(run.sessionId) }}>{t('transcript')}</Button> : null}
          {run.status === 'queued' || run.status === 'running' ? <Button variant="outline" disabled={busy} onClick={() => { command({ kind: 'stop', runId: run.id }) }}>{t('stop')}</Button> : null}
          {['failed', 'cancelled', 'interrupted'].includes(run.status) ? <Button variant="outline" disabled={busy || archived || !runtimeAvailable} onClick={() => { command({ kind: 'retry', runId: run.id }) }}>{t('retry')}</Button> : null}
        </div>
      </article>})}
  </section>
}
