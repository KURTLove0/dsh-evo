// @vitest-environment jsdom
/** Fixed-target review, retained uncertain requests, and independently labeled outcomes. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore, type TriggerSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { TriggerCommand, TriggerDefinition, WorkTrigger, WorkDetail } from '@deepseek-ai/dsh-api-remotes/client'
import { TriggerCapture, TriggerNavigation, TriggerPage } from '../src/client/TriggerView.tsx'
import { createTriggerViewStore } from '../src/client/store.ts'
import { parseTriggerTime } from '../src/client/time.ts'
import { en } from '../src/client/locales.ts'
afterEach(cleanup)
const source = { kind: 'agent' as const, id: 'run' as never }
const prepared: Pick<TriggerDefinition, 'name' | 'target'> = { name: 'Report', target: { kind: 'agent', id: 'agent' as never,
  workspaceId: 'workspace' as never, expectedRevision: 3, brief: { version: 1, goal: 'Original goal', background: '', deliverables: [], acceptanceCriteria: [], constraints: '' } } }
function mount(capture = false, connected = true) {
  const data = createSnapshotStore<TriggerSnapshot>({ directory: { value: { items: [], failures: [], observedAt: 1 },
    options: { minIntervalMs: 300000, pollIntervalMs: 1000, maxOccurrences: 100 }, loading: false, stale: false, error: null },
  detail: { loading: false, stale: false, error: null },
  preparation: { value: { ...prepared, source }, loading: false, error: null }, mutating: false })
  const view = createTriggerViewStore().create()
  const command = vi.fn(async (_request: TriggerCommand) => ({ id: 'trigger' as never, revision: 1 }))
  const props = { t: (key: keyof typeof en) => en[key], actions: view.actions, useStore: bindSnapshotSelector(view.store),
    useTriggers: bindSnapshotSelector(data),
    useHostDescription: (selector: (value: unknown) => unknown) => selector(connected ? {} : undefined),
    useSessions: (selector: (value: unknown) => unknown) => selector({ byId: {} }),
    useWorkspaces: (selector: (value: unknown) => unknown) => selector({ items: [] }),
    command, refresh: vi.fn(async () => {}), query: vi.fn(async () => {}), select: vi.fn(async () => {}),
    prepare: vi.fn(), openWork: vi.fn(), openSession: vi.fn(), openRun: vi.fn(async () => {}),
    detail: { ref: source, name: 'Report', workspaceId: 'workspace' as never, sessionId: 'session' as never, status: 'completed' } satisfies WorkDetail,
    disabled: false }
  const element = () => capture
    ? <TriggerCapture {...props as Parameters<typeof TriggerCapture>[0]} />
    : <TriggerPage {...props as Parameters<typeof TriggerPage>[0]} />
  let rendered = render(element())
  return { data, view, props, command, remount: () => { rendered.unmount(); rendered = render(element()) } }
}
it('keeps exact creation inputs across remount and recovers only by explicit action', async () => {
  const ui = mount(); ui.command.mockRejectedValueOnce(new Error('Lost acknowledgment'))
  fireEvent.click(screen.getByRole('button', { name: en.useTarget }))
  fireEvent.change(screen.getByRole('textbox', { name: en.utcInput }), { target: { value: '2026-10-22T09:00:00+08:00' } })
  fireEvent.click(screen.getByRole('button', { name: en.createEnabled }))
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('Lost acknowledgment') })
  const original = ui.command.mock.calls[0]![0]; expect(original).toMatchObject({ enabled: true, definition: { target: prepared.target, rule: { kind: 'at', at: Date.UTC(2026, 9, 22, 1) } } })
  ui.remount(); expect(ui.command).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: en.retryCreate }))
  await waitFor(() => { expect(ui.props.select).toHaveBeenCalledWith('trigger') })
  expect(ui.command.mock.calls[1]![0]).toEqual(original)
  expect(screen.queryByRole('region', { name: en.commandPending })).toBeNull()
})
it('rejects ambiguous dates and short intervals and pins the exact original settlement source', async () => {
  const ui = mount(); fireEvent.click(screen.getByRole('button', { name: en.useTarget }))
  fireEvent.change(screen.getByRole('textbox', { name: en.utcInput }), { target: { value: '2026-02-30T12:00:00Z' } })
  expect(screen.getByRole('button', { name: en.createEnabled }).hasAttribute('disabled')).toBe(true)
  fireEvent.change(screen.getByRole('combobox', { name: en.rule }), { target: { value: 'every' } })
  fireEvent.change(screen.getByRole('textbox', { name: en.utcInput }), { target: { value: '2026-10-22T12:00:00Z' } })
  fireEvent.change(screen.getByRole('spinbutton', { name: en.minutes }), { target: { value: '1' } })
  expect(screen.getByText(en.invalidInterval)).toBeTruthy()
  fireEvent.change(screen.getByRole('combobox', { name: en.rule }), { target: { value: 'on-settled' } })
  fireEvent.click(screen.getByRole('button', { name: en.savePaused }))
  await waitFor(() => { expect(ui.command).toHaveBeenCalledOnce() })
  expect(ui.command.mock.calls[0]![0]).toMatchObject({ enabled: false, definition: { rule: { kind: 'on-settled', source } } })
})
it('keeps historical uncertainty distinct from settled failure and acknowledgment', async () => {
  const ui = mount(), record: WorkTrigger = { id: 'trigger' as never, revision: 2, definition: { ...prepared, rule: { kind: 'at', at: 1 } },
    enabled: false, createdAt: 1, updatedAt: 2, occurrences: [{ id: 'occurrence' as never, dueAt: 1, claimedAt: 2, attempts: 2, skippedIntervals: 0,
      admission: { state: 'settled', ref: source, acceptedAt: 3, observation: { status: 'failed', observedAt: 4 } },
      notices: [{ id: 'notice' as never, kind: 'admission-unconfirmed', createdAt: 2 }, { id: 'failed' as never, kind: 'settled', status: 'failed', createdAt: 4, readAt: 5 }] }] }
  ui.data.update((state) => { state.detail = { id: record.id, value: record, loading: false, stale: false, error: null } })
  expect(await screen.findByText(en.historicalUncertain)).toBeTruthy()
  expect(screen.queryByRole('button', { name: en.recover })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.acknowledge }))
  await waitFor(() => { expect(ui.command).toHaveBeenCalledWith({ kind: 'acknowledge', id: record.id, noticeId: 'notice' }) })
  fireEvent.click(screen.getByRole('button', { name: en.openRun })); expect(ui.props.openRun).toHaveBeenCalledWith(source)
})
it('adds a preparation control without another intake form and blocks disconnected writes', () => {
  const ui = mount(true, false)
  expect(document.querySelector('form')).toBeNull()
  const button = screen.getByRole('button', { name: en.prepare }) as HTMLButtonElement
  expect(button.disabled).toBe(true); fireEvent.click(button); expect(ui.props.prepare).not.toHaveBeenCalled()
})
it('does not retry uncertain controls when remounted and preserves the compare-and-set input', () => {
  const ui = mount(), pending: TriggerCommand = { kind: 'set-enabled', id: 'trigger' as never, expectedRevision: 2, enabled: false }
  ui.view.actions.stage(pending); ui.view.actions.settled(pending, 'Lost control acknowledgment'); ui.remount()
  expect(screen.queryByRole('button', { name: en.retryCreate })).toBeNull(); expect(ui.command).not.toHaveBeenCalled()
  expect(ui.view.store.getSnapshot().pending).toEqual(pending)
  fireEvent.click(screen.getByRole('button', { name: en.clear })); expect(ui.view.store.getSnapshot().pending).toBeNull()
})
it('parses explicit offsets while rejecting normalized dates, leap seconds, and missing zones', () => {
  for (const input of ['2026-02-30T00:00Z', '2026-13-01T00:00Z', '2026-00-01T00:00Z', '2026-01-00T00:00Z',
    '2026-01-01T24:00Z', '2026-01-01T12:60Z', '2026-01-01T12:00:60Z', '2026-01-01T12:00', 'not a date', '2026-01-01T12:00+99:00']) expect(parseTriggerTime(input)).toBeUndefined()
  expect(parseTriggerTime('2028-02-29T09:30:00.123+08:00')).toBe(Date.UTC(2028, 1, 29, 1, 30, 0, 123))
})

it('applies explicit filters, refreshes, navigates, and preserves last-known read errors', async () => {
  const ui = mount(false, false)
  fireEvent.change(screen.getByRole('searchbox', { name: en.search }), { target: { value: 'report' } })
  ui.view.actions.field('workspace', 'missing-workspace'); ui.remount()
  fireEvent.change(screen.getByRole('combobox', { name: en.enabledFilter }), { target: { value: 'false' } })
  expect(screen.getByText(en.disconnected)).toBeTruthy()
  ui.data.update((state) => {
    state.directory = { value: { items: [], failures: [{ id: 'rule' as never, observedAt: 1, code: 'worker-step-failed' }], observedAt: 1 },
      submitted: { text: 'previous', enabled: false, workspaceId: 'previous' as never }, loading: true, stale: true, error: 'Directory offline' }
    state.detail = { loading: true, stale: true, error: 'Detail offline' }
    state.preparation = { loading: true, error: 'Preparation offline' }
  })
  expect(await screen.findByText(en.stale)).toBeTruthy()
  expect(screen.getAllByRole('alert')).toHaveLength(4)
  fireEvent.click(screen.getByRole('button', { name: en.openWork })); expect(ui.props.openWork).toHaveBeenCalledOnce()
})
it('submits workspace and enabled filters and selects retained directory records', async () => {
  const ui = mount()
  ui.data.update((state) => {
    state.directory.submitted = { text: '', enabled: true }
    state.directory.value = { observedAt: 1, failures: [], items: [{ id: 'trigger' as never, revision: 1, name: 'Directory rule',
      workspaceId: 'workspace' as never, target: 'workflow', enabled: true, status: 'armed', unread: 1, nextAt: 99,
      latest: { id: 'occurrence' as never, dueAt: 1, claimedAt: 2, skippedIntervals: 0, attempts: 1, admission: { state: 'pending' } } }] }
  })
  await screen.findByRole('button', { name: /Directory rule/ })
  fireEvent.change(screen.getByRole('combobox', { name: en.workspace }), { target: { value: 'workspace' } })
  fireEvent.change(screen.getByRole('combobox', { name: en.enabledFilter }), { target: { value: 'true' } })
  fireEvent.click(screen.getByRole('button', { name: en.apply }))
  expect(ui.props.query).toHaveBeenCalledWith({ text: '', workspaceId: 'workspace', enabled: true })
  fireEvent.change(screen.getByRole('combobox', { name: en.workspace }), { target: { value: '' } })
  fireEvent.change(screen.getByRole('combobox', { name: en.enabledFilter }), { target: { value: 'all' } })
  fireEvent.click(screen.getByRole('button', { name: en.apply })); expect(ui.props.query).toHaveBeenLastCalledWith({ text: '' })
  fireEvent.click(screen.getByRole('button', { name: /Directory rule/ })); expect(ui.props.select).toHaveBeenCalledWith('trigger')
  fireEvent.click(screen.getByRole('button', { name: en.refresh })); expect(ui.props.refresh).toHaveBeenCalledOnce()
})
it('renders workflow targets, interval times, unavailable observations, and exact recovery attempts', async () => {
  const ui = mount(), record: WorkTrigger = { id: 'trigger' as never, revision: 4, definition: { name: 'Workflow rule', rule: { kind: 'every', firstAt: 10, intervalMs: 60000 },
    target: { kind: 'workflow', id: 'workflow' as never, versionId: 'publication' as never, workspaceId: 'workspace' as never, inputs: { report: 'Retained input' } } },
  enabled: true, createdAt: 1, updatedAt: 2, nextAt: 100,
  occurrences: [{ id: 'uncertain' as never, dueAt: 10, claimedAt: 11, attempts: 3, skippedIntervals: 2, admission: { state: 'unconfirmed', lastAttemptAt: 12 }, notices: [] }] }
  ui.data.update((state) => { state.detail = { id: record.id, value: record, loading: false, stale: false, error: null } })
  await screen.findByRole('button', { name: en.recover })
  fireEvent.click(screen.getByRole('button', { name: en.recover }))
  await waitFor(() => { expect(ui.command).toHaveBeenCalledWith({ kind: 'recover', id: record.id, occurrenceId: 'uncertain', expectedAttempt: 3 }) })
  const admitted: WorkTrigger['occurrences'][number] = { id: 'uncertain' as never, dueAt: 10, claimedAt: 11, attempts: 4, skippedIntervals: 2,
    admission: { state: 'admitted', acceptedAt: 3, ref: source, unavailableAt: 4 }, notices: [] }
  ui.data.update((state) => { state.detail.value = { ...record, enabled: false, occurrences: [admitted] } })
  await screen.findByText(/Original execution is unavailable/)
  fireEvent.click(screen.getByRole('button', { name: en.openRun }))
  fireEvent.click(await screen.findByRole('button', { name: en.resume }))
  await waitFor(() => { expect(ui.command).toHaveBeenCalledWith({ kind: 'set-enabled', id: record.id, expectedRevision: 4, enabled: true }) })
  ui.data.update((state) => { state.detail.value = { ...record, definition: { ...record.definition, rule: { kind: 'on-settled', source } } } })
  await screen.findByText(en.eventHint)
  ui.props.openRun.mockRejectedValueOnce(new Error('Original unavailable'))
  fireEvent.click(screen.getAllByRole('button', { name: en.openRun })[0]!)
  expect(await screen.findByText(`${en.readError}: Original unavailable`)).toBeTruthy()
})
it('creates valid intervals, rejects invalid programmatic submission, and prepares another original execution', async () => {
  const ui = mount(); fireEvent.click(screen.getByRole('button', { name: en.useTarget }))
  fireEvent.submit(screen.getByRole('button', { name: en.createEnabled }).closest('form')!)
  expect(ui.command).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('textbox', { name: en.name }), { target: { value: 'Interval' } })
  fireEvent.change(screen.getByRole('combobox', { name: en.rule }), { target: { value: 'every' } })
  fireEvent.change(screen.getByRole('textbox', { name: en.utcInput }), { target: { value: '2099-01-01T12:00Z' } })
  fireEvent.click(screen.getByRole('button', { name: en.createEnabled }))
  await waitFor(() => { expect(ui.command).toHaveBeenCalledOnce() })
  expect(ui.command.mock.calls[0]![0]).toMatchObject({ definition: { rule: { kind: 'every', firstAt: Date.UTC(2099, 0, 1, 12), intervalMs: 3600000 } } })
  cleanup()
  const capture = mount(true)
  fireEvent.click(screen.getByRole('button', { name: en.prepare })); expect(capture.props.prepare).toHaveBeenCalledWith(source)
  expect(capture.view.store.getSnapshot().draft).toBeNull()
})
it('opens navigation at both sidebar widths', () => {
  const open = vi.fn(), props = { t: (key: keyof typeof en) => en[key], open, wide: true }
  const ui = render(<TriggerNavigation {...props as Parameters<typeof TriggerNavigation>[0]} />)
  fireEvent.click(screen.getByRole('button', { name: en.title })); expect(open).toHaveBeenCalledOnce()
  ui.rerender(<TriggerNavigation {...{ ...props, wide: false } as Parameters<typeof TriggerNavigation>[0]} />)
  expect(screen.getByRole('button', { name: en.title })).toBeTruthy()
})
it('keeps project labels, unavailable deployment limits, and stale in-flight observations explicit', async () => {
  const ui = mount()
  ui.view.actions.draft(prepared, source); ui.view.actions.rule('every'); ui.view.actions.field('at', '2000-01-01T00:00Z')
  ui.props.useWorkspaces = selector => selector({ items: [{ workspaceId: 'workspace', title: 'Named project' }] })
  ui.data.update((state) => {
    delete state.directory.options; delete state.directory.value
    state.directory.submitted = { text: '' }
    state.preparation = { loading: false, error: null }
  })
  ui.remount()
  expect(screen.getByText(en.past)).toBeTruthy()
  expect(screen.getByText(en.invalidInterval)).toBeTruthy()
  expect(screen.queryByText(en.minimum)).toBeNull()
  const record: WorkTrigger = { id: 'trigger' as never, revision: 1, definition: { ...prepared, rule: { kind: 'at', at: 1 } },
    enabled: true, createdAt: 1, updatedAt: 1, occurrences: [{ id: 'occurrence' as never, dueAt: 1, claimedAt: 2, skippedIntervals: 0, attempts: 1,
      admission: { state: 'admitted', ref: source, acceptedAt: 3, observation: { status: 'running', observedAt: 4 } }, notices: [] }] }
  ui.data.update((state) => {
    state.directory.value = { items: [{ id: record.id, revision: 1, name: 'Named-project rule', workspaceId: 'workspace' as never,
      target: 'agent', enabled: true, status: 'armed', unread: 0 }], failures: [], observedAt: 1 }
    state.detail = { id: record.id, value: record, stale: true, loading: false, error: null }
  })
  expect(await screen.findByText(en.stale)).toBeTruthy()
  expect(screen.getAllByText('Named project').length).toBeGreaterThan(0)
  expect(screen.queryByText(/Original execution is unavailable/)).toBeNull()
  ui.props.openRun.mockRejectedValueOnce('Original unavailable')
  fireEvent.click(screen.getByRole('button', { name: en.openRun }))
  expect(await screen.findByText(`${en.readError}: Original unavailable`)).toBeTruthy()
})
