// @vitest-environment jsdom
/** Run cohorts, original evidence coverage, retained filters, and source failure presentation. */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore, type WorkStatisticsSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkStatisticsCounts, WorkStatisticsReport } from '@deepseek-ai/dsh-api-remotes/client'
import { RunStatisticsPanel, type RunStatisticsProps } from '../src/client/RunStatisticsPanel.tsx'
import { createRunStatisticsViewStore, runStatisticsQuery } from '../src/client/run-view-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const counts = (): WorkStatisticsCounts => ({ runs: 2, queued: 0, active: 1, waiting: 1, settled: 1, succeeded: 1,
  failed: 0, cancelled: 0, interrupted: 0, taskRuns: 1, designRuns: 0, executionRuns: 0, verificationRuns: 1,
  elapsed: { count: 1, totalMs: 2000 }, queue: { count: 1, totalMs: 1000 },
  tokens: { usage: { uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
    requests: 1, reportedSteps: 1, checkedRuns: 1, unavailableRuns: 1, uncheckedRuns: 0 } })
function report(): WorkStatisticsReport {
  const group = { key: 'agent:reviewer', label: 'Reviewer', counts: counts() }
  return { query: { from: 0, to: 86400000, timeZone: 'UTC', usage: 'recorded' }, observedAt: 1, usageSessions: { attempted: 2, limit: 100 },
    sources: [{ source: 'agent', state: 'available', runs: 2 }, { source: 'workflow', state: 'unavailable', runs: 0, message: 'Workflow source offline' }],
    counts: counts(), days: [{ ...group, key: '1970-01-01', label: '1970-01-01' }], executors: [{ ...group, source: 'agent' }],
    workspaces: [{ ...group, key: 'workspace', label: 'workspace' }] }
}
function mount(patch: Partial<WorkStatisticsSnapshot> = {}, connected = true) {
  const data = createSnapshotStore<WorkStatisticsSnapshot>({ choices: { executors: [
    { ref: { kind: 'agent', id: 'reviewer' as never }, name: 'Reviewer', archived: false },
    { ref: { kind: 'workflow', id: 'reviewer' as never }, name: 'Review flow', archived: true, workspaceId: 'workspace' as never },
    { ref: { kind: 'workflow', id: 'elsewhere' as never }, name: 'Other project flow', archived: false, workspaceId: 'other' as never },
  ], failures: [] }, choicesLoading: false, choicesError: null, loading: false, stale: false, error: null, report: undefined, ...patch })
  const view = createRunStatisticsViewStore().create()
  const read = vi.fn(async () => {}), choices = vi.fn(async () => {}), invalidate = vi.fn()
  const props: RunStatisticsProps = {
    useWork: bindSnapshotSelector(data), useStore: bindSnapshotSelector(view.store), actions: view.actions,
    useHostDescription: select => select(connected ? {} as never : undefined),
    useWorkspaces: select => select({ items: [{ workspaceId: 'workspace', title: 'Project' }] } as never),
    useSessions: () => undefined as never, t: key => en[key as keyof typeof en], read, choices, invalidate }
  const rendered = render(<RunStatisticsPanel {...props} />)
  return { data, view, read, choices, invalidate, rendered, props }
}
it('submits exact local-date cohorts and source-qualified executors, retaining controls across remounts', () => {
  const ui = mount()
  fireEvent.change(screen.getByLabelText(en.fromDate), { target: { value: '2026-10-01' } })
  fireEvent.change(screen.getByLabelText(en.toDate), { target: { value: '2026-10-02' } })
  fireEvent.change(screen.getByLabelText(en.workspace), { target: { value: 'workspace' } })
  expect(screen.queryByRole('option', { name: /Other project flow/ })).toBeNull()
  fireEvent.change(screen.getByLabelText(en.executor), { target: { value: 'workflow:reviewer' } })
  fireEvent.submit(screen.getByRole('form', { name: en.workFilters }))
  expect(ui.read).toHaveBeenLastCalledWith({ from: new Date('2026-10-01T00:00:00').getTime(), to: new Date('2026-10-03T00:00:00').getTime(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, usage: 'skip', workspaceId: 'workspace', executor: { kind: 'workflow', id: 'reviewer' } })
  fireEvent.click(screen.getByRole('button', { name: en.readTokens }))
  expect(ui.read).toHaveBeenLastCalledWith(expect.objectContaining({ usage: 'recorded' }))
  fireEvent.change(screen.getByLabelText(en.source), { target: { value: 'agent' } })
  expect(ui.view.store.getSnapshot().executor).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.refreshChoices }))
  expect(ui.choices).toHaveBeenCalledTimes(2)
  ui.rendered.unmount(); render(<RunStatisticsPanel {...ui.props} />)
  expect(screen.getByLabelText<HTMLInputElement>(en.fromDate).value).toBe('2026-10-01')
  expect(ui.read).toHaveBeenCalledTimes(2)
  expect(runStatisticsQuery(ui.view.store.getSnapshot(), 'skip')).toMatchObject({ source: 'agent' })
  act(() => { ui.view.actions.workspace('') })
  expect(runStatisticsQuery(ui.view.store.getSnapshot(), 'skip').workspaceId).toBeUndefined()
})
it('shows execution outcomes and measurement coverage with accessible dimension tables', () => {
  const ui = mount({ report: report(), stale: true })
  expect(screen.getByText(en.workStale)).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toBe('Workflow source offline')
  expect(screen.getAllByText('15')).toHaveLength(2)
  expect(screen.getByText('100%')).toBeTruthy()
  const table = screen.getByRole('table', { name: en['table-executors'] })
  expect(within(table).getByRole('rowheader', { name: 'Agent · Reviewer' })).toBeTruthy()
  fireEvent.change(screen.getByLabelText(en.groupBy), { target: { value: 'workspaces' } })
  expect(screen.getByRole('rowheader', { name: 'Project' })).toBeTruthy()
  fireEvent.change(screen.getByLabelText(en.groupBy), { target: { value: 'days' } })
  expect(screen.getByRole('rowheader', { name: '1970-01-01' })).toBeTruthy()
  expect(ui.read).not.toHaveBeenCalled()
  const original = ui.data.getSnapshot().report!
  act(() => { ui.data.set({ ...ui.data.getSnapshot(), report: { ...original, query: { ...original.query, workspaceId: 'missing' as never,
    executor: { kind: 'agent', id: 'reviewer' as never } } } }) })
  expect(screen.getByText(/missing · Agent/)).toBeTruthy()
})
it('leaves unknown duration and usage as unavailable and keeps failures visible when disconnected', () => {
  const noData = report()
  noData.counts.settled = 0; noData.counts.elapsed.count = 0; noData.counts.tokens.reportedSteps = 0
  noData.executors = []; noData.query.source = 'agent'
  const ui = mount({ report: noData, loading: true, error: 'Query refused', choicesError: 'Choices refused',
    choices: { executors: [], failures: [{ source: 'workflow', message: 'Catalog refused' }] } }, false)
  expect(screen.getByText(en.disconnected)).toBeTruthy()
  expect(screen.getByText(en.loadingWork)).toBeTruthy()
  expect(screen.getByText(en.noWorkRows)).toBeTruthy()
  expect(screen.getAllByRole('alert').map(element => element.textContent)).toEqual(['Choices refused', 'Workflow: Catalog refused', 'Query refused', 'Workflow source offline'])
  expect(screen.getByRole<HTMLButtonElement>('button', { name: en.readTokens }).disabled).toBe(true)
  expect(ui.read).not.toHaveBeenCalled()
  act(() => { ui.view.actions.executor({ kind: 'agent', id: 'reviewer' as never }); ui.view.actions.executor(null); ui.view.actions.workspace('') })
})
it('retains old submitted filters rather than presenting changed controls as already read', () => {
  const ui = mount({ report: report(), choices: undefined, choicesLoading: true })
  fireEvent.change(screen.getByLabelText(en.executor), { target: { value: '' } })
  expect(ui.invalidate).toHaveBeenCalled()
  expect(screen.getByText(/Submitted range/).textContent).toContain(new Date(0).toLocaleString())
  act(() => { ui.data.set({ ...ui.data.getSnapshot(), report: { ...report(), workspaces: [{ key: 'unknown', label: 'Unknown workspace', counts: counts() }] } })
    ui.view.actions.group('workspaces') })
  expect(screen.getByRole('rowheader', { name: 'Unknown workspace' })).toBeTruthy()
})

it('does not present all unavailable sources as zero work', () => {
  const missing = report()
  missing.sources = [{ source: 'agent', state: 'unavailable', runs: 0 }, { source: 'workflow', state: 'excluded', runs: 0 }]
  mount({ report: missing })
  expect(screen.getByText(en.noAvailableSources)).toBeTruthy()
  expect(screen.queryByRole('table')).toBeNull()
})

it('keeps short recorded durations visible in milliseconds', () => {
  const fast = report(); fast.counts.elapsed = { count: 1, totalMs: 10 }
  mount({ report: fast })
  expect(screen.getByText('10 ms')).toBeTruthy()
})
