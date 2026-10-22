/** Unsaved date and dimension controls, retained across statistics-page remounts. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkStatisticsExecutor, WorkStatisticsQuery } from '@deepseek-ai/dsh-api-remotes/client'

/** Date inputs are local calendar dates; report filters remain the host's submitted timestamps. */
export interface RunStatisticsView {
  from: string
  to: string
  source: 'all' | 'agent' | 'workflow'
  executor: WorkStatisticsExecutor | null
  workspaceId: string
  group: 'executors' | 'workspaces' | 'days'
}
type RunStatisticsActions = {
  dates: (state: RunStatisticsView, from: string, to: string) => void
  source: (state: RunStatisticsView, source: RunStatisticsView['source']) => void
  executor: (state: RunStatisticsView, executor: WorkStatisticsExecutor | null) => void
  workspace: (state: RunStatisticsView, workspaceId: string) => void
  group: (state: RunStatisticsView, group: RunStatisticsView['group']) => void
}
const day = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
/**
 * Create the statistics control store independently of observed host results.
 * @returns the declaration and complete view action API.
 */
export function createRunStatisticsViewStore(): EngineStoreHandle<RunStatisticsView, RunStatisticsActions> {
  return defineStore({
    init: (): RunStatisticsView => {
      const to = new Date(), from = new Date(to)
      from.setDate(from.getDate() - 29)
      return { from: day(from), to: day(to), source: 'all', executor: null, workspaceId: '', group: 'executors' }
    },
    actions: {
      dates: (state: RunStatisticsView, from: string, to: string) => { state.from = from; state.to = to },
      source: (state: RunStatisticsView, source: RunStatisticsView['source']) => { state.source = source; state.executor = null },
      executor: (state: RunStatisticsView, executor: WorkStatisticsExecutor | null) => { state.executor = executor },
      workspace: (state: RunStatisticsView, workspaceId: string) => { state.workspaceId = workspaceId; state.executor = null },
      group: (state: RunStatisticsView, group: RunStatisticsView['group']) => { state.group = group },
    },
  })
}
/**
 * Resolve local calendar controls to an inclusive-start, exclusive-end submission cohort.
 * @param view - current date and dimension controls.
 * @param usage - explicit original-log read choice.
 * @returns exact filters submitted to the host, with tomorrow's local midnight after the selected end date.
 */
export function runStatisticsQuery(view: RunStatisticsView, usage: WorkStatisticsQuery['usage']): WorkStatisticsQuery {
  const to = new Date(`${view.to}T00:00:00`)
  to.setDate(to.getDate() + 1)
  return { from: new Date(`${view.from}T00:00:00`).getTime(), to: to.getTime(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, usage,
    ...(view.source === 'all' ? {} : { source: view.source }),
    ...(view.executor === null ? {} : { executor: view.executor }),
    ...(view.workspaceId === '' ? {} : { workspaceId: view.workspaceId as NonNullable<WorkStatisticsQuery['workspaceId']> }) }
}
