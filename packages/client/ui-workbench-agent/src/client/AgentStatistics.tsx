/** Run-derived statistics for the selected identity, including an accessible daily histogram. */
import type { AgentRun } from '@deepseek-ai/dsh-api-remotes/client'
import type { AgentKey } from './locales.ts'
import css from './AgentPage.module.css'

/**
 * Summarize retained executions created during the last thirty local calendar days.
 * @param props - selected identity's recorded runs and localized labels.
 * @returns counts, settled-run success rate, measured duration, and daily activity.
 */
export function AgentStatistics({ runs, t }: { runs: AgentRun[]; t: (key: AgentKey) => string }) {
  const now = Date.now()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - 29)
  const recent = runs.filter(run => run.createdAt >= start.getTime() && run.createdAt <= now)
  const settled = recent.filter(run => run.status !== 'queued' && run.status !== 'running')
  const completed = settled.filter(run => run.status === 'completed').length
  const durations = settled.flatMap(run =>
    run.startedAt !== undefined && run.endedAt !== undefined && run.endedAt >= run.startedAt ? [run.endedAt - run.startedAt] : [],
  )
  const seconds = durations.length === 0 ? undefined
    : Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length / 1000)
  const days = Array.from({ length: 30 }, (_, index) => {
    const from = new Date(start); from.setDate(from.getDate() + index)
    const to = new Date(from); to.setDate(to.getDate() + 1)
    const count = recent.filter(run => run.createdAt >= from.getTime() && run.createdAt < to.getTime()).length
    return { date: from.toLocaleDateString(), count }
  })
  const maximum = Math.max(1, ...days.map(day => day.count))
  return <section className={css.statistics} aria-label={t('last30Days')}>
    <h3>{t('last30Days')}</h3>
    <dl className={css.metrics}>
      <div><dt>{t('totalRuns')}</dt><dd>{recent.length}</dd></div>
      <div><dt>{t('successRate')}</dt><dd>{settled.length === 0 ? '—' : `${Math.round(completed / settled.length * 100)}%`}</dd></div>
      <div>
        <dt>{t('averageDuration')}</dt>
        <dd>{seconds === undefined ? '—' : `${Math.floor(seconds / 60)}m ${seconds % 60}s`}</dd>
      </div>
      <div><dt>{t('failures')}</dt><dd>{recent.filter(run => run.status === 'failed').length}</dd></div>
    </dl>
    <svg className={css.activity} viewBox="0 0 300 54" role="img" aria-label={t('activity')}>
      <desc>{days.map(day => `${day.date}: ${day.count}`).join('; ')}</desc>
      {days.map((day, index) => <rect key={index}
        x={index * 10 + 1} y={52 - day.count / maximum * 48} width={8} height={day.count / maximum * 48} />)}
      <path d="M0 53H300" />
    </svg>
  </section>
}
